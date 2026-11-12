// The queue for the owner's CLI reader, independent of the Netlify runtime so
// it can be tested and run in the local dev server.
//
// A signed-in visitor posts their photos (POST /api/convert). They wait here,
// in Netlify Blobs, until the owner's CLI (cli/pgn-worker.mjs) lists and
// claims the job, reads it with a local Claude Code on the owner's
// subscription, and posts the reading back (/api/worker/*). The browser polls
// GET /api/jobs/:id, and may cancel (DELETE) to read through the HintWise
// gateway instead. Photos are deleted once the job finishes, and jobs after
// a day. No Anthropic key is involved anywhere on this side.
import type { AppConfig } from "./config";
import type { KV } from "./kv";
import { sha256Hex, userFrom, type UserVerifier } from "./auth";
import { dayKey, release, reserve, weekKey } from "./quota";
import { ExtractionSchema, type Extraction } from "../../src/lib/schema";
import { SYSTEM_PROMPT, extractionJsonSchema, userText } from "../../src/lib/prompt";

export interface ImageInput {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: string; // base64
}

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "error";
  identity: string; // user:<HintWise user id>
  lease?: { workerId: string; until: string; tokenHash: string };
  attempts?: number; // reads that failed and were put back in the queue
  createdAt: string;
  updatedAt: string;
  reservedAt: string; // when the reading was counted against the caps
  viewTokenHash: string;
  imageCount: number;
  result?: Extraction;
  usage?: { model: string; inputTokens: number; outputTokens: number };
  error?: { code: string; message: string };
}

export interface Deps {
  config: AppConfig;
  jobs: KV;
  quota: KV;
  verifyUser: UserVerifier;
  now?: () => Date;
}

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_ATTEMPTS = 3;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json(status, { error: { code, message }, ...extra });
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
}

function base64Size(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const nowOf = (deps: Deps) => deps.now?.() ?? new Date();

/** POST /api/convert: queue photos for the CLI reader. Needs a signed-in visitor. */
export async function handleConvert(req: Request, deps: Deps): Promise<Response> {
  const { config } = deps;
  const now = nowOf(deps);
  if (req.method !== "POST") return fail(405, "method", "Use POST.");
  if (!config.workerToken) return fail(503, "reader_off", "The HintWise reader is not running.");
  const user = await userFrom(req, deps.verifyUser);
  if (!user) return fail(401, "sign_in", "Sign in to use the free reading.");

  let body: { images?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "bad_request", "The request body is not JSON.");
  }
  const images = Array.isArray(body.images) ? (body.images as ImageInput[]) : [];
  if (images.length === 0) return fail(400, "no_images", "Add a photo of the scoresheet.");
  if (images.length > config.maxImages) return fail(400, "too_many_images", `At most ${config.maxImages} photos per game.`);
  for (const img of images) {
    if (!img || typeof img.data !== "string" || !MEDIA_TYPES.has(img.mediaType)) {
      return fail(400, "bad_image", "Photos must be JPEG, PNG, WebP or GIF.");
    }
    if (base64Size(img.data) > config.maxImageBytes) return fail(413, "image_too_large", "A photo is too large.");
  }

  const identity = `user:${user.id}`;
  const r = await reserve(deps.quota, identity, config.limits, now);
  if (!r.ok) {
    const message =
      r.denied === "global"
        ? "The HintWise reader has done all it can for today. Try again tomorrow, or use your own API key."
        : r.denied === "day"
          ? `You have used today's ${config.limits.perDay} readings. Try again tomorrow, or use your own API key.`
          : `You have used this week's ${config.limits.perWeek} readings. Try again next week, or use your own API key.`;
    return fail(429, `limit_${r.denied}`, message);
  }

  const id = crypto.randomUUID();
  const viewToken = randomToken();
  const job: Job = {
    id,
    status: "queued",
    identity,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    reservedAt: now.toISOString(),
    viewTokenHash: await sha256Hex(viewToken),
    imageCount: images.length,
  };
  try {
    await Promise.all(
      images.map((img, n) => deps.jobs.setBytes(`img/${id}/${n}`, decodeBase64(img.data), { mediaType: img.mediaType })),
    );
    await deps.jobs.setJSON(`job/${id}`, job);
    await deps.jobs.setJSON(`queue/${id}`, { createdAt: job.createdAt });
  } catch (err) {
    console.error("convert: could not queue", id, err instanceof Error ? err.message : err);
    await finishJob(deps, job, { status: "error", error: { code: "start_failed", message: "Could not queue the photos." } });
    return fail(502, "start_failed", "Could not queue the photos. Try again.");
  }
  return json(202, { jobId: id, viewToken });
}

async function deleteImages(deps: Deps, job: Job) {
  await Promise.all(Array.from({ length: job.imageCount }, (_, n) => deps.jobs.delete(`img/${job.id}/${n}`)));
}

/**
 * Move a job to done or error, exactly once. A failed or cancelled reading
 * is given back to the person's allowance. Photos are deleted either way.
 */
async function finishJob(deps: Deps, job: Job, patch: Pick<Job, "status"> & Partial<Job>): Promise<boolean> {
  const now = nowOf(deps).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await deps.jobs.getJSON<Job>(`job/${job.id}`);
    if (cur && (cur.value.status === "done" || cur.value.status === "error")) return false;
    const next = { ...(cur?.value ?? job), ...patch, updatedAt: now };
    const ok = cur
      ? await deps.jobs.setJSON(`job/${job.id}`, next, { onlyIfMatch: cur.etag })
      : await deps.jobs.setJSON(`job/${job.id}`, next, { onlyIfNew: true });
    if (!ok) continue;
    if (patch.status === "error") await release(deps.quota, next.identity, new Date(next.reservedAt));
    await deleteImages(deps, next);
    await deps.jobs.delete(`queue/${job.id}`);
    return true;
  }
  return false;
}

async function viewable(req: Request, id: string | undefined, deps: Deps) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const entry = id ? await deps.jobs.getJSON<Job>(`job/${id}`) : null;
  if (!entry || entry.value.viewTokenHash !== (await sha256Hex(token))) return null;
  return entry;
}

/** GET /api/jobs/:id?token=...  and  DELETE (cancel) */
export async function handleJob(req: Request, id: string | undefined, deps: Deps): Promise<Response> {
  const entry = await viewable(req, id, deps);
  if (!entry) return fail(404, "not_found", "No such reading.");
  let job = entry.value;

  if (req.method === "DELETE") {
    await finishJob(deps, job, { status: "error", error: { code: "cancelled", message: "Cancelled." } });
    return json(200, { ok: true });
  }

  const pending = job.status === "queued" || job.status === "running";
  if (pending && nowOf(deps).getTime() - new Date(job.createdAt).getTime() > deps.config.localTimeoutMs) {
    const message = "No reader picked up these photos in time. Try again later, or use your own API key.";
    await finishJob(deps, job, { status: "error", error: { code: "timeout", message } });
    job = (await deps.jobs.getJSON<Job>(`job/${job.id}`))?.value ?? job;
  }
  return json(200, { id: job.id, status: job.status, result: job.result, error: job.error });
}

// ---- CLI reader endpoints (Authorization: Bearer PGN_WORKER_TOKEN) ----

async function workerAuthorized(req: Request, config: AppConfig): Promise<boolean> {
  if (!config.workerToken) return false;
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  // Compare digests so the comparison time does not depend on the token.
  return (await sha256Hex(given)) === (await sha256Hex(config.workerToken));
}

function leaseLive(job: Job, now: Date): boolean {
  return Boolean(job.lease && new Date(job.lease.until).getTime() > now.getTime());
}

function open(job: Job, now: Date): boolean {
  return job.status === "queued" || (job.status === "running" && !leaseLive(job, now));
}

/** GET /api/worker/jobs: jobs waiting for the CLI reader, oldest first. */
export async function handleWorkerList(req: Request, deps: Deps): Promise<Response> {
  if (!(await workerAuthorized(req, deps.config))) return fail(401, "unauthorized", "Bad or missing worker token.");
  const now = nowOf(deps);
  const jobs: { id: string; createdAt: string; imageCount: number; attempts: number }[] = [];
  for (const key of await deps.jobs.list("queue/")) {
    const id = key.slice("queue/".length);
    const job = (await deps.jobs.getJSON<Job>(`job/${id}`))?.value;
    if (job && open(job, now)) jobs.push({ id, createdAt: job.createdAt, imageCount: job.imageCount, attempts: job.attempts ?? 0 });
  }
  jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return json(200, { jobs });
}

/** POST /api/worker/jobs/:id/claim {workerId}: reserve a job and get its photos. */
export async function handleWorkerClaim(req: Request, id: string | undefined, deps: Deps): Promise<Response> {
  if (!(await workerAuthorized(req, deps.config))) return fail(401, "unauthorized", "Bad or missing worker token.");
  const body = (await req.json().catch(() => ({}))) as { workerId?: unknown };
  const workerId = typeof body.workerId === "string" ? body.workerId.slice(0, 80) : "cli";
  const now = nowOf(deps);
  const entry = id ? await deps.jobs.getJSON<Job>(`job/${id}`) : null;
  if (!entry) return fail(404, "not_found", "No such job in the queue.");
  const job = entry.value;
  if (!open(job, now)) return fail(409, "taken", "This job is already being read or is finished.");

  const leaseToken = randomToken();
  const lease = { workerId, until: new Date(now.getTime() + deps.config.leaseMs).toISOString(), tokenHash: await sha256Hex(leaseToken) };
  const next: Job = { ...job, status: "running", lease, updatedAt: now.toISOString() };
  if (!(await deps.jobs.setJSON(`job/${job.id}`, next, { onlyIfMatch: entry.etag }))) {
    return fail(409, "taken", "Another reader claimed this job first.");
  }
  const images: ImageInput[] = [];
  for (let n = 0; n < job.imageCount; n++) {
    const img = await deps.jobs.getBytes(`img/${job.id}/${n}`);
    if (!img) {
      await finishJob(deps, next, { status: "error", error: { code: "internal", message: "The photo is missing." } });
      return fail(410, "gone", "The photos for this job are missing.");
    }
    images.push({ mediaType: img.metadata.mediaType as ImageInput["mediaType"], data: encodeBase64(img.data) });
  }
  return json(200, {
    jobId: job.id,
    leaseToken,
    leaseUntil: lease.until,
    images,
    systemPrompt: SYSTEM_PROMPT,
    userText: userText(images.length),
    schema: extractionJsonSchema(),
  });
}

/**
 * POST /api/worker/jobs/:id/result
 *   {leaseToken, extraction}            the reading, checked against the schema
 *   {leaseToken, error, retry?: true}    the read failed; retry puts it back in the queue
 */
export async function handleWorkerResult(req: Request, id: string | undefined, deps: Deps): Promise<Response> {
  if (!(await workerAuthorized(req, deps.config))) return fail(401, "unauthorized", "Bad or missing worker token.");
  const body = (await req.json().catch(() => null)) as {
    leaseToken?: string;
    extraction?: unknown;
    error?: { message?: string };
    retry?: boolean;
    usage?: { model?: string; inputTokens?: number; outputTokens?: number };
  } | null;
  if (!body) return fail(400, "bad_request", "The request body is not JSON.");
  const now = nowOf(deps);
  const entry = id ? await deps.jobs.getJSON<Job>(`job/${id}`) : null;
  if (!entry) return fail(404, "not_found", "No such job.");
  const job = entry.value;
  if (job.status !== "running" || !job.lease || job.lease.tokenHash !== (await sha256Hex(body.leaseToken ?? ""))) {
    return fail(409, "not_leased", "This job is not leased to you (it may have expired, been reclaimed or cancelled).");
  }

  if (body.error) {
    const attempts = (job.attempts ?? 0) + 1;
    if (body.retry && attempts < MAX_ATTEMPTS) {
      const back: Job = { ...job, status: "queued", lease: undefined, attempts, updatedAt: now.toISOString() };
      if (!(await deps.jobs.setJSON(`job/${job.id}`, back, { onlyIfMatch: entry.etag }))) return fail(409, "conflict", "Try again.");
      return json(200, { ok: true, requeued: true });
    }
    const message = String(body.error.message ?? "The reader could not read this photo.").slice(0, 300);
    await finishJob(deps, job, { status: "error", error: { code: "reader_failed", message } });
    return json(200, { ok: true, requeued: false });
  }

  const parsed = ExtractionSchema.safeParse(body.extraction);
  if (!parsed.success) {
    return fail(422, "invalid_extraction", "The reading does not match the schema.", {
      issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const usage = {
    model: String(body.usage?.model ?? "local"),
    inputTokens: Number(body.usage?.inputTokens ?? 0),
    outputTokens: Number(body.usage?.outputTokens ?? 0),
  };
  await finishJob(deps, job, { status: "done", result: parsed.data, usage, lease: undefined });
  console.log("worker-api: done", job.id, job.lease.workerId, usage);
  return json(200, { ok: true });
}

/** Delete usage counters for days and weeks that are over. */
export async function cleanupQuota(deps: Deps): Promise<number> {
  const now = nowOf(deps);
  let removed = 0;
  for (const prefix of ["day/", "global/", "week/"]) {
    const keep =
      prefix === "week/"
        ? [weekKey(now), weekKey(new Date(now.getTime() - 7 * 86_400_000))]
        : [dayKey(now), dayKey(new Date(now.getTime() - 86_400_000))];
    for (const key of await deps.quota.list(prefix)) {
      const period = key.split("/")[1] ?? "";
      if (period >= keep[1]) continue; // the current and the previous period stay
      await deps.quota.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Delete jobs older than a day. Returns how many were removed. */
export async function cleanupJobs(deps: Deps, maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const now = nowOf(deps).getTime();
  let removed = 0;
  for (const key of await deps.jobs.list("job/")) {
    const job = (await deps.jobs.getJSON<Job>(key))?.value;
    if (!job || now - new Date(job.createdAt).getTime() < maxAgeMs) continue;
    await deleteImages(deps, job);
    await deps.jobs.delete(`queue/${job.id}`);
    await deps.jobs.delete(key);
    removed++;
  }
  return removed;
}

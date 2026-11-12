// Request handling for the conversion API, independent of the Netlify
// runtime so it can be tested and run in the local dev server.
//
// Flow: POST /api/convert stores the photos and a job record, takes one free
// conversion if the owner's key is used, and starts the background worker.
// The worker calls Claude (which can take minutes) and writes the result to
// the job. The browser polls GET /api/jobs/:id until it is done.
//
// With a local reader (PGN_FREE_READER=local or local-then-api), free jobs
// are not given to the background worker. They wait in a queue that the
// owner's CLI (cli/pgn-worker.mjs) lists, claims, reads with a local Claude
// Code, and answers through the /api/worker/* endpoints below.
import type { AppConfig } from "./config";
import type { KV } from "./kv";
import { identify, sha256Hex, type Identity, type UserVerifier } from "./identity";
import { dayKey, getQuota, release, reserve, weekKey, type QuotaStatus } from "./quota";
import { ReadError, type ImageInput, type ReadResult } from "./claude";
import { ExtractionSchema, type Extraction } from "../../src/lib/schema";
import { SYSTEM_PROMPT, extractionJsonSchema, userText } from "./prompt";

export type Mode = "free" | "own-key";
export type Reader = "api" | "local";

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "error";
  mode: Mode;
  reader: Reader;
  lease?: { workerId: string; until: string; tokenHash: string };
  attempts?: number; // local reads that failed and were put back in the queue
  identity: string;
  createdAt: string;
  updatedAt: string;
  reservedAt: string | null; // set when a free conversion was taken
  viewTokenHash: string;
  workerTokenHash: string;
  imageCount: number;
  result?: Extraction;
  usage?: ReadResult["usage"];
  error?: { code: string; message: string };
}

export interface Deps {
  config: AppConfig;
  jobs: KV;
  quota: KV;
  now?: () => Date;
  verifyUser?: UserVerifier;
  /** Start the worker for a job. Must not wait for the job to finish. */
  startWorker: (body: WorkerRequest) => Promise<void>;
  readScoresheet: (opts: {
    apiKey: string;
    model: string;
    effort: AppConfig["effort"];
    images: ImageInput[];
    baseURL: string;
  }) => Promise<ReadResult>;
}

export interface WorkerRequest {
  jobId: string;
  workerToken: string;
  apiKey?: string; // the visitor's own key; passed through, never stored
}

const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// A job that has not finished in this long is treated as failed (the
// background function limit is 15 minutes).
const STALE_MS = 16 * 60 * 1000;
const MAX_LOCAL_ATTEMPTS = 3;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
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

/** Which reader a free conversion gets, or null if none is set up. */
export function freeReaderFor(config: AppConfig): Reader | null {
  if (config.limits.perDay <= 0) return null;
  if (config.freeReader !== "api" && config.workerToken) return "local";
  return config.ownerKey ? "api" : null;
}

export function publicQuota(config: AppConfig, status: QuotaStatus | null, identity: Identity) {
  return {
    freeAvailable: freeReaderFor(config) !== null,
    signedIn: identity.kind === "user",
    quota: status,
  };
}

/** GET /api/quota */
export async function handleQuota(req: Request, ip: string | undefined, deps: Deps): Promise<Response> {
  const identity = await identify(req, ip, deps.config.identitySalt, deps.verifyUser);
  const status = freeReaderFor(deps.config)
    ? await getQuota(deps.quota, identity.id, deps.config.limits, deps.now?.())
    : null;
  return json(200, publicQuota(deps.config, status, identity));
}

/** POST /api/convert */
export async function handleConvert(req: Request, ip: string | undefined, deps: Deps): Promise<Response> {
  const { config } = deps;
  const now = deps.now?.() ?? new Date();
  if (req.method !== "POST") return fail(405, "method", "Use POST.");

  let body: { mode?: unknown; images?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "bad_request", "The request body is not JSON.");
  }
  const mode = body.mode === "own-key" ? "own-key" : body.mode === "free" ? "free" : null;
  if (!mode) return fail(400, "bad_request", 'mode must be "free" or "own-key".');

  const images = Array.isArray(body.images) ? (body.images as ImageInput[]) : [];
  if (images.length === 0) return fail(400, "no_images", "Add a photo of the scoresheet.");
  if (images.length > config.maxImages) {
    return fail(400, "too_many_images", `At most ${config.maxImages} photos per game.`);
  }
  for (const img of images) {
    if (!img || typeof img.data !== "string" || !MEDIA_TYPES.has(img.mediaType)) {
      return fail(400, "bad_image", "Photos must be JPEG, PNG, WebP or GIF.");
    }
    if (base64Size(img.data) > config.maxImageBytes) {
      return fail(413, "image_too_large", "A photo is too large. Try a smaller one.");
    }
  }

  let apiKey: string | undefined;
  if (mode === "own-key") {
    apiKey = req.headers.get("x-anthropic-key")?.trim();
    if (!apiKey || !apiKey.startsWith("sk-ant-")) {
      return fail(400, "bad_key", "Enter an Anthropic API key (it starts with sk-ant-).");
    }
  }
  const reader: Reader | null = mode === "own-key" ? "api" : freeReaderFor(config);
  if (!reader) return fail(503, "free_unavailable", "Free conversions are not available. Use your own API key.");

  const identity = await identify(req, ip, config.identitySalt, deps.verifyUser);
  let reservedAt: string | null = null;
  if (mode === "free") {
    const r = await reserve(deps.quota, identity.id, config.limits, now);
    const quota = await getQuota(deps.quota, identity.id, config.limits, now);
    if (!r.ok) {
      const message =
        r.denied === "global"
          ? "Today's free conversions are used up for everyone. Use your own API key, or try again tomorrow."
          : r.denied === "day"
            ? `You have used today's ${config.limits.perDay} free conversions. Use your own API key, or try again tomorrow.`
            : `You have used this week's ${config.limits.perWeek} free conversions. Use your own API key, or try again next week.`;
      return fail(429, `limit_${r.denied}`, message, { quota });
    }
    reservedAt = now.toISOString();
  }

  const id = crypto.randomUUID();
  const viewToken = randomToken();
  const workerToken = randomToken();
  const job: Job = {
    id,
    status: "queued",
    mode,
    reader,
    identity: identity.id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    reservedAt,
    viewTokenHash: await sha256Hex(viewToken),
    workerTokenHash: await sha256Hex(workerToken),
    imageCount: images.length,
  };

  try {
    await Promise.all(
      images.map((img, n) => deps.jobs.setBytes(`img/${id}/${n}`, decodeBase64(img.data), { mediaType: img.mediaType })),
    );
    await deps.jobs.setJSON(`job/${id}`, job);
    if (reader === "local") await deps.jobs.setJSON(`queue/${id}`, { createdAt: job.createdAt });
    else await deps.startWorker({ jobId: id, workerToken, apiKey });
  } catch (err) {
    console.error("convert: could not start job", id, err instanceof Error ? err.message : err);
    await finishJob(deps, job, { status: "error", error: { code: "start_failed", message: "Could not start the conversion. Try again." } });
    return fail(502, "start_failed", "Could not start the conversion. Try again.");
  }

  const quota = mode === "free" ? await getQuota(deps.quota, identity.id, config.limits, now) : null;
  return json(202, { jobId: id, viewToken, quota });
}

async function deleteImages(deps: Deps, job: Job) {
  await Promise.all(Array.from({ length: job.imageCount }, (_, n) => deps.jobs.delete(`img/${job.id}/${n}`)));
}

/**
 * Move a job to done or error, exactly once. A failed free conversion is
 * given back. Photos are deleted either way.
 */
async function finishJob(deps: Deps, job: Job, patch: Pick<Job, "status"> & Partial<Job>): Promise<void> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await deps.jobs.getJSON<Job>(`job/${job.id}`);
    if (cur && (cur.value.status === "done" || cur.value.status === "error")) return;
    const next = { ...(cur?.value ?? job), ...patch, updatedAt: now };
    const ok = cur
      ? await deps.jobs.setJSON(`job/${job.id}`, next, { onlyIfMatch: cur.etag })
      : await deps.jobs.setJSON(`job/${job.id}`, next, { onlyIfNew: true });
    if (!ok) continue;
    if (patch.status === "error" && next.reservedAt) {
      await release(deps.quota, next.identity, new Date(next.reservedAt));
    }
    await deleteImages(deps, next);
    await deps.jobs.delete(`queue/${job.id}`);
    return;
  }
}

/** The background worker: read the photos with Claude and store the result. */
export async function runWorker(body: WorkerRequest, deps: Deps): Promise<void> {
  const entry = await deps.jobs.getJSON<Job>(`job/${body.jobId}`);
  if (!entry) return;
  const job = entry.value;
  if (job.workerTokenHash !== (await sha256Hex(body.workerToken ?? ""))) {
    console.error("worker: bad token for job", job.id);
    return;
  }
  if (job.status !== "queued") return; // a retry of a job already handled
  if ((job.reader ?? "api") !== "api") return; // waiting for the CLI reader

  const claimed = await deps.jobs.setJSON(
    `job/${job.id}`,
    { ...job, status: "running", updatedAt: (deps.now?.() ?? new Date()).toISOString() },
    { onlyIfMatch: entry.etag },
  );
  if (!claimed) return;

  const apiKey = job.mode === "own-key" ? body.apiKey : deps.config.ownerKey;
  try {
    if (!apiKey) throw new ReadError("bad_key", "No API key for this conversion.");
    const images: ImageInput[] = [];
    for (let n = 0; n < job.imageCount; n++) {
      const img = await deps.jobs.getBytes(`img/${job.id}/${n}`);
      if (!img) throw new Error(`photo ${n} is missing`);
      images.push({ mediaType: img.metadata.mediaType as ImageInput["mediaType"], data: encodeBase64(img.data) });
    }
    const { model, effort, anthropicBaseURL: baseURL } = deps.config;
    const result = await deps.readScoresheet({ apiKey, model, effort, images, baseURL });
    console.log("worker: done", job.id, job.mode, result.usage);
    await finishJob(deps, job, { status: "done", result: result.extraction, usage: result.usage });
  } catch (err) {
    const error =
      err instanceof ReadError
        ? { code: err.code, message: err.message }
        : { code: "internal", message: "Something went wrong while reading the photo." };
    console.error("worker: failed", job.id, error.code, err instanceof Error ? err.message : err);
    await finishJob(deps, job, { status: "error", error });
  }
}

/**
 * A free job queued for the CLI reader that has waited past the fallback
 * time goes to the owner's key instead (local-then-api only).
 */
async function maybeFallBack(deps: Deps, entry: { value: Job; etag: string }, now: Date): Promise<boolean> {
  const { config } = deps;
  const job = entry.value;
  if (config.freeReader !== "local-then-api" || !config.ownerKey) return false;
  if (job.reader !== "local" || job.status !== "queued") return false;
  if (now.getTime() - new Date(job.createdAt).getTime() < config.localFallbackMs) return false;
  const workerToken = randomToken();
  const next: Job = { ...job, reader: "api", workerTokenHash: await sha256Hex(workerToken), updatedAt: now.toISOString() };
  if (!(await deps.jobs.setJSON(`job/${job.id}`, next, { onlyIfMatch: entry.etag }))) return false;
  await deps.jobs.delete(`queue/${job.id}`);
  console.log("job: no local reader in time; using the owner's key", job.id);
  try {
    await deps.startWorker({ jobId: job.id, workerToken });
  } catch (err) {
    console.error("job: fallback worker did not start", job.id, err instanceof Error ? err.message : err);
    await finishJob(deps, next, { status: "error", error: { code: "start_failed", message: "Could not start the conversion. Try again." } });
  }
  return true;
}

/** GET /api/jobs/:id?token=... */
export async function handleJob(req: Request, id: string | undefined, deps: Deps): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!id) return fail(404, "not_found", "No such conversion.");
  let entry = await deps.jobs.getJSON<Job>(`job/${id}`);
  if (!entry || entry.value.viewTokenHash !== (await sha256Hex(token))) {
    return fail(404, "not_found", "No such conversion.");
  }
  const now = deps.now?.() ?? new Date();
  if (await maybeFallBack(deps, entry, now)) entry = (await deps.jobs.getJSON<Job>(`job/${id}`)) ?? entry;

  let job = entry.value;
  const pending = job.status === "queued" || job.status === "running";
  const local = (job.reader ?? "api") === "local";
  const age = now.getTime() - new Date(local ? job.createdAt : job.updatedAt).getTime();
  const limit = local ? deps.config.localTimeoutMs : STALE_MS;
  if (pending && age > limit) {
    const message = local
      ? "No reader picked up this conversion in time. Try again later, or use your own API key."
      : "The conversion took too long. Try again.";
    await finishJob(deps, job, { status: "error", error: { code: "timeout", message } });
    job = (await deps.jobs.getJSON<Job>(`job/${id}`))?.value ?? job;
  }
  return json(200, { id: job.id, status: job.status, reader: job.reader ?? "api", result: job.result, error: job.error });
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

/** GET /api/worker/jobs: jobs waiting for the CLI reader, oldest first. */
export async function handleWorkerList(req: Request, deps: Deps): Promise<Response> {
  if (!(await workerAuthorized(req, deps.config))) return fail(401, "unauthorized", "Bad or missing worker token.");
  const now = deps.now?.() ?? new Date();
  const jobs: { id: string; createdAt: string; imageCount: number; attempts: number }[] = [];
  for (const key of await deps.jobs.list("queue/")) {
    const id = key.slice("queue/".length);
    const job = (await deps.jobs.getJSON<Job>(`job/${id}`))?.value;
    if (!job || job.reader !== "local") continue;
    const open = job.status === "queued" || (job.status === "running" && !leaseLive(job, now));
    if (open) jobs.push({ id, createdAt: job.createdAt, imageCount: job.imageCount, attempts: job.attempts ?? 0 });
  }
  jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return json(200, { jobs });
}

/** POST /api/worker/jobs/:id/claim {workerId}: reserve a job and get its photos. */
export async function handleWorkerClaim(req: Request, id: string | undefined, deps: Deps): Promise<Response> {
  if (!(await workerAuthorized(req, deps.config))) return fail(401, "unauthorized", "Bad or missing worker token.");
  const body = (await req.json().catch(() => ({}))) as { workerId?: unknown };
  const workerId = typeof body.workerId === "string" ? body.workerId.slice(0, 80) : "cli";
  const now = deps.now?.() ?? new Date();
  const entry = id ? await deps.jobs.getJSON<Job>(`job/${id}`) : null;
  if (!entry || entry.value.reader !== "local") return fail(404, "not_found", "No such job in the queue.");
  const job = entry.value;
  const open = job.status === "queued" || (job.status === "running" && !leaseLive(job, now));
  if (!open) return fail(409, "taken", "This job is already being read or is finished.");

  const leaseToken = randomToken();
  const lease = {
    workerId,
    until: new Date(now.getTime() + deps.config.leaseMs).toISOString(),
    tokenHash: await sha256Hex(leaseToken),
  };
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
  const now = deps.now?.() ?? new Date();
  const entry = id ? await deps.jobs.getJSON<Job>(`job/${id}`) : null;
  if (!entry || entry.value.reader !== "local") return fail(404, "not_found", "No such job.");
  const job = entry.value;
  if (job.status !== "running" || !job.lease || job.lease.tokenHash !== (await sha256Hex(body.leaseToken ?? ""))) {
    return fail(409, "not_leased", "This job is not leased to you (it may have expired and been reclaimed).");
  }

  if (body.error) {
    const attempts = (job.attempts ?? 0) + 1;
    if (body.retry && attempts < MAX_LOCAL_ATTEMPTS) {
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
  const now = deps.now?.() ?? new Date();
  const today = dayKey(now);
  const thisWeek = weekKey(now);
  let removed = 0;
  for (const prefix of ["day/", "global/", "week/"]) {
    for (const key of await deps.quota.list(prefix)) {
      const period = key.split("/")[1] ?? "";
      const current = prefix === "week/" ? thisWeek : today;
      // Keep the current and the previous period (a request near midnight).
      if (period >= current) continue;
      const prev = prefix === "week/" ? weekKey(new Date(now.getTime() - 7 * 86_400_000)) : dayKey(new Date(now.getTime() - 86_400_000));
      if (period >= prev) continue;
      await deps.quota.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Delete jobs older than a day. Returns how many were removed. */
export async function cleanupJobs(deps: Deps, maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const now = (deps.now?.() ?? new Date()).getTime();
  let removed = 0;
  for (const key of await deps.jobs.list("job/")) {
    const job = (await deps.jobs.getJSON<Job>(key))?.value;
    if (!job || now - new Date(job.createdAt).getTime() < maxAgeMs) continue;
    await deleteImages(deps, job);
    await deps.jobs.delete(key);
    removed++;
  }
  return removed;
}

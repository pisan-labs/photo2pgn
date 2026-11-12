// The CLI reader queue: sign-in, caps, claims, leases, results, cancel.
import { describe, expect, it, vi } from "vitest";
import { HINTWISE_SUPABASE_ANON_KEY, HINTWISE_SUPABASE_URL, loadConfig } from "../netlify/lib/config";
import { memoryKV } from "../netlify/lib/kv";
import { supabaseVerifier } from "../netlify/lib/auth";
import { dayKey, getQuota, release, reserve, weekKey } from "../netlify/lib/quota";
import {
  cleanupJobs,
  cleanupQuota,
  handleConvert,
  handleJob,
  handleWorkerClaim,
  handleWorkerList,
  handleWorkerResult,
  HEARTBEAT,
  readerRunning,
  type Deps,
} from "../netlify/lib/handlers";
import { readFileSync } from "node:fs";
import { extraction, rowsFrom, OPERA_GAME } from "./helpers";

const TOKEN = "worker-secret";
const PNG = btoa("png bytes");
const LIMITS = { perDay: 2, perWeek: 3, globalPerDay: 5 };

function setup(env: Record<string, string> = {}) {
  let clock = new Date("2026-11-12T10:00:00Z");
  const deps: Deps = {
    config: { ...loadConfig({ PGN_WORKER_TOKEN: TOKEN, ...env }), limits: LIMITS },
    jobs: memoryKV(),
    quota: memoryKV(),
    now: () => clock,
    // "alice-token" signs in as alice, "bob-token" as bob; anything else is nobody.
    verifyUser: async (t) => (t === "alice-token" || t === "bob-token" ? { id: t.replace("-token", "") } : null),
  };
  const call = {
    convert: async (who: string | null = "alice", images: unknown[] = [{ mediaType: "image/png", data: PNG }], extra: object = {}) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (who) headers.authorization = `Bearer ${who}-token`;
      const res = await handleConvert(
        new Request("https://app.test/api/convert", { method: "POST", headers, body: JSON.stringify({ images, ...extra }) }),
        deps,
      );
      return { status: res.status, body: await res.json() };
    },
    job: async (jobId: string, viewToken: string, method = "GET") =>
      (await handleJob(new Request(`https://app.test/api/jobs/${jobId}?token=${viewToken}`, { method }), jobId, deps)).json(),
    list: async (token = TOKEN) => {
      const res = await handleWorkerList(new Request("https://app.test/api/worker/jobs", { headers: { authorization: `Bearer ${token}` } }), deps);
      return { status: res.status, body: await res.json() };
    },
    claim: async (id: string, workerId = "mac") => {
      const res = await handleWorkerClaim(
        new Request(`https://app.test/api/worker/jobs/${id}/claim`, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ workerId }),
        }),
        id,
        deps,
      );
      return { status: res.status, body: await res.json() };
    },
    result: async (id: string, body: unknown) => {
      const res = await handleWorkerResult(
        new Request(`https://app.test/api/worker/jobs/${id}/result`, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(body),
        }),
        id,
        deps,
      );
      return { status: res.status, body: await res.json() };
    },
    used: async (who = "alice") => (await getQuota(deps.quota, `user:${who}`, LIMITS, clock)).day.used,
  };
  return { deps, call, setClock: (d: Date) => (clock = d) };
}

describe("settings", () => {
  it("ignores ANTHROPIC_* and CLAUDE_* variables and has no key setting at all", () => {
    const c = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-personal", CLAUDE_EFFORT: "xhigh" });
    expect(JSON.stringify(c)).not.toContain("sk-ant");
    expect(c.workerToken).toBeNull();
  });
  it("uses the same public Supabase values as .env.example", () => {
    const env = readFileSync(".env.example", "utf8");
    expect(env).toContain(`VITE_SUPABASE_URL=${HINTWISE_SUPABASE_URL}`);
    expect(env).toContain(`VITE_SUPABASE_ANON_KEY=${HINTWISE_SUPABASE_ANON_KEY}`);
    const toml = readFileSync("netlify.toml", "utf8");
    expect(toml).toContain(`VITE_SUPABASE_URL = "${HINTWISE_SUPABASE_URL}"`);
    expect(toml).toContain(`VITE_SUPABASE_ANON_KEY = "${HINTWISE_SUPABASE_ANON_KEY}"`);
    expect(toml).not.toMatch(/sk-ant-|ANTHROPIC/);
  });
  it("sends the netlify.app address to hintwise.org and serves the manifest as a manifest", () => {
    const toml = readFileSync("netlify.toml", "utf8");
    expect(toml).toMatch(/from = "https:\/\/photo2pgn\.netlify\.app\/\*"\s+to = "https:\/\/photo2pgn\.hintwise\.org\/:splat"\s+status = 301\s+force = true/);
    expect(toml).toMatch(/for = "\/manifest\.webmanifest"\s+\[headers\.values\]\s+Content-Type = "application\/manifest\+json"/);
  });
  it("keeps window.opener for the Chess TD hand-off (no same-origin opener policy)", () => {
    expect(readFileSync("netlify.toml", "utf8")).not.toMatch(/Cross-Origin-Opener-Policy\s*=\s*"same-origin"/);
  });
  it("reads PGN_ settings and falls back on bad numbers", () => {
    const c = loadConfig({ PGN_WORKER_TOKEN: " t ", PGN_READER_PER_DAY: "7", PGN_READER_PER_WEEK: "lots" });
    expect(c).toMatchObject({ workerToken: "t", limits: { perDay: 7, perWeek: 10, globalPerDay: 100 } });
  });
});

describe("sign-in check", () => {
  it("asks Supabase Auth whose token it is", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      expect(url).toBe("https://auth.test/auth/v1/user");
      expect(h.get("apikey")).toBe("anon");
      return h.get("authorization") === "Bearer good"
        ? new Response(JSON.stringify({ id: "u1" }), { status: 200 })
        : new Response("{}", { status: 401 });
    });
    const verify = supabaseVerifier("https://auth.test/", "anon", fetch as unknown as typeof globalThis.fetch);
    expect(await verify("good")).toEqual({ id: "u1" });
    expect(await verify("bad")).toBeNull();
    expect(await verify("")).toBeNull();
  });
});

describe("calendar keys and caps", () => {
  it("uses ISO weeks", () => {
    expect(weekKey(new Date("2026-01-01T12:00:00Z"))).toBe("2026-W01");
    expect(weekKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(dayKey(new Date("2026-11-12T23:59:00Z"))).toBe("2026-11-12");
  });
  it("stops at the day cap, then the week cap, and does not let parallel requests pass", async () => {
    const kv = memoryKV();
    const mon = new Date("2026-11-09T10:00:00Z");
    const results = await Promise.all(Array.from({ length: 5 }, () => reserve(kv, "a", LIMITS, mon)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(await reserve(kv, "a", LIMITS, new Date("2026-11-10T10:00:00Z"))).toEqual({ ok: true });
    expect(await reserve(kv, "a", LIMITS, new Date("2026-11-10T11:00:00Z"))).toEqual({ ok: false, denied: "week" });
    await release(kv, "a", mon);
    expect((await getQuota(kv, "a", LIMITS, mon)).day.used).toBe(1);
  });
});

describe("queue", () => {
  it("needs a signed-in visitor and a running reader", async () => {
    const { call } = setup();
    expect((await call.convert(null)).status).toBe(401);
    expect((await call.convert("mallory-not")).status).toBe(401);
    const off = setup({ PGN_WORKER_TOKEN: "" });
    expect((await off.call.convert("alice")).body.error.code).toBe("reader_off");
  });

  it("with onlyIfReaderRunning, refuses at once and uncounted unless a reader is running", async () => {
    const { deps, call, setClock } = setup();
    const ask = () => call.convert("alice", [{ mediaType: "image/png", data: PNG }], { onlyIfReaderRunning: true });
    const idle = await ask();
    expect([idle.status, idle.body.error.code]).toEqual([503, "reader_idle"]);
    expect((await call.convert("bob")).status).toBe(202); // without the flag it waits for a reader started later
    await call.list(); // the CLI checks in
    expect((await ask()).status).toBe(202);
    setClock(new Date("2026-11-12T10:01:01Z")); // 61 s later, no check-in
    expect((await ask()).body.error.code).toBe("reader_idle");
    // Busy reading a job (no polling meanwhile) counts as running until the lease ends.
    const [first] = (await call.list()).body.jobs;
    expect((await call.claim(first.id)).status).toBe(200);
    setClock(new Date("2026-11-12T10:10:00Z"));
    expect(await readerRunning(deps, new Date("2026-11-12T10:10:00Z"))).toBe(true);
    expect((await ask()).status).toBe(202);
    setClock(new Date("2026-11-12T10:17:00Z")); // lease (15 min) over, still silent
    expect((await ask()).body.error.code).toBe("reader_idle");
    expect(await call.used()).toBe(2);
  });

  it("hands over photos, prompt and schema on claim, and accepts a valid reading", async () => {
    const { call } = setup();
    const { status, body: job } = await call.convert();
    expect(status).toBe(202);
    expect((await call.list()).body.jobs.map((j: { id: string }) => j.id)).toEqual([job.jobId]);
    const claim = await call.claim(job.jobId);
    expect(claim.body.images).toEqual([{ mediaType: "image/png", data: PNG }]);
    expect(claim.body.systemPrompt).toContain("chess scoresheets");
    expect(claim.body.schema.properties.rows).toBeTruthy();
    expect((await call.list()).body.jobs).toEqual([]);
    expect((await call.job(job.jobId, job.viewToken)).status).toBe("running");

    const ok = await call.result(job.jobId, { leaseToken: claim.body.leaseToken, extraction: extraction(rowsFrom(OPERA_GAME)) });
    expect(ok.status).toBe(200);
    const done = await call.job(job.jobId, job.viewToken);
    expect(done.status).toBe("done");
    expect(done.result.rows).toHaveLength(17);
    expect(await call.used()).toBe(1);
  });

  it("counts readings per signed-in person", async () => {
    const { call } = setup();
    expect((await call.convert("alice")).status).toBe(202);
    expect((await call.convert("alice")).status).toBe(202);
    const third = await call.convert("alice");
    expect(third.status).toBe(429);
    expect(third.body.error.message).toContain("own API key");
    expect((await call.convert("bob")).status).toBe(202);
  });

  it("rejects a reading that does not match the schema, and keeps the lease", async () => {
    const { call } = setup();
    const { body: job } = await call.convert();
    const claim = await call.claim(job.jobId);
    const bad = await call.result(job.jobId, { leaseToken: claim.body.leaseToken, extraction: { rows: "nope" } });
    expect(bad.status).toBe(422);
    expect(bad.body.issues.length).toBeGreaterThan(0);
    expect((await call.result(job.jobId, { leaseToken: claim.body.leaseToken, extraction: extraction(rowsFrom(OPERA_GAME)) })).status).toBe(200);
  });

  it("lets only one reader claim a job, and reopens it when the lease runs out", async () => {
    const { call, setClock } = setup();
    const { body: job } = await call.convert();
    const first = await call.claim(job.jobId, "a");
    expect((await call.claim(job.jobId, "b")).status).toBe(409);
    setClock(new Date("2026-11-12T10:16:00Z"));
    const second = await call.claim(job.jobId, "b");
    expect(second.status).toBe(200);
    const late = await call.result(job.jobId, { leaseToken: first.body.leaseToken, extraction: extraction(rowsFrom(OPERA_GAME)) });
    expect(late.status).toBe(409);
  });

  it("puts a failed read back in the queue, then gives up and refunds", async () => {
    const { call } = setup();
    const { body: job } = await call.convert();
    for (let i = 0; i < 2; i++) {
      const c = await call.claim(job.jobId);
      expect((await call.result(job.jobId, { leaseToken: c.body.leaseToken, error: { message: "crash" }, retry: true })).body.requeued).toBe(true);
    }
    const c = await call.claim(job.jobId);
    expect((await call.result(job.jobId, { leaseToken: c.body.leaseToken, error: { message: "crash" }, retry: true })).body.requeued).toBe(false);
    expect(await call.job(job.jobId, job.viewToken)).toMatchObject({ status: "error", error: { code: "reader_failed" } });
    expect(await call.used()).toBe(0);
  });

  it("cancels a waiting job (the browser reads through the gateway instead), with a refund", async () => {
    const { call } = setup();
    const { body: job } = await call.convert();
    expect(await call.job(job.jobId, job.viewToken, "DELETE")).toEqual({ ok: true });
    expect(await call.job(job.jobId, job.viewToken)).toMatchObject({ status: "error", error: { code: "cancelled" } });
    expect((await call.list()).body.jobs).toEqual([]);
    expect((await call.claim(job.jobId)).status).toBe(409);
    expect(await call.used()).toBe(0);
  });

  it("times out a job no reader picks up, with a refund", async () => {
    const { call, setClock } = setup();
    const { body: job } = await call.convert();
    setClock(new Date("2026-11-12T10:31:00Z"));
    expect(await call.job(job.jobId, job.viewToken)).toMatchObject({ status: "error", error: { code: "timeout" } });
    expect(await call.used()).toBe(0);
  });

  it("hides a job from anyone without its token", async () => {
    const { call } = setup();
    const { body: job } = await call.convert();
    expect(await call.job(job.jobId, "nope")).toMatchObject({ error: { code: "not_found" } });
  });

  it("validates photos", async () => {
    const { call } = setup();
    const cases: [unknown[], string][] = [
      [[], "no_images"],
      [[{ mediaType: "image/tiff", data: PNG }], "bad_image"],
      [Array(3).fill({ mediaType: "image/png", data: PNG }), "too_many_images"],
    ];
    for (const [images, code] of cases) expect((await call.convert("alice", images)).body.error.code).toBe(code);
  });

  it("refuses the worker endpoints without the token", async () => {
    const { call } = setup();
    expect((await call.list("wrong")).status).toBe(401);
  });

  it("cleans up day-old jobs and finished counters", async () => {
    const { deps, call, setClock } = setup();
    await call.convert();
    setClock(new Date("2026-11-13T11:00:00Z"));
    expect(await cleanupJobs(deps)).toBe(1);
    expect(await deps.jobs.list("")).toEqual([]);
    await call.list();
    expect(await deps.jobs.list("")).toEqual([HEARTBEAT]); // the reader's one small record
    setClock(new Date("2026-11-24T10:00:00Z"));
    expect(await cleanupQuota(deps)).toBe(3);
  });
});

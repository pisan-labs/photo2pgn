import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../netlify/lib/config";
import { memoryKV } from "../netlify/lib/kv";
import {
  handleConvert,
  handleJob,
  handleQuota,
  handleWorkerClaim,
  handleWorkerList,
  handleWorkerResult,
  runWorker,
  type Deps,
  type WorkerRequest,
} from "../netlify/lib/handlers";
import { extraction, rowsFrom, OPERA_GAME } from "./helpers";

const TOKEN = "worker-secret";
const PNG = btoa("png bytes");

function setup(env: Record<string, string> = {}) {
  const started: WorkerRequest[] = [];
  let clock = new Date("2026-11-12T10:00:00Z");
  const deps: Deps = {
    config: loadConfig({ PGN_FREE_READER: "local", PGN_WORKER_TOKEN: TOKEN, ...env }),
    jobs: memoryKV(),
    quota: memoryKV(),
    now: () => clock,
    startWorker: async (b) => {
      started.push(b);
    },
    readScoresheet: vi.fn(async () => ({
      extraction: extraction(rowsFrom(OPERA_GAME)),
      usage: { inputTokens: 1, outputTokens: 1, model: "api" },
    })),
  };
  const call = {
    convert: async (mode = "free", headers: Record<string, string> = {}) => {
      const res = await handleConvert(
        new Request("https://app.test/api/convert", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ mode, images: [{ mediaType: "image/png", data: PNG }] }),
        }),
        "1.2.3.4",
        deps,
      );
      return { status: res.status, body: await res.json() };
    },
    job: async (jobId: string, viewToken: string) =>
      (await handleJob(new Request(`https://app.test/api/jobs/${jobId}?token=${viewToken}`), jobId, deps)).json(),
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
    quota: async () => (await handleQuota(new Request("https://app.test/api/quota"), "1.2.3.4", deps)).json(),
  };
  return { deps, started, call, setClock: (d: Date) => (clock = d) };
}

describe("CLI reader queue", () => {
  it("queues a free job for the CLI instead of starting the API worker", async () => {
    const { started, call } = setup();
    expect((await call.quota()).freeAvailable).toBe(true);
    const { status, body } = await call.convert();
    expect(status).toBe(202);
    expect(started).toHaveLength(0);
    const list = await call.list();
    expect(list.body.jobs.map((j: { id: string }) => j.id)).toEqual([body.jobId]);
    expect((await call.job(body.jobId, body.viewToken)).reader).toBe("local");
  });

  it("hands over photos, prompt and schema on claim, and accepts a valid reading", async () => {
    const { call } = setup();
    const { body: job } = await call.convert();
    const claim = await call.claim(job.jobId);
    expect(claim.status).toBe(200);
    expect(claim.body.images).toEqual([{ mediaType: "image/png", data: PNG }]);
    expect(claim.body.systemPrompt).toContain("chess scoresheets");
    expect(claim.body.schema.properties.rows).toBeTruthy();
    // Claimed jobs leave the list.
    expect((await call.list()).body.jobs).toEqual([]);

    const ok = await call.result(job.jobId, {
      leaseToken: claim.body.leaseToken,
      extraction: extraction(rowsFrom(OPERA_GAME)),
      usage: { model: "claude-opus-5-5 (subscription)" },
    });
    expect(ok).toEqual({ status: 200, body: { ok: true } });
    const done = await call.job(job.jobId, job.viewToken);
    expect(done.status).toBe("done");
    expect(done.result.rows).toHaveLength(17);
  });

  it("rejects a reading that does not match the schema, and keeps the lease", async () => {
    const { call } = setup();
    const { body: job } = await call.convert();
    const claim = await call.claim(job.jobId);
    const bad = await call.result(job.jobId, { leaseToken: claim.body.leaseToken, extraction: { rows: "nope" } });
    expect(bad.status).toBe(422);
    expect(bad.body.issues.length).toBeGreaterThan(0);
    const good = await call.result(job.jobId, { leaseToken: claim.body.leaseToken, extraction: extraction(rowsFrom(OPERA_GAME)) });
    expect(good.status).toBe(200);
  });

  it("lets only one reader claim a job, and reopens it when the lease runs out", async () => {
    const { call, setClock } = setup();
    const { body: job } = await call.convert();
    const first = await call.claim(job.jobId, "a");
    expect(first.status).toBe(200);
    expect((await call.claim(job.jobId, "b")).status).toBe(409);
    setClock(new Date("2026-11-12T10:16:00Z")); // lease is 15 minutes
    expect((await call.list()).body.jobs).toHaveLength(1);
    const second = await call.claim(job.jobId, "b");
    expect(second.status).toBe(200);
    // The first reader's late answer is refused.
    const late = await call.result(job.jobId, { leaseToken: first.body.leaseToken, extraction: extraction(rowsFrom(OPERA_GAME)) });
    expect(late.status).toBe(409);
  });

  it("puts a failed read back in the queue, then gives up and refunds", async () => {
    const { call } = setup();
    const { body: job } = await call.convert();
    for (let i = 0; i < 2; i++) {
      const c = await call.claim(job.jobId);
      const r = await call.result(job.jobId, { leaseToken: c.body.leaseToken, error: { message: "claude crashed" }, retry: true });
      expect(r.body.requeued).toBe(true);
    }
    const c = await call.claim(job.jobId);
    const r = await call.result(job.jobId, { leaseToken: c.body.leaseToken, error: { message: "claude crashed" }, retry: true });
    expect(r.body.requeued).toBe(false);
    const failed = await call.job(job.jobId, job.viewToken);
    expect(failed).toMatchObject({ status: "error", error: { code: "reader_failed" } });
    expect((await call.quota()).quota.day.used).toBe(0);
  });

  it("times out a job no reader picks up, and refunds it", async () => {
    const { call, setClock } = setup();
    const { body: job } = await call.convert();
    setClock(new Date("2026-11-12T10:31:00Z"));
    expect(await call.job(job.jobId, job.viewToken)).toMatchObject({ status: "error", error: { code: "timeout" } });
    expect((await call.quota()).quota.day.used).toBe(0);
  });

  it("falls back to the owner's key when no reader claims the job in time", async () => {
    const { deps, started, call, setClock } = setup({ PGN_FREE_READER: "local-then-api", PGN_OWNER_API_KEY: "sk-ant-owner" });
    const { body: job } = await call.convert();
    expect(started).toHaveLength(0);
    setClock(new Date("2026-11-12T10:01:00Z"));
    expect((await call.job(job.jobId, job.viewToken)).reader).toBe("local");
    setClock(new Date("2026-11-12T10:02:30Z"));
    expect((await call.job(job.jobId, job.viewToken)).reader).toBe("api");
    expect(started).toHaveLength(1);
    expect((await call.list()).body.jobs).toEqual([]);
    await runWorker(started[0], deps);
    expect((await call.job(job.jobId, job.viewToken)).status).toBe("done");
  });

  it("still reads own-key jobs with the API right away", async () => {
    const { started, call } = setup();
    const { status } = await call.convert("own-key", { "x-anthropic-key": "sk-ant-visitor" });
    expect(status).toBe(202);
    expect(started).toHaveLength(1);
    expect((await call.list()).body.jobs).toEqual([]);
  });

  it("refuses the worker endpoints without the token, or when no token is set", async () => {
    const { call } = setup();
    expect((await call.list("wrong")).status).toBe(401);
    const off = setup({ PGN_WORKER_TOKEN: "" });
    expect((await off.call.list(TOKEN)).status).toBe(401);
  });

  it("offers no free conversions with a local reader but no worker token", async () => {
    const { call } = setup({ PGN_WORKER_TOKEN: "" });
    expect((await call.quota()).freeAvailable).toBe(false);
    expect((await call.convert()).status).toBe(503);
  });
});

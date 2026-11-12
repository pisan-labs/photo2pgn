import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../netlify/lib/config";
import { memoryKV } from "../netlify/lib/kv";
import { dayKey, getQuota, release, reserve, weekKey } from "../netlify/lib/quota";
import { cleanupJobs, cleanupQuota, handleConvert, handleJob, handleQuota, runWorker, type Deps, type WorkerRequest } from "../netlify/lib/handlers";
import { ReadError } from "../netlify/lib/claude";
import { extraction, rowsFrom, OPERA_GAME } from "./helpers";

const LIMITS = { perDay: 2, perWeek: 3, globalPerDay: 5 };
const PNG = btoa("not really a png");

function makeDeps(overrides: Partial<Deps> = {}, env: Record<string, string> = { PGN_OWNER_API_KEY: "sk-ant-owner" }) {
  const started: WorkerRequest[] = [];
  let clock = new Date("2026-11-12T10:00:00Z");
  const deps: Deps = {
    config: { ...loadConfig(env), limits: LIMITS },
    jobs: memoryKV(),
    quota: memoryKV(),
    now: () => clock,
    startWorker: async (b) => {
      started.push(b);
    },
    readScoresheet: vi.fn(async () => ({
      extraction: extraction(rowsFrom(OPERA_GAME)),
      usage: { inputTokens: 100, outputTokens: 200, model: "test" },
    })),
    ...overrides,
  };
  return { deps, started, setClock: (d: Date) => (clock = d) };
}

function convertReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.test/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const freeBody = { mode: "free", images: [{ mediaType: "image/png", data: PNG }] };

describe("calendar keys", () => {
  it("uses ISO weeks", () => {
    expect(weekKey(new Date("2026-01-01T12:00:00Z"))).toBe("2026-W01"); // Thursday
    expect(weekKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53"); // Friday
    expect(weekKey(new Date("2026-11-12T12:00:00Z"))).toBe("2026-W46");
    expect(dayKey(new Date("2026-11-12T23:59:00Z"))).toBe("2026-11-12");
  });
});

describe("quota", () => {
  it("stops at the daily cap, then the weekly cap", async () => {
    const kv = memoryKV();
    const mon = new Date("2026-11-09T10:00:00Z");
    const tue = new Date("2026-11-10T10:00:00Z");
    expect(await reserve(kv, "a", LIMITS, mon)).toEqual({ ok: true });
    expect(await reserve(kv, "a", LIMITS, mon)).toEqual({ ok: true });
    expect(await reserve(kv, "a", LIMITS, mon)).toEqual({ ok: false, denied: "day" });
    expect(await reserve(kv, "a", LIMITS, tue)).toEqual({ ok: true });
    expect(await reserve(kv, "a", LIMITS, tue)).toEqual({ ok: false, denied: "week" });
    // A denial counts nothing.
    const s = await getQuota(kv, "a", LIMITS, tue);
    expect(s).toMatchObject({ day: { used: 1 }, week: { used: 3 }, remaining: 0 });
  });

  it("applies the global cap across people", async () => {
    const kv = memoryKV();
    const now = new Date("2026-11-12T10:00:00Z");
    for (const who of ["a", "a", "b", "b", "c"]) expect((await reserve(kv, who, LIMITS, now)).ok).toBe(true);
    expect(await reserve(kv, "d", LIMITS, now)).toEqual({ ok: false, denied: "global" });
    expect((await getQuota(kv, "d", LIMITS, now)).day.used).toBe(0);
  });

  it("gives a conversion back", async () => {
    const kv = memoryKV();
    const now = new Date("2026-11-12T10:00:00Z");
    await reserve(kv, "a", LIMITS, now);
    await release(kv, "a", now);
    expect(await getQuota(kv, "a", LIMITS, now)).toMatchObject({ day: { used: 0 }, global: { used: 0 }, remaining: 2 });
  });

  it("does not let parallel requests pass the cap", async () => {
    const kv = memoryKV();
    const now = new Date("2026-11-12T10:00:00Z");
    const results = await Promise.all(Array.from({ length: 6 }, () => reserve(kv, "a", LIMITS, now)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
  });

  it("resets on Monday for the week and at midnight UTC for the day", async () => {
    const kv = memoryKV();
    const s = await getQuota(kv, "a", LIMITS, new Date("2026-11-12T10:00:00Z"));
    expect(s.dayResetsAt).toBe("2026-11-13T00:00:00.000Z");
    expect(s.weekResetsAt).toBe("2026-11-16T00:00:00.000Z");
  });
});

describe("convert, worker and job", () => {
  it("runs a free conversion end to end and counts it", async () => {
    const { deps, started } = makeDeps();
    const res = await handleConvert(convertReq(freeBody), "1.2.3.4", deps);
    expect(res.status).toBe(202);
    const { jobId, viewToken, quota } = await res.json();
    expect(quota.day.used).toBe(1);
    expect(started).toHaveLength(1);
    expect(started[0].apiKey).toBeUndefined();

    const pending = await handleJob(new Request(`https://app.test/api/jobs/${jobId}?token=${viewToken}`), jobId, deps);
    expect((await pending.json()).status).toBe("queued");

    await runWorker(started[0], deps);
    expect(deps.readScoresheet).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-ant-owner" }));
    const done = await (await handleJob(new Request(`https://app.test/api/jobs/${jobId}?token=${viewToken}`), jobId, deps)).json();
    expect(done.status).toBe("done");
    expect(done.result.rows).toHaveLength(17);
    // Photos are deleted once read.
    expect(await deps.jobs.list(`img/${jobId}/`)).toEqual([]);
  });

  it("passes the visitor's key to the worker and does not count it", async () => {
    const { deps, started } = makeDeps();
    const res = await handleConvert(
      convertReq({ ...freeBody, mode: "own-key" }, { "x-anthropic-key": "sk-ant-visitor" }),
      "1.2.3.4",
      deps,
    );
    expect(res.status).toBe(202);
    expect(started[0].apiKey).toBe("sk-ant-visitor");
    const stored = JSON.stringify(await deps.jobs.getJSON(`job/${started[0].jobId}`));
    expect(stored).not.toContain("sk-ant-visitor");
    await runWorker(started[0], deps);
    expect(deps.readScoresheet).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-ant-visitor" }));
    const q = await (await handleQuota(new Request("https://app.test/api/quota"), "1.2.3.4", deps)).json();
    expect(q.quota.day.used).toBe(0);
  });

  it("refuses once the daily cap is used, with a message and the quota", async () => {
    const { deps } = makeDeps();
    for (let i = 0; i < 2; i++) expect((await handleConvert(convertReq(freeBody), "1.2.3.4", deps)).status).toBe(202);
    const res = await handleConvert(convertReq(freeBody), "1.2.3.4", deps);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("limit_day");
    expect(body.error.message).toContain("own API key");
    expect(body.quota.remaining).toBe(0);
    // Another address still has its own allowance.
    expect((await handleConvert(convertReq(freeBody), "5.6.7.8", deps)).status).toBe(202);
  });

  it("gives the conversion back when Claude fails", async () => {
    const { deps, started } = makeDeps({
      readScoresheet: vi.fn(async () => {
        throw new ReadError("upstream", "Anthropic API error 529: overloaded");
      }),
    });
    const res = await handleConvert(convertReq(freeBody), "1.2.3.4", deps);
    const { jobId, viewToken } = await res.json();
    await runWorker(started[0], deps);
    const job = await (await handleJob(new Request(`https://app.test/api/jobs/${jobId}?token=${viewToken}`), jobId, deps)).json();
    expect(job).toMatchObject({ status: "error", error: { code: "upstream" } });
    const q = await (await handleQuota(new Request("https://app.test/api/quota"), "1.2.3.4", deps)).json();
    expect(q.quota.day.used).toBe(0);
  });

  it("ignores a worker call with the wrong token, and a repeated call", async () => {
    const { deps, started } = makeDeps();
    await handleConvert(convertReq(freeBody), "1.2.3.4", deps);
    await runWorker({ ...started[0], workerToken: "guess" }, deps);
    expect(deps.readScoresheet).not.toHaveBeenCalled();
    await runWorker(started[0], deps);
    await runWorker(started[0], deps);
    expect(deps.readScoresheet).toHaveBeenCalledTimes(1);
  });

  it("hides a job from anyone without its token", async () => {
    const { deps } = makeDeps();
    const { jobId } = await (await handleConvert(convertReq(freeBody), "1.2.3.4", deps)).json();
    const res = await handleJob(new Request(`https://app.test/api/jobs/${jobId}?token=nope`), jobId, deps);
    expect(res.status).toBe(404);
  });

  it("marks a job that never finished as timed out and gives the conversion back", async () => {
    const { deps, setClock } = makeDeps();
    const { jobId, viewToken } = await (await handleConvert(convertReq(freeBody), "1.2.3.4", deps)).json();
    setClock(new Date("2026-11-12T10:20:00Z"));
    const job = await (await handleJob(new Request(`https://app.test/api/jobs/${jobId}?token=${viewToken}`), jobId, deps)).json();
    expect(job.error.code).toBe("timeout");
    const q = await (await handleQuota(new Request("https://app.test/api/quota"), "1.2.3.4", deps)).json();
    expect(q.quota.day.used).toBe(0);
  });

  it("validates requests", async () => {
    const { deps } = makeDeps();
    const cases: [unknown, Record<string, string>, number, string][] = [
      [{ mode: "free", images: [] }, {}, 400, "no_images"],
      [{ mode: "x", images: freeBody.images }, {}, 400, "bad_request"],
      [{ mode: "free", images: [{ mediaType: "image/tiff", data: PNG }] }, {}, 400, "bad_image"],
      [{ mode: "free", images: Array(3).fill(freeBody.images[0]) }, {}, 400, "too_many_images"],
      [{ mode: "own-key", images: freeBody.images }, { "x-anthropic-key": "nope" }, 400, "bad_key"],
    ];
    for (const [body, headers, status, code] of cases) {
      const res = await handleConvert(convertReq(body, headers), "1.2.3.4", deps);
      expect([res.status, (await res.json()).error.code]).toEqual([status, code]);
    }
  });

  it("offers no free conversions when no owner key is set", async () => {
    const { deps } = makeDeps({}, {});
    const res = await handleConvert(convertReq(freeBody), "1.2.3.4", deps);
    expect(res.status).toBe(503);
    const q = await (await handleQuota(new Request("https://app.test/api/quota"), "1.2.3.4", deps)).json();
    expect(q).toMatchObject({ freeAvailable: false, quota: null });
  });

  it("gives the conversion back if the worker cannot start", async () => {
    const { deps } = makeDeps({
      startWorker: async () => {
        throw new Error("network");
      },
    });
    const res = await handleConvert(convertReq(freeBody), "1.2.3.4", deps);
    expect(res.status).toBe(502);
    const q = await (await handleQuota(new Request("https://app.test/api/quota"), "1.2.3.4", deps)).json();
    expect(q.quota.day.used).toBe(0);
  });

  it("cleans up counters for finished days and weeks", async () => {
    const { deps, setClock } = makeDeps();
    await handleConvert(convertReq(freeBody), "1.2.3.4", deps); // Thu 12 Nov, week 46
    setClock(new Date("2026-11-13T10:00:00Z"));
    expect(await cleanupQuota(deps)).toBe(0); // yesterday is kept
    setClock(new Date("2026-11-14T10:00:00Z"));
    expect(await cleanupQuota(deps)).toBe(2); // day and global for the 12th
    setClock(new Date("2026-11-24T10:00:00Z")); // week 48
    expect(await cleanupQuota(deps)).toBe(1);
    expect(await deps.quota.list("")).toEqual([]);
  });

  it("cleans up day-old jobs", async () => {
    const { deps, setClock } = makeDeps();
    await handleConvert(convertReq(freeBody), "1.2.3.4", deps);
    setClock(new Date("2026-11-13T11:00:00Z"));
    expect(await cleanupJobs(deps)).toBe(1);
    expect(await deps.jobs.list("")).toEqual([]);
  });
});

describe("loadConfig", () => {
  it("ignores ANTHROPIC_* and CLAUDE_* variables meant for other tools", () => {
    const c = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-personal", CLAUDE_EFFORT: "xhigh", ANTHROPIC_BASE_URL: "https://proxy" });
    expect(c).toMatchObject({ ownerKey: null, effort: "high", anthropicBaseURL: "https://api.anthropic.com" });
  });
  it("reads PGN_ settings and falls back on bad numbers", () => {
    const c = loadConfig({ PGN_OWNER_API_KEY: " sk-ant-x ", PGN_CLAUDE_EFFORT: "max", PGN_FREE_PER_DAY: "7", PGN_FREE_PER_WEEK: "lots" });
    expect(c).toMatchObject({ ownerKey: "sk-ant-x", effort: "max", limits: { perDay: 7, perWeek: 10, globalPerDay: 100 } });
  });
});

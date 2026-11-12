import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { CapReached, GatewayError, LlmUnavailable, type AnthropicLike, type Message } from "../src/lib/llm";
import { READ_TOOL_NAME, ReadFailed } from "../src/lib/read";
import { ApiError, cancelJob, queueForReader, waitForJob } from "../src/lib/api";
import { capMessage, describeError, fallbackMsFrom, freeReaderFrom, readPhotos } from "../src/lib/reading";
import { extraction, rowsFrom, OPERA_GAME } from "./helpers";

const photos = [{ mediaType: "image/jpeg" as const, data: btoa("jpeg") }];
const EX = extraction(rowsFrom(OPERA_GAME));
const reply = {
  id: "m",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "tool_use", id: "t", name: READ_TOOL_NAME, input: EX }],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
} as unknown as Message;

const gatewayOk = () =>
  vi.fn(async () => new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } }));

describe("settings from the build", () => {
  it("defaults to the gateway and a two-minute fallback", () => {
    expect(freeReaderFrom({})).toBe("gateway");
    expect(freeReaderFrom({ VITE_FREE_READER: "local-then-gateway" })).toBe("local-then-gateway");
    expect(freeReaderFrom({ VITE_FREE_READER: "nonsense" })).toBe("gateway");
    expect(fallbackMsFrom({})).toBe(120_000);
    expect(fallbackMsFrom({ VITE_LOCAL_FALLBACK_SECONDS: "45" })).toBe(45_000);
  });
});

describe("readPhotos", () => {
  it("own key: straight to Anthropic, never stored", async () => {
    const create = vi.fn(async (_b: unknown) => reply);
    const createAnthropic = vi.fn((_k: string): AnthropicLike => ({ messages: { create } }));
    const phases: string[] = [];
    const ex = await readPhotos(photos, { mode: "own-key", apiKey: "sk-ant-x", ask: { createAnthropic }, onPhase: (p) => phases.push(p) });
    expect(ex.headers.white).toBe("Morphy, Paul");
    expect(createAnthropic).toHaveBeenCalledWith("sk-ant-x");
    expect(phases).toEqual(["reading"]);
  });

  it("free, gateway: sends the session token", async () => {
    const fetch = gatewayOk();
    const ex = await readPhotos(photos, {
      mode: "free",
      reader: "gateway",
      getToken: async () => "tok",
      ask: { fetch, gatewayUrl: "https://gw.test" },
    });
    expect(ex.rows).toHaveLength(17);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("free, local: queues with the token and follows the job", async () => {
    const queue = vi.fn(async () => ({ jobId: "j", viewToken: "v" }));
    const phases: string[] = [];
    const ex = await readPhotos(photos, {
      mode: "free",
      reader: "local",
      getToken: async () => "tok",
      queue,
      onPhase: (p) => phases.push(p),
      wait: async (_job, opts) => {
        opts.onStatus?.("running");
        return EX;
      },
    });
    expect(ex.rows).toHaveLength(17);
    expect(queue).toHaveBeenCalledWith(photos, "tok", undefined, { onlyIfReaderRunning: false });
    expect(phases).toEqual(["queued", "local"]);
  });

  it("free, local: needs sign-in", async () => {
    await expect(readPhotos(photos, { mode: "free", reader: "local", getToken: async () => null })).rejects.toBeInstanceOf(LlmUnavailable);
  });

  it("local-then-gateway: gives up on the queue in time, cancels, and reads through the gateway", async () => {
    let t = 0;
    const cancel = vi.fn(async () => undefined);
    const fetch = gatewayOk();
    const ex = await readPhotos(photos, {
      mode: "free",
      reader: "local-then-gateway",
      fallbackMs: 60_000,
      now: () => t,
      getToken: async () => "tok",
      queue: async () => ({ jobId: "j", viewToken: "v" }),
      cancel,
      ask: { fetch, gatewayUrl: "https://gw.test" },
      wait: async (_job, opts) => {
        for (;;) {
          t += 30_000;
          opts.onStatus?.("queued");
          if (opts.signal?.aborted) throw new ApiError("cancelled", "Cancelled.");
        }
      },
    });
    expect(ex.rows).toHaveLength(17);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("local-then-gateway: reads through the gateway at once when the queue is off or out of reach", async () => {
    for (const code of ["reader_off", "reader_idle", "network", "start_failed"]) {
      const fetch = gatewayOk();
      const ex = await readPhotos(photos, {
        mode: "free",
        reader: "local-then-gateway",
        getToken: async () => "tok",
        queue: async (_p, _t, _f, opts) => {
          expect(opts).toEqual({ onlyIfReaderRunning: true });
          throw new ApiError(code, "queue unavailable");
        },
        ask: { fetch, gatewayUrl: "https://gw.test" },
      });
      expect(ex.rows).toHaveLength(17);
      expect(fetch).toHaveBeenCalledOnce();
    }
  });

  it("local: a queue that is off is an error; a used-up reader allowance is never bypassed", async () => {
    const off = async () => {
      throw new ApiError("reader_off", "The HintWise reader is not running.");
    };
    await expect(readPhotos(photos, { mode: "free", reader: "local", getToken: async () => "tok", queue: off })).rejects.toMatchObject({ code: "reader_off" });
    const used = async () => {
      throw new ApiError("limit_day", "Used up");
    };
    await expect(
      readPhotos(photos, { mode: "free", reader: "local-then-gateway", getToken: async () => "tok", queue: used }),
    ).rejects.toMatchObject({ code: "limit_day" });
  });

  it("local-then-gateway: keeps waiting once the reader has the job", async () => {
    let t = 0;
    const cancel = vi.fn(async () => undefined);
    const ex = await readPhotos(photos, {
      mode: "free",
      reader: "local-then-gateway",
      fallbackMs: 60_000,
      now: () => t,
      getToken: async () => "tok",
      queue: async () => ({ jobId: "j", viewToken: "v" }),
      cancel,
      wait: async (_job, opts) => {
        t += 30_000;
        opts.onStatus?.("running");
        t += 300_000;
        opts.onStatus?.("running");
        return EX;
      },
    });
    expect(ex.rows).toHaveLength(17);
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("messages", () => {
  it("says the credits are out, until when, and offers the visitor's own key", () => {
    const at = "2026-11-13T08:00:00Z";
    expect(capMessage(new CapReached("app-user-day", at), "en-US")).toMatch(/^Out of credits until .+\. Use your own Anthropic API key to keep going\.$/);
    expect(capMessage(new CapReached("app-month", "not a date"))).toBe("Out of credits. Use your own Anthropic API key to keep going.");
    expect(describeError(new CapReached("app-day", at)).ownKey).toBe(true);
  });
  it("describes the other failures", () => {
    expect(describeError(new ReadFailed("too_long", "Too long")).message).toBe("Too long");
    expect(describeError(new GatewayError(500, { message: "down" })).message).toBe("down");
    expect(describeError(new ApiError("limit_day", "Used up"))).toEqual({ message: "Used up", ownKey: true });
    const bad = new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers());
    expect(describeError(bad).message).toBe("Anthropic rejected your API key.");
    const slow = new Anthropic.RateLimitError(429, { type: "error" }, "slow down", new Headers());
    expect(describeError(slow).message).toContain("rate limiting");
    expect(describeError(new Error("boom")).message).toBe("boom");
  });
});

describe("queue client", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  it("queues with the token and reports server errors", async () => {
    const ok = vi.fn(async () => json(202, { jobId: "j", viewToken: "v" }));
    expect(await queueForReader(photos, "tok", ok as unknown as typeof fetch)).toEqual({ jobId: "j", viewToken: "v" });
    const [, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).not.toHaveProperty("onlyIfReaderRunning");
    await queueForReader(photos, "tok", ok as unknown as typeof fetch, { onlyIfReaderRunning: true });
    const [, init2] = ok.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init2.body)).onlyIfReaderRunning).toBe(true);
    const denied = async () => json(429, { error: { code: "limit_day", message: "Used up" } });
    await expect(queueForReader(photos, "tok", denied as unknown as typeof fetch)).rejects.toMatchObject({ code: "limit_day" });
    const down = async () => {
      throw new TypeError("offline");
    };
    await expect(queueForReader(photos, "tok", down as unknown as typeof fetch)).rejects.toMatchObject({ code: "network" });
  });
  it("polls until done, ignoring a few network blips", async () => {
    const answers = [new TypeError("blip"), json(200, { status: "queued" }), json(200, { status: "done", result: EX })];
    const fetch = vi.fn(async () => {
      const a = answers.shift()!;
      if (a instanceof Error) throw a;
      return a;
    });
    const seen: string[] = [];
    const ex = await waitForJob({ jobId: "j", viewToken: "v" }, { fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => undefined, onStatus: (s) => seen.push(s) });
    expect(ex.rows).toHaveLength(17);
    expect(seen).toEqual(["queued", "done"]);
  });
  it("stops on an error answer, a missing job, or a cancel", async () => {
    const err = async () => json(200, { status: "error", error: { code: "timeout", message: "Too slow" } });
    await expect(waitForJob({ jobId: "j", viewToken: "v" }, { fetch: err as unknown as typeof fetch, sleep: async () => undefined })).rejects.toMatchObject({ code: "timeout" });
    const gone = async () => json(404, { error: { code: "not_found", message: "No" } });
    await expect(waitForJob({ jobId: "j", viewToken: "v" }, { fetch: gone as unknown as typeof fetch, sleep: async () => undefined })).rejects.toMatchObject({ code: "not_found" });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(waitForJob({ jobId: "j", viewToken: "v" }, { signal: ctrl.signal })).rejects.toMatchObject({ code: "cancelled" });
  });
  it("cancels with DELETE and never throws", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await cancelJob({ jobId: "j", viewToken: "v" }, fetch as unknown as typeof globalThis.fetch);
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });
});

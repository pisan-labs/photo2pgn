import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { CapReached, GatewayError, LlmUnavailable, type AnthropicLike, type Message } from "../src/lib/llm";
import { READ_TOOL_NAME, ReadFailed } from "../src/lib/read";
import { ApiError, forgetJob, listMyJobs, queueForReader } from "../src/lib/api";
import { capMessage, describeError, freeReaderFrom, readPhotos, type ReadOutcome } from "../src/lib/reading";
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

const read = (o: ReadOutcome) => {
  if (o.kind !== "read") throw new Error(`expected a reading, got ${o.kind}`);
  return o.extraction;
};

const gatewayOk = () =>
  vi.fn(async () => new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } }));

describe("settings from the build", () => {
  it("defaults to the gateway", () => {
    expect(freeReaderFrom({})).toBe("gateway");
    expect(freeReaderFrom({ VITE_FREE_READER: "local-then-gateway" })).toBe("local-then-gateway");
    expect(freeReaderFrom({ VITE_FREE_READER: "local" })).toBe("local");
    expect(freeReaderFrom({ VITE_FREE_READER: "nonsense" })).toBe("gateway");
  });
});

describe("readPhotos", () => {
  it("own key: straight to Anthropic, never stored", async () => {
    const create = vi.fn(async (_b: unknown) => reply);
    const createAnthropic = vi.fn((_k: string): AnthropicLike => ({ messages: { create } }));
    const phases: string[] = [];
    const ex = read(await readPhotos(photos, { mode: "own-key", apiKey: "sk-ant-x", ask: { createAnthropic }, onPhase: (p) => phases.push(p) }));
    expect(ex.headers.white).toBe("Morphy, Paul");
    expect(createAnthropic).toHaveBeenCalledWith("sk-ant-x");
    expect(phases).toEqual(["reading"]);
  });

  it("free, gateway: sends the session token", async () => {
    const fetch = gatewayOk();
    const ex = read(
      await readPhotos(photos, {
        mode: "free",
        reader: "gateway",
        getToken: async () => "tok",
        ask: { fetch, gatewayUrl: "https://gw.test" },
      }),
    );
    expect(ex.rows).toHaveLength(17);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("free, local: queues with the token and returns at once, without waiting for the reading", async () => {
    const queue = vi.fn(async () => ({ jobId: "j", viewToken: "v", createdAt: "2026-11-13T10:00:00Z" }));
    const phases: string[] = [];
    const outcome = await readPhotos(photos, { mode: "free", reader: "local", getToken: async () => "tok", queue, onPhase: (p) => phases.push(p) });
    expect(outcome).toEqual({ kind: "queued", job: { jobId: "j", viewToken: "v", createdAt: "2026-11-13T10:00:00Z" } });
    expect(queue).toHaveBeenCalledWith(photos, "tok", undefined, { onlyIfReaderRunning: false });
    expect(phases).toEqual(["sending"]);
  });

  it("free, local: needs sign-in", async () => {
    await expect(readPhotos(photos, { mode: "free", reader: "local", getToken: async () => null })).rejects.toBeInstanceOf(LlmUnavailable);
  });

  it("local-then-gateway: reads through the gateway at once when the reader cannot take the photos", async () => {
    // Its own ceiling too: a sheet costs a credit either way, and the gateway counts them.
    for (const code of ["reader_off", "reader_idle", "network", "start_failed", "limit_day"]) {
      const fetch = gatewayOk();
      const ex = read(
        await readPhotos(photos, {
          mode: "free",
          reader: "local-then-gateway",
          getToken: async () => "tok",
          queue: async (_p, _t, _f, opts) => {
            expect(opts).toEqual({ onlyIfReaderRunning: true });
            throw new ApiError(code, "queue unavailable");
          },
          ask: { fetch, gatewayUrl: "https://gw.test" },
        }),
      );
      expect(ex.rows).toHaveLength(17);
      expect(fetch).toHaveBeenCalledOnce();
    }
  });

  it("local: a queue that is off, or a used-up reader allowance, is an error (no other way to read)", async () => {
    const off = async () => {
      throw new ApiError("reader_off", "The HintWise reader is not running.");
    };
    await expect(readPhotos(photos, { mode: "free", reader: "local", getToken: async () => "tok", queue: off })).rejects.toMatchObject({ code: "reader_off" });
    const used = async () => {
      throw new ApiError("limit_day", "Used up");
    };
    await expect(readPhotos(photos, { mode: "free", reader: "local", getToken: async () => "tok", queue: used })).rejects.toMatchObject({ code: "limit_day" });
    // Credits spoken for by sheets already with the reader: never spent again through the gateway.
    const spoken = async () => {
      throw new ApiError("limit_credits", "Spoken for");
    };
    const gw = gatewayOk();
    await expect(
      readPhotos(photos, { mode: "free", reader: "local-then-gateway", getToken: async () => "tok", queue: spoken, ask: { fetch: gw, gatewayUrl: "https://gw.test" } }),
    ).rejects.toMatchObject({ code: "limit_credits" });
    expect(gw).not.toHaveBeenCalled();
    // Anything but the queue's own answers is passed on, even with the gateway behind it.
    const broken = async () => {
      throw new TypeError("bug");
    };
    await expect(readPhotos(photos, { mode: "free", reader: "local-then-gateway", getToken: async () => "tok", queue: broken })).rejects.toBeInstanceOf(TypeError);
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
  it("lists the person's readings and forgets one, with the token", async () => {
    const list = vi.fn(async () => json(200, { jobs: [{ id: "j", status: "queued" }] }));
    expect(await listMyJobs("tok", list as unknown as typeof fetch)).toEqual([{ id: "j", status: "queued" }]);
    const [url, init] = list.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/my-jobs");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    expect(await listMyJobs("tok", (async () => json(200, {})) as unknown as typeof fetch)).toEqual([]);
    await expect(listMyJobs("tok", (async () => json(401, { error: { code: "sign_in", message: "Sign in" } })) as unknown as typeof fetch)).rejects.toMatchObject({
      code: "sign_in",
    });
    const down = async () => {
      throw new TypeError("offline");
    };
    await expect(listMyJobs("tok", down as unknown as typeof fetch)).rejects.toMatchObject({ code: "network" });

    const del = vi.fn(async () => json(200, { ok: true }));
    await forgetJob("a/b", "tok", del as unknown as typeof fetch);
    const [delUrl, delInit] = del.mock.calls[0] as unknown as [string, RequestInit];
    expect(delUrl).toBe("/api/my-jobs/a%2Fb");
    expect(delInit.method).toBe("DELETE");
    // Already gone is fine; anything else is reported.
    await forgetJob("j", "tok", (async () => json(404, { error: { code: "not_found", message: "No" } })) as unknown as typeof fetch);
    await expect(forgetJob("j", "tok", (async () => json(500, {})) as unknown as typeof fetch)).rejects.toMatchObject({ code: "error" });
    await expect(forgetJob("j", "tok", down as unknown as typeof fetch)).rejects.toMatchObject({ code: "network" });
  });
});

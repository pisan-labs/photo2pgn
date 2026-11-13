// photo2pgn's server asking the gateway about one person, as that person.
import { describe, expect, it, vi } from "vitest";
import { hintwiseGateway } from "../netlify/lib/gateway";

const URL_ = "https://auth.test/functions/v1/llm-gateway";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const allowance = (partial: object = {}) => ({ allowed: true, scope: null, resets_at: null, app_open: true, limits: [], calls_left: 2, credits: 5, ...partial });

function sent(fetch: ReturnType<typeof vi.fn>, n = 0) {
  const [url, init] = fetch.mock.calls[n] as [string, RequestInit];
  return { url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) };
}

describe("balance", () => {
  it("asks check mode with the person's token, and counts free and bought credits", async () => {
    const fetch = vi.fn(async () => json(200, allowance()));
    expect(await hintwiseGateway(URL_, "m", fetch as unknown as typeof globalThis.fetch).balance("tok")).toEqual({ allowed: true, left: 7 });
    expect(sent(fetch)).toEqual({ url: URL_, auth: "Bearer tok", body: { app: "photo2pgn", check: true } });
  });
  it("is out when the gateway says so, and unknown when it cannot be asked", async () => {
    const gw = (f: () => Promise<Response>) => hintwiseGateway(URL_, "m", f as unknown as typeof fetch);
    expect(await gw(async () => json(200, allowance({ allowed: false, calls_left: 0, credits: 0 }))).balance("t")).toEqual({ allowed: false, left: 0 });
    expect(await gw(async () => json(500, {})).balance("t")).toBeNull();
    expect(await gw(async () => json(200, { nonsense: true })).balance("t")).toBeNull();
    expect(
      await gw(async () => {
        throw new TypeError("offline");
      }).balance("t"),
    ).toBeNull();
  });
});

describe("charge", () => {
  it("makes the smallest call the gateway counts, with the person's token", async () => {
    const fetch = vi.fn(async () => json(200, { id: "msg", content: [] }));
    expect(await hintwiseGateway(URL_, "claude-x", fetch as unknown as typeof globalThis.fetch).charge("tok", "job-1")).toBe("charged");
    const { auth, body } = sent(fetch);
    expect(auth).toBe("Bearer tok");
    expect(body).toMatchObject({ app: "photo2pgn", model: "claude-x", max_tokens: 1 });
    expect(body.messages[0].content).toContain("job-1");
  });
  it("tells out of credits from a failure", async () => {
    const gw = (f: () => Promise<Response>) => hintwiseGateway(URL_, "m", f as unknown as typeof fetch);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await gw(async () => json(429, { error: "cap", scope: "app-user-day-calls", resets_at: "x" })).charge("t", "j")).toBe("out");
    expect(await gw(async () => json(429, { error: "rate" })).charge("t", "j")).toBe("error");
    expect(await gw(async () => new Response("bad gateway", { status: 502 })).charge("t", "j")).toBe("error");
    expect(
      await gw(async () => {
        throw new TypeError("offline");
      }).charge("t", "j"),
    ).toBe("error");
    quiet.mockRestore();
  });
});

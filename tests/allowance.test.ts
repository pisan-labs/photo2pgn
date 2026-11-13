// Readings left, from the gateway's check mode.
import { describe, expect, it, vi } from "vitest";
import { checkAllowance, creditsLine, creditsOf, outMarkOf, whenLocal, type Allowance } from "../src/lib/allowance";

const DAY = "2026-11-14T00:00:00.000Z";
const WEEK = "2026-11-16T00:00:00.000Z";
const ok = (dayUsed: number, weekUsed: number): Allowance => {
  const left = Math.max(0, Math.min(3 - dayUsed, 9 - weekUsed));
  return {
    allowed: left > 0,
    scope: left > 0 ? null : dayUsed >= 3 ? "app-user-day-calls" : "app-user-week-calls",
    resets_at: left > 0 ? null : dayUsed >= 3 ? DAY : WEEK,
    app_open: true,
    limits: [
      { scope: "app-user-week-calls", unit: "calls", used: weekUsed, cap: 9, resets_at: WEEK },
      { scope: "app-user-day-calls", unit: "calls", used: dayUsed, cap: 3, resets_at: DAY },
      { scope: "user-day", unit: "usd", used: 0.2, cap: 1, resets_at: DAY },
    ],
    calls_left: left,
  };
};

describe("checkAllowance", () => {
  it("asks the gateway in check mode with the session token", async () => {
    const fetch = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(ok(1, 1)), { status: 200 }));
    const a = await checkAllowance({ getToken: async () => "tok", fetch: fetch as unknown as typeof globalThis.fetch, gatewayUrl: "https://gw.test" });
    expect(a?.calls_left).toBe(2);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://gw.test");
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(init!.body))).toEqual({ app: "photo2pgn", check: true });
  });

  it("is null when it cannot tell: signed out, an error, an odd answer, offline", async () => {
    const f = (r: Response | Error) => (async () => {
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as typeof fetch;
    expect(await checkAllowance({ getToken: async () => null, fetch: f(new Response("{}")) })).toBeNull();
    expect(await checkAllowance({ getToken: async () => "t", fetch: f(new Response("{}", { status: 401 })), gatewayUrl: "x" })).toBeNull();
    expect(await checkAllowance({ getToken: async () => "t", fetch: f(new Response('{"allowed":"yes"}')), gatewayUrl: "x" })).toBeNull();
    expect(await checkAllowance({ getToken: async () => "t", fetch: f(new TypeError("offline")), gatewayUrl: "x" })).toBeNull();
  });
});

describe("credits", () => {
  it("counts what is left, renewing with the day", () => {
    expect(creditsOf(ok(0, 0))).toMatchObject({ free: 3, paid: 0, left: 3, renewsAt: DAY, out: false, admin: false });
    expect(creditsOf(ok(2, 5))).toMatchObject({ left: 1, renewsAt: DAY, out: false });
  });

  it("renews with the week when the week's limit is the tighter", () => {
    // 1 used today, 8 this week: one left, and the next ones come on Monday.
    expect(creditsOf(ok(1, 8))).toMatchObject({ left: 1, renewsAt: WEEK, out: false });
  });

  it("adds bought credits, which carry on once the free ones are used up", () => {
    const both = { ...ok(1, 1), credits: 12, admin: true };
    expect(creditsOf(both)).toMatchObject({ free: 2, paid: 12, left: 14, out: false, admin: true });
    // Free ones used up for today: still allowed, on a credit; free ones come back at the reset.
    const paidOnly = { ...ok(3, 3), allowed: true, uses_credit: true, credits: 5 };
    expect(creditsOf(paidOnly)).toMatchObject({ free: 0, paid: 5, left: 5, renewsAt: DAY, out: false });
    const now = new Date("2026-11-13T07:00:00Z");
    expect(creditsLine(creditsOf(both), now, "en-US")).toMatch(/^2 free today and 12 bought\. New free credits at .+\.$/);
    expect(creditsLine(creditsOf(paidOnly), now, "en-US")).toMatch(/^5 bought\. New free credits at .+\.$/);
    expect(creditsLine(creditsOf(ok(0, 0)), now, "en-US")).toMatch(/^New credits at .+\.$/);
  });

  it("is out when a limit refuses, or the app is closed, until its reset", () => {
    expect(creditsOf(ok(3, 4))).toMatchObject({ left: 0, renewsAt: DAY, out: true });
    expect(creditsOf(ok(2, 9))).toMatchObject({ left: 0, renewsAt: WEEK, out: true });
    // The app's own limit stops bought credits too.
    expect(creditsOf({ ...ok(0, 0), credits: 5, allowed: false, app_open: false, resets_at: DAY }).out).toBe(true);
    const closed = { ...ok(0, 0), app_open: false, allowed: false, resets_at: DAY };
    expect(creditsOf(closed).out).toBe(true);
    expect(outMarkOf(ok(3, 4), "u1")).toEqual({ userId: "u1", until: DAY });
    expect(outMarkOf(ok(0, 0), "u1")).toBeNull();
  });

  it("says when, in the person's own time", () => {
    const now = new Date("2026-11-13T07:00:00Z");
    expect(whenLocal(DAY, now, "en-US")).toMatch(/^at \d{1,2}:00\s?[AP]M$/);
    expect(whenLocal(WEEK, now, "en-US")).toMatch(/^[A-Z][a-z]{2} \d{1,2}:00\s?[AP]M$/);
  });
});

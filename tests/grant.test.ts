// Admins adding credits through the platform's credits-grant function.
import { describe, expect, it, vi } from "vitest";
import { grantCredits, grantProblem, grantUrl } from "../src/lib/grant";

const answer = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(body), { status }));
const deps = (fetch: ReturnType<typeof answer>) => ({ getToken: async () => "admin-tok", fetch: fetch as unknown as typeof globalThis.fetch, url: "https://auth.test/functions/v1/credits-grant" });

describe("grantCredits", () => {
  it("posts the app, email, credits and note with the admin's token", async () => {
    const f = answer(200, { email: "kai@example.com", balance: 15 });
    expect(await grantCredits({ email: " kai@example.com ", credits: 10, note: " club trial " }, deps(f))).toEqual({ ok: true, email: "kai@example.com", balance: 15 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://auth.test/functions/v1/credits-grant");
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer admin-tok");
    expect(JSON.parse(String(init!.body))).toEqual({ app: "photo2pgn", email: "kai@example.com", credits: 10, note: "club trial" });
  });

  it("checks the request before sending it", async () => {
    const f = answer(200, {});
    expect(await grantCredits({ email: "not an email", credits: 5 }, deps(f))).toMatchObject({ ok: false });
    expect(await grantCredits({ email: "a@b.co", credits: 2.5 }, deps(f))).toMatchObject({ ok: false });
    expect(await grantCredits({ email: "a@b.co", credits: 10001 }, deps(f))).toMatchObject({ ok: false });
    expect(f).not.toHaveBeenCalled();
    expect(grantProblem("a@b.co", -10000)).toBeNull();
  });

  it("explains each refusal in plain words", async () => {
    const cases: [number, unknown, RegExp][] = [
      [403, { error: "admin" }, /not a HintWise admin/],
      [400, { error: "below_zero" }, /below zero; nothing changed/],
      [400, { error: "request" }, /whole number/],
      [404, { error: "not_found" }, /No HintWise account has that email/],
      [401, {}, /Sign in again/],
      [500, { error: "database" }, /HTTP 500/],
    ];
    for (const [status, body, message] of cases) {
      const r = await grantCredits({ email: "a@b.co", credits: 1 }, deps(answer(status, body)));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(message);
    }
  });

  it("needs a session, and says so when offline", async () => {
    expect(await grantCredits({ email: "a@b.co", credits: 1 }, { getToken: async () => null })).toMatchObject({ ok: false, message: "Sign in again." });
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await grantCredits({ email: "a@b.co", credits: 1 }, { getToken: async () => "t", fetch: offline as unknown as typeof fetch, url: "x" })).toMatchObject({ ok: false, message: /Could not reach HintWise/ });
  });

  it("finds the function on the configured Supabase project", () => {
    expect(grantUrl({ VITE_SUPABASE_URL: "https://auth.hintwise.org/" })).toBe("https://auth.hintwise.org/functions/v1/credits-grant");
  });
});

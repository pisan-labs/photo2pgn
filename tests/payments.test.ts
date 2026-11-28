// The browser side of "Payments to grant": photo2pgn's own routes, with the
// admin's sign-in token. No network: fetch is a fake.
import { describe, expect, it, vi } from "vitest";
import { grantPayment, grantQuestion, grantable, listOwedPayments, markPaymentDone, packText, paidCheck, paidOf, paidWarning, type OwedPayment } from "../src/lib/payments";

const answer = (status: number, body: unknown) =>
  vi.fn(async (_u: string, _i?: RequestInit) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const deps = (f: ReturnType<typeof answer>) => ({ getToken: async () => "admin-tok", fetch: f as unknown as typeof fetch });

const owed = (partial: Partial<OwedPayment> = {}): OwedPayment => ({
  transactionId: "txn_1",
  customerId: "ctm_1",
  pack: "pack-50",
  credits: 50,
  userId: "u1",
  email: "kai@example.com",
  completedAt: "2026-11-28T10:00:00.000Z",
  grantedAt: null,
  ...partial,
});

describe("listOwedPayments", () => {
  it("asks photo2pgn's admin route with the admin's token", async () => {
    const f = answer(200, { payments: [owed()] });
    expect(await listOwedPayments(deps(f))).toEqual({ ok: true, payments: [owed()], unreadable: 0 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/admin/payments");
    expect(init?.method).toBe("GET");
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer admin-tok");
  });

  it("passes on how many records the server could not read", async () => {
    expect(await listOwedPayments(deps(answer(200, { payments: [], unreadable: 2 })))).toEqual({ ok: true, payments: [], unreadable: 2 });
    expect(await listOwedPayments(deps(answer(200, { payments: [], unreadable: "2" })))).toEqual({ ok: true, payments: [], unreadable: 0 });
  });

  it("passes on the server's plain words, and falls back to its own", async () => {
    expect(await listOwedPayments(deps(answer(403, { error: { code: "admin", message: "Only a HintWise admin can see the payments." } })))).toEqual({
      ok: false,
      code: "admin",
      message: "Only a HintWise admin can see the payments.",
    });
    expect(await listOwedPayments(deps(answer(401, {})))).toMatchObject({ ok: false, message: "Sign in again." });
    expect(await listOwedPayments(deps(answer(502, "bad gateway")))).toMatchObject({ ok: false, message: "The payments did not load (HTTP 502). Try again." });
    expect(await listOwedPayments(deps(answer(200, { nonsense: true })))).toMatchObject({ ok: false, message: /HTTP 200/ });
    expect(await listOwedPayments(deps(answer(200, "null")))).toMatchObject({ ok: false });
  });

  it("needs a sign-in, and says so when offline", async () => {
    const f = answer(200, {});
    expect(await listOwedPayments({ getToken: async () => null, fetch: f as unknown as typeof fetch })).toEqual({ ok: false, code: "sign_in", message: "Sign in again." });
    expect(f).not.toHaveBeenCalled();
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await listOwedPayments({ getToken: async () => "t", fetch: offline as unknown as typeof fetch })).toMatchObject({ ok: false, code: "network", message: /Could not reach Photo to PGN/ });
  });
});

describe("grantPayment", () => {
  it("posts to the payment's grant route and says what was added", async () => {
    const f = answer(200, { email: "kai@example.com", balance: 62, credits: 50, grantedAt: "x", already: false });
    expect(await grantPayment("txn/1", deps(f))).toEqual({ ok: true, already: false, message: "Added 50 credits to kai@example.com (balance now 62), and marked the payment done." });
    expect(f.mock.calls[0][0]).toBe("/api/admin/payments/txn%2F1/grant");
    expect(f.mock.calls[0][1]?.method).toBe("POST");
    expect(await grantPayment("txn_1", deps(answer(200, { credits: 20 })))).toMatchObject({ message: "Added 20 credits to the account, and marked the payment done." });
  });

  it("says when the payment was already done", async () => {
    expect(await grantPayment("txn_1", deps(answer(200, { already: true, grantedAt: "x" })))).toEqual({ ok: true, already: true, message: expect.stringMatching(/already marked done; no credits were added/) });
  });

  it("passes on why the grant failed, with its code", async () => {
    const message = "The 50 credits were added to kai@example.com (balance now 62), but the payment could not be marked done. Do not grant it again; press Mark done after 28 Nov 2026, 18:02 UTC.";
    expect(await grantPayment("txn_1", deps(answer(500, { error: { code: "not_marked", message } })))).toEqual({ ok: false, code: "not_marked", message });
    expect(await grantPayment("txn_1", deps(answer(409, { error: { message: "Odd." } })))).toEqual({ ok: false, code: "error", message: "Odd." });
  });

  it("never says the credits were not added when photo2pgn's server did not say", async () => {
    for (const [status, body] of [
      [502, ""],
      [504, "<html>timed out</html>"],
      [502, {}],
      [500, { error: {} }],
      [200, { odd: true }],
      [401, ""],
    ] as const) {
      const r = await grantPayment("txn_1", deps(answer(status, body)));
      expect(r).toEqual({
        ok: false,
        code: "grant_unknown",
        message: `Photo to PGN did not say whether the credits were added (HTTP ${status}). Do not grant this payment again until you have refreshed the list, and check the account's balance before doing anything else.`,
      });
      expect(r.message).not.toMatch(/were not added/);
    }
  });

  it("says the outcome is not known when the connection fails", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("network error");
    });
    expect(await grantPayment("txn_1", { getToken: async () => "t", fetch: offline as unknown as typeof fetch })).toEqual({
      ok: false,
      code: "grant_network",
      message: expect.stringMatching(/^The connection to Photo to PGN failed, so it is not known whether the grant reached it or whether the credits were added\. Do not grant this payment again until you have refreshed the list/),
    });
    expect(await grantPayment("txn_1", { getToken: async () => null })).toMatchObject({ ok: false, code: "sign_in" });
  });

  it("warns when someone else marked the payment done while the grant ran", async () => {
    const r = await grantPayment("txn_1", deps(answer(200, { email: "kai@example.com", balance: 100, credits: 50, grantedAt: "2026-11-28T18:00:05.000Z", already: false, markedMeanwhile: true })));
    expect(r).toMatchObject({ ok: true, already: false, warn: true });
    expect(r.message).toMatch(/^Added 50 credits to kai@example\.com \(balance now 100\), but someone else marked the payment done while the grant was running \(.+\)\. If they also added the credits by hand, the account has them twice/);
    expect((await grantPayment("txn_1", deps(answer(200, { credits: 50, markedMeanwhile: true })))).message).toMatch(/while the grant was running\. If they/);
  });
});

describe("markPaymentDone", () => {
  it("posts to the payment's granted route", async () => {
    const f = answer(200, { grantedAt: "x", already: false });
    expect(await markPaymentDone("txn_1", deps(f))).toEqual({ ok: true, already: false, message: "Marked the payment done." });
    expect(f.mock.calls[0][0]).toBe("/api/admin/payments/txn_1/granted");
    expect(await markPaymentDone("txn_1", deps(answer(200, { grantedAt: "x", already: true })))).toEqual({ ok: true, already: true, message: "That payment was already marked done." });
  });

  it("passes on a refusal", async () => {
    expect(await markPaymentDone("txn_1", deps(answer(404, { error: { code: "not_found", message: "No such payment. Refresh the list." } })))).toEqual({
      ok: false,
      code: "not_found",
      message: "No such payment. Refresh the list.",
    });
    expect(await markPaymentDone("txn_1", deps(answer(503, {})))).toMatchObject({ ok: false, message: "The payment was not marked done (HTTP 503). Try again." });
    expect(await markPaymentDone("txn_1", { getToken: async () => null })).toMatchObject({ ok: false, code: "sign_in" });
  });
});

describe("what was paid", () => {
  it("reads Paddle's total in the currency's smallest unit", () => {
    expect(paidOf({ total: "1000", currency: "USD" })).toEqual({ minor: 1000, currency: "USD", text: "US$10.00" });
    expect(paidOf({ total: "0", currency: "USD" })).toMatchObject({ minor: 0, text: "US$0.00" });
    expect(paidOf({ total: "920", currency: "EUR" })).toMatchObject({ text: "9.20 EUR" });
    expect(paidOf({ total: "1500", currency: "JPY" })).toMatchObject({ minor: 1500, text: "1500 JPY" });
    expect(paidOf({ total: 1100 as unknown as string, currency: "USD" })).toMatchObject({ text: "US$11.00" });
    for (const odd of [{ total: null, currency: null }, {}, { total: "10.00", currency: "USD" }, { total: "-5", currency: "USD" }, { total: "1000", currency: "usd" }, { total: "1000", currency: null }]) {
      expect(paidOf(odd as OwedPayment)).toBeNull();
    }
  });

  it("compares it with the pack's list price", () => {
    expect(paidCheck(owed({ total: "1000", currency: "USD" }))).toMatchObject({ kind: "full" });
    expect(paidCheck(owed({ total: "1100", currency: "USD" }))).toMatchObject({ kind: "full" }); // with the tax Paddle adds
    expect(paidCheck(owed({ total: "999", currency: "USD" }))).toMatchObject({ kind: "less", list: "US$10" });
    expect(paidCheck(owed({ pack: "pack-20", credits: 20, total: "0", currency: "USD" }))).toMatchObject({ kind: "less", list: "US$5", paid: { text: "US$0.00" } });
    expect(paidCheck(owed({ total: "0", currency: "EUR" }))).toMatchObject({ kind: "less" });
    expect(paidCheck(owed({ total: "2000", currency: "EUR" }))).toMatchObject({ kind: "unknown", list: "US$10" });
    expect(paidCheck(owed({ total: null, currency: null }))).toEqual({ kind: "unknown", paid: null, list: "US$10" });
    expect(paidCheck(owed({ pack: "pack-old", total: "1000", currency: "USD" }))).toEqual({ kind: "unknown", paid: expect.objectContaining({ text: "US$10.00" }), list: null });
  });

  it("says what to check, and asks with the amount paid", () => {
    const at = (partial: Partial<OwedPayment>) => paidCheck(owed(partial));
    expect(paidWarning(at({ total: "1000", currency: "USD" }))).toBeNull();
    expect(paidWarning(at({ total: "0", currency: "USD" }))).toBe("Paid US$0.00, less than the pack's list price of US$10 (a discount, or a test). Check the sale in Paddle before granting the whole pack.");
    expect(paidWarning(at({ pack: "pack-old", total: "0", currency: "USD" }))).toMatch(/less than the pack's list price \(a discount/);
    expect(paidWarning(at({ total: null }))).toBe("The amount paid was not recorded for this payment. Check it in Paddle before granting.");
    expect(paidWarning(at({ total: "920", currency: "EUR" }))).toBe("Paid in EUR, which cannot be compared with the pack's list price of US$10 here. Check the sale in Paddle before granting.");
    expect(paidWarning(at({ pack: "pack-old", total: "920", currency: "EUR" }))).toMatch(/compared with the pack's list price here/);
    expect(grantQuestion(owed(), at({ total: "500", currency: "USD" }))).toBe("Grant 50 credits for a payment of US$5.00 (the pack's list price is US$10)?");
    expect(grantQuestion(owed(), at({ total: null }))).toBe("Grant 50 credits for a payment whose amount was not recorded (the pack's list price is US$10)?");
    expect(grantQuestion(owed(), at({ total: "1000", currency: "USD" }))).toBe("Grant 50 credits for a payment of US$10.00?");
  });
});

describe("what a row says", () => {
  it("names the pack, or says it is not one", () => {
    expect(packText(owed())).toBe("50 credits (US$10 pack)");
    expect(packText(owed({ pack: "pack-20", credits: 20 }))).toBe("20 credits (US$5 pack)");
    expect(packText(owed({ pack: "pack-old", credits: 30 }))).toBe("30 credits");
    expect(packText(owed({ pack: null, credits: null }))).toBe("Not one of the packs");
  });

  it("offers Grant only for a pack with an account email and no grant under way", () => {
    expect(grantable(owed())).toEqual({ ok: true });
    expect(grantable(owed({ pack: null, credits: null }))).toMatchObject({ ok: false, why: /Not one of the packs/ });
    expect(grantable(owed({ email: null }))).toMatchObject({ ok: false, why: /did not carry the account's email/ });
    expect(grantable(owed({ grantStartedAt: "2026-11-28T10:00:00.000Z" }))).toMatchObject({ ok: false, why: /^A grant of this payment began \(.+\) and did not confirm.*Do not grant it again: check the account's balance/ });
    expect(grantable(owed({ grantStartedAt: "not a date" }))).toMatchObject({ ok: false, why: /^A grant of this payment began and did not confirm/ });
  });
});

// The browser side of "Payments to grant": photo2pgn's own routes, with the
// admin's sign-in token. No network: fetch is a fake.
import { describe, expect, it, vi } from "vitest";
import { grantPayment, grantQuestion, grantable, listOwedPayments, markPaymentDone, packText, paidCheck, paidOf, paidWarning, type OwedPayment } from "../src/lib/payments";
import { GRANT_CLAIM_MS, claimEnd, clockTime, deviceZone, zoneOrUtc } from "../src/lib/claim";

const NOW = new Date("2026-11-28T18:00:00Z");
const answer = (status: number, body: unknown) =>
  vi.fn(async (_u: string, _i?: RequestInit) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const deps = (f: ReturnType<typeof answer>, zone = "UTC") => ({ getToken: async () => "admin-tok", fetch: f as unknown as typeof fetch, now: () => NOW, zone });

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
    expect(new Headers(init!.headers).get("x-time-zone")).toBe("UTC"); // so the server's messages give times in the admin's zone
  });

  it("sends the device's own time zone when none is set", async () => {
    const f = answer(200, { payments: [] });
    await listOwedPayments({ getToken: async () => "admin-tok", fetch: f as unknown as typeof fetch });
    expect(new Headers(f.mock.calls[0][1]!.headers).get("x-time-zone")).toBe(deviceZone());
    await listOwedPayments(deps(f, "America/Los_Angeles"));
    expect(new Headers(f.mock.calls[1][1]!.headers).get("x-time-zone")).toBe("America/Los_Angeles");
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
    const message = "The 50 credits were added to kai@example.com (balance now 62), but the payment could not be marked done. Do not grant it again; press Mark done after Sat, Nov 28, 6:02 PM UTC.";
    expect(await grantPayment("txn_1", deps(answer(500, { error: { code: "not_marked", message } })))).toEqual({ ok: false, code: "not_marked", message });
    expect(await grantPayment("txn_1", deps(answer(409, { error: { message: "Odd." } })))).toEqual({ ok: false, code: "error", message: "Odd." });
  });

  it("never says the credits were not added when photo2pgn's server did not say, and says to refresh in two minutes before anything by hand", async () => {
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
        message: `Photo to PGN did not say whether the credits were added (HTTP ${status}). Do not grant this payment again, and do not check the balance or add credits by hand yet: refresh the list in two minutes (after Sat, Nov 28, 6:02 PM UTC) and follow what the row then says.`,
      });
      expect(r.message).not.toMatch(/were not added/);
    }
  });

  it("says the outcome is not known when the connection fails, and when to refresh, in the admin's time zone", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("network error");
    });
    expect(await grantPayment("txn_1", { getToken: async () => "t", fetch: offline as unknown as typeof fetch, now: () => NOW, zone: "UTC" })).toEqual({
      ok: false,
      code: "grant_network",
      message:
        "The connection to Photo to PGN failed, so it is not known whether the grant reached it or whether the credits were added. Do not grant this payment again, and do not check the balance or add credits by hand yet: refresh the list in two minutes (after Sat, Nov 28, 6:02 PM UTC) and follow what the row then says.",
    });
    const pacific = await grantPayment("txn_1", { getToken: async () => "t", fetch: offline as unknown as typeof fetch, now: () => NOW, zone: "America/Los_Angeles" });
    expect(pacific.message).toMatch(/refresh the list in two minutes \(after Sat, Nov 28, 10:02 AM PST\)/);
    expect((await grantPayment("txn_1", deps(answer(504, ""), "Europe/Istanbul"))).message).toMatch(/\(after Sat, Nov 28, 9:02 PM GMT\+3\)/);
    // Without an injected clock or zone it still names a time, in the device's own zone.
    expect((await grantPayment("txn_1", { getToken: async () => "t", fetch: offline as unknown as typeof fetch })).message).toMatch(/refresh the list in two minutes \(after [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s[AP]M \S+\)/);
    expect(await grantPayment("txn_1", { getToken: async () => null })).toMatchObject({ ok: false, code: "sign_in" });
  });

  it("warns when someone else marked the payment done while the grant ran", async () => {
    const r = await grantPayment("txn_1", deps(answer(200, { email: "kai@example.com", balance: 100, credits: 50, grantedAt: "2026-11-28T18:00:05.000Z", already: false, markedMeanwhile: true })));
    expect(r).toMatchObject({ ok: true, already: false, warn: true });
    expect(r.message).toMatch(/^Added 50 credits to kai@example\.com \(balance now 100\), but someone else marked the payment done while the grant was running \(Sat, Nov 28, 6:00 PM UTC\)\. If they also added the credits by hand, the account has them twice/);
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

  it("compares the price before tax with the pack's list price, never the total with the tax in it", () => {
    const pretax = { subtotal: "1000", discount: "0", currency: "USD" };
    expect(paidCheck(owed({ ...pretax, total: "1000" }))).toMatchObject({ kind: "full" });
    expect(paidCheck(owed({ ...pretax, total: "1200" }))).toMatchObject({ kind: "full" }); // the list price, with 20% tax on top
    expect(paidCheck(owed({ ...pretax, subtotal: "1500", total: "1500" }))).toMatchObject({ kind: "full" });
    // Review r2's case: 15% off the US$5 pack at 20% VAT. The total, 510, is above the list price; the discount is not.
    const r2 = paidCheck(owed({ pack: "pack-20", credits: 20, total: "510", subtotal: "500", discount: "75", currency: "USD" }));
    expect(r2).toEqual({ kind: "less", paid: { minor: 510, currency: "USD", text: "US$5.10" }, list: "US$5", discount: { minor: 75, currency: "USD", text: "US$0.75" } });
    expect(paidCheck(owed({ total: "1080", subtotal: "1000", discount: "100", currency: "USD" }))).toMatchObject({ kind: "less", discount: { text: "US$1.00" } }); // 10% off, then 20% VAT
    expect(paidCheck(owed({ total: "1", subtotal: "1000", discount: "1", currency: "USD" }))).toMatchObject({ kind: "less" }); // any discount at all
    expect(paidCheck(owed({ total: "1080", subtotal: "900", discount: "0", currency: "USD" }))).toMatchObject({ kind: "less", subtotal: { text: "US$9.00" } }); // a price under the list
    expect(paidCheck(owed({ total: "1080", discount: "100", currency: "USD" }))).toMatchObject({ kind: "less" }); // a discount, even with no subtotal
    expect(paidCheck(owed({ pack: "pack-20", credits: 20, total: "0", currency: "USD" }))).toMatchObject({ kind: "less", list: "US$5", paid: { text: "US$0.00" } });
    expect(paidCheck(owed({ ...pretax, total: "0" }))).toMatchObject({ kind: "less" });
    expect(paidCheck(owed({ total: "0", currency: "EUR" }))).toMatchObject({ kind: "less" });
    expect(paidCheck(owed({ total: "2000", currency: "EUR" }))).toMatchObject({ kind: "unknown", list: "US$10" });
    expect(paidCheck(owed({ total: null, currency: null }))).toEqual({ kind: "unknown", paid: null, list: "US$10" });
    expect(paidCheck(owed({ pack: "pack-old", ...pretax, total: "1000" }))).toEqual({ kind: "unknown", paid: expect.objectContaining({ text: "US$10.00" }), list: null });
  });

  it("does not know the amount for an older record with no price before tax, so Grant asks first", () => {
    for (const partial of [{}, { subtotal: null, discount: null }, { subtotal: "1000" }, { discount: "0" }, { subtotal: "10.00", discount: "0" }]) {
      for (const total of ["1080", "1100", "999", "2000"]) {
        expect(paidCheck(owed({ total, currency: "USD", ...partial })), `${total} ${JSON.stringify(partial)}`).toEqual({ kind: "unknown", paid: expect.objectContaining({ minor: Number(total) }), list: "US$10", pretax: true });
      }
    }
  });

  it("says what to check, and asks with the amount paid", () => {
    const at = (partial: Partial<OwedPayment>) => paidCheck(owed({ subtotal: "1000", discount: "0", ...partial }));
    expect(paidWarning(at({ total: "1000", currency: "USD" }))).toBeNull();
    expect(paidWarning(at({ total: "0", currency: "USD" }))).toBe("Paid US$0.00, less than the pack's list price of US$10 (a discount, or a test). Check the sale in Paddle before granting the whole pack.");
    expect(paidWarning(at({ pack: "pack-old", total: "0", currency: "USD" }))).toMatch(/less than the pack's list price \(a discount/);
    expect(paidWarning(at({ pack: "pack-20", total: "510", subtotal: "500", discount: "75", currency: "USD" }))).toBe(
      "Paid US$5.10 after a discount of US$0.75 off the pack's list price of US$5 (before tax). Check the sale in Paddle before granting the whole pack.",
    );
    expect(paidWarning(at({ total: "1080", subtotal: "900", currency: "USD" }))).toBe("Paid US$10.80, for a price of US$9.00 before tax, less than the pack's list price of US$10. Check the sale in Paddle before granting the whole pack.");
    expect(paidWarning(at({ total: "1080", subtotal: null, discount: null, currency: "USD" }))).toBe(
      "Paid US$10.80 with any tax. This record does not keep the price before tax or any discount (it is older than that), so it cannot be compared with the pack's list price of US$10 here. Check the sale in Paddle before granting.",
    );
    expect(paidWarning(at({ total: null }))).toBe("The amount paid was not recorded for this payment. Check it in Paddle before granting.");
    expect(paidWarning(at({ total: "920", currency: "EUR" }))).toBe("Paid in EUR, which cannot be compared with the pack's list price of US$10 here. Check the sale in Paddle before granting.");
    expect(paidWarning(at({ pack: "pack-old", total: "920", currency: "EUR" }))).toMatch(/compared with the pack's list price here/);
    expect(grantQuestion(owed(), at({ total: "0", currency: "USD" }))).toBe("Grant 50 credits for a payment of US$0.00 (the pack's list price is US$10 before tax)?");
    expect(grantQuestion(owed({ pack: "pack-20", credits: 20 }), at({ pack: "pack-20", total: "510", subtotal: "500", discount: "75", currency: "USD" }))).toBe(
      "Grant 20 credits for a payment of US$5.10 after a discount of US$0.75 (the pack's list price is US$5 before tax)?",
    );
    expect(grantQuestion(owed(), at({ total: "1080", subtotal: "900", currency: "USD" }))).toBe("Grant 50 credits for a payment of US$10.80 (US$9.00 before tax) (the pack's list price is US$10 before tax)?");
    expect(grantQuestion(owed(), at({ total: "1080", subtotal: null, currency: "USD" }))).toBe("Grant 50 credits for a payment of US$10.80 (the pack's list price is US$10 before tax)?");
    expect(grantQuestion(owed(), at({ total: null }))).toBe("Grant 50 credits for a payment whose amount was not recorded (the pack's list price is US$10 before tax)?");
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
  });

  it("says to wait until the claim's time is up before checking the balance, while a grant may still be running", () => {
    const claimed = owed({ grantStartedAt: "2026-11-28T18:00:00.000Z" });
    for (const now of [NOW, new Date(NOW.getTime() + 20_000), new Date(NOW.getTime() + GRANT_CLAIM_MS - 1)]) {
      const r = grantable(claimed, { now, zone: "UTC" });
      expect(r).toEqual({
        ok: false,
        why: "A grant of this payment began at Sat, Nov 28, 6:00 PM UTC and may still be running. Do not grant it again, and wait until Sat, Nov 28, 6:02 PM UTC before checking the account's balance or adding credits by hand: then refresh the list and follow what this row says.",
      });
      expect(r.ok ? "" : r.why).not.toMatch(/did not confirm|add the credits by hand only if/);
    }
    expect(grantable(claimed, { now: NOW, zone: "America/Los_Angeles" })).toMatchObject({ why: /began at Sat, Nov 28, 10:00 AM PST .* wait until Sat, Nov 28, 10:02 AM PST before checking/ });
  });

  it("says when an older claim's grant had certainly landed, and only then to check the balance and add by hand", () => {
    const claimed = owed({ grantStartedAt: "2026-11-28T18:00:00.000Z" });
    for (const now of [new Date(NOW.getTime() + GRANT_CLAIM_MS), new Date(NOW.getTime() + 86_400_000)]) {
      expect(grantable(claimed, { now, zone: "UTC" })).toEqual({
        ok: false,
        why: "A grant of this payment began at Sat, Nov 28, 6:00 PM UTC and did not confirm, so the credits may or may not have been added; anything it did had landed by Sat, Nov 28, 6:02 PM UTC. Do not grant it again: check the account's balance, add the credits by hand only if they are missing, then Mark done.",
      });
    }
    // With no clock given, the device's own: a claim from 2020 is long over.
    expect(grantable(owed({ grantStartedAt: "2020-01-01T00:00:00.000Z" }))).toMatchObject({ why: /did not confirm.*had landed by/ });
    expect(grantable(owed({ grantStartedAt: "not a date" }))).toEqual({
      ok: false,
      why: "A grant of this payment began and did not confirm, so the credits may or may not have been added, and the record does not say when it began. Do not grant it again, and wait two minutes from now before checking the account's balance; then add the credits by hand only if they are missing, and Mark done.",
    });
  });
});

describe("how a time reads", () => {
  it("is the same on the server and in the browser: the admin's zone, named", () => {
    expect(GRANT_CLAIM_MS).toBe(2 * 60_000); // the messages say "two minutes"
    expect(clockTime("2026-11-28T18:02:00Z", "UTC")).toBe("Sat, Nov 28, 6:02 PM UTC");
    expect(clockTime("2026-11-28T18:02:00Z", "America/Los_Angeles")).toBe("Sat, Nov 28, 10:02 AM PST");
    expect(clockTime("2026-07-04T18:02:00Z", "America/Los_Angeles")).toBe("Sat, Jul 4, 11:02 AM PDT");
    expect(clockTime("2026-11-28T18:02:00Z", "Asia/Kolkata")).toBe("Sat, Nov 28, 11:32 PM GMT+5:30");
    expect(clockTime("not a date", "UTC")).toBe("");
    expect(claimEnd("2026-11-28T18:00:00.000Z")).toBe("2026-11-28T18:02:00.000Z");
    expect(claimEnd("not a date")).toBeNull();
  });

  it("takes only a time zone Intl knows, and falls back to UTC", () => {
    expect(zoneOrUtc("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(zoneOrUtc("utc")).toBe("UTC");
    for (const odd of [null, undefined, "", "Not/AZone", "x".repeat(65), "<script>"]) expect(zoneOrUtc(odd)).toBe("UTC");
    expect(typeof deviceZone()).toBe("string");
    const intl = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new RangeError("no Intl");
    });
    try {
      expect(deviceZone()).toBeNull();
    } finally {
      intl.mockRestore();
    }
  });
});

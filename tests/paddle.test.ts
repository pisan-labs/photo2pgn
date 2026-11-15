// The Paddle webhook: signature on the raw body, one record per transaction,
// the pack from the price id, the owner's list. No network.
import { describe, expect, it } from "vitest";
import { memoryKV } from "../netlify/lib/kv";
import { handlePaddleWebhook, handlePaymentGranted, handlePayments, paddleConfigFrom, validSignature, type Payment } from "../netlify/lib/paddle";

const SECRET = "pdl_ntfset_test";
const NOW = new Date("2026-11-15T12:00:00Z");
const config = paddleConfigFrom({ PGN_PADDLE_WEBHOOK_SECRET: SECRET, PGN_PADDLE_PRICE_PACK_20: "pri_20", PGN_PADDLE_PRICE_PACK_50: "pri_50" });

async function sign(body: string, ts = Math.floor(NOW.getTime() / 1000), secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${body}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ts=${ts};h1=${mac}`;
}

const txn = (id: string, price = "pri_50") =>
  JSON.stringify({
    event_type: "transaction.completed",
    data: { id, customer_id: "ctm_1", currency_code: "USD", items: [{ price: { id: price } }], details: { totals: { grand_total: "1000" } }, custom_data: { user_id: "u1", email: "a@example.com", credits: 9999 } },
  });

function setup(cfg = config) {
  const payments = memoryKV();
  const deps = { config: cfg, payments, now: () => NOW };
  const post = async (body: string, header?: string | null) => {
    const headers: Record<string, string> = {};
    const sig = header === undefined ? await sign(body) : header;
    if (sig) headers["paddle-signature"] = sig;
    return handlePaddleWebhook(new Request("https://x/api/paddle-webhook", { method: "POST", body, headers }), deps);
  };
  return { deps, payments, post };
}

describe("signature", () => {
  it("accepts a good one and rejects a wrong secret, a changed body, an old one and a missing one", async () => {
    const s = await sign("{}");
    expect(await validSignature("{}", s, SECRET, NOW.getTime() / 1000)).toBe(true);
    expect(await validSignature("{}", await sign("{}", undefined, "other"), SECRET, NOW.getTime() / 1000)).toBe(false);
    expect(await validSignature("{ }", s, SECRET, NOW.getTime() / 1000)).toBe(false);
    expect(await validSignature("{}", s, SECRET, NOW.getTime() / 1000 + 3600)).toBe(false);
    expect(await validSignature("{}", null, SECRET, NOW.getTime() / 1000)).toBe(false);
    expect(await validSignature("{}", "garbage", SECRET, NOW.getTime() / 1000)).toBe(false);
  });
});

describe("webhook", () => {
  it("is off without a secret", async () => {
    const { post } = setup({ ...config, webhookSecret: null });
    expect((await post(txn("txn_1"))).status).toBe(503);
  });

  it("answers a bad signature with a non-2xx and records nothing", async () => {
    const { post, payments } = setup();
    expect((await post(txn("txn_1"), "ts=1;h1=00")).status).toBe(401);
    expect((await post(txn("txn_1"), null)).status).toBe(401);
    expect(await payments.list("payment/")).toEqual([]);
  });

  it("records a completed purchase once, taking credits from the price and not from the browser", async () => {
    const { post, payments } = setup();
    expect(await (await post(txn("txn_1"))).json()).toEqual({ recorded: true });
    expect(await (await post(txn("txn_1"))).json()).toEqual({ recorded: false }); // a repeat delivery
    const p = (await payments.getJSON<Payment>("payment/txn_1"))!.value;
    expect(p).toMatchObject({ pack: "pack-50", credits: 50, userId: "u1", email: "a@example.com", customerId: "ctm_1", total: "1000", currency: "USD", grantedAt: null });
  });

  it("keeps a purchase of an unknown price, without credits", async () => {
    const { post, payments } = setup();
    await post(txn("txn_2", "pri_other"));
    expect((await payments.getJSON<Payment>("payment/txn_2"))!.value).toMatchObject({ pack: null, credits: null });
  });

  it("ignores other events and refuses a body that is not JSON", async () => {
    const { post, payments } = setup();
    const other = JSON.stringify({ event_type: "customer.updated", data: { id: "ctm_1" } });
    expect(await (await post(other)).json()).toEqual({ ignored: true });
    expect((await post("not json")).status).toBe(400);
    expect(await payments.list("payment/")).toEqual([]);
  });
});

describe("owner's list", () => {
  it("lists what is owed, oldest first, and drops a purchase once marked granted", async () => {
    const { post, deps } = setup();
    await post(txn("txn_1"));
    await post(txn("txn_2", "pri_20"));
    expect(((await (await handlePayments(true, deps)).json()) as { payments: Payment[] }).payments.map((p) => p.transactionId)).toEqual(["txn_1", "txn_2"]);
    expect((await handlePaymentGranted(true, "txn_1", deps)).status).toBe(200);
    expect(await (await handlePaymentGranted(true, "txn_1", deps)).json()).toEqual({ already: true });
    expect(((await (await handlePayments(true, deps)).json()) as { payments: Payment[] }).payments.map((p) => p.transactionId)).toEqual(["txn_2"]);
    expect((await handlePaymentGranted(true, "nope", deps)).status).toBe(404);
  });

  it("needs the owner's token", async () => {
    const { deps } = setup();
    expect((await handlePayments(false, deps)).status).toBe(401);
    expect((await handlePaymentGranted(false, "txn_1", deps)).status).toBe(401);
  });
});

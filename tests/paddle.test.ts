// The Paddle webhook: signature on the raw body, one record per transaction,
// the pack from the price id, the owner's list. No network.
import { describe, expect, it } from "vitest";
import { memoryKV } from "../netlify/lib/kv";
import { PADDLE_IPS_URL, handlePaddleWebhook, handlePaymentGranted, handlePayments, inCidrs, paddleConfigFrom, paddleIps, validSignature, type Payment } from "../netlify/lib/paddle";

const PADDLE_IP = "34.237.3.244";
const IPS = ["34.237.3.244/32", "52.11.166.252/32"];

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

function setup(cfg = config, clientIp: string | null = PADDLE_IP, ips: string[] | null = IPS) {
  const payments = memoryKV();
  const deps = { config: cfg, payments, now: () => NOW, clientIp, allowedIps: async () => ips };
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

describe("Paddle's addresses", () => {
  it("matches IPv4 CIDR blocks", () => {
    expect(inCidrs("34.237.3.244", IPS)).toBe(true);
    expect(inCidrs("34.237.3.245", IPS)).toBe(false);
    expect(inCidrs("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(inCidrs("11.1.2.3", ["10.0.0.0/8"])).toBe(false);
    expect(inCidrs("1.2.3.4", ["0.0.0.0/0"])).toBe(true);
    expect(inCidrs("2001:db8::1", IPS)).toBe(false);
    expect(inCidrs("256.1.1.1", ["0.0.0.0/0"])).toBe(false);
    expect(inCidrs("1.2.3.4", ["1.2.3.4/33", "x/8", "1.2.3/24"])).toBe(false);
  });

  it("fetches the list from Paddle, keeps it an hour, and falls back to the last good one", async () => {
    const urls: string[] = [];
    let answer: () => Response = () => Response.json({ data: { ipv4_cidrs: IPS } });
    const fetcher = (async (url: string) => {
      urls.push(url);
      return answer();
    }) as unknown as typeof fetch;
    const ips = paddleIps(fetcher, 1000);
    expect(await ips(0)).toEqual(IPS);
    expect(await ips(999)).toEqual(IPS);
    expect(urls).toEqual([PADDLE_IPS_URL]); // kept
    answer = () => new Response("down", { status: 502 });
    expect(await ips(1000)).toEqual(IPS); // stale, not none
    answer = () => Response.json({ data: { ipv4_cidrs: [] } });
    expect(await ips(2000)).toEqual(IPS);
    expect(urls).toHaveLength(3);
    const never = paddleIps((async () => new Response("down", { status: 500 })) as unknown as typeof fetch);
    expect(await never()).toBeNull();
    const garbage = paddleIps((async () => Response.json({ data: { ipv4_cidrs: [1] } })) as unknown as typeof fetch);
    expect(await garbage()).toBeNull();
  });
});

describe("webhook", () => {
  it("is off without a secret", async () => {
    const { post } = setup({ ...config, webhookSecret: null });
    expect((await post(txn("txn_1"))).status).toBe(503);
  });

  it("lets in only Paddle's addresses, and asks Paddle to retry when its list cannot be had", async () => {
    for (const ip of ["203.0.113.9", "", null]) {
      const { post, payments } = setup(config, ip);
      expect((await post(txn("txn_1"))).status).toBe(403);
      expect(await payments.list("payment/")).toEqual([]);
    }
    expect((await setup(config, `::ffff:${PADDLE_IP}`).post(txn("txn_1"))).status).toBe(200);
    expect((await setup(config, PADDLE_IP, null).post(txn("txn_1"))).status).toBe(503);
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

  // The Paddle account also sells mychessmaster.net (28 Nov) and Paddle sends every destination
  // every event: a sale another app tagged is not photo2pgn's to keep. Each test below has one
  // beside its own cases, so it fails without the filter as well as with one that drops too much.
  const sale = (id: string, customData?: unknown, price = "pri_other") =>
    JSON.stringify({
      event_type: "transaction.completed",
      data: { id, customer_id: "ctm_2", currency_code: "USD", items: [{ price: { id: price } }], details: { totals: { grand_total: "1500" } }, ...(customData === undefined ? {} : { custom_data: customData }) },
    });
  const mcm = { app: "mychessmaster", user_id: "m1", email: "b@example.com", plan: "plus" };

  it("answers another app's sale 200 and keeps and echoes nothing of it", async () => {
    const { post, payments, deps } = setup();
    for (const [i, cd] of [mcm, { ...mcm, app: "other" }, { ...mcm, app: "PHOTO2PGN" }].entries()) {
      for (const price of ["pri_mcm", "pri_50"]) {
        const res = await post(sale(`txn_m${i}${price}`, cd, price));
        expect(res.status).toBe(200); // so Paddle stops retrying
        expect(await res.json()).toEqual({ ignored: true, reason: "other app" }); // exactly: no buyer detail, no custom data
      }
    }
    expect(await payments.list("payment/")).toEqual([]);
    expect(await (await handlePayments(true, deps)).json()).toEqual({ payments: [] });
    // The address and signature checks still come first.
    expect((await post(sale("txn_m9", mcm), "ts=1;h1=00")).status).toBe(401);
    expect((await setup(config, "203.0.113.9").post(sale("txn_m9", mcm))).status).toBe(403);
  });

  it("keeps photo2pgn's own sales and untagged ones exactly as before, beside another app's", async () => {
    const { post, payments, deps } = setup();
    const own = { app: "photo2pgn", user_id: "u1", pack: "pack-50", credits: 50, email: "a@example.com" };
    expect(await (await post(sale("txn_own", own, "pri_50"))).json()).toEqual({ recorded: true });
    expect(await (await post(sale("txn_own_other", own))).json()).toEqual({ recorded: true });
    expect(await (await post(sale("txn_none"))).json()).toEqual({ recorded: true }); // no custom_data
    expect(await (await post(sale("txn_null", null))).json()).toEqual({ recorded: true });
    expect(await (await post(sale("txn_noapp", { user_id: "u2" }))).json()).toEqual({ recorded: true });
    expect(await (await post(sale("txn_mcm", mcm))).json()).toEqual({ ignored: true, reason: "other app" });
    expect((await payments.getJSON<Payment>("payment/txn_own"))!.value).toEqual({
      transactionId: "txn_own", customerId: "ctm_2", priceIds: ["pri_50"], pack: "pack-50", credits: 50, userId: "u1", email: "a@example.com", total: "1500", currency: "USD", completedAt: NOW.toISOString(), grantedAt: null,
    });
    expect((await payments.getJSON<Payment>("payment/txn_own_other"))!.value).toMatchObject({ pack: null, credits: null, userId: "u1" });
    expect((await payments.getJSON<Payment>("payment/txn_none"))!.value).toMatchObject({ pack: null, userId: null, email: null });
    expect((await payments.getJSON<Payment>("payment/txn_noapp"))!.value).toMatchObject({ pack: null, userId: "u2" });
    const owed = ((await (await handlePayments(true, deps)).json()) as { payments: Payment[] }).payments.map((p) => p.transactionId);
    expect(owed.sort()).toEqual(["txn_noapp", "txn_none", "txn_null", "txn_own", "txn_own_other"]);
  });

  it("takes an app that is empty or not a string as untagged", async () => {
    const { post, payments } = setup();
    const odd: unknown[] = ["", 7, 0, null, true, false, ["mychessmaster"], { name: "mychessmaster" }];
    for (const [i, app] of odd.entries()) {
      expect(await (await post(sale(`txn_odd${i}`, { app, user_id: "u3" }))).json()).toEqual({ recorded: true });
    }
    expect(await (await post(sale("txn_mcm", mcm))).json()).toEqual({ ignored: true, reason: "other app" });
    expect((await payments.list("payment/")).sort()).toEqual(odd.map((_, i) => `payment/txn_odd${i}`).sort());
    expect((await payments.getJSON<Payment>("payment/txn_odd0"))!.value).toMatchObject({ pack: null, userId: "u3" });
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

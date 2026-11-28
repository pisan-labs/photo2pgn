// Buying credits through Paddle: nothing for sale until the build says so.
import { describe, expect, it, vi } from "vitest";
import { CREDIT_PACKS } from "../src/lib/credits";
import { checkoutConfigFrom, checkoutSetupFrom, environmentOf, openCheckout, perCredit, priceVar, type PaddleLike } from "../src/lib/checkout";
import { memoryKV } from "../netlify/lib/kv";
import { handlePaddleWebhook, paddleConfigFrom, type Payment } from "../netlify/lib/paddle";
import { paddleSignature } from "./helpers";

const FULL = { VITE_PADDLE_CLIENT_TOKEN: " test_abc ", VITE_PADDLE_PRICE_PACK_20: "pri_20", VITE_PADDLE_PRICE_PACK_50: "pri_50" };

describe("settings from the build", () => {
  it("sells nothing without a client token and a price for every pack", () => {
    expect(checkoutConfigFrom({})).toBeNull();
    expect(checkoutConfigFrom({ VITE_PADDLE_CLIENT_TOKEN: "t" })).toBeNull();
    expect(checkoutConfigFrom({ ...FULL, VITE_PADDLE_PRICE_PACK_50: " " })).toBeNull();
    expect(checkoutConfigFrom(FULL)).toEqual({ token: "test_abc", environment: "sandbox", prices: { "pack-20": "pri_20", "pack-50": "pri_50" }, open: false });
    // Sales open only with VITE_PADDLE_OPEN=yes; until then only admins can buy.
    expect(checkoutConfigFrom({ ...FULL, VITE_PADDLE_OPEN: " yes " })!.open).toBe(true);
    expect(checkoutConfigFrom({ ...FULL, VITE_PADDLE_OPEN: "true" })!.open).toBe(false);
    expect(CREDIT_PACKS.map(priceVar)).toEqual(["VITE_PADDLE_PRICE_PACK_20", "VITE_PADDLE_PRICE_PACK_50"]);
  });
  it("takes live or sandbox from the client token, and sells nothing when a setting disagrees", () => {
    expect(environmentOf("live_x")).toBe("production");
    expect(environmentOf("test_x")).toBe("sandbox");
    expect(environmentOf("x")).toBeNull();
    const LIVE = { ...FULL, VITE_PADDLE_CLIENT_TOKEN: "live_abc" };
    expect(checkoutConfigFrom(LIVE)!.environment).toBe("production");
    expect(checkoutConfigFrom({ ...LIVE, VITE_PADDLE_ENV: "production" })!.environment).toBe("production");
    expect(checkoutSetupFrom({ ...LIVE, VITE_PADDLE_ENV: "sandbox" })).toEqual({ config: null, problem: "VITE_PADDLE_ENV is sandbox, but the client token is for production" });
    expect(checkoutSetupFrom({ ...FULL, VITE_PADDLE_ENV: "production" }).problem).toBe("VITE_PADDLE_ENV is production, but the client token is for sandbox");
    expect(checkoutSetupFrom({ ...FULL, VITE_PADDLE_CLIENT_TOKEN: "abc" }).problem).toBe("VITE_PADDLE_CLIENT_TOKEN starts with neither live_ nor test_");
    expect(checkoutSetupFrom({}).problem).toBe("no VITE_PADDLE_CLIENT_TOKEN");
    expect(checkoutSetupFrom({ ...FULL, VITE_PADDLE_PRICE_PACK_50: "" }).problem).toBe("no VITE_PADDLE_PRICE_PACK_50");
    // Amounts in place of price ids (the first Netlify settings had 500 and 1000).
    expect(checkoutSetupFrom({ ...FULL, VITE_PADDLE_PRICE_PACK_20: "500" }).problem).toBe("VITE_PADDLE_PRICE_PACK_20 is not a Paddle price id (pri_…)");
  });
  it("is off in this repository's build (nothing for sale before the Paddle account)", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("netlify.toml", "utf8")).not.toContain("VITE_PADDLE_CLIENT_TOKEN");
  });
});

describe("prices", () => {
  it("says what a credit costs in each pack", () => {
    expect(CREDIT_PACKS.map(perCredit)).toEqual(["25¢ a credit", "20¢ a credit"]);
    expect(perCredit({ id: "x", credits: 30, priceUsd: 10 })).toBe("US$0.333 a credit");
  });
});

describe("checkout", () => {
  function fakePaddle() {
    let callback: ((e: { name?: string }) => void) | undefined;
    const paddle: PaddleLike = {
      Environment: { set: vi.fn() },
      Initialize: vi.fn((o) => {
        callback = o.eventCallback;
      }),
      Checkout: { open: vi.fn() },
    };
    return { paddle, fire: (name: string) => callback?.({ name }) };
  }

  it("opens Paddle's overlay for the pack, with who pays in the custom data, and passes on its events", async () => {
    const { paddle, fire } = fakePaddle();
    const config = checkoutConfigFrom(FULL)!;
    const events: string[] = [];
    await openCheckout(CREDIT_PACKS[1], { userId: "u1", email: "a@example.com" }, config, { load: async () => paddle, onEvent: (e) => events.push(e) });
    expect(paddle.Environment.set).toHaveBeenCalledWith("sandbox");
    expect(paddle.Checkout.open).toHaveBeenCalledWith({
      items: [{ priceId: "pri_50", quantity: 1 }],
      customer: { email: "a@example.com" },
      customData: { app: "photo2pgn", user_id: "u1", pack: "pack-50", credits: 50, email: "a@example.com" },
      settings: { displayMode: "overlay", theme: "light" },
    });
    fire("checkout.loaded");
    fire("checkout.completed");
    expect(events).toEqual(["checkout.completed"]);

    // A second purchase: Paddle is set up once, and the events go to the newest caller.
    const later: string[] = [];
    await openCheckout(CREDIT_PACKS[0], { userId: "u1", email: null }, config, { load: async () => paddle, onEvent: (e) => later.push(e) });
    expect(paddle.Initialize).toHaveBeenCalledOnce();
    expect((paddle.Checkout.open as ReturnType<typeof vi.fn>).mock.calls[1][0]).not.toHaveProperty("customer");
    fire("checkout.closed");
    fire("");
    expect(later).toEqual(["checkout.closed"]);
    expect(events).toEqual(["checkout.completed"]);
  });

  // The webhook keeps only sales tagged as photo2pgn's (the Paddle account also sells other
  // apps, 28 Nov): what the checkout really sends must come back through it as a record.
  it("sends custom data the webhook records as photo2pgn's sale", async () => {
    const { paddle } = fakePaddle();
    await openCheckout(CREDIT_PACKS[1], { userId: "u1", email: "a@example.com" }, checkoutConfigFrom(FULL)!, { load: async () => paddle });
    const sent = (paddle.Checkout.open as ReturnType<typeof vi.fn>).mock.calls[0][0] as { items: { priceId: string }[]; customData: Record<string, unknown> };
    const body = JSON.stringify({
      event_type: "transaction.completed",
      data: { id: "txn_rt", customer_id: "ctm_1", subscription_id: null, currency_code: "USD", items: sent.items.map((i) => ({ price: { id: i.priceId } })), details: { totals: { grand_total: "1000" } }, custom_data: sent.customData },
    });
    const now = new Date("2026-11-28T12:00:00Z");
    const secret = "pdl_ntfset_test";
    const payments = memoryKV();
    const res = await handlePaddleWebhook(
      new Request("https://x/api/paddle-webhook", { method: "POST", body, headers: { "paddle-signature": await paddleSignature(body, secret, Math.floor(now.getTime() / 1000)) } }),
      { config: paddleConfigFrom({ PGN_PADDLE_WEBHOOK_SECRET: secret, PGN_PADDLE_PRICE_PACK_20: "pri_20", PGN_PADDLE_PRICE_PACK_50: "pri_50" }), payments, now: () => now, clientIp: "34.237.3.244", allowedIps: async () => ["34.237.3.244/32"] },
    );
    expect(await res.json()).toEqual({ recorded: true });
    expect((await payments.getJSON<Payment>("payment/txn_rt"))!.value).toMatchObject({ pack: "pack-50", credits: 50, userId: "u1", email: "a@example.com" });
  });

  it("leaves Paddle.js on live for a live token", async () => {
    const { paddle } = fakePaddle();
    await openCheckout(CREDIT_PACKS[0], { userId: "u1", email: null }, checkoutConfigFrom({ ...FULL, VITE_PADDLE_CLIENT_TOKEN: "live_abc" })!, { load: async () => paddle });
    expect(paddle.Environment.set).not.toHaveBeenCalled();
    expect(paddle.Initialize).toHaveBeenCalledWith(expect.objectContaining({ token: "live_abc" }));
  });
});

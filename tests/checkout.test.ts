// Buying credits through Paddle: nothing for sale until the build says so.
import { describe, expect, it, vi } from "vitest";
import { CREDIT_PACKS } from "../src/lib/credits";
import { checkoutConfigFrom, openCheckout, perCredit, priceVar, type PaddleLike } from "../src/lib/checkout";

const FULL = { VITE_PADDLE_CLIENT_TOKEN: " test_abc ", VITE_PADDLE_PRICE_PACK_20: "pri_20", VITE_PADDLE_PRICE_PACK_50: "pri_50" };

describe("settings from the build", () => {
  it("sells nothing without a client token and a price for every pack", () => {
    expect(checkoutConfigFrom({})).toBeNull();
    expect(checkoutConfigFrom({ VITE_PADDLE_CLIENT_TOKEN: "t" })).toBeNull();
    expect(checkoutConfigFrom({ ...FULL, VITE_PADDLE_PRICE_PACK_50: " " })).toBeNull();
    expect(checkoutConfigFrom(FULL)).toEqual({ token: "test_abc", environment: "sandbox", prices: { "pack-20": "pri_20", "pack-50": "pri_50" } });
    expect(checkoutConfigFrom({ ...FULL, VITE_PADDLE_ENV: "production" })!.environment).toBe("production");
    expect(CREDIT_PACKS.map(priceVar)).toEqual(["VITE_PADDLE_PRICE_PACK_20", "VITE_PADDLE_PRICE_PACK_50"]);
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
      customData: { app: "photo2pgn", user_id: "u1", pack: "pack-50", credits: 50 },
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
});

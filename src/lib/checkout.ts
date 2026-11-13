// Buying credits through Paddle (HintWise is the seller, Paddle the Merchant
// of Record). Pending: the owner's Paddle account. Until the build has a
// client token and a price for every pack (VITE_PADDLE_*), nothing is for
// sale: checkoutConfigFrom() is null and only admins see a preview.
//
// Also pending, outside this page: the webhook that adds the credits when
// Paddle confirms a payment. It reads custom_data (app, user_id, pack,
// credits) from the transaction, so the credits go to the HintWise account
// that paid whatever email address was typed at checkout.
import { CREDIT_PACKS, type CreditPack } from "./credits";

export interface CheckoutConfig {
  token: string;
  environment: "sandbox" | "production";
  /** Paddle price id for each pack id. */
  prices: Record<string, string>;
}

/** The build variable holding a pack's Paddle price id: pack-20 -> VITE_PADDLE_PRICE_PACK_20. */
export const priceVar = (p: CreditPack) => `VITE_PADDLE_PRICE_${p.id.replace(/-/g, "_").toUpperCase()}`;

export function checkoutConfigFrom(env: Record<string, unknown> = import.meta.env): CheckoutConfig | null {
  const token = typeof env.VITE_PADDLE_CLIENT_TOKEN === "string" ? env.VITE_PADDLE_CLIENT_TOKEN.trim() : "";
  if (!token) return null;
  const prices: Record<string, string> = {};
  for (const p of CREDIT_PACKS) {
    const v = env[priceVar(p)];
    if (typeof v !== "string" || !v.trim()) return null; // every pack, or none
    prices[p.id] = v.trim();
  }
  return { token, environment: env.VITE_PADDLE_ENV === "production" ? "production" : "sandbox", prices };
}

/** "25¢ a credit" */
export function perCredit(p: CreditPack): string {
  const cents = (p.priceUsd * 100) / p.credits;
  return Number.isInteger(cents) ? `${cents}¢ a credit` : `US$${(cents / 100).toFixed(3)} a credit`;
}

export interface Buyer {
  userId: string;
  email: string | null;
}

/** The part of Paddle.js (v2) used here. */
export interface PaddleLike {
  Environment: { set(environment: string): void };
  Initialize(options: { token: string; eventCallback?: (event: { name?: string }) => void }): void;
  Checkout: {
    open(options: {
      items: { priceId: string; quantity: number }[];
      customer?: { email: string };
      customData?: Record<string, string | number>;
      settings?: Record<string, string>;
    }): void;
  };
}

const PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";

/** Paddle.js, added to the page the first time someone buys. */
export function loadPaddle(): Promise<PaddleLike> {
  const w = window as unknown as { Paddle?: PaddleLike };
  if (w.Paddle) return Promise.resolve(w.Paddle);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PADDLE_JS;
    s.async = true;
    s.onload = () => (w.Paddle ? resolve(w.Paddle) : reject(new Error("Paddle did not load.")));
    s.onerror = () => reject(new Error("Could not reach Paddle. Check your connection and try again."));
    document.head.appendChild(s);
  });
}

let initialised: PaddleLike | null = null;
let listener: ((name: string) => void) | null = null;

/** Paddle's events this page acts on. */
export type CheckoutEvent = "checkout.completed" | "checkout.closed";

/** Open Paddle's checkout over the page for one pack. */
export async function openCheckout(
  pack: CreditPack,
  buyer: Buyer,
  config: CheckoutConfig,
  deps: { load?: () => Promise<PaddleLike>; onEvent?: (event: CheckoutEvent) => void } = {},
): Promise<void> {
  const paddle = await (deps.load ?? loadPaddle)();
  listener = (name) => {
    if (name === "checkout.completed" || name === "checkout.closed") deps.onEvent?.(name);
  };
  if (initialised !== paddle) {
    paddle.Environment.set(config.environment);
    paddle.Initialize({ token: config.token, eventCallback: (e) => listener?.(e.name ?? "") });
    initialised = paddle;
  }
  paddle.Checkout.open({
    items: [{ priceId: config.prices[pack.id], quantity: 1 }],
    ...(buyer.email ? { customer: { email: buyer.email } } : {}),
    customData: { app: "photo2pgn", user_id: buyer.userId, pack: pack.id, credits: pack.credits },
    settings: { displayMode: "overlay", theme: "light" },
  });
}

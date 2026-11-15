// Buying credits through Paddle (HintWise is the seller, Paddle the Merchant
// of Record). Until the build has a client token and a price for every pack
// (VITE_PADDLE_*), nothing is for sale: checkoutConfigFrom() is null and only
// admins see a preview, with the reason. The token's prefix decides live or
// sandbox (owner, 15 Nov), so the two cannot disagree; VITE_PADDLE_ENV is
// optional, and if it says otherwise nothing is for sale.
//
// The credits: for now the owner adds them by hand (Admin: add credits)
// when Paddle reports a payment (owner, 13 Nov). The transaction's
// custom_data (app, user_id, pack, credits) says whose HintWise account
// paid, whatever email address was typed at checkout; a webhook can read
// the same later.
import { CREDIT_PACKS, type CreditPack } from "./credits";

export interface CheckoutConfig {
  token: string;
  environment: "sandbox" | "production";
  /** Paddle price id for each pack id. */
  prices: Record<string, string>;
  /** VITE_PADDLE_OPEN=yes: everyone can buy. Until then only admins, so the live test runs on the real domain before sales open. */
  open: boolean;
}

/** The build variable holding a pack's Paddle price id: pack-20 -> VITE_PADDLE_PRICE_PACK_20. */
export const priceVar = (p: CreditPack) => `VITE_PADDLE_PRICE_${p.id.replace(/-/g, "_").toUpperCase()}`;

/** Paddle's client-side tokens say whose they are: live_… the live account, test_… the sandbox. */
export function environmentOf(token: string): CheckoutConfig["environment"] | null {
  return token.startsWith("live_") ? "production" : token.startsWith("test_") ? "sandbox" : null;
}

export type CheckoutSetup = { config: CheckoutConfig; problem: null } | { config: null; problem: string };

/** The build's Paddle settings, or why nothing is for sale. */
export function checkoutSetupFrom(env: Record<string, unknown> = import.meta.env): CheckoutSetup {
  const str = (k: string) => (typeof env[k] === "string" ? (env[k] as string).trim() : "");
  const off = (problem: string): CheckoutSetup => ({ config: null, problem });
  const token = str("VITE_PADDLE_CLIENT_TOKEN");
  if (!token) return off("no VITE_PADDLE_CLIENT_TOKEN");
  const environment = environmentOf(token);
  if (!environment) return off("VITE_PADDLE_CLIENT_TOKEN starts with neither live_ nor test_");
  const stated = str("VITE_PADDLE_ENV");
  if (stated && stated !== environment) return off(`VITE_PADDLE_ENV is ${stated}, but the client token is for ${environment}`);
  const prices: Record<string, string> = {};
  for (const p of CREDIT_PACKS) {
    const v = str(priceVar(p)); // every pack, or none
    if (!v) return off(`no ${priceVar(p)}`);
    if (!v.startsWith("pri_")) return off(`${priceVar(p)} is not a Paddle price id (pri_…)`);
    prices[p.id] = v;
  }
  return { config: { token, environment, prices, open: str("VITE_PADDLE_OPEN") === "yes" }, problem: null };
}

export const checkoutConfigFrom = (env: Record<string, unknown> = import.meta.env): CheckoutConfig | null => checkoutSetupFrom(env).config;

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
    if (config.environment === "sandbox") paddle.Environment.set("sandbox"); // live is Paddle.js's default
    paddle.Initialize({ token: config.token, eventCallback: (e) => listener?.(e.name ?? "") });
    initialised = paddle;
  }
  paddle.Checkout.open({
    items: [{ priceId: config.prices[pack.id], quantity: 1 }],
    ...(buyer.email ? { customer: { email: buyer.email } } : {}),
    customData: { app: "photo2pgn", user_id: buyer.userId, pack: pack.id, credits: pack.credits, ...(buyer.email ? { email: buyer.email } : {}) },
    settings: { displayMode: "overlay", theme: "light" },
  });
}

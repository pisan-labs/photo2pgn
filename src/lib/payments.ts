// The admin panel's "Payments to grant": Paddle sales of photo2pgn not yet
// marked granted, from photo2pgn's own server (netlify/lib/admin-payments.ts)
// with the admin's sign-in token. The server checks with the HintWise gateway
// that the caller is an admin, and adds a pack's credits through the
// platform's credits-grant function before it marks the payment granted.
import { currentToken } from "./auth";
import { CREDIT_PACKS } from "./credits";
import { shortWhen } from "./grant";

/** One payment still owed, as the server keeps it (netlify/lib/paddle.ts, Payment). */
export interface OwedPayment {
  transactionId: string;
  customerId: string | null;
  /** The pack bought, from the price; null when the price is not one of the packs. */
  pack: string | null;
  credits: number | null;
  /** The HintWise account the checkout named (custom_data.user_id). */
  userId: string | null;
  /** That account's email, as the checkout carried it (custom_data.email). */
  email: string | null;
  completedAt: string;
  grantedAt: string | null;
  /** A grant from the panel began then and has not finished (or never will). */
  grantStartedAt?: string | null;
}

export interface PaymentsDeps {
  getToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export type PaymentsList = { ok: true; payments: OwedPayment[]; unreadable: number } | { ok: false; message: string };
/** `warn`: it went through, but the admin should look at the account (marked by someone else while the grant ran). */
export type PaymentDone = { ok: true; already: boolean; message: string; warn?: boolean };
export type PaymentFailed = { ok: false; code: string; message: string };

export const PAYMENTS_URL = "/api/admin/payments";
const OFFLINE = "Could not reach Photo to PGN. Check the connection and try again.";
const SIGN_IN = "Sign in again.";
/** A grant whose request failed on the way: it may have reached the server, which may have added the credits. */
const GRANT_NETWORK =
  "The connection to Photo to PGN failed, so it is not known whether the grant reached it or whether the credits were added. Do not grant this payment again until you have refreshed the list, and check the account's balance before doing anything else.";

async function call(url: string, method: "GET" | "POST", deps: PaymentsDeps): Promise<{ status: number; body: Record<string, unknown> } | PaymentFailed> {
  const token = await (deps.getToken ?? currentToken)();
  if (!token) return { ok: false, code: "sign_in", message: SIGN_IN };
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(url, { method, headers: { authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, code: "network", message: OFFLINE };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: body && typeof body === "object" ? body : {} };
}

function failure(status: number, body: Record<string, unknown>, what: string): PaymentFailed {
  const e = (body.error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "error";
  if (typeof e.message === "string" && e.message) return { ok: false, code, message: e.message };
  if (status === 401) return { ok: false, code, message: SIGN_IN };
  return { ok: false, code, message: `${what} (HTTP ${status}). Try again.` };
}

/** The open payments, newest first. */
export async function listOwedPayments(deps: PaymentsDeps = {}): Promise<PaymentsList> {
  const r = await call(PAYMENTS_URL, "GET", deps);
  if ("ok" in r) return r;
  if (r.status === 200 && Array.isArray(r.body.payments)) {
    const unreadable = typeof r.body.unreadable === "number" && r.body.unreadable > 0 ? r.body.unreadable : 0;
    return { ok: true, payments: r.body.payments as OwedPayment[], unreadable };
  }
  return failure(r.status, r.body, "The payments did not load");
}

const pathOf = (id: string, action: "grant" | "granted") => `${PAYMENTS_URL}/${encodeURIComponent(id)}/${action}`;

/** Add the pack's credits to the account the checkout named, then mark the payment granted (the server does both, in that order). */
export async function grantPayment(id: string, deps: PaymentsDeps = {}): Promise<PaymentDone | PaymentFailed> {
  const r = await call(pathOf(id, "grant"), "POST", deps);
  if ("ok" in r) return r.code === "network" ? { ok: false, code: "grant_network", message: GRANT_NETWORK } : r;
  const b = r.body;
  if (r.status === 200 && b.already === true) return { ok: true, already: true, message: "That payment was already marked done; no credits were added." };
  if (r.status === 200 && typeof b.credits === "number") {
    const balance = typeof b.balance === "number" ? ` (balance now ${b.balance})` : "";
    const added = `Added ${b.credits} credits to ${String(b.email ?? "the account")}${balance}`;
    if (b.markedMeanwhile === true) {
      const when = typeof b.grantedAt === "string" ? shortWhen(b.grantedAt) : "";
      return {
        ok: true,
        already: false,
        warn: true,
        message: `${added}, but someone else marked the payment done while the grant was running${when ? ` (${when})` : ""}. If they also added the credits by hand, the account has them twice: check its balance and take off any extra (Admin: add credits, with a negative number).`,
      };
    }
    return { ok: true, already: false, message: `${added}, and marked the payment done.` };
  }
  const e = (b.error ?? {}) as { code?: unknown; message?: unknown };
  if (typeof e.message === "string" && e.message) return { ok: false, code: typeof e.code === "string" ? e.code : "error", message: e.message };
  // No word from photo2pgn's server (Netlify's own 502 or 504, or an odd answer): the grant may have run.
  return {
    ok: false,
    code: "grant_unknown",
    message: `Photo to PGN did not say whether the credits were added (HTTP ${r.status}). Do not grant this payment again until you have refreshed the list, and check the account's balance before doing anything else.`,
  };
}

/** Mark a payment granted without adding credits here; a second mark changes nothing. */
export async function markPaymentDone(id: string, deps: PaymentsDeps = {}): Promise<PaymentDone | PaymentFailed> {
  const r = await call(pathOf(id, "granted"), "POST", deps);
  if ("ok" in r) return r;
  if (r.status === 200) {
    return { ok: true, already: r.body.already === true, message: r.body.already === true ? "That payment was already marked done." : "Marked the payment done." };
  }
  return failure(r.status, r.body, "The payment was not marked done");
}

/** "50 credits (the 50-credit pack)", or why there is no number. */
export function packText(p: Pick<OwedPayment, "pack" | "credits">): string {
  if (p.pack && p.credits) {
    const known = CREDIT_PACKS.find((c) => c.id === p.pack);
    return `${p.credits} credits${known ? ` (US$${known.priceUsd} pack)` : ""}`;
  }
  return "Not one of the packs";
}

/** What "Grant and mark done" can do for a payment: grant, or why only "Mark done" is offered. */
export function grantable(p: OwedPayment): { ok: true } | { ok: false; why: string } {
  if (p.grantStartedAt) {
    const when = shortWhen(p.grantStartedAt);
    return {
      ok: false,
      why: `A grant of this payment began${when ? ` (${when})` : ""} and did not confirm, so the credits may or may not have been added. Do not grant it again: check the account's balance, add the credits by hand only if they are missing, then Mark done.`,
    };
  }
  if (!p.pack || !p.credits) return { ok: false, why: "Not one of the packs: add any credits owed by hand above, then Mark done." };
  if (!p.email) return { ok: false, why: "The checkout did not carry the account's email: add the credits by hand above, then Mark done." };
  return { ok: true };
}

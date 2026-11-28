// The admin panel's "Payments to grant": Paddle sales of photo2pgn not yet
// marked granted, from photo2pgn's own server (netlify/lib/admin-payments.ts)
// with the admin's sign-in token. The server checks with the HintWise gateway
// that the caller is an admin, and adds a pack's credits through the
// platform's credits-grant function before it marks the payment granted.
import { currentToken } from "./auth";
import { GRANT_CLAIM_MS, TIME_ZONE_HEADER, claimEnd, clockTime, deviceZone } from "./claim";
import { CREDIT_PACKS } from "./credits";

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
  /** What was paid: Paddle's grand_total, with tax, in the currency's smallest unit ("1000" is US$10.00); null when the record did not keep it. */
  total?: string | null;
  /** Paddle's subtotal (the price before discount and tax) and discount, in the same unit; absent on records from before review r2. */
  subtotal?: string | null;
  discount?: string | null;
  currency?: string | null;
  completedAt: string;
  grantedAt: string | null;
  /** A grant from the panel began then and has not finished (or never will). */
  grantStartedAt?: string | null;
}

export interface PaymentsDeps {
  getToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
  /** The clock the messages' times come from (tests set it). */
  now?: () => Date;
  /** The time zone every time is given in, the browser's messages and the server's; the device's own when not set. */
  zone?: string;
}

export type PaymentsList = { ok: true; payments: OwedPayment[]; unreadable: number } | { ok: false; message: string };
/** `warn`: it went through, but the admin should look at the account (marked by someone else while the grant ran). */
export type PaymentDone = { ok: true; already: boolean; message: string; warn?: boolean };
export type PaymentFailed = { ok: false; code: string; message: string };

export const PAYMENTS_URL = "/api/admin/payments";
const OFFLINE = "Could not reach Photo to PGN. Check the connection and try again.";
const SIGN_IN = "Sign in again.";
/**
 * A grant with no answer from photo2pgn's server (a lost connection, or
 * Netlify's own 502 or 504): it may have reached the server and still be
 * running, and the claim's time is not known here. In two minutes the
 * refreshed row says what to do, with its own time (review r2, RPP.2-1).
 */
const refreshLater = (deps: PaymentsDeps) => {
  const at = clockTime(new Date((deps.now?.() ?? new Date()).getTime() + GRANT_CLAIM_MS).toISOString(), deps.zone);
  return `Do not grant this payment again, and do not check the balance or add credits by hand yet: refresh the list in two minutes (after ${at}) and follow what the row then says.`;
};

async function call(url: string, method: "GET" | "POST", deps: PaymentsDeps): Promise<{ status: number; body: Record<string, unknown> } | PaymentFailed> {
  const token = await (deps.getToken ?? currentToken)();
  if (!token) return { ok: false, code: "sign_in", message: SIGN_IN };
  const zone = deps.zone ?? deviceZone();
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(url, { method, headers: { authorization: `Bearer ${token}`, ...(zone ? { [TIME_ZONE_HEADER]: zone } : {}) } });
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
  if ("ok" in r) {
    if (r.code !== "network") return r;
    return { ok: false, code: "grant_network", message: `The connection to Photo to PGN failed, so it is not known whether the grant reached it or whether the credits were added. ${refreshLater(deps)}` };
  }
  const b = r.body;
  if (r.status === 200 && b.already === true) return { ok: true, already: true, message: "That payment was already marked done; no credits were added." };
  if (r.status === 200 && typeof b.credits === "number") {
    const balance = typeof b.balance === "number" ? ` (balance now ${b.balance})` : "";
    const added = `Added ${b.credits} credits to ${String(b.email ?? "the account")}${balance}`;
    if (b.markedMeanwhile === true) {
      const when = typeof b.grantedAt === "string" ? clockTime(b.grantedAt, deps.zone) : "";
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
    message: `Photo to PGN did not say whether the credits were added (HTTP ${r.status}). ${refreshLater(deps)}`,
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

/** What was paid, from the record: the amount in the currency's smallest unit, and how it reads. */
export interface Paid {
  minor: number;
  currency: string;
  text: string;
}

/** Digits after the point in a currency (2 for USD, 0 for JPY), as Paddle counts its smallest unit; a well-formed code Intl does not know gets 2. */
const minorDigits = (currency: string): number => new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;

/** An amount in the currency's smallest unit as it reads ("US$10.00", "9.20 EUR"), or null when it is not one. */
function amountOf(value: string | number | null | undefined, currency: string | null | undefined): Paid | null {
  const v = typeof value === "number" ? String(value) : value;
  if (typeof v !== "string" || !/^\d{1,15}$/.test(v) || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;
  const minor = Number(v);
  const digits = minorDigits(currency);
  const major = (minor / 10 ** digits).toFixed(digits);
  return { minor, currency, text: currency === "USD" ? `US$${major}` : `${major} ${currency}` };
}

/** "US$10.00", "9.20 EUR", or null when the record has no usable amount (an older record, or an odd one). */
export function paidOf(p: Pick<OwedPayment, "total" | "currency">): Paid | null {
  return amountOf(p.total, p.currency);
}

/**
 * What was paid against the pack's list price (CREDIT_PACKS, in US$, before
 * the tax Paddle adds). The total includes that tax, so it is never compared
 * with the list price (review r2, RPP.2-2): a payment is "less" when the total
 * is 0, or Paddle's pre-tax subtotal is under the list price, or there was any
 * discount; "full" only when the record shows neither; and not known when the
 * amount was not recorded, is in another currency, the pack is not in the
 * list, or the record is older than the pre-tax amounts (`pretax`).
 */
export type PaidCheck =
  | { kind: "full"; paid: Paid }
  | { kind: "less"; paid: Paid; list: string | null; discount?: Paid; subtotal?: Paid }
  | { kind: "unknown"; paid: Paid | null; list: string | null; pretax?: boolean };

export function paidCheck(p: Pick<OwedPayment, "pack" | "total" | "subtotal" | "discount" | "currency">): PaidCheck {
  const paid = paidOf(p);
  const pack = CREDIT_PACKS.find((c) => c.id === p.pack);
  const list = pack ? `US$${Number.isInteger(pack.priceUsd) ? pack.priceUsd : pack.priceUsd.toFixed(2)}` : null;
  if (paid && paid.minor === 0) return { kind: "less", paid, list };
  if (!paid || !pack || paid.currency !== "USD") return { kind: "unknown", paid, list };
  const discount = amountOf(p.discount, paid.currency);
  if (discount && discount.minor > 0) return { kind: "less", paid, list, discount };
  const subtotal = amountOf(p.subtotal, paid.currency);
  if (!subtotal || !discount) return { kind: "unknown", paid, list, pretax: true };
  if (subtotal.minor < Math.round(pack.priceUsd * 100)) return { kind: "less", paid, list, subtotal };
  return { kind: "full", paid };
}

/** What a row says about the amount when the admin should look before granting; null when it is at least the list price. */
export function paidWarning(c: PaidCheck): string | null {
  if (c.kind === "full") return null;
  const price = c.list ? `the pack's list price of ${c.list}` : "the pack's list price";
  const check = "Check the sale in Paddle before granting the whole pack.";
  if (c.kind === "less") {
    if (c.discount) return `Paid ${c.paid.text} after a discount of ${c.discount.text} off ${price} (before tax). ${check}`;
    if (c.subtotal) return `Paid ${c.paid.text}, for a price of ${c.subtotal.text} before tax, less than ${price}. ${check}`;
    return `Paid ${c.paid.text}, less than ${price} (a discount, or a test). ${check}`;
  }
  if (!c.paid) return "The amount paid was not recorded for this payment. Check it in Paddle before granting.";
  if (c.pretax) {
    return `Paid ${c.paid.text} with any tax. This record does not keep the price before tax or any discount (it is older than that), so it cannot be compared with ${price} here. Check the sale in Paddle before granting.`;
  }
  return `Paid in ${c.paid.currency}, which cannot be compared with ${price} here. Check the sale in Paddle before granting.`;
}

/** The question "Grant and mark done" asks first when the amount is less than the list price or not known. */
export function grantQuestion(p: Pick<OwedPayment, "credits">, c: PaidCheck): string {
  const detail = c.kind === "less" && c.discount ? ` after a discount of ${c.discount.text}` : c.kind === "less" && c.subtotal ? ` (${c.subtotal.text} before tax)` : "";
  const amount = c.paid ? `a payment of ${c.paid.text}${detail}` : "a payment whose amount was not recorded";
  const list = c.kind !== "full" && c.list ? ` (the pack's list price is ${c.list} before tax)` : "";
  return `Grant ${p.credits} credits for ${amount}${list}?`;
}

/**
 * What "Grant and mark done" can do for a payment: grant, or why only "Mark
 * done" is offered. A claimed payment names the time its grant has certainly
 * landed by (the claim plus GRANT_CLAIM_MS, as the server's messages do):
 * before it, wait and refresh; after it, check the balance (review r2, RPP.2-1).
 */
export function grantable(p: OwedPayment, opts: { now?: Date; zone?: string } = {}): { ok: true } | { ok: false; why: string } {
  if (p.grantStartedAt) {
    const end = claimEnd(p.grantStartedAt);
    if (!end) {
      return {
        ok: false,
        why: "A grant of this payment began and did not confirm, so the credits may or may not have been added, and the record does not say when it began. Do not grant it again, and wait two minutes from now before checking the account's balance; then add the credits by hand only if they are missing, and Mark done.",
      };
    }
    const began = clockTime(p.grantStartedAt, opts.zone);
    const until = clockTime(end, opts.zone);
    if ((opts.now ?? new Date()).getTime() < Date.parse(end)) {
      return {
        ok: false,
        why: `A grant of this payment began at ${began} and may still be running. Do not grant it again, and wait until ${until} before checking the account's balance or adding credits by hand: then refresh the list and follow what this row says.`,
      };
    }
    return {
      ok: false,
      why: `A grant of this payment began at ${began} and did not confirm, so the credits may or may not have been added; anything it did had landed by ${until}. Do not grant it again: check the account's balance, add the credits by hand only if they are missing, then Mark done.`,
    };
  }
  if (!p.pack || !p.credits) return { ok: false, why: "Not one of the packs: add any credits owed by hand above, then Mark done." };
  if (!p.email) return { ok: false, why: "The checkout did not carry the account's email: add the credits by hand above, then Mark done." };
  return { ok: true };
}

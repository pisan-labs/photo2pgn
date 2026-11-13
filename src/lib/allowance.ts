// How many readings a signed-in person has left, from the gateway's check
// mode (live since 13 Nov 2026): POST {app, check: true} with the session
// token, as for a reading, answers without calling the model:
//   { allowed, scope, resets_at, app_open, limits: [{scope, unit, used, cap, resets_at}], calls_left }
// calls_left is exact (the minimum over the person's call caps, 0 when any cap refuses).
// Since credits (13 Nov): allowed counts bought credits too, uses_credit says the
// next reading spends one, credits is this app's balance and admin who may grant.
import { GATEWAY_APP, gatewayUrl } from "./llm";
import { currentToken } from "./auth";
import type { OutOfCredits } from "./access";

export interface Limit {
  scope: string;
  unit: "calls" | "usd";
  used: number;
  cap: number;
  resets_at: string;
}

export interface Allowance {
  allowed: boolean;
  uses_credit?: boolean;
  scope: string | null;
  resets_at: string | null; // when free readings come back, while none are left
  app_open: boolean;
  limits: Limit[];
  calls_left: number | null; // free readings left
  credits?: number; // bought credits, this app
  admin?: boolean;
}

export interface CheckDeps {
  getToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
  gatewayUrl?: string;
}

function isAllowance(d: unknown): d is Allowance {
  const a = d as Allowance | null;
  return Boolean(a) && typeof a!.allowed === "boolean" && Array.isArray(a!.limits) && (a!.calls_left === null || typeof a!.calls_left === "number");
}

/** The signed-in person's allowance, or null when it cannot be told (signed out, offline, an older gateway). */
export async function checkAllowance(deps: CheckDeps = {}): Promise<Allowance | null> {
  try {
    const token = await (deps.getToken ?? currentToken)();
    if (!token) return null;
    const res = await (deps.fetch ?? fetch)(deps.gatewayUrl ?? gatewayUrl(), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ app: GATEWAY_APP, check: true }),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isAllowance(data) ? data : null;
  } catch {
    return null;
  }
}

export interface Credits {
  free: number | null; // free readings left
  paid: number; // bought credits
  left: number | null; // all of them
  /** When new free credits come: the next day, or the next week when the week's limit binds. */
  renewsAt: string | null;
  out: boolean;
  admin: boolean;
}

export function creditsOf(a: Allowance): Credits {
  const paid = typeof a.credits === "number" && a.credits > 0 ? a.credits : 0;
  const free = a.calls_left;
  const admin = a.admin === true;
  // allowed already counts bought credits; an older gateway has none, so no free ones left is out.
  const out = !a.allowed || !a.app_open || (free === 0 && paid === 0);
  if (out) return { free: 0, paid, left: 0, renewsAt: a.resets_at, out: true, admin };
  const day = a.limits.find((l) => l.unit === "calls" && l.scope.includes("day"));
  const week = a.limits.find((l) => l.unit === "calls" && l.scope.includes("week"));
  const weekBinds = Boolean(day && week && free !== null && free > 0 && free < day.cap - day.used);
  const renewsAt = free === 0 ? a.resets_at : ((weekBinds ? week : day)?.resets_at ?? null);
  return { free, paid, left: free === null ? paid || null : free + paid, renewsAt, out: false, admin };
}

/** The line under "Use my N credits". */
export function creditsLine(c: Credits, now = new Date(), locale?: string): string {
  const when = c.renewsAt ? whenLocal(c.renewsAt, now, locale) : null;
  const renew = when ? (c.paid > 0 ? ` New free credits ${when}.` : ` New credits ${when}.`) : "";
  if (c.paid > 0 && c.free) return `${c.free} free today and ${c.paid} bought.${renew}`;
  if (c.paid > 0) return `${c.paid} bought.${renew}`;
  return renew.trim();
}

/** The out-of-credits mark the page already understands, when the gateway says so. */
export function outMarkOf(a: Allowance, userId: string): OutOfCredits | null {
  const c = creditsOf(a);
  return c.out && c.renewsAt ? { userId, until: c.renewsAt } : null;
}

/** "at 4:00 PM" today, or "Mon 4:00 PM" on another day, in the person's own time. */
export function whenLocal(iso: string, now = new Date(), locale?: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const sameDay = at.toDateString() === now.toDateString();
  // Within the next day the time alone is clear ("at 4:00 PM"); further off, name the day.
  return sameDay || at.getTime() - now.getTime() < 24 * 3600 * 1000 ? `at ${time}` : `${at.toLocaleDateString(locale, { weekday: "short" })} ${time}`;
}

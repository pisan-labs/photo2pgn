// How many readings a signed-in person has left, from the gateway's check
// mode (live since 13 Nov 2026): POST {app, check: true} with the session
// token, as for a reading, answers without calling the model:
//   { allowed, scope, resets_at, app_open, limits: [{scope, unit, used, cap, resets_at}], calls_left }
// calls_left is exact (the minimum over the person's call caps, 0 when any cap refuses).
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
  scope: string | null;
  resets_at: string | null;
  app_open: boolean;
  limits: Limit[];
  calls_left: number | null;
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
  left: number | null;
  /** When new credits come: the next day, or the next week when the week's limit binds. */
  renewsAt: string | null;
  out: boolean;
}

export function creditsOf(a: Allowance): Credits {
  const out = !a.allowed || !a.app_open || a.calls_left === 0;
  if (out) return { left: 0, renewsAt: a.resets_at, out: true };
  const day = a.limits.find((l) => l.unit === "calls" && l.scope.includes("day"));
  const week = a.limits.find((l) => l.unit === "calls" && l.scope.includes("week"));
  const weekBinds = Boolean(day && week && a.calls_left !== null && a.calls_left < day.cap - day.used);
  return { left: a.calls_left, renewsAt: (weekBinds ? week : day)?.resets_at ?? null, out: false };
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

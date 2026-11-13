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
import { creditsOf, isAllowance, type Allowance, type Credits } from "./balance";

export { creditsOf, isAllowance, type Allowance, type Credits, type Limit } from "./balance";

export interface CheckDeps {
  getToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
  gatewayUrl?: string;
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

// A person's credits from the gateway's check mode, in one place for the
// browser (allowance.ts) and photo2pgn's server (netlify/lib/gateway.ts).
// No imports: the server bundle takes this file alone.

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

export function isAllowance(d: unknown): d is Allowance {
  const a = d as Allowance | null;
  return Boolean(a) && typeof a!.allowed === "boolean" && Array.isArray(a!.limits) && (a!.calls_left === null || typeof a!.calls_left === "number");
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

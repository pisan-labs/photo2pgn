// Adding credits to a person, for HintWise admins: the platform's
// credits-grant function (live since 13 Nov 2026). POST with the admin's
// session token and {app, email, credits, note?}; credits is a whole number
// from -10000 to 10000, and 0 only reads the balance.
import { GATEWAY_APP } from "./llm";
import { currentToken } from "./auth";

export const GRANT_LIMIT = 10000;

export type GrantResult = { ok: true; email: string; balance: number } | { ok: false; message: string };

export interface GrantDeps {
  getToken?: () => Promise<string | null>;
  fetch?: typeof fetch;
  url?: string;
}

export function grantUrl(env: Record<string, unknown> = import.meta.env): string {
  const base = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL : "";
  return `${base.replace(/\/$/, "")}/functions/v1/credits-grant`;
}

/** What is wrong with the request before it is sent, or null. */
export function grantProblem(email: string, credits: number): string | null {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return "Enter the person's email address.";
  if (!Number.isInteger(credits) || Math.abs(credits) > GRANT_LIMIT) return `Credits: a whole number from -${GRANT_LIMIT} to ${GRANT_LIMIT}.`;
  return null;
}

const ERRORS: Record<string, string> = {
  admin: "Your account is not a HintWise admin.",
  below_zero: "That would take their balance below zero; nothing changed.",
  not_found: "No HintWise account has that email address. They need to sign in once first.",
  request: `Check the email address and the number (a whole number from -${GRANT_LIMIT} to ${GRANT_LIMIT}).`,
};

export async function grantCredits(req: { email: string; credits: number; note?: string }, deps: GrantDeps = {}): Promise<GrantResult> {
  const problem = grantProblem(req.email, req.credits);
  if (problem) return { ok: false, message: problem };
  const token = await (deps.getToken ?? currentToken)();
  if (!token) return { ok: false, message: "Sign in again." };
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(deps.url ?? grantUrl(), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ app: GATEWAY_APP, email: req.email.trim(), credits: req.credits, ...(req.note?.trim() ? { note: req.note.trim() } : {}) }),
    });
  } catch {
    return { ok: false, message: "Could not reach HintWise. Check the connection and try again." };
  }
  const data = (await res.json().catch(() => ({}))) as { email?: string; balance?: number; error?: string };
  if (res.ok && typeof data.balance === "number") return { ok: true, email: data.email ?? req.email.trim(), balance: data.balance };
  if (res.status === 401) return { ok: false, message: "Sign in again." };
  return { ok: false, message: (data.error && ERRORS[data.error]) || `The grant did not go through (HTTP ${res.status}). Try again.` };
}

// ---- the list of people who have used photo2pgn (admins only) ----
// POST the same function with {app, list: true, limit?}: most recent first.
// People are noted on every check and reading; earlier ones come from their
// readings, credits and saved games (so someone who only ever signed in, before
// 13 Nov, is not listed).

export interface AppUser {
  email: string;
  first_seen: string;
  last_seen: string;
  free_left: number | null;
  free_resets_at: string | null;
  credits: number;
  readings_today: number;
  readings_total: number;
}

export type ListResult = { ok: true; count: number; users: AppUser[] } | { ok: false; message: string };

export async function listUsers(deps: GrantDeps = {}, limit = 500): Promise<ListResult> {
  const token = await (deps.getToken ?? currentToken)();
  if (!token) return { ok: false, message: "Sign in again." };
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(deps.url ?? grantUrl(), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ app: GATEWAY_APP, list: true, limit }),
    });
  } catch {
    return { ok: false, message: "Could not reach HintWise. Check the connection and try again." };
  }
  const data = (await res.json().catch(() => ({}))) as { count?: number; users?: AppUser[]; error?: string };
  if (res.ok && Array.isArray(data.users)) return { ok: true, count: data.count ?? data.users.length, users: data.users };
  if (res.status === 401) return { ok: false, message: "Sign in again." };
  return { ok: false, message: (data.error && ERRORS[data.error]) || `The list did not load (HTTP ${res.status}). Try again.` };
}

/** "Fri 13 Nov, 9:15 AM" in the admin's own time. */
export function shortWhen(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

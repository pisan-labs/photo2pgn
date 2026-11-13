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

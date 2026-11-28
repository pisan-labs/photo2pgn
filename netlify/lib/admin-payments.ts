// The payments still owed, for a signed-in HintWise admin in photo2pgn's
// admin panel (owner, 28 Nov: "p2p payments panel"), so a sale no longer
// needs a curl with the worker token and a grant by hand.
//
// The admin is whoever the HintWise gateway says is one, asked with the
// caller's own sign-in token (check mode, `admin: true`); nobody else gets
// in. The credits are added through the platform's credits-grant function,
// also with the caller's own token, so the platform checks the admin again
// and logs the admin as the actor. No service key, no Anthropic key.
//
// Grant first, then mark: a payment is marked granted only after the grant
// went through, so a failed grant or a failed mark leaves it in the list.
// While a grant runs the payment carries a claim (grantStartedAt), taken
// with the record's etag, so two clicks or two admins cannot add the
// credits twice; a claim that never finished (the function was stopped)
// is shown, and only "Mark done" is offered for it.
import type { KV } from "./kv";
import { openPayments, type Payment } from "./paddle";
import { isAllowance } from "../../src/lib/balance";

export const APP = "photo2pgn";

/** What the gateway says about the caller: an admin, signed in but not an admin, signed out, or it could not be asked. */
export type AdminStatus = "admin" | "not_admin" | "signed_out" | "unreachable";
export type AdminCheck = (token: string) => Promise<AdminStatus>;

/** The gateway's check mode ({ app, check: true }) with the caller's own token: free, and it says `admin`. */
export function gatewayAdminCheck(url: string, doFetch: typeof fetch = fetch): AdminCheck {
  return async (token) => {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ app: APP, check: true }),
      });
      if (res.status === 401) return "signed_out";
      const data: unknown = res.ok ? await res.json() : null;
      if (!isAllowance(data)) return "unreachable";
      return data.admin === true ? "admin" : "not_admin";
    } catch {
      return "unreachable";
    }
  };
}

export type GrantFailure = "signed_out" | "admin" | "not_found" | "request" | "unreachable" | "failed";
export type GrantOutcome = { ok: true; email: string; balance: number } | { ok: false; code: GrantFailure; status: number | null };
export type CreditsGrant = (token: string, grant: { email: string; credits: number; note: string }) => Promise<GrantOutcome>;

/** The platform's credits-grant function, with the admin's own token: {app, email, credits, note} -> {email, balance}. */
export function creditsGrantClient(url: string, doFetch: typeof fetch = fetch): CreditsGrant {
  return async (token, grant) => {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ app: APP, ...grant }),
      });
    } catch {
      return { ok: false, code: "unreachable", status: null };
    }
    const data = (await res.json().catch(() => ({}))) as { email?: unknown; balance?: unknown; error?: unknown };
    if (res.ok && typeof data.balance === "number") return { ok: true, email: typeof data.email === "string" ? data.email : grant.email, balance: data.balance };
    const code: GrantFailure =
      res.status === 401 ? "signed_out" : data.error === "admin" ? "admin" : data.error === "not_found" ? "not_found" : data.error === "request" ? "request" : "failed";
    return { ok: false, code, status: res.status };
  };
}

export interface AdminPaymentsDeps {
  payments: KV;
  isAdmin: AdminCheck;
  grant: CreditsGrant;
  now?: () => Date;
}

/** A grant claim younger than this is a grant under way; an older one never finished. */
export const GRANT_CLAIM_MS = 2 * 60_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => json(status, { error: { code, message }, ...extra });
const bearer = (req: Request) => {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
};
const keyOf = (id: string) => `payment/${id}`;
/** "28 Nov 2026, 17:50 UTC": the server does not know the admin's time zone. */
const utc = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" })} UTC`;
};

/** The caller's token when the gateway says they are a HintWise admin; otherwise the answer to send. */
async function admitted(req: Request, deps: AdminPaymentsDeps): Promise<{ token: string } | Response> {
  const token = bearer(req);
  if (!token) return fail(401, "sign_in", "Sign in as a HintWise admin to see the payments.");
  const status = await deps.isAdmin(token);
  if (status === "admin") return { token };
  if (status === "signed_out") return fail(401, "sign_in", "Your sign-in has run out. Sign in again.");
  if (status === "unreachable") return fail(503, "gateway", "Could not ask HintWise whether you are an admin. Try again in a minute.");
  return fail(403, "admin", "Only a HintWise admin can see the payments.");
}

/**
 * Mark a payment granted, once: when it is marked (now, or already before),
 * and whether it was before. A lost write is tried again on the fresh record;
 * null when it never went through (gone, or the storage failed), so the
 * payment stays in the list.
 */
async function markGranted(kv: KV, id: string, at: string, extra: Partial<Payment> = {}): Promise<{ grantedAt: string; already: boolean } | null> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await kv.getJSON<Payment>(keyOf(id));
      if (!cur) return null;
      if (cur.value.grantedAt) return { grantedAt: cur.value.grantedAt, already: true };
      const next: Payment = { ...cur.value, ...extra, grantedAt: at, grantStartedAt: null };
      if (await kv.setJSON(keyOf(id), next, { onlyIfMatch: cur.etag })) return { grantedAt: at, already: false };
    }
  } catch (err) {
    console.error("admin-payments: could not mark", id, err instanceof Error ? err.message : err);
  }
  return null;
}

/** Take back a claim after a grant that did not go through, so it can be tried again. */
async function releaseClaim(kv: KV, id: string, claim: string): Promise<void> {
  try {
    const cur = await kv.getJSON<Payment>(keyOf(id));
    if (cur && !cur.value.grantedAt && cur.value.grantStartedAt === claim) {
      await kv.setJSON(keyOf(id), { ...cur.value, grantStartedAt: null }, { onlyIfMatch: cur.etag });
    }
  } catch (err) {
    console.error("admin-payments: could not release the claim", id, err instanceof Error ? err.message : err);
  }
}

function grantFailure(r: Extract<GrantOutcome, { ok: false }>, p: Payment): Response {
  const still = "The payment is still open.";
  switch (r.code) {
    case "signed_out":
      return fail(401, "sign_in", `Your sign-in has run out, so no credits were added. ${still} Sign in again and retry.`);
    case "admin":
      return fail(403, "admin", `HintWise says your account is not an admin, so no credits were added. ${still}`);
    case "not_found":
      return fail(
        409,
        "no_account",
        `No HintWise account has the email ${p.email}, so no credits were added. ${still} Add the credits by hand to the buyer's account (Admin: add credits), then Mark done.`,
      );
    case "unreachable":
      return fail(502, "grant_unreachable", `Could not reach HintWise to add the credits. ${still} Try again in a minute.`);
    default:
      return fail(502, "grant_failed", `HintWise did not add the credits${r.status ? ` (HTTP ${r.status})` : ""}. ${still} Try again in a minute.`);
  }
}

/** GET /api/admin/payments: the payments not yet marked granted, newest first. */
async function list(deps: AdminPaymentsDeps): Promise<Response> {
  const owed = await openPayments(deps.payments);
  owed.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return json(200, { payments: owed });
}

/** POST /api/admin/payments/:id/grant: add the pack's credits to the account the checkout named, then mark it granted. */
async function grant(id: string, token: string, deps: AdminPaymentsDeps): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const cur = await deps.payments.getJSON<Payment>(keyOf(id));
  if (!cur) return fail(404, "not_found", "No such payment. Refresh the list.");
  const p = cur.value;
  if (p.grantedAt) return json(200, { already: true, grantedAt: p.grantedAt });
  if (!p.pack || !p.credits) {
    return fail(409, "no_pack", "This payment is not one of the packs, so there is no number of credits to add. Add any credits owed by hand, then Mark done.");
  }
  if (!p.email) {
    return fail(409, "no_email", "The checkout did not carry the account's email, so the credits cannot be added from here. Add them by hand to the buyer's account, then Mark done.");
  }
  if (p.grantStartedAt) {
    if (now.getTime() - Date.parse(p.grantStartedAt) < GRANT_CLAIM_MS) {
      return fail(409, "busy", "This payment is being granted right now (in another tab, or by another admin). Refresh the list in a minute.");
    }
    return fail(
      409,
      "unfinished",
      `A grant of this payment started at ${utc(p.grantStartedAt)} and did not finish, so the credits may or may not have been added. Check the balance of ${p.email} (Check balance), add the credits by hand if they are missing, then Mark done.`,
    );
  }
  const claim = now.toISOString();
  if (!(await deps.payments.setJSON(keyOf(id), { ...p, grantStartedAt: claim }, { onlyIfMatch: cur.etag }))) {
    return fail(409, "busy", "This payment changed while you were granting it. Refresh the list.");
  }
  const r = await deps.grant(token, { email: p.email, credits: p.credits, note: `Paddle ${p.transactionId} (${p.pack})` });
  if (!r.ok) {
    await releaseClaim(deps.payments, id, claim);
    return grantFailure(r, p);
  }
  const marked = await markGranted(deps.payments, id, (deps.now?.() ?? new Date()).toISOString(), { grantedCredits: p.credits });
  const done = { email: r.email, balance: r.balance, credits: p.credits };
  if (!marked) {
    // The credits are in; the claim stays, so nobody adds them again from here.
    return fail(
      500,
      "not_marked",
      `The ${p.credits} credits were added to ${r.email} (balance now ${r.balance}), but the payment could not be marked done. Press Mark done; do not grant it again.`,
      done,
    );
  }
  return json(200, { ...done, grantedAt: marked.grantedAt, already: false });
}

/** POST /api/admin/payments/:id/granted: mark it done without adding credits here. A second mark changes nothing. */
async function mark(id: string, deps: AdminPaymentsDeps): Promise<Response> {
  if (!(await deps.payments.getJSON<Payment>(keyOf(id)))) return fail(404, "not_found", "No such payment. Refresh the list.");
  const marked = await markGranted(deps.payments, id, (deps.now?.() ?? new Date()).toISOString());
  if (!marked) return fail(503, "not_marked", "The payment could not be marked done. It is still open; try again.");
  return json(200, marked);
}

const ROUTE = /^\/api\/admin\/payments(?:\/([^/]+)\/(grant|granted))?\/?$/;

/**
 * GET  /api/admin/payments               the open payments, newest first
 * POST /api/admin/payments/:id/grant     add the pack's credits, then mark it granted
 * POST /api/admin/payments/:id/granted   mark it granted only
 * Every route needs a HintWise admin's own sign-in (Authorization: Bearer).
 */
export async function handleAdminPayments(req: Request, deps: AdminPaymentsDeps): Promise<Response> {
  const m = ROUTE.exec(new URL(req.url).pathname);
  const who = await admitted(req, deps);
  if (who instanceof Response) return who;
  if (!m) return fail(404, "not_found", "No such route.");
  const [, rawId, action] = m;
  if (!action) return req.method === "GET" ? list(deps) : fail(405, "method", "Use GET.");
  if (req.method !== "POST") return fail(405, "method", "Use POST.");
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return fail(404, "not_found", "No such payment. Refresh the list.");
  }
  return action === "grant" ? grant(id, who.token, deps) : mark(id, deps);
}

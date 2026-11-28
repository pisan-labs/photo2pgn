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
// credits twice. credits-grant adds the credits every time it is called, so
// the claim is given back only when credits-grant certainly wrote nothing
// (review r1, RPP.1-1); after any answer that leaves it unclear the claim
// stays, and only "Mark done" is offered, after checking the balance. A
// record with no etag is never claimed (the claim would be an unconditional
// write), and Mark done waits while a claim is young.
import type { KV, Versioned } from "./kv";
import { APP } from "./gateway";
import type { Payment } from "./paddle";
import { isAllowance } from "../../src/lib/balance";

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

/**
 * Why a grant did not go through. The first five mean credits-grant certainly
 * wrote nothing (see REFUSED); "unreachable" (the request threw: it may have
 * been sent) and "failed" (any other status, or a 2xx without a balance) leave
 * it unknown whether the credits went in.
 */
export type GrantFailure = "signed_out" | "admin" | "not_found" | "request" | "refused" | "unreachable" | "failed";
export type GrantOutcome = { ok: true; email: string; balance: number } | { ok: false; code: GrantFailure; status: number | null };
export type CreditsGrant = (token: string, grant: { email: string; credits: number; note: string }) => Promise<GrantOutcome>;

/**
 * The answers after which no credits were added, so the claim can be given
 * back. From credits-grant's source (platform/supabase/functions/credits-grant
 * and src/credits/grant.ts): 401 comes before the token's user is known, 403
 * before the grant, 400 for a request it could not read or a balance that
 * would go below zero, 404 for an email with no account (those two are raised
 * inside platform.credit_grant, so it rolled back); Supabase's own layer
 * answers 400, 401, 403 and 404 before the function runs at all. A 500
 * `database` is not one of them: credits-grant gives it for every other error
 * of the database call, and supabase-js reports a connection lost on the way
 * back from a call that committed as just such an error, so the body cannot
 * tell "refused" from "written, answer lost".
 */
export const REFUSED_STATUSES: readonly number[] = [400, 401, 403, 404];
const REFUSED: readonly GrantFailure[] = ["signed_out", "admin", "not_found", "request", "refused"];

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
      // Also thrown when the connection closes after the request went out, by when the grant may have gone in.
      return { ok: false, code: "unreachable", status: null };
    }
    const data = (await res.json().catch(() => ({}))) as { email?: unknown; balance?: unknown; error?: unknown };
    if (res.ok && typeof data.balance === "number") return { ok: true, email: typeof data.email === "string" ? data.email : grant.email, balance: data.balance };
    const code: GrantFailure =
      res.status === 401
        ? "signed_out"
        : res.status === 403 && data.error === "admin"
          ? "admin"
          : res.status === 404 && data.error === "not_found"
            ? "not_found"
            : res.status === 400
              ? "request"
              : REFUSED_STATUSES.includes(res.status)
                ? "refused"
                : "failed";
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

/** A claim younger than GRANT_CLAIM_MS: the grant that took it may still be running. */
const live = (claim: string, now: Date) => now.getTime() - Date.parse(claim) < GRANT_CLAIM_MS;
/** When a claim stops being young: after that, anything its grant did has landed. */
const claimEnds = (claim: string) => utc(new Date(Date.parse(claim) + GRANT_CLAIM_MS).toISOString());
const STORE_DOWN = (what: string) => `Could not ${what} the payment store just now, so nothing was granted or marked. Try again in a minute.`;

type Marked = { grantedAt: string; already: boolean } | { claimedAt: string } | null;

/**
 * Mark a payment granted, once: when it is marked (now, or already before),
 * and whether it was before. A lost write is tried again on the fresh record;
 * null when it never went through (gone, or the storage failed), so the
 * payment stays in the list. A young claim other than `claim` (the caller's
 * own, after its grant) is not marked over: its grant may still be running.
 */
async function markGranted(kv: KV, id: string, now: Date, opts: { claim?: string; extra?: Partial<Payment> } = {}): Promise<Marked> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await kv.getJSON<Payment>(keyOf(id));
      if (!cur) return null;
      if (cur.value.grantedAt) return { grantedAt: cur.value.grantedAt, already: true };
      const claimed = cur.value.grantStartedAt;
      if (claimed && claimed !== opts.claim && live(claimed, now)) return { claimedAt: claimed };
      const next: Payment = { ...cur.value, ...opts.extra, grantedAt: now.toISOString(), grantStartedAt: null };
      // With no etag there can be no claim to keep (a grant refuses such a record), so the mark is the one write left.
      if (await kv.setJSON(keyOf(id), next, cur.etag ? { onlyIfMatch: cur.etag } : undefined)) return { grantedAt: now.toISOString(), already: false };
    }
  } catch (err) {
    console.error("admin-payments: could not mark", id, err instanceof Error ? err.message : err);
  }
  return null;
}

/** Take back a claim after credits-grant refused the grant (nothing was written), so it can be tried again. */
async function releaseClaim(kv: KV, id: string, claim: string): Promise<void> {
  try {
    const cur = await kv.getJSON<Payment>(keyOf(id));
    if (cur?.etag && !cur.value.grantedAt && cur.value.grantStartedAt === claim) {
      await kv.setJSON(keyOf(id), { ...cur.value, grantStartedAt: null }, { onlyIfMatch: cur.etag });
    }
  } catch (err) {
    console.error("admin-payments: could not release the claim", id, err instanceof Error ? err.message : err);
  }
}

function grantFailure(r: Extract<GrantOutcome, { ok: false }>, p: Payment, claim: string): Response {
  const still = "The payment is still open.";
  // The claim stays: the payment is never offered for a grant again, only Mark done once the balance is checked.
  const unknown = `Do not grant this payment again. After ${claimEnds(claim)}, check the balance of ${p.email} (Check balance): add the ${p.credits} credits by hand (Admin: add credits) only if they are missing, then Mark done.`;
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
    case "request":
      return fail(
        502,
        "grant_refused",
        `HintWise turned the grant down: it does not take ${p.email} with ${p.credits} credits. No credits were added. ${still} Add them by hand (Admin: add credits), then Mark done.`,
      );
    case "refused":
      return fail(502, "grant_refused", `HintWise refused the grant (HTTP ${r.status}), so no credits were added. ${still} Add them by hand (Admin: add credits), then Mark done.`);
    case "unreachable":
      return fail(502, "grant_unreachable", `The connection to HintWise failed while the grant was being sent, so the credits may or may not have been added. ${unknown}`);
    default:
      // A server error or an answer without a balance: the grant may have gone in before the answer was lost.
      return fail(502, "grant_unclear", `HintWise did not confirm the grant${r.status ? ` (HTTP ${r.status})` : ""}, so the credits may or may not have been added. ${unknown}`);
  }
}

const READ_AT_ONCE = 8;

/**
 * The payments not yet marked granted, read a few at a time. A record that
 * cannot be read (a store error, or not a payment) is counted and left out,
 * so one bad record does not hide the rest. A failed listing throws.
 */
export async function readOpenPayments(kv: KV): Promise<{ open: Payment[]; unreadable: number }> {
  const keys = await kv.list("payment/");
  const open: Payment[] = [];
  let unreadable = 0;
  for (let i = 0; i < keys.length; i += READ_AT_ONCE) {
    const read = await Promise.allSettled(keys.slice(i, i + READ_AT_ONCE).map((k) => kv.getJSON<Payment>(k)));
    for (const r of read) {
      if (r.status === "rejected") unreadable++;
      else if (!r.value) continue; // removed since the listing
      else if (typeof r.value.value?.transactionId !== "string" || typeof r.value.value.completedAt !== "string") unreadable++;
      else if (!r.value.value.grantedAt) open.push(r.value.value);
    }
  }
  if (unreadable) console.error("admin-payments:", unreadable, "payment records could not be read");
  return { open, unreadable };
}

/** GET /api/admin/payments: the payments not yet marked granted, newest first, and how many records could not be read. */
async function list(deps: AdminPaymentsDeps): Promise<Response> {
  let read: Awaited<ReturnType<typeof readOpenPayments>>;
  try {
    read = await readOpenPayments(deps.payments);
  } catch (err) {
    console.error("admin-payments: could not list", err instanceof Error ? err.message : err);
    return fail(503, "store", "The payments could not be read from the store just now. Try again in a minute.");
  }
  read.open.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return json(200, { payments: read.open, ...(read.unreadable ? { unreadable: read.unreadable } : {}) });
}

/** POST /api/admin/payments/:id/grant: add the pack's credits to the account the checkout named, then mark it granted. */
async function grant(id: string, token: string, deps: AdminPaymentsDeps): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  let cur: Versioned<Payment> | null;
  try {
    cur = await deps.payments.getJSON<Payment>(keyOf(id));
  } catch {
    return fail(503, "store", STORE_DOWN("read"));
  }
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
    if (live(p.grantStartedAt, now)) {
      return fail(409, "busy", "This payment is being granted right now (in another tab, or by another admin). Refresh the list in a minute.");
    }
    return fail(
      409,
      "unfinished",
      `A grant of this payment started at ${utc(p.grantStartedAt)} and did not finish, so the credits may or may not have been added. Check the balance of ${p.email} (Check balance), add the credits by hand if they are missing, then Mark done.`,
    );
  }
  if (!cur.etag) {
    // Without a version the claim would be an unconditional write, and two grants could both go through.
    return fail(
      503,
      "unguarded",
      `The payment store gave this payment no version to write against, so a grant from here could not be kept from running twice. No credits were added. The payment is still open. Add them by hand (Admin: add credits), then Mark done.`,
    );
  }
  const claim = now.toISOString();
  let claimed: boolean;
  try {
    claimed = await deps.payments.setJSON(keyOf(id), { ...p, grantStartedAt: claim }, { onlyIfMatch: cur.etag });
  } catch {
    return fail(503, "store", "Could not record that this payment is being granted, so no credits were added. Refresh the list before trying again.");
  }
  if (!claimed) return fail(409, "busy", "This payment changed while you were granting it. Refresh the list.");
  const r = await deps.grant(token, { email: p.email, credits: p.credits, note: `Paddle ${p.transactionId} (${p.pack})` });
  if (!r.ok) {
    if (REFUSED.includes(r.code)) await releaseClaim(deps.payments, id, claim);
    return grantFailure(r, p, claim);
  }
  const marked = await markGranted(deps.payments, id, deps.now?.() ?? new Date(), { claim, extra: { grantedCredits: p.credits } });
  const done = { email: r.email, balance: r.balance, credits: p.credits };
  if (!marked || "claimedAt" in marked) {
    // The credits are in; the claim stays, so nobody adds them again from here.
    return fail(
      500,
      "not_marked",
      `The ${p.credits} credits were added to ${r.email} (balance now ${r.balance}), but the payment could not be marked done. Do not grant it again; press Mark done after ${claimEnds(claim)}.`,
      done,
    );
  }
  // Marked by someone else while the grant ran (the owner's worker route, say): the account may now have the credits twice.
  if (marked.already) return json(200, { ...done, grantedAt: marked.grantedAt, already: false, markedMeanwhile: true });
  return json(200, { ...done, grantedAt: marked.grantedAt, already: false });
}

/** POST /api/admin/payments/:id/granted: mark it done without adding credits here. A second mark changes nothing; a young grant claim is waited for. */
async function mark(id: string, deps: AdminPaymentsDeps): Promise<Response> {
  try {
    if (!(await deps.payments.getJSON<Payment>(keyOf(id)))) return fail(404, "not_found", "No such payment. Refresh the list.");
  } catch {
    return fail(503, "store", STORE_DOWN("read"));
  }
  const marked = await markGranted(deps.payments, id, deps.now?.() ?? new Date());
  if (marked && "claimedAt" in marked) {
    return fail(
      409,
      "grant_running",
      `A grant of this payment started at ${utc(marked.claimedAt)} and may still be running, so it cannot be marked done before ${claimEnds(marked.claimedAt)}. Then refresh, check the account's balance, add any credits still missing by hand, and Mark done.`,
    );
  }
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

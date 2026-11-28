// For HintWise admins only (the gateway's check says admin): the Paddle sales
// of photo2pgn credits not yet marked granted, newest first. "Grant and mark
// done" adds the pack's credits to the account the checkout named and then
// marks the payment done (photo2pgn's server does both, in that order);
// "Mark done" alone is for a sale with no pack, or one handled another way.
import { useEffect, useRef, useState } from "react";
import { clockTime } from "../lib/claim";
import {
  grantable,
  grantPayment,
  grantQuestion,
  listOwedPayments,
  markPaymentDone,
  packText,
  paidCheck,
  paidWarning,
  type OwedPayment,
  type PaymentsDeps,
} from "../lib/payments";

type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; payments: OwedPayment[]; unreadable: number };

const withoutKey = (e: Record<string, string>, id: string) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== id));

/**
 * The answers after which only "Mark done" is offered until a refresh: the
 * credits may already be in (the grant's outcome is not known, or a grant is
 * under way), or there is nothing to grant from here.
 */
const MARK_ONLY = new Set([
  "not_marked",
  "unfinished",
  "no_pack",
  "no_email",
  "grant_refused",
  "grant_unclear",
  "grant_unreachable",
  "grant_unknown",
  "grant_network",
  "unguarded",
  "busy",
  "grant_running",
  "claim_kept",
]);

export function AdminPayments({ deps, onGranted }: { deps?: PaymentsDeps; onGranted?: () => void }) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const [busy, setBusy] = useState<{ id: string; kind: "grant" | "mark" } | null>(null);
  // The row whose action waits for a yes: Mark done always, a grant when the amount paid is under the list price or not known.
  const [confirming, setConfirming] = useState<{ id: string; kind: "grant" | "mark" } | null>(null);
  // Why the last action on a row did not go through, per row, until that row is acted on again.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [markOnly, setMarkOnly] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ text: string; warn?: boolean }>({ text: "" });
  const [focusTo, setFocusTo] = useState<{ to: "notice" | "confirm" | "mark" | "grant"; id?: string } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const markRefs = useRef(new Map<string, HTMLButtonElement>());
  const grantRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    let live = true;
    void listOwedPayments(deps).then((r) => {
      if (live) setList(r.ok ? { kind: "ready", payments: r.payments, unreadable: r.unreadable } : { kind: "error", message: r.message });
    });
    return () => {
      live = false;
    };
  }, [deps, reloads]);

  // Keyboard focus follows the action: to the confirmation, back to its button, or to the result.
  useEffect(() => {
    if (!focusTo) return;
    if (focusTo.to === "notice") noticeRef.current?.focus();
    else if (focusTo.to === "confirm") confirmRef.current?.focus();
    else if (focusTo.id) (focusTo.to === "grant" ? grantRefs : markRefs).current.get(focusTo.id)?.focus();
  }, [focusTo]);

  const refresh = () => {
    setList({ kind: "loading" });
    setNotice({ text: "" });
    setRowErrors({});
    setMarkOnly([]); // the fresh list says again what each payment allows
    setConfirming(null);
    setReloads((n) => n + 1);
  };

  const act = async (p: OwedPayment, kind: "grant" | "mark") => {
    if (busy) return;
    const id = p.transactionId;
    setBusy({ id, kind });
    setRowErrors((e) => withoutKey(e, id));
    setNotice({ text: "" });
    const r = kind === "grant" ? await grantPayment(id, deps) : await markPaymentDone(id, deps);
    setBusy(null);
    setConfirming(null);
    if (r.ok) {
      setList((l) => (l.kind === "ready" ? { ...l, payments: l.payments.filter((x) => x.transactionId !== id) } : l));
      setNotice({ text: r.message, warn: r.warn });
      setFocusTo({ to: "notice" });
      if (kind === "grant" && !r.already) onGranted?.();
      return;
    }
    setRowErrors((e) => ({ ...e, [id]: r.message }));
    if (MARK_ONLY.has(r.code)) setMarkOnly((m) => [...m, id]);
    setFocusTo({ to: "mark", id });
  };

  const cancelConfirm = (id: string, kind: "grant" | "mark") => {
    setConfirming(null);
    setFocusTo({ to: kind, id });
  };

  const ask = (id: string, kind: "grant" | "mark") => {
    if (busy) return;
    setRowErrors((e) => withoutKey(e, id));
    setConfirming({ id, kind });
    setFocusTo({ to: "confirm" });
  };

  return (
    <section className="panel admin-payments" aria-labelledby="admin-payments-title">
      <h2 id="admin-payments-title">Payments to grant</h2>
      <p className="hint">
        Sales of Photo to PGN credits through Paddle that are not marked done yet, newest first. &ldquo;Grant and mark done&rdquo; adds the pack&rsquo;s credits to
        the account the checkout named, then marks the payment done.
      </p>
      <div className="row payments-tools">
        <button
          type="button"
          className="secondary"
          aria-disabled={list.kind === "loading" || busy !== null}
          onClick={() => {
            if (list.kind !== "loading" && !busy) refresh();
          }}
        >
          Refresh
        </button>
      </div>
      <p className={`${notice.warn ? "warn" : "ok-note"} payments-notice`} role="status" tabIndex={-1} ref={noticeRef}>
        {notice.text}
      </p>

      {list.kind === "loading" && (
        <p className="hint" role="status">
          Loading the payments…
        </p>
      )}
      {list.kind === "error" && (
        <div className="row">
          <p className="error" role="alert">
            {list.message}
          </p>
          <button type="button" className="secondary" onClick={refresh}>
            Try again
          </button>
        </div>
      )}
      {list.kind === "ready" && list.unreadable > 0 && (
        <p className="error" role="alert">
          {list.unreadable} {list.unreadable === 1 ? "payment record" : "payment records"} could not be read just now, so {list.unreadable === 1 ? "it is" : "they are"} not listed. Refresh to try again.
        </p>
      )}
      {list.kind === "ready" && list.payments.length === 0 && list.unreadable === 0 && <p className="ok-note">No payments are waiting. Every sale so far is marked done.</p>}
      {list.kind === "ready" && list.payments.length > 0 && (
        <>
          <p className="hint">
            {list.payments.length} {list.payments.length === 1 ? "payment" : "payments"} to grant.
          </p>
          <ul className="payments">
            {list.payments.map((p, i) => {
              const id = p.transactionId;
              const can = grantable(p, { now: deps?.now?.(), zone: deps?.zone });
              const grantOk = can.ok && !markOnly.includes(id);
              const why = can.ok ? null : can.why;
              const summaryId = `payment-${i}-summary`;
              const mine = busy?.id === id;
              const paid = paidCheck(p);
              const paidNote = grantOk ? paidWarning(paid) : null;
              const asking = confirming?.id === id ? confirming.kind : null;
              return (
                <li key={id} className="payment" aria-busy={mine || undefined}>
                  <p className="payment-head" id={summaryId}>
                    <strong>{packText(p)}</strong> <span className="payment-when">{clockTime(p.completedAt, deps?.zone) || p.completedAt}</span>
                    {paid.kind === "less" && <span className="payment-flag">Paid less than the list price</span>}
                    <span className="sr-only">, for {p.email ?? p.userId ?? "an account not named at checkout"}</span>
                  </p>
                  <dl className="payment-facts">
                    <dt>Account</dt>
                    <dd>
                      {p.email ? (
                        <>
                          <span className="payment-email">{p.email}</span>
                          {p.userId && <span className="hint"> user id <span className="payment-id">{p.userId}</span></span>}
                        </>
                      ) : p.userId ? (
                        <>user id <span className="payment-id">{p.userId}</span></>
                      ) : (
                        "Not named at checkout"
                      )}
                    </dd>
                    <dt>Paid</dt>
                    <dd>{paid.paid ? paid.paid.text : "Amount not recorded"}</dd>
                    <dt>Paddle</dt>
                    <dd>
                      <span className="payment-id">{id}</span>
                      {p.customerId && (
                        <span className="hint">
                          {" "}
                          customer <span className="payment-id">{p.customerId}</span>
                        </span>
                      )}
                    </dd>
                  </dl>
                  {why && <p className="hint">{why}</p>}
                  {paidNote && <p className="warn payment-warn">{paidNote}</p>}
                  {rowErrors[id] && (
                    <p className="error" role="alert">
                      {rowErrors[id]}
                    </p>
                  )}
                  {asking ? (
                    <div
                      className="row payment-confirm"
                      role="group"
                      aria-label={asking === "grant" ? "Confirm Grant and mark done" : "Confirm Mark done"}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") cancelConfirm(id, asking);
                      }}
                    >
                      <span>{asking === "grant" ? grantQuestion(p, paid) : "Mark this payment done without adding credits here?"}</span>
                      <button type="button" className="primary" ref={confirmRef} aria-disabled={busy !== null} aria-describedby={summaryId} onClick={() => void act(p, asking)}>
                        {asking === "grant" ? (mine && busy?.kind === "grant" ? "Granting…" : "Yes, grant and mark done") : mine && busy?.kind === "mark" ? "Marking…" : "Yes, mark done"}
                      </button>
                      <button type="button" className="secondary" onClick={() => cancelConfirm(id, asking)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="row">
                      {grantOk && (
                        <button
                          type="button"
                          className="primary"
                          aria-disabled={busy !== null}
                          aria-describedby={summaryId}
                          ref={(el) => {
                            if (el) grantRefs.current.set(id, el);
                            else grantRefs.current.delete(id);
                          }}
                          onClick={() => (paid.kind === "full" ? void act(p, "grant") : ask(id, "grant"))}
                        >
                          {mine && busy?.kind === "grant" ? "Granting…" : "Grant and mark done"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        aria-disabled={busy !== null}
                        aria-describedby={summaryId}
                        ref={(el) => {
                          if (el) markRefs.current.set(id, el);
                          else markRefs.current.delete(id);
                        }}
                        onClick={() => ask(id, "mark")}
                      >
                        Mark done
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

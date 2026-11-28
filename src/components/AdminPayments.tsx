// For HintWise admins only (the gateway's check says admin): the Paddle sales
// of photo2pgn credits not yet marked granted, newest first. "Grant and mark
// done" adds the pack's credits to the account the checkout named and then
// marks the payment done (photo2pgn's server does both, in that order);
// "Mark done" alone is for a sale with no pack, or one handled another way.
import { useEffect, useRef, useState } from "react";
import { shortWhen } from "../lib/grant";
import { grantable, grantPayment, listOwedPayments, markPaymentDone, packText, type OwedPayment, type PaymentsDeps } from "../lib/payments";

type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; payments: OwedPayment[] };

const withoutKey = (e: Record<string, string>, id: string) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== id));

/** The server's answers after which only "Mark done" is offered: the credits may already be in, or there is nothing to grant from here. */
const MARK_ONLY = new Set(["not_marked", "unfinished", "no_pack", "no_email"]);

export function AdminPayments({ deps, onGranted }: { deps?: PaymentsDeps; onGranted?: () => void }) {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [reloads, setReloads] = useState(0);
  const [busy, setBusy] = useState<{ id: string; kind: "grant" | "mark" } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Why the last action on a row did not go through, per row, until that row is acted on again.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [markOnly, setMarkOnly] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [focusTo, setFocusTo] = useState<{ to: "notice" | "confirm" | "mark"; id?: string } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const markRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    let live = true;
    void listOwedPayments(deps).then((r) => {
      if (live) setList(r.ok ? { kind: "ready", payments: r.payments } : { kind: "error", message: r.message });
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
    else if (focusTo.id) markRefs.current.get(focusTo.id)?.focus();
  }, [focusTo]);

  const refresh = () => {
    setList({ kind: "loading" });
    setNotice("");
    setRowErrors({});
    setConfirming(null);
    setReloads((n) => n + 1);
  };

  const act = async (p: OwedPayment, kind: "grant" | "mark") => {
    if (busy) return;
    const id = p.transactionId;
    setBusy({ id, kind });
    setRowErrors((e) => withoutKey(e, id));
    setNotice("");
    const r = kind === "grant" ? await grantPayment(id, deps) : await markPaymentDone(id, deps);
    setBusy(null);
    setConfirming(null);
    if (r.ok) {
      setList((l) => (l.kind === "ready" ? { kind: "ready", payments: l.payments.filter((x) => x.transactionId !== id) } : l));
      setNotice(r.message);
      setFocusTo({ to: "notice" });
      if (kind === "grant" && !r.already) onGranted?.();
      return;
    }
    setRowErrors((e) => ({ ...e, [id]: r.message }));
    if (MARK_ONLY.has(r.code)) setMarkOnly((m) => [...m, id]);
    setFocusTo({ to: "mark", id });
  };

  const cancelConfirm = (id: string) => {
    setConfirming(null);
    setFocusTo({ to: "mark", id });
  };

  return (
    <section className="panel admin-payments" aria-labelledby="admin-payments-title">
      <h2 id="admin-payments-title">Payments to grant</h2>
      <p className="hint">
        Sales of Photo to PGN credits through Paddle that are not marked done yet, newest first. &ldquo;Grant and mark done&rdquo; adds the pack&rsquo;s credits to
        the account that paid, then marks the payment done.
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
      <p className="ok-note payments-notice" role="status" tabIndex={-1} ref={noticeRef}>
        {notice}
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
      {list.kind === "ready" && list.payments.length === 0 && <p className="ok-note">No payments are waiting. Every sale so far is marked done.</p>}
      {list.kind === "ready" && list.payments.length > 0 && (
        <>
          <p className="hint">
            {list.payments.length} {list.payments.length === 1 ? "payment" : "payments"} to grant.
          </p>
          <ul className="payments">
            {list.payments.map((p, i) => {
              const id = p.transactionId;
              const can = grantable(p);
              const grantOk = can.ok && !markOnly.includes(id);
              const why = can.ok ? null : can.why;
              const summaryId = `payment-${i}-summary`;
              const mine = busy?.id === id;
              return (
                <li key={id} className="payment" aria-busy={mine || undefined}>
                  <p className="payment-head" id={summaryId}>
                    <strong>{packText(p)}</strong> <span className="payment-when">{shortWhen(p.completedAt) || p.completedAt}</span>
                    <span className="sr-only">, for {p.email ?? p.userId ?? "an account not named at checkout"}</span>
                  </p>
                  <dl className="payment-facts">
                    <dt>Account</dt>
                    <dd>
                      {p.email ? (
                        <>
                          <span className="payment-email">{p.email}</span>
                          {p.userId && <span className="hint"> user id {p.userId}</span>}
                        </>
                      ) : p.userId ? (
                        <>user id {p.userId}</>
                      ) : (
                        "Not named at checkout"
                      )}
                    </dd>
                    <dt>Paddle</dt>
                    <dd>
                      {id}
                      {p.customerId && <span className="hint"> customer {p.customerId}</span>}
                    </dd>
                  </dl>
                  {why && <p className="hint">{why}</p>}
                  {rowErrors[id] && (
                    <p className="error" role="alert">
                      {rowErrors[id]}
                    </p>
                  )}
                  {confirming === id ? (
                    <div
                      className="row payment-confirm"
                      role="group"
                      aria-label="Confirm Mark done"
                      onKeyDown={(e) => {
                        if (e.key === "Escape") cancelConfirm(id);
                      }}
                    >
                      <span>Mark this payment done without adding credits here?</span>
                      <button type="button" className="primary" ref={confirmRef} aria-disabled={busy !== null} aria-describedby={summaryId} onClick={() => void act(p, "mark")}>
                        {mine && busy?.kind === "mark" ? "Marking…" : "Yes, mark done"}
                      </button>
                      <button type="button" className="secondary" onClick={() => cancelConfirm(id)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="row">
                      {grantOk && (
                        <button type="button" className="primary" aria-disabled={busy !== null} aria-describedby={summaryId} onClick={() => void act(p, "grant")}>
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
                        onClick={() => {
                          if (busy) return;
                          setRowErrors((e) => withoutKey(e, id));
                          setConfirming(id);
                          setFocusTo({ to: "confirm" });
                        }}
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

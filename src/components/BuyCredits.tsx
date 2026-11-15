// Buying credits: the packs, and Paddle's checkout over the page. The prices
// are public at /pricing (owner, 15 Nov); until the build has Paddle settings
// the buttons say "Coming soon", and admins see why.
import { useEffect, useRef, useState } from "react";
import { CREDIT_PACKS, FREE_PER_DAY, FREE_PER_WEEK, REFUND_DAYS, packLabel, type CreditPack } from "../lib/credits";
import { openCheckout, perCredit, type Buyer, type CheckoutConfig } from "../lib/checkout";

type State = { kind: "idle" } | { kind: "opening"; pack: string } | { kind: "paid" } | { kind: "error"; message: string };

export function BuyCredits({
  config,
  problem = null,
  buyer,
  onSignIn,
  onClose,
  onPaid,
  admin = false,
}: {
  config: CheckoutConfig | null;
  /** Why config is null (checkoutSetupFrom), shown to admins. */
  problem?: string | null;
  /** An admin sees why nothing can be bought yet. */
  admin?: boolean;
  /** Signed in: who pays. Signed out: buying needs an account. */
  buyer: Buyer | null;
  onSignIn: () => void;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const ref = useRef<HTMLElement>(null);
  // Opened from further down the page: bring it into view.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, []);
  const buy = async (pack: CreditPack) => {
    if (!config || !buyer) return;
    setState({ kind: "opening", pack: pack.id });
    try {
      await openCheckout(pack, buyer, config, {
        onEvent: (e) => {
          if (e === "checkout.completed") {
            setState({ kind: "paid" });
            onPaid();
          } else setState((s) => (s.kind === "opening" ? { kind: "idle" } : s));
        },
      });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <section ref={ref} className="panel buy" aria-labelledby="buy-title">
      <div className="buy-head">
        <h2 id="buy-title">Buy credits</h2>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </div>
      {config && !config.open && admin && (
        <p className="notice">Admins only: sales are not open yet (VITE_PADDLE_OPEN=yes opens them), so only admins can buy. Everyone else sees Coming soon.</p>
      )}
      {!config && (
        <p className="notice">
          {admin
            ? `Admins: Paddle is not connected (${problem ?? "the VITE_PADDLE_* build settings"}), so the buttons are off. Everyone sees these prices at /pricing.`
            : "Buying opens soon. Until then, use your free credits or your own Anthropic API key."}
        </p>
      )}
      <p>
        One credit reads one scoresheet. Everyone also gets {FREE_PER_DAY} free credits a day, up to {FREE_PER_WEEK} a week.
      </p>
      <ul className="packs">
        {CREDIT_PACKS.map((p) => (
          <li key={p.id}>
            <span>
              <strong>{packLabel(p)}</strong>
              <small>{perCredit(p)}</small>
            </span>
            {!config ? (
              <button type="button" className="secondary" disabled>
                Coming soon
              </button>
            ) : buyer ? (
              <button type="button" className="primary" disabled={state.kind === "opening"} onClick={() => void buy(p)}>
                {state.kind === "opening" && state.pack === p.id ? "Opening…" : "Buy"}
              </button>
            ) : (
              <button type="button" className="secondary" onClick={onSignIn}>
                Sign in to buy
              </button>
            )}
          </li>
        ))}
      </ul>
      {state.kind === "paid" && (
        <p className="ok-note" role="status">
          Thank you. Your credits will be added to your account soon; Paddle emails you the receipt.
        </p>
      )}
      {state.kind === "error" && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}
      <p className="hint">
        Payment through Paddle, which handles tax and receipts; sales tax or VAT may be added at checkout. Credits are for Photo to PGN and do
        not expire. Within {REFUND_DAYS} days, unused credits are refunded. <a href="/terms">Terms</a> · <a href="/refunds">Refunds</a> · <a href="/privacy">Privacy</a>
      </p>
    </section>
  );
}

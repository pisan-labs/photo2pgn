// For HintWise admins only (the gateway's check says admin): add credits to a
// person by email, take some back, or look up their balance.
import { useState } from "react";
import { grantCredits, type GrantResult } from "../lib/grant";

export function AdminCredits({ onChanged }: { onChanged?: () => void }) {
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState("10");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GrantResult | null>(null);

  const send = async (amount: number) => {
    setBusy(true);
    setResult(null);
    const r = await grantCredits({ email, credits: amount, note });
    setResult(r);
    setBusy(false);
    if (r.ok && amount !== 0) onChanged?.();
  };
  const amount = Number(credits);

  return (
    <section className="panel admin-credits" aria-labelledby="admin-credits-title">
      <h2 id="admin-credits-title">Admin: add credits</h2>
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(amount);
        }}
      >
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="player@example.com" autoComplete="off" required />
        </label>
        <label>
          <span>Credits</span>
          <input type="number" step={1} min={-10000} max={10000} value={credits} onChange={(e) => setCredits(e.target.value)} />
        </label>
        <label className="wide">
          <span>Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. club trial" />
        </label>
        <div className="row">
          <button type="submit" className="primary" disabled={busy}>
            {amount < 0 ? "Take back credits" : "Add credits"}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void send(0)}>
            Check balance
          </button>
        </div>
      </form>
      {result &&
        (result.ok ? (
          <p className="ok-note" role="status">
            {result.email} now has {result.balance} credit{result.balance === 1 ? "" : "s"}.
          </p>
        ) : (
          <p className="error" role="alert">
            {result.message}
          </p>
        ))}
      <p className="hint">A negative number takes credits back; a balance never goes below zero. The person needs a HintWise account (they have signed in once).</p>
    </section>
  );
}

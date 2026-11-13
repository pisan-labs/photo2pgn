// For HintWise admins only (the gateway's check says admin): add credits to a
// person by email, take some back, look up a balance, and list everyone who
// has used photo2pgn with their free and paid credits.
import { useRef, useState } from "react";
import { grantCredits, listUsers, shortWhen, type AppUser, type GrantResult } from "../lib/grant";

export function AdminCredits({ onChanged }: { onChanged?: () => void }) {
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState("10");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GrantResult | null>(null);
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const creditsRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setListError(null);
    const r = await listUsers();
    if (r.ok) setUsers(r.users);
    else setListError(r.message);
  };
  const send = async (amount: number) => {
    setBusy(true);
    setResult(null);
    const r = await grantCredits({ email, credits: amount, note });
    setResult(r);
    setBusy(false);
    if (r.ok && amount !== 0) {
      onChanged?.();
      if (users) void load();
    }
  };
  const copyEmails = async () => {
    if (!users) return;
    try {
      await navigator.clipboard.writeText(users.map((u) => u.email).join(", "));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setListError("The browser did not allow copying; select the emails in the table instead.");
    }
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
          <input ref={creditsRef} type="number" step={1} min={-10000} max={10000} value={credits} onChange={(e) => setCredits(e.target.value)} />
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

      <h3 className="admin-users-title">People who have used Photo to PGN</h3>
      <div className="row">
        <button type="button" className="secondary" onClick={() => void load()}>
          {users ? "Refresh the list" : "List users"}
        </button>
        {users && users.length > 0 && (
          <button type="button" className="secondary" onClick={() => void copyEmails()}>
            {copied ? "Copied" : "Copy emails"}
          </button>
        )}
      </div>
      {listError && (
        <p className="error" role="alert">
          {listError}
        </p>
      )}
      {users && (
        <>
          <p className="hint">
            {users.length} {users.length === 1 ? "person" : "people"}, most recent first. Before 13 Nov only people who read or saved a game are known.
          </p>
          {users.length > 0 && (
            <div className="admin-users">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Name</th>
                    <th scope="col">First used</th>
                    <th scope="col">Last used</th>
                    <th scope="col">Free left</th>
                    <th scope="col">Credits</th>
                    <th scope="col">Readings</th>
                    <th scope="col">Games</th>
                    <th scope="col">
                      <span className="sr-only">Grant</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.email}>
                      <td className="email">{u.email}</td>
                      <td>{u.name || "–"}</td>
                      <td>{shortWhen(u.first_seen)}</td>
                      <td>{shortWhen(u.last_seen)}</td>
                      <td title={u.free_resets_at ? `More ${shortWhen(u.free_resets_at)}` : undefined}>
                        {u.free_left ?? "–"}
                        {u.free_left === 0 && u.free_resets_at ? ` (more ${shortWhen(u.free_resets_at)})` : ""}
                      </td>
                      <td>{u.credits}</td>
                      <td title="today / in all">
                        {u.readings_today} / {u.readings_total}
                      </td>
                      <td title="saved in My games">{u.counts?.games ?? 0}</td>
                      <td>
                        <button
                          type="button"
                          className="link"
                          aria-label={`Grant credits to ${u.email}`}
                          onClick={() => {
                            setEmail(u.email);
                            setResult(null);
                            creditsRef.current?.focus();
                            creditsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                          }}
                        >
                          Grant
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

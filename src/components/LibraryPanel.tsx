// "My games": open or delete a saved game.
import { useEffect, useState } from "react";
import type { Library, Listing, SavedGame } from "../lib/library";

export function LibraryPanel({
  library,
  signedIn,
  signInAvailable,
  refresh,
  onOpen,
}: {
  library: Library;
  signedIn: boolean;
  signInAvailable: boolean;
  refresh: number;
  onOpen: (g: SavedGame) => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void library.list().then((l) => live && setListing(l));
    return () => {
      live = false;
    };
  }, [library, refresh, tick]);

  if (!listing || listing.games.length === 0) return null;
  return (
    <section className="panel library" aria-labelledby="library-title">
      <h2 id="library-title">My games</h2>
      <p className="hint">
        {signedIn && !listing.accountError
          ? "Saved in your HintWise account and on this device. Photos are not kept."
          : signedIn
            ? "Saved on this device. Your account could not be reached, so games are not in your account yet."
            : signInAvailable
              ? "Saved on this device only. Sign in to keep them in your account and open them on another device."
              : "Saved on this device only."}
      </p>
      <ul className="games">
        {listing.games.map((g) => {
          const moves = Math.ceil(g.game.extraction.rows.length);
          const when = new Date(g.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
          return (
            <li key={g.id}>
              <button type="button" className="link game-open" onClick={() => onOpen(g)}>
                {g.title}
              </button>
              <span className="hint">
                {moves} moves · {when}
                {g.where === "account" ? " · from your account" : ""}
              </span>
              <button
                type="button"
                className="link"
                aria-label={`Delete ${g.title}`}
                onClick={async () => {
                  if (!window.confirm(`Delete "${g.title}"?`)) return;
                  await library.remove(g.id);
                  setTick((t) => t + 1);
                }}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

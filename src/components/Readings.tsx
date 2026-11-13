// Sheets sent to the HintWise reader: the page does not wait for them. It
// says to check back, collects each finished one into My games (on any
// device the person signs in on), and offers to open it.
import { useCallback, useEffect, useRef, useState } from "react";
import { forgetJob, type MyJob } from "../lib/api";
import { collectReadings, POLL_MS, sentAt, type Failed } from "../lib/collect";
import type { Library, SavedGame } from "../lib/library";
import type { GameHeaders } from "../lib/schema";

export interface ReadingsState {
  waiting: MyJob[];
  failed: Failed[];
  /** Collected while this page was open, until opened or dismissed. */
  ready: SavedGame[];
}

const EMPTY: ReadingsState = { waiting: [], failed: [], ready: [] };

interface Options {
  enabled: boolean;
  library: Library;
  getToken: () => Promise<string | null>;
  headersFor?: (id: string, headers: GameHeaders) => GameHeaders;
  onSaved?: (games: SavedGame[]) => void;
}

export function useReadings({ enabled, library, getToken, headersFor, onSaved }: Options) {
  const [state, setState] = useState<ReadingsState>(EMPTY);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  // The latest callbacks, without restarting the collection when they change.
  const cb = useRef({ getToken, headersFor, onSaved });
  useEffect(() => {
    cb.current = { getToken, headersFor, onSaved };
  });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      const token = await cb.current.getToken();
      if (!token || !live) return;
      try {
        const r = await collectReadings({
          token,
          save: (g) => library.save(g),
          has: (id) => library.has(id),
          headersFor: (id, h) => cb.current.headersFor?.(id, h) ?? h,
        });
        if (r.saved.length) cb.current.onSaved?.(r.saved);
        if (live) setState((s) => ({ waiting: r.waiting, failed: r.failed, ready: [...s.ready, ...r.saved] }));
      } catch {
        // Out of reach for now: keep what is shown, and try again on the next round.
        if (live) setState((s) => ({ ...s, waiting: [...s.waiting] }));
      }
    })();
    return () => {
      live = false;
    };
  }, [enabled, tick, library]);

  // Every POLL_MS while a sheet is with the reader, and on coming back to the tab.
  useEffect(() => {
    if (!enabled || state.waiting.length === 0) return;
    const t = setTimeout(refresh, POLL_MS);
    return () => clearTimeout(t);
  }, [enabled, state.waiting, refresh]);
  useEffect(() => {
    if (!enabled) return;
    const onShow = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [enabled, refresh]);

  const forget = useCallback(async (id: string) => {
    const token = await cb.current.getToken();
    if (token) await forgetJob(id, token).catch(() => undefined);
  }, []);

  return {
    state: enabled ? state : EMPTY,
    /** A sheet just sent from this page: shown at once, collected on the next rounds. */
    added: (job: MyJob) => setState((s) => ({ ...s, waiting: [...s.waiting, job] })),
    cancel: (id: string) => {
      setState((s) => ({ ...s, waiting: s.waiting.filter((j) => j.id !== id) }));
      void forget(id);
    },
    dismissFailed: (id: string) => {
      setState((s) => ({ ...s, failed: s.failed.filter((f) => f.id !== id) }));
      void forget(id);
    },
    dismissReady: (id: string) => setState((s) => ({ ...s, ready: s.ready.filter((g) => g.id !== id) })),
  };
}

export function ReadingsPanel({
  state,
  onOpen,
  onCancel,
  onDismissFailed,
  onDismissReady,
}: {
  state: ReadingsState;
  onOpen: (g: SavedGame) => void;
  onCancel: (id: string) => void;
  onDismissFailed: (id: string) => void;
  onDismissReady: (id: string) => void;
}) {
  const { waiting, failed, ready } = state;
  if (waiting.length + failed.length + ready.length === 0) return null;
  const one = waiting.length === 1;
  return (
    <section className="panel readings" aria-live="polite" aria-label="Your sheets">
      {waiting.length > 0 && (
        <div className="readings-wait">
          <div className="spinner small" aria-hidden="true" />
          <div>
            <p>
              <strong>{one ? "Your sheet is being read." : `${waiting.length} sheets are being read.`}</strong> Check back in 1–3
              minutes: {one ? "your game" : "the games"} will appear in My games. You can close this page meanwhile.
            </p>
            <ul className="readings-list">
              {waiting.map((j) => (
                <li key={j.id}>
                  Sent {sentAt(j.createdAt)}
                  {j.imageCount > 1 ? ` (${j.imageCount} pages)` : ""}.{" "}
                  <button type="button" className="link" onClick={() => onCancel(j.id)}>
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {ready.map((g) => (
        <p key={g.id} className="ok-note readings-ready">
          Your game is ready: <strong>{g.title}</strong>.{" "}
          <button type="button" className="primary small" onClick={() => onOpen(g)}>
            Open it
          </button>{" "}
          <button type="button" className="link" aria-label={`Dismiss: ${g.title} is ready`} onClick={() => onDismissReady(g.id)}>
            Dismiss
          </button>
        </p>
      ))}
      {failed.map((f) => (
        <p key={f.id} className="error" role="alert">
          The sheet sent {sentAt(f.createdAt)} could not be read. {f.message}{" "}
          <button type="button" className="link" onClick={() => onDismissFailed(f.id)}>
            Dismiss
          </button>
        </p>
      ))}
    </section>
  );
}

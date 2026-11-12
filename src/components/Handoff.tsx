// The Chess TD hand-off in the page: the link is picked up once (and kept for
// a day, so it survives signing in), a banner says whom the reading is for,
// and "Send to Chess TD" returns the checked game. Protocol: src/lib/handoff.ts.
import { useEffect, useState } from "react";
import { load, remove, save } from "../lib/storage";
import {
  HANDOFF_STORAGE,
  handoffFromUrl,
  isFresh,
  isReceived,
  returnHref,
  withoutHandoffParams,
  type Handoff,
  type ResultMessage,
} from "../lib/handoff";

const REPLY_WAIT_MS = 3000;

function initialHandoff(): Handoff | null {
  const fromLink = handoffFromUrl(window.location.href);
  if (fromLink) return fromLink;
  const kept = load<Handoff>(HANDOFF_STORAGE);
  if (isFresh(kept)) return kept;
  remove(HANDOFF_STORAGE);
  return null;
}

/** The hand-off in progress, if this tab was opened from Chess TD. */
export function useHandoff() {
  const [handoff, setHandoff] = useState<Handoff | null>(initialHandoff);
  useEffect(() => {
    if (!handoff) return;
    save(HANDOFF_STORAGE, handoff);
    const clean = withoutHandoffParams(window.location.href);
    if (clean !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(null, "", clean);
    }
  }, [handoff]);
  const end = () => {
    remove(HANDOFF_STORAGE);
    setHandoff(null);
  };
  return { handoff, end };
}

function opener(h: Handoff): Window | null {
  const o = window.opener as Window | null;
  return o && !o.closed && h.returnOrigin ? o : null;
}

export function describeFor(h: Handoff): string {
  const { white, black, round, board } = h.hints;
  const players = white || black ? `${white ?? "?"} – ${black ?? "?"}` : "";
  const where = [round && `round ${round}`, board && `board ${board}`].filter(Boolean).join(", ");
  return [players, where].filter(Boolean).join(", ");
}

export function HandoffBanner({ handoff, onCancel }: { handoff: Handoff; onCancel: () => void }) {
  const cancel = () => {
    const o = opener(handoff);
    try {
      o?.postMessage({ type: "photo2pgn/cancel", v: 1, ref: handoff.ref }, handoff.returnOrigin!);
    } catch {
      // Chess TD's tab went away: nothing to tell it
    }
    onCancel();
  };
  const what = describeFor(handoff);
  return (
    <section className="panel handoff" aria-label="Reading for Chess TD">
      <p>
        <strong>For Chess TD</strong>
        {what && `: ${what}`}. Read the scoresheet, check the moves, then send the game back.
      </p>
      <button type="button" className="link" onClick={cancel}>
        Cancel
      </button>
    </section>
  );
}

type SendState = "idle" | "sending" | "no-return" | "too-long";

/** "Send to Chess TD": to the tab that opened this one, else back to Chess TD's page. */
export function SendToChessTd({
  handoff,
  message,
  incomplete,
  beforeLeave,
  onSent,
}: {
  handoff: Handoff;
  message: ResultMessage;
  /** The PGN stops early, at a move still to fix. */
  incomplete: boolean;
  beforeLeave: () => void;
  onSent: () => void;
}) {
  const [state, setState] = useState<SendState>("idle");
  const send = async () => {
    setState("sending");
    const o = opener(handoff);
    if (o) {
      const got = await new Promise<boolean>((resolve) => {
        const done = (ok: boolean) => {
          window.removeEventListener("message", onMessage);
          clearTimeout(timer);
          resolve(ok);
        };
        const onMessage = (ev: MessageEvent) => {
          if (isReceived(ev, handoff)) done(true);
        };
        const timer = setTimeout(() => done(false), REPLY_WAIT_MS);
        window.addEventListener("message", onMessage);
        try {
          o.postMessage(message, handoff.returnOrigin!);
        } catch {
          done(false);
        }
      });
      if (got) {
        onSent();
        return;
      }
    }
    const href = returnHref(handoff, message);
    if (!href) {
      setState(handoff.returnUrl ? "too-long" : "no-return");
      return;
    }
    beforeLeave();
    onSent();
    window.location.assign(href);
  };
  return (
    <div className="send-back">
      <button type="button" className="primary" onClick={send} disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Send to Chess TD"}
      </button>
      {incomplete && state === "idle" && <p className="hint">The PGN stops at the move in red; fix it first to send the whole game.</p>}
      {state === "no-return" && (
        <p className="warn" role="alert">
          This tab was not opened from Chess TD&apos;s site, so the game cannot go back by itself. Copy the PGN below into Chess TD.
        </p>
      )}
      {state === "too-long" && (
        <p className="warn" role="alert">
          The game is too long to send back this way. Copy the PGN below into Chess TD.
        </p>
      )}
    </div>
  );
}

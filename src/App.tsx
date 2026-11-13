import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UploadPanel } from "./components/UploadPanel";
import { OUT_OF_CREDITS_STORAGE, outOfCreditsFrom, stillOut, type AccessOption, type OutOfCredits } from "./lib/access";
import { ReviewPanel, type ReviewSession } from "./components/ReviewPanel";
import { SignInPanel, useUser } from "./components/SignIn";
import { fitPhotos, type PreparedImage } from "./lib/image";
import { getByokKey, setByokKey } from "./lib/llm";
import { currentToken } from "./lib/auth";
import { ApiError, type QueuedJob } from "./lib/api";
import { describeError, followQueued, freeReaderFrom, readPhotos, type Phase } from "./lib/reading";
import { load, remove, save } from "./lib/storage";
import { Library, LocalRepository, type SavedGame } from "./lib/library";
import { newId, SupabaseRepository } from "./lib/repository";
import { getSupabase } from "./lib/supabase";
import { LibraryPanel } from "./components/LibraryPanel";
import { takeSharedPhotos } from "./lib/shared";
import { useInstall } from "./lib/install";
import { DEMO_EXTRACTION, DEMO_IMAGE_URL } from "./demo/sample";
import type { Extraction, GameHeaders } from "./lib/schema";
import { HandoffBanner, useHandoff } from "./components/Handoff";
import { applyHints } from "./lib/handoff";

const LIBRARY_STORAGE = "photo2pgn.games";
const PENDING_STORAGE = "photo2pgn.pending";
const MAX_PAGES = 2;
const FREE_READER = freeReaderFrom();

interface PendingJob extends QueuedJob {
  startedAt: number;
}

type View = { kind: "upload" } | { kind: "reading"; startedAt: number; phase: Phase } | { kind: "review" };

function savedKey(): string {
  try {
    return getByokKey() ?? "";
  } catch {
    return "";
  }
}

function pendingJob(): PendingJob | null {
  const pending = load<PendingJob>(PENDING_STORAGE);
  if (pending && Date.now() - pending.startedAt < 32 * 60 * 1000) return pending;
  remove(PENDING_STORAGE);
  return null;
}

export default function App() {
  const [signInOpen, setSignInOpen] = useState(false);
  const { user, available: signInAvailable } = useUser(() => setSignInOpen(false));
  const [resume] = useState(pendingJob);
  const [view, setView] = useState<View>(() =>
    resume ? { kind: "reading", startedAt: resume.startedAt, phase: "queued" } : { kind: "upload" },
  );
  const [pages, setPages] = useState<PreparedImage[]>([]);
  const [choice, setChoice] = useState<AccessOption>(() => (signInAvailable && !savedKey() ? "sign-in" : "own-key"));
  // Out of credits: remembered per person until the reset, when it lapses by itself.
  const [outMark, setOutMark] = useState<OutOfCredits | null>(() => load<OutOfCredits>(OUT_OF_CREDITS_STORAGE));
  const [, setClock] = useState(0);
  const out = stillOut(outMark, user?.id ?? null);
  useEffect(() => {
    if (!out) return;
    const t = setTimeout(() => setClock((c) => c + 1), Math.max(1000, Date.parse(out.until) - Date.now() + 1000));
    return () => clearTimeout(t);
  }, [out]);
  const [apiKey, setApiKey] = useState(savedKey);
  const [rememberKey, setRememberKey] = useState(() => Boolean(savedKey()));
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const library = useMemo(
    () =>
      new Library(
        new LocalRepository<SavedGame>(LIBRARY_STORAGE),
        user && signInAvailable ? new SupabaseRepository<SavedGame>(getSupabase(), "games", "updated_at") : null,
      ),
    [user, signInAvailable],
  );
  const saveGame = useCallback(
    (g: SavedGame) => {
      void library.save(g).then(() => setSavedTick((t) => t + 1));
    },
    [library],
  );
  const abort = useRef<AbortController | null>(null);
  const [incoming, setIncoming] = useState<File[] | undefined>(undefined);
  const { canInstall, install, iosTip } = useInstall();
  // Opened from Chess TD to read one game and send it back.
  const { handoff, end: endHandoff } = useHandoff();
  const [sentToChessTd, setSentToChessTd] = useState(false);
  const hinted = (h: GameHeaders) => (handoff ? applyHints(h, handoff.hints) : h);

  // Photos shared from the phone's gallery (Android share sheet).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("shared")) return;
    window.history.replaceState(null, "", url.pathname);
    void takeSharedPhotos()
      .then((files) => files.length && setIncoming(files))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      setByokKey(rememberKey && apiKey.trim() ? apiKey.trim() : null);
    } catch {
      // storage unavailable: the key lives only in this page
    }
  }, [rememberKey, apiKey]);

  function finished(extraction: Extraction, images: string[]) {
    remove(PENDING_STORAGE);
    setSession({ id: newId(), extraction, edits: {}, headers: hinted(extraction.headers), images, demo: false });
    setView({ kind: "review" });
  }

  function failed(err: unknown) {
    setView({ kind: "upload" });
    if (err instanceof ApiError && err.code === "cancelled") return;
    remove(PENDING_STORAGE);
    const mark = user ? outOfCreditsFrom(err, user.id) : null;
    if (mark) {
      // The notice above the choices says until when; only the own key is offered meanwhile.
      save(OUT_OF_CREDITS_STORAGE, mark);
      setOutMark(mark);
      setChoice("own-key");
      return;
    }
    const { message, ownKey } = describeError(err);
    if (ownKey) setChoice("own-key");
    setError(message);
  }

  // A reload or a locked phone while queued for the HintWise reader: pick the job up again.
  const following = useRef(false);
  useEffect(() => {
    if (!resume || following.current) return;
    following.current = true;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const onPhase = (phase: Phase) => setView({ kind: "reading", startedAt: resume.startedAt, phase });
    followQueued(resume, { mode: "free", reader: "local", signal: ctrl.signal, onPhase })
      .then((ex) => {
        remove(PENDING_STORAGE);
        setSession({ id: newId(), extraction: ex, edits: {}, headers: handoff ? applyHints(ex.headers, handoff.hints) : ex.headers, images: [], demo: false });
        setView({ kind: "review" });
      })
      .catch((err) => {
        setView({ kind: "upload" });
        remove(PENDING_STORAGE);
        if (!(err instanceof ApiError && err.code === "cancelled")) setError(describeError(err).message);
      });
  }, [resume, handoff]);

  async function convert() {
    setError(null);
    const startedAt = Date.now();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setView({ kind: "reading", startedAt, phase: "reading" });
    try {
      const photos = await fitPhotos(pages);
      const extraction = await readPhotos(
        photos.map((p) => ({ mediaType: p.mediaType, data: p.data })),
        {
          mode: choice === "sign-in" ? "free" : "own-key",
          apiKey: apiKey.trim(),
          reader: FREE_READER,
          signal: ctrl.signal,
          getToken: signInAvailable ? () => currentToken() : async () => null,
          onPhase: (phase) => setView({ kind: "reading", startedAt, phase }),
          onQueued: (job) => save(PENDING_STORAGE, { ...job, startedAt }),
        },
      );
      finished(extraction, photos.map((p) => p.previewUrl));
    } catch (err) {
      failed(err);
    }
  }

  function demo() {
    setSession({ id: "demo", extraction: DEMO_EXTRACTION, edits: {}, headers: DEMO_EXTRACTION.headers, images: [DEMO_IMAGE_URL], demo: true });
    setView({ kind: "review" });
  }

  function startOver() {
    setSession(null);
    setPages([]);
    setError(null);
    setView({ kind: "upload" });
  }

  return (
    <div className={`app${view.kind === "review" ? "" : " narrow"}`}>
      <header className="top">
        <a className="brand" href="/" aria-label="Photo to PGN home">
          <span className="mark" aria-hidden="true">
            ♞
          </span>
          <span>
            <strong>Photo to PGN</strong>
            <small>Scoresheet photos to PGN files</small>
          </span>
        </a>
        <span className="row">
          {canInstall && (
            <button type="button" className="secondary small" onClick={install}>
              Install app
            </button>
          )}
          {signInAvailable && (
            <button type="button" className="secondary small" onClick={() => setSignInOpen((o) => !o)} aria-expanded={signInOpen}>
              {user ? (user.email ?? "Account") : "Sign in"}
            </button>
          )}
        </span>
      </header>
      <SignInPanel open={signInOpen} signedIn={Boolean(user)} onClose={() => setSignInOpen(false)} />

      <main>
        {handoff && <HandoffBanner handoff={handoff} onCancel={endHandoff} />}
        {sentToChessTd && (
          <section className="panel handoff" role="status">
            <p>
              <strong>Sent to Chess TD.</strong> You can close this tab.
            </p>
          </section>
        )}
        {view.kind === "upload" && (
          <>
            <p className="lede">
              Take a photo of a handwritten tournament scoresheet. Claude reads the moves, a chess engine checks each one
              is legal, you fix anything doubtful, and you download a PGN file.
            </p>
            {iosTip && (
              <p className="install-tip">
                Tip: tap Share, then <strong>Add to Home Screen</strong>, to open Photo to PGN like a native mobile app.
              </p>
            )}
            <UploadPanel
              pages={pages}
              setPages={setPages}
              maxPages={MAX_PAGES}
              signInAvailable={signInAvailable}
              signedIn={Boolean(user)}
              userEmail={user?.email ?? null}
              onOpenSignIn={() => setSignInOpen(true)}
              out={out}
              choice={choice}
              setChoice={setChoice}
              apiKey={apiKey}
              setApiKey={setApiKey}
              rememberKey={rememberKey}
              setRememberKey={setRememberKey}
              error={error}
              onConvert={convert}
              onDemo={demo}
              incoming={incoming}
            />
            <LibraryPanel
              library={library}
              signedIn={Boolean(user)}
              signInAvailable={signInAvailable}
              refresh={savedTick}
              onOpen={(g) => {
                setSession({ id: g.id, extraction: g.game.extraction, edits: g.game.edits, headers: g.game.headers, notes: g.game.notes, images: [], demo: false });
                setView({ kind: "review" });
              }}
            />
          </>
        )}

        {view.kind === "reading" && (
          <Reading
            startedAt={view.startedAt}
            phase={view.phase}
            pages={pages}
            onCancel={() => {
              remove(PENDING_STORAGE);
              abort.current?.abort();
              setView({ kind: "upload" });
            }}
          />
        )}

        {view.kind === "review" && session && (
          <ReviewPanel
            session={session}
            onChange={setSession}
            onStartOver={startOver}
            onSave={saveGame}
            handoff={session.demo ? null : handoff}
            onHandoffSent={() => {
              endHandoff();
              setSentToChessTd(true);
            }}
          />
        )}
      </main>

      <footer className="foot">
        <p>HintWise uses your photos only to read the game and does not keep them afterwards. Your games stay on this device, and in your account when you sign in.</p>
        <p className="credits">
          Chess pieces by Cburnett, <a href="/piece-images-license.txt">BSD licence</a>.
        </p>
      </footer>
    </div>
  );
}

function Reading({
  startedAt,
  phase,
  pages,
  onCancel,
}: {
  startedAt: number;
  phase: Phase;
  pages: PreparedImage[];
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((now - startedAt) / 1000);
  const title = phase === "queued" ? "Waiting for the HintWise reader…" : "Reading the handwriting…";
  const text =
    phase === "queued"
      ? "Your photos are in line to be read. You can leave this page open, or come back to it later on this device."
      : "A full sheet usually takes under a minute; Claude follows the game as it reads to sort out unclear moves. Keep this page open.";
  return (
    <section className="panel reading" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <h2>{title}</h2>
      <p>
        {secs}s. {text}
      </p>
      <div className="pages small">
        {pages.map((p, i) => (
          <img key={p.previewUrl} src={p.previewUrl} alt={`Page ${i + 1}`} />
        ))}
      </div>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { UploadPanel, type Mode } from "./components/UploadPanel";
import { ReviewPanel, type ReviewSession } from "./components/ReviewPanel";
import { SignInPanel, useUser } from "./components/SignIn";
import { fitPhotos, type PreparedImage } from "./lib/image";
import { getByokKey, setByokKey } from "./lib/llm";
import { currentToken } from "./lib/auth";
import { ApiError, type QueuedJob } from "./lib/api";
import { describeError, followQueued, freeReaderFrom, readPhotos, type Phase } from "./lib/reading";
import { load, remove, save } from "./lib/storage";
import { takeSharedPhotos } from "./lib/shared";
import { useInstall } from "./lib/install";
import { DEMO_EXTRACTION, DEMO_IMAGE_URL } from "./demo/sample";
import type { Extraction } from "./lib/schema";

const SESSION_STORAGE = "photo2pgn.session";
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
  const [mode, setMode] = useState<Mode>(() => (signInAvailable && !savedKey() ? "free" : "own-key"));
  const [apiKey, setApiKey] = useState(savedKey);
  const [rememberKey, setRememberKey] = useState(() => Boolean(savedKey()));
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [saved] = useState(() => load<ReviewSession>(SESSION_STORAGE));
  const abort = useRef<AbortController | null>(null);
  const [incoming, setIncoming] = useState<File[] | undefined>(undefined);
  const { canInstall, install, iosTip } = useInstall();

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

  useEffect(() => {
    if (session) save(SESSION_STORAGE, { ...session, images: session.demo ? session.images : [] });
  }, [session]);

  function finished(extraction: Extraction, images: string[]) {
    remove(PENDING_STORAGE);
    setSession({ extraction, edits: {}, headers: extraction.headers, images, demo: false });
    setView({ kind: "review" });
  }

  function failed(err: unknown) {
    setView({ kind: "upload" });
    if (err instanceof ApiError && err.code === "cancelled") return;
    remove(PENDING_STORAGE);
    const { message, ownKey } = describeError(err);
    if (ownKey) setMode("own-key");
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
        setSession({ extraction: ex, edits: {}, headers: ex.headers, images: [], demo: false });
        setView({ kind: "review" });
      })
      .catch((err) => {
        setView({ kind: "upload" });
        remove(PENDING_STORAGE);
        if (!(err instanceof ApiError && err.code === "cancelled")) setError(describeError(err).message);
      });
  }, [resume]);

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
          mode,
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
    setSession({ extraction: DEMO_EXTRACTION, edits: {}, headers: DEMO_EXTRACTION.headers, images: [DEMO_IMAGE_URL], demo: true });
    setView({ kind: "review" });
  }

  function startOver() {
    setSession(null);
    remove(SESSION_STORAGE);
    setPages([]);
    setError(null);
    setView({ kind: "upload" });
  }

  return (
    <div className="app">
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
      <SignInPanel open={signInOpen} onClose={() => setSignInOpen(false)} />

      <main>
        {view.kind === "upload" && (
          <>
            <p className="lede">
              Take a photo of a handwritten tournament scoresheet. Claude reads the moves, a chess engine checks each one
              is legal, you fix anything doubtful, and you download a PGN file.
            </p>
            {iosTip && (
              <p className="install-tip">
                Tip: tap Share, then <strong>Add to Home Screen</strong>, to open Photo to PGN like an app.
              </p>
            )}
            {saved && !session && (
              <p className="resume">
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setSession(saved);
                    setView({ kind: "review" });
                  }}
                >
                  Resume your last game ({saved.headers.white || "White"} vs {saved.headers.black || "Black"})
                </button>
              </p>
            )}
            <UploadPanel
              pages={pages}
              setPages={setPages}
              maxPages={MAX_PAGES}
              signInAvailable={signInAvailable}
              signedIn={Boolean(user)}
              onOpenSignIn={() => setSignInOpen(true)}
              freeReader={FREE_READER}
              mode={mode}
              setMode={setMode}
              apiKey={apiKey}
              setApiKey={setApiKey}
              rememberKey={rememberKey}
              setRememberKey={setRememberKey}
              error={error}
              onConvert={convert}
              onDemo={demo}
              incoming={incoming}
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

        {view.kind === "review" && session && <ReviewPanel session={session} onChange={setSession} onStartOver={startOver} />}
      </main>

      <footer className="foot">
        <p>
          Your photos go from this browser to Claude to be read, and are not kept. With the HintWise reader they wait on
          our server until they are read, then are deleted. Your games stay in this browser.
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

import { useEffect, useRef, useState } from "react";
import { UploadPanel } from "./components/UploadPanel";
import { ReviewPanel, type ReviewSession } from "./components/ReviewPanel";
import { ApiError, fetchQuota, startConversion, waitForJob, type Mode, type QuotaInfo } from "./lib/api";
import type { PreparedImage } from "./lib/image";
import { load, remove, save } from "./lib/storage";
import { DEMO_EXTRACTION, DEMO_IMAGE_URL } from "./demo/sample";

const KEY_STORAGE = "photo2pgn.apiKey";
const SESSION_STORAGE = "photo2pgn.session";
const PENDING_STORAGE = "photo2pgn.pending";

interface PendingJob {
  jobId: string;
  viewToken: string;
  startedAt: number;
}
const MAX_PAGES = 2;

type Phase =
  | { kind: "upload" }
  | { kind: "reading"; startedAt: number; waiting?: boolean }
  | { kind: "review" };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "upload" });
  const [pages, setPages] = useState<PreparedImage[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [mode, setMode] = useState<Mode>("free");
  const [apiKey, setApiKey] = useState(() => load<string>(KEY_STORAGE) ?? "");
  const [rememberKey, setRememberKey] = useState(() => Boolean(load<string>(KEY_STORAGE)));
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [saved] = useState(() => load<ReviewSession>(SESSION_STORAGE));
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void fetchQuota().then((q) => {
      setQuota(q ?? { freeAvailable: false, signedIn: false, quota: null });
      if (!q?.freeAvailable || (q.quota && q.quota.remaining === 0) || load<string>(KEY_STORAGE)) setMode("own-key");
    });
  }, []);

  useEffect(() => {
    if (rememberKey && apiKey.trim()) save(KEY_STORAGE, apiKey.trim());
    else remove(KEY_STORAGE);
  }, [rememberKey, apiKey]);

  useEffect(() => {
    if (session) save(SESSION_STORAGE, { ...session, images: session.demo ? session.images : [] });
  }, [session]);

  // A reload or a locked phone during the wait: pick the job up again.
  useEffect(() => {
    const pending = load<PendingJob>(PENDING_STORAGE);
    if (pending && Date.now() - pending.startedAt < 47 * 60 * 1000) void follow(pending, []);
    else remove(PENDING_STORAGE);
  }, []);

  async function convert() {
    setError(null);
    const startedAt = Date.now();
    setPhase({ kind: "reading", startedAt });
    let job;
    try {
      job = await startConversion(
        pages.map((p) => ({ mediaType: p.mediaType, data: p.data })),
        mode,
        apiKey.trim(),
      );
    } catch (err) {
      return failed(err);
    }
    if (job.quota && quota) setQuota({ ...quota, quota: job.quota });
    const pending = { jobId: job.jobId, viewToken: job.viewToken, startedAt };
    save(PENDING_STORAGE, pending);
    await follow(pending, pages.map((p) => p.previewUrl));
  }

  async function follow(pending: PendingJob, images: string[]) {
    setPhase({ kind: "reading", startedAt: pending.startedAt });
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const extraction = await waitForJob(pending.jobId, pending.viewToken, {
        signal: ctrl.signal,
        onStatus: (s) =>
          setPhase({ kind: "reading", startedAt: pending.startedAt, waiting: s.reader === "local" && s.status === "queued" }),
      });
      remove(PENDING_STORAGE);
      setSession({ extraction, edits: {}, headers: extraction.headers, images, demo: false });
      setPhase({ kind: "review" });
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "cancelled")) remove(PENDING_STORAGE);
      failed(err);
    }
  }

  function failed(err: unknown) {
    setPhase({ kind: "upload" });
    if (err instanceof ApiError && err.code === "cancelled") return;
    if (err instanceof ApiError && err.quota && quota) setQuota({ ...quota, quota: err.quota });
    if (err instanceof ApiError && err.code.startsWith("limit_")) setMode("own-key");
    setError(err instanceof Error ? err.message : String(err));
    void fetchQuota().then((q) => q && setQuota(q));
  }

  function demo() {
    setSession({
      extraction: DEMO_EXTRACTION,
      edits: {},
      headers: DEMO_EXTRACTION.headers,
      images: [DEMO_IMAGE_URL],
      demo: true,
    });
    setPhase({ kind: "review" });
  }

  function startOver() {
    setSession(null);
    remove(SESSION_STORAGE);
    setPages([]);
    setError(null);
    setPhase({ kind: "upload" });
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
        <span className="byline">HintWise</span>
      </header>

      <main>
        {phase.kind === "upload" && (
          <>
            <p className="lede">
              Take a photo of a handwritten tournament scoresheet. Claude reads the moves, a chess engine checks each one
              is legal, you fix anything doubtful, and you download a PGN file.
            </p>
            {saved && !session && (
              <p className="resume">
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setSession(saved);
                    setPhase({ kind: "review" });
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
              quota={quota}
              mode={mode}
              setMode={setMode}
              apiKey={apiKey}
              setApiKey={setApiKey}
              rememberKey={rememberKey}
              setRememberKey={setRememberKey}
              error={error}
              busy={false}
              onConvert={convert}
              onDemo={demo}
            />
          </>
        )}

        {phase.kind === "reading" && (
          <Reading
            startedAt={phase.startedAt}
            waiting={Boolean(phase.waiting)}
            pages={pages}
            onCancel={() => {
              remove(PENDING_STORAGE);
              abort.current?.abort();
            }}
          />
        )}

        {phase.kind === "review" && session && (
          <ReviewPanel session={session} onChange={setSession} onStartOver={startOver} />
        )}
      </main>

      <footer className="foot">
        <p>
          Photos are deleted from the server once they are read. Results stay in your browser. A HintWise app.
        </p>
      </footer>
    </div>
  );
}

function Reading({
  startedAt,
  waiting,
  pages,
  onCancel,
}: {
  startedAt: number;
  waiting: boolean;
  pages: PreparedImage[];
  onCancel: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((now - startedAt) / 1000);
  return (
    <section className="panel reading" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <h2>{waiting ? "Waiting for a reader…" : "Reading the handwriting…"}</h2>
      <p>
        {secs}s.{" "}
        {waiting
          ? "Your photo is in line to be read. You can leave this page open, or come back to it later on this device."
          : "A full sheet usually takes one to three minutes; Claude follows the game as it reads to sort out unclear moves."}
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

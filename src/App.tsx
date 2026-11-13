import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UploadPanel } from "./components/UploadPanel";
import { OUT_OF_CREDITS_STORAGE, displayName, outOfCreditsFrom, stillOut, type AccessOption, type OutOfCredits } from "./lib/access";
import { checkAllowance, creditsOf, outMarkOf, type Allowance } from "./lib/allowance";
import { ReviewPanel, type ReviewSession } from "./components/ReviewPanel";
import { SignInPanel, useUser } from "./components/SignIn";
import { fitPhotos, type PreparedImage } from "./lib/image";
import { getByokKey, setByokKey } from "./lib/llm";
import { currentToken, signOut } from "./lib/auth";
import { ApiError, forgetJob } from "./lib/api";
import { describeError, freeReaderFrom, readPhotos, type Phase } from "./lib/reading";
import { load, save } from "./lib/storage";
import { Library, LocalRepository, type SavedGame } from "./lib/library";
import { newId, SupabaseRepository } from "./lib/repository";
import { getSupabase } from "./lib/supabase";
import { LibraryPanel } from "./components/LibraryPanel";
import { AdminCredits } from "./components/AdminCredits";
import { ReadingsPanel, useReadings } from "./components/Readings";
import { BuyCredits } from "./components/BuyCredits";
import { checkoutConfigFrom } from "./lib/checkout";
import { takeSharedPhotos } from "./lib/shared";
import { useInstall } from "./lib/install";
import { DEMO_EXTRACTION, DEMO_IMAGE_URL } from "./demo/sample";
import type { Extraction, GameHeaders } from "./lib/schema";
import { HandoffBanner, useHandoff } from "./components/Handoff";
import { applyHints } from "./lib/handoff";

const LIBRARY_STORAGE = "photo2pgn.games";
const MAX_PAGES = 2;
const FREE_READER = freeReaderFrom();
// Credits are for sale once the build has Paddle settings; until then admins see a preview.
const CHECKOUT = checkoutConfigFrom();

type View = { kind: "upload" } | { kind: "reading"; startedAt: number; phase: Phase } | { kind: "review" };

function savedKey(): string {
  try {
    return getByokKey() ?? "";
  } catch {
    return "";
  }
}

export default function App() {
  const [signInOpen, setSignInOpen] = useState(false);
  const { user, available: signInAvailable } = useUser(() => setSignInOpen(false));
  const [view, setView] = useState<View>({ kind: "upload" });
  // photo2pgn.hintwise.org/pricing opens the packs.
  const [buying, setBuying] = useState(() => window.location.pathname === "/pricing");
  const [pages, setPages] = useState<PreparedImage[]>([]);
  const [choice, setChoice] = useState<AccessOption>(() => (signInAvailable && !savedKey() ? "sign-in" : "own-key"));
  // Out of credits: remembered per person until the reset, when it lapses by itself.
  const [outMark, setOutMark] = useState<OutOfCredits | null>(() => load<OutOfCredits>(OUT_OF_CREDITS_STORAGE));
  const [, setClock] = useState(0);
  // The gateway's own count of the person's readings left (check mode), asked
  // on sign-in and on each return to the start page; it beats the remembered mark.
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [checks, setChecks] = useState(0);
  const onStart = view.kind === "upload";
  useEffect(() => {
    if (!user || !signInAvailable || !onStart) return;
    let live = true;
    void checkAllowance().then((a) => {
      if (live) setAllowance(a);
    });
    return () => {
      live = false;
    };
  }, [user, signInAvailable, onStart, checks]);
  const checked = user && allowance ? allowance : null;
  const credits = checked ? creditsOf(checked) : null;
  const canBuy = Boolean(CHECKOUT) || Boolean(credits?.admin);
  const out = checked && user ? outMarkOf(checked, user.id) : stillOut(outMark, user?.id ?? null);
  useEffect(() => {
    if (!out) return;
    const t = setTimeout(
      () => {
        setClock((c) => c + 1);
        setChecks((c) => c + 1);
      },
      Math.max(1000, Date.parse(out.until) - Date.now() + 1000),
    );
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

  // Sheets sent to the HintWise reader: collected into My games when read.
  // A sheet sent from this page keeps its photos for the review, and the one
  // Chess TD asked for opens by itself.
  const photosOf = useRef(new Map<string, string[]>());
  const handoffJob = useRef<string | null>(null);
  const openGame = (g: SavedGame) => {
    setSession({ id: g.id, extraction: g.game.extraction, edits: g.game.edits, headers: g.game.headers, notes: g.game.notes, images: photosOf.current.get(g.id) ?? [], demo: false });
    setView({ kind: "review" });
  };
  const readings = useReadings({
    enabled: Boolean(user) && signInAvailable && FREE_READER !== "gateway",
    library,
    getToken: () => currentToken(),
    headersFor: (id, h) => (id === handoffJob.current ? hinted(h) : h),
    onSaved: (games) => {
      setSavedTick((t) => t + 1);
      setChecks((c) => c + 1); // its credit was taken: ask the gateway again
      const asked = games.find((g) => g.id === handoffJob.current);
      if (asked && view.kind === "upload") {
        handoffJob.current = null;
        readings.dismissReady(asked.id);
        openGame(asked);
      }
    },
  });

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
    setSession({ id: newId(), extraction, edits: {}, headers: hinted(extraction.headers), images, demo: false });
    setView({ kind: "review" });
  }

  function failed(err: unknown) {
    setView({ kind: "upload" });
    if (err instanceof ApiError && err.code === "cancelled") return;
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

  async function convert() {
    setError(null);
    const startedAt = Date.now();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const queued = choice === "sign-in" && FREE_READER !== "gateway";
    setView({ kind: "reading", startedAt, phase: queued ? "sending" : "reading" });
    try {
      const photos = await fitPhotos(pages);
      const outcome = await readPhotos(
        photos.map((p) => ({ mediaType: p.mediaType, data: p.data })),
        {
          mode: choice === "sign-in" ? "free" : "own-key",
          apiKey: apiKey.trim(),
          reader: FREE_READER,
          getToken: signInAvailable ? () => currentToken() : async () => null,
          onPhase: (phase) => {
            if (!ctrl.signal.aborted) setView({ kind: "reading", startedAt, phase });
          },
        },
      );
      const previews = photos.map((p) => p.previewUrl);
      if (outcome.kind === "read") {
        if (!ctrl.signal.aborted) finished(outcome.extraction, previews);
        return;
      }
      const { job } = outcome;
      if (ctrl.signal.aborted) {
        // Cancelled while the photos were on their way: take them back.
        const token = await currentToken();
        if (token) await forgetJob(job.jobId, token).catch(() => undefined);
        return;
      }
      // Sent: the page does not wait. The game arrives in My games.
      photosOf.current.set(job.jobId, previews);
      if (handoff) handoffJob.current = job.jobId;
      const at = job.createdAt ?? new Date().toISOString();
      readings.added({ id: job.jobId, status: "queued", createdAt: at, updatedAt: at, imageCount: photos.length });
      setPages([]);
      setView({ kind: "upload" });
    } catch (err) {
      if (!ctrl.signal.aborted) failed(err);
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
        {/* Signed out, the first step offers the sign-in; signed in: who, and Sign out.
            The name opens the account panel (Delete my account). */}
        {user && (
          <span className="row account">
            <button
              type="button"
              className="link account-name"
              onClick={() => setSignInOpen((o) => !o)}
              aria-expanded={signInOpen}
              title="Your account"
            >
              {displayName(user)}
            </button>
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                setSignInOpen(false);
                void signOut();
              }}
            >
              Sign out
            </button>
          </span>
        )}
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
            {buying && canBuy && (
              <BuyCredits
                config={CHECKOUT}
                buyer={user ? { userId: user.id, email: user.email ?? null } : null}
                onSignIn={() => setSignInOpen(true)}
                onClose={() => {
                  setBuying(false);
                  if (window.location.pathname === "/pricing") window.history.replaceState(null, "", "/");
                }}
                onPaid={() => {
                  // The owner adds the credits by hand for now (13 Nov); the count is asked
                  // again on each return to the start page, and once in a while meanwhile.
                  for (const ms of [60_000, 300_000]) setTimeout(() => setChecks((c) => c + 1), ms);
                }}
              />
            )}
            <ReadingsPanel
              state={readings.state}
              onOpen={(g) => {
                readings.dismissReady(g.id);
                openGame(g);
              }}
              onCancel={readings.cancel}
              onDismissFailed={readings.dismissFailed}
              onDismissReady={readings.dismissReady}
            />
            <p className="lede">
              Take a photo of a handwritten tournament scoresheet. Claude reads the moves, a chess engine checks each one
              is legal, you fix anything doubtful, and you download a PGN file.
            </p>
            {canInstall && (
              <p className="install-tip">
                Tip:{" "}
                <button type="button" className="link" onClick={install}>
                  install Photo to PGN
                </button>{" "}
                to open it like a native mobile app.
              </p>
            )}
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
              credits={credits}
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
              onBuy={canBuy ? () => setBuying(true) : undefined}
            />
            <LibraryPanel
              library={library}
              signedIn={Boolean(user)}
              signInAvailable={signInAvailable}
              refresh={savedTick}
              onOpen={openGame}
            />
            {credits?.admin && <AdminCredits onChanged={() => setChecks((c) => c + 1)} />}
          </>
        )}

        {view.kind === "reading" && (
          <Reading
            startedAt={view.startedAt}
            phase={view.phase}
            pages={pages}
            onCancel={() => {
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
  const title = phase === "sending" ? "Sending your photos…" : "Reading the handwriting…";
  const text =
    phase === "sending"
      ? "They go to the HintWise reader. You will not have to wait here for it."
      : "A full sheet usually takes under a minute; HintWise follows the game as it reads to sort out unclear moves. Keep this page open.";
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

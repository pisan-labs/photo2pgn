import { useCallback, useEffect, useMemo, useState } from "react";
import type { Extraction, GameHeaders } from "../lib/schema";
import { rowsToPlies, type Analysis, type PlyResult, type PlyStatus } from "../lib/repair";
import { useAnalysis } from "../lib/useAnalysis";
import { load, save } from "../lib/storage";
import type { SavedGame } from "../lib/library";

const FLIP_STORAGE = "photo2pgn.flipped";
import { buildPgn, pgnFileName } from "../lib/pgn";
import { CHESSCOM_ANALYSIS, canShareFiles, gameTitle, importToLichess, mailtoHref, pgnFile } from "../lib/export";
import { GameViewer, STATUS_LABEL } from "./GameViewer";
import { SendToChessTd } from "./Handoff";
import { resultMessage, type Handoff } from "../lib/handoff";
import { START, boardView, manyFixes, plyLabel, stepTo } from "../lib/view";
import { rankMoves } from "../lib/repair";

export interface ReviewSession {
  id: string;
  extraction: Extraction;
  edits: Record<number, string>;
  headers: GameHeaders;
  images: string[]; // object URLs or demo image URL; empty after a reload
  demo: boolean;
  notes?: string;
}

interface Props {
  session: ReviewSession;
  onChange: (s: ReviewSession) => void;
  onStartOver: () => void;
  /** Called (debounced) with the game as it stands, to keep it in My games. */
  onSave?: (game: SavedGame) => void;
  /** Opened from Chess TD: offer to send the checked game back. */
  handoff?: Handoff | null;
  onHandoffSent?: () => void;
}

export function ReviewPanel(props: Props) {
  const { extraction, edits } = props.session;
  const plies = useMemo(() => rowsToPlies(extraction.rows), [extraction]);
  const { analysis, busy } = useAnalysis(plies, extraction.notationLanguage || "en", edits);
  if (!extraction.isScoresheet || plies.length === 0) return <NoMoves {...props} />;
  if (!analysis) {
    return (
      <section className="panel reading" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <h2>Checking the moves…</h2>
        <p>Replaying the game and working out unclear moves.</p>
      </section>
    );
  }
  return <Review {...props} plies={plies} analysis={analysis} busy={busy} />;
}

function NoMoves({ session, onStartOver }: Props) {
  const { extraction } = session;
  return (
    <section className="panel">
      <h2>No moves found</h2>
      <p>
        This does not look like a chess scoresheet, or no moves could be read.
        {extraction.notes && ` Claude noted: ${extraction.notes}`}
      </p>
      <button type="button" className="primary" onClick={onStartOver}>
        Try another photo
      </button>
    </section>
  );
}

function Review({
  session,
  onChange,
  onStartOver,
  onSave,
  handoff,
  onHandoffSent,
  plies,
  analysis,
  busy,
}: Props & { plies: ReturnType<typeof rowsToPlies>; analysis: Analysis; busy: boolean }) {
  const { extraction, edits, headers } = session;
  const [commentFixes, setCommentFixes] = useState(false);
  const pgn = useMemo(
    () => buildPgn(headers, analysis, { commentFixes, notes: session.notes ?? "" }),
    [headers, analysis, commentFixes, session.notes],
  );

  // Keep the game in My games as it is edited (not the demo).
  const saveNow = useCallback(() => {
    onSave?.({
      id: session.id,
      title: gameTitle(headers),
      pgn,
      updated_at: new Date().toISOString(),
      game: { headers, extraction, edits, notes: session.notes ?? "" },
    });
  }, [onSave, session.id, session.notes, headers, pgn, extraction, edits]);
  useEffect(() => {
    if (session.demo || busy || !onSave) return;
    const t = setTimeout(saveNow, 800);
    return () => clearTimeout(t);
  }, [saveNow, session.demo, busy, onSave]);
  // Open on the move that most needs the person: a typed move that is not legal, then a guess.
  const firstToCheck =
    (analysis.plies.find((p) => p.status === "illegal") ?? analysis.plies.find((p) => p.status === "guess") ?? analysis.plies.find((p) => p.status !== "ok"))
      ?.index ?? null;
  const [selected, setSelected] = useState<number>(firstToCheck ?? START);
  const [flipped, setFlipped] = useState(() => load<boolean>(FLIP_STORAGE) === true);

  const counts = useMemo(() => {
    const c: Record<PlyStatus, number> = { ok: 0, unsure: 0, fixed: 0, guess: 0, skipped: 0, illegal: 0, unchecked: 0 };
    for (const p of analysis.plies) c[p.status]++;
    return { ...c, inserted: analysis.plies.filter((p) => p.inserted).length };
  }, [analysis]);

  const setEdit = (index: number, value: string | null) => {
    const next = { ...edits };
    if (value === null) delete next[index];
    else next[index] = value;
    onChange({ ...session, edits: next });
  };

  const sel: PlyResult | undefined = selected >= 0 ? analysis.plies[selected] : undefined;
  const view = boardView(analysis, selected);
  const withInsert = (p: PlyResult, san: string) => (p.inserted ? `${p.inserted.san} ${san}` : san);
  // The other legal moves for the selected one, most likely first.
  const lang = extraction.notationLanguage || "en";
  const alternatives = useMemo(() => (sel ? rankMoves(plies, analysis, sel.index, { lang, edits }) : []), [sel, plies, analysis, lang, edits]);
  const pick = (san: string) => sel && setEdit(sel.index, withInsert(sel, san));

  // Arrow keys step through the game when focus is not in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.altKey || e.ctrlKey || e.metaKey || t.closest("input, textarea, select, [contenteditable]")) return;
      const last = analysis.plies.length - 1;
      const to: Record<string, (s: number) => number> = {
        ArrowLeft: (s) => s - 1,
        ArrowRight: (s) => s + 1,
        ArrowUp: () => START,
        Home: () => START,
        ArrowDown: () => last,
        End: () => last,
      };
      const move = to[e.key];
      if (!move) return;
      e.preventDefault();
      setSelected((s) => stepTo(analysis, move(s)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [analysis]);

  return (
    <div className="review">
      <section className="panel summary" aria-live="polite">
        <div>
          <h2>
            Check the moves{busy && <span className="checking"> Checking…</span>}
          </h2>
          <p>
            Read {Math.ceil(plies.length / 2)} moves.{" "}
            {counts.illegal > 0
              ? `One move needs your fix before the rest can be checked.`
              : counts.guess > 0
                ? counts.guess === 1
                  ? "1 move is a best guess the moves after it do not confirm: please check it."
                  : `${counts.guess} moves are best guesses the moves after them do not confirm: please check them.`
                : counts.fixed + counts.unsure + counts.skipped > 0
                ? counts.fixed + counts.unsure + counts.skipped === 1
                  ? "The game is legal; 1 move is worth a look."
                  : `The game is legal; ${counts.fixed + counts.unsure + counts.skipped} moves are worth a look.`
                : "Every move is legal and clearly read."}
            {analysis.endState === "checkmate" && " Ends in checkmate."}
          </p>
          <ul className="legend">
            {counts.guess > 0 && <li className="st-guess">{counts.guess} to check</li>}
            <li className="st-fixed">{counts.fixed} corrected</li>
            <li className="st-unsure">{counts.unsure} unclear</li>
            {counts.inserted > 0 && <li className="st-fixed">{counts.inserted} missing from the sheet</li>}
            {counts.skipped > 0 && <li className="st-skipped">{counts.skipped} left out</li>}
            {counts.illegal > 0 && <li className="st-illegal">{counts.illegal} not legal</li>}
            {counts.unchecked > 0 && <li className="st-unchecked">{counts.unchecked} not checked yet</li>}
          </ul>
          {manyFixes(analysis) && (
            <p className="warn">
              Many moves had to be changed or guessed. Check that the photo shows one game, or take it again flat and in good light.
            </p>
          )}
          {extraction.notes && !session.demo && <p className="hint">Note from the reading: {extraction.notes}</p>}
          {session.demo && <p className="hint">This is the demo game: a sample, not read from a photo.</p>}
        </div>
        <div className="row">
          {handoff && !busy && (
            <SendToChessTd
              handoff={handoff}
              message={resultMessage(handoff, headers, analysis, pgn)}
              incomplete={analysis.stoppedAt !== null}
              beforeLeave={saveNow}
              onSent={() => onHandoffSent?.()}
            />
          )}
          {firstToCheck !== null && (
            <button type="button" onClick={() => setSelected(nextToCheck(analysis, selected))}>
              Next to check
            </button>
          )}
          <button type="button" className="link" onClick={onStartOver}>
            Start over
          </button>
        </div>
      </section>

      <GameViewer
        analysis={analysis}
        edits={edits}
        headers={headers}
        selected={selected}
        onSelect={setSelected}
        view={view}
        flipped={flipped}
        onFlip={() => {
          setFlipped(!flipped);
          save(FLIP_STORAGE, !flipped);
        }}
        onBoardMove={pick}
        alternatives={alternatives}
        onPick={pick}
        panel={
          sel ? (
            <MovePanel key={sel.index} ply={sel} edit={edits[sel.index]} best={alternatives.slice(0, 3)} onEdit={(v) => setEdit(sel.index, v)} />
          ) : (
            <div className="move-panel">
              <p className="mp-head">
                <strong>Starting position</strong>
              </p>
              <p className="hint">Step through with the buttons or the arrow keys, or tap a move.</p>
            </div>
          )
        }
      />

      <div className="review-grid two">
        <section className="panel photo-panel" aria-label="Scoresheet photo">
          <PhotoViewer images={session.images} />
        </section>
        <section className="panel" aria-labelledby="game-info">
          <h2 id="game-info">Game details</h2>
          <HeadersForm headers={headers} onChange={(h) => onChange({ ...session, headers: h })} />
          <label className="notes">
            <span>Notes</span>
            <textarea
              rows={3}
              value={session.notes ?? ""}
              placeholder="Anything to remember about this game. Added to the PGN as a comment."
              onChange={(e) => onChange({ ...session, notes: e.target.value })}
            />
          </label>
        </section>
      </div>

      <section className="panel" aria-labelledby="pgn-title">
        <h2 id="pgn-title">PGN</h2>
        <PgnExport headers={headers} analysis={analysis} pgn={pgn} commentFixes={commentFixes} setCommentFixes={setCommentFixes} />
      </section>
    </div>
  );
}

function nextToCheck(a: Analysis, from: number): number {
  const start = from + 1;
  const after = a.plies.slice(start).find((p) => p.status !== "ok" && p.status !== "unchecked");
  return (after ?? a.plies.find((p) => p.status !== "ok" && p.status !== "unchecked") ?? a.plies[0]).index;
}

function PhotoViewer({ images }: { images: string[] }) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  if (!images.length) {
    return <p className="hint">The photo is not kept after the page reloads. Your moves and edits are.</p>;
  }
  const src = images[Math.min(page, images.length - 1)];
  return (
    <div className="viewer">
      <div className="row viewer-bar">
        {images.length > 1 &&
          images.map((_, i) => (
            <button key={i} type="button" className={i === page ? "tab active" : "tab"} onClick={() => setPage(i)}>
              Page {i + 1}
            </button>
          ))}
        <label className="inline zoom">
          Zoom
          <input type="range" min={1} max={4} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
      </div>
      <div className="viewer-frame">
        <img src={src} alt={`Scoresheet page ${page + 1}`} style={{ width: `${zoom * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * The selected move, as short as it can be: what it is, what the sheet says,
 * and the likeliest other moves. The rest (typing a move, a missing move,
 * leaving the entry out, why) is one tap away.
 */
function MovePanel({
  ply,
  edit,
  best,
  onEdit,
}: {
  ply: PlyResult;
  edit: string | undefined;
  best: string[];
  onEdit: (v: string | null) => void;
}) {
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState(false);
  const [text, setText] = useState(edit ?? ply.san ?? ply.reading?.san ?? "");
  const [missing, setMissing] = useState<string | null>(null);
  const r = ply.reading;
  const flagged = ply.status !== "ok" && ply.status !== "unchecked";
  const current = ply.san ?? edit ?? r?.san ?? r?.written ?? "";
  const withInsert = (san: string) => (ply.inserted ? `${ply.inserted.san} ${san}` : san);

  if (ply.status === "unchecked") {
    return (
      <div className="move-panel">
        <p className="mp-head">
          <strong>{r?.written || "(blank)"}</strong> <span className="badge st-unchecked">{STATUS_LABEL.unchecked}</span>
        </p>
        <p className="hint">Fix the move in red first.</p>
      </div>
    );
  }

  return (
    <div className="move-panel" aria-label="This move">
      <p className="mp-head">
        <strong>
          {plyLabel(ply)} {ply.san ?? current}
        </strong>{" "}
        <span className={`badge st-${ply.status}`}>{STATUS_LABEL[ply.status]}</span>
      </p>
      <p className="mp-sheet">
        Sheet: <code>{r?.written || "(blank)"}</code>
        {r && r.legibility !== "clear" && <span className="muted"> ({r.legibility})</span>}
        {ply.inserted && (
          <>
            {" "}
            · missing before it: <code>{ply.inserted.san}</code>
          </>
        )}
      </p>
      {flagged && (
        <div className="chips" aria-label="Likeliest moves">
          {ply.san && (
            <button type="button" className="chip keep" onClick={() => onEdit(withInsert(ply.san!))}>
              Keep {ply.san}
            </button>
          )}
          {best.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => onEdit(withInsert(s))}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="row mp-links">
        {ply.note && (
          <button type="button" className="link" aria-expanded={why} onClick={() => setWhy(!why)}>
            Why?
          </button>
        )}
        <button type="button" className="link" aria-expanded={more} onClick={() => setMore(!more)}>
          More
        </button>
        {edit !== undefined && (
          <button type="button" className="link" onClick={() => onEdit(null)}>
            Undo my change
          </button>
        )}
      </div>
      {why && ply.note && <p className="note">{ply.note}</p>}
      {more && (
        <div className="mp-more">
          <form
            className="edit"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) onEdit(text.trim());
            }}
          >
            <label htmlFor="move-edit">Type the move</label>
            <div className="row">
              <input id="move-edit" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder="e.g. Nf3" />
              <button type="submit">Use</button>
            </div>
          </form>
          <div className="row">
            {ply.inserted && ply.san && (
              <button type="button" className="secondary small" onClick={() => onEdit(ply.san!)}>
                Remove the inserted {ply.inserted.san}
              </button>
            )}
            {!ply.inserted && ply.status !== "skipped" && missing === null && (
              <button type="button" className="secondary small" onClick={() => setMissing("")}>
                A move is missing before this one
              </button>
            )}
            {ply.status !== "skipped" && (
              <button type="button" className="secondary small" onClick={() => onEdit("-")}>
                Leave this entry out
              </button>
            )}
          </div>
          {missing !== null && (
            <form
              className="edit missing"
              onSubmit={(e) => {
                e.preventDefault();
                if (missing.trim()) onEdit(`${missing.trim()} ${current}`);
              }}
            >
              <label htmlFor="missing-move">The missing move, played before {current || "this one"}</label>
              <div className="row">
                <input id="missing-move" value={missing} onChange={(e) => setMissing(e.target.value)} spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder="e.g. e5" autoFocus />
                <button type="submit">Add</button>
                <button type="button" className="link" onClick={() => setMissing(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      <p className="hint mp-tip">Tap a piece on the board to play a different move, or this move in the list for other moves.</p>
    </div>
  );
}

const HEADER_FIELDS: { key: keyof GameHeaders; label: string; placeholder?: string }[] = [
  { key: "white", label: "White", placeholder: "Surname, Firstname" },
  { key: "black", label: "Black", placeholder: "Surname, Firstname" },
  { key: "whiteElo", label: "White rating" },
  { key: "blackElo", label: "Black rating" },
  { key: "event", label: "Event" },
  { key: "site", label: "Site" },
  { key: "date", label: "Date", placeholder: "YYYY.MM.DD" },
  { key: "round", label: "Round" },
  { key: "board", label: "Board" },
];

function HeadersForm({ headers, onChange }: { headers: GameHeaders; onChange: (h: GameHeaders) => void }) {
  return (
    <div className="headers-form">
      {HEADER_FIELDS.map((f) => (
        <label key={f.key}>
          <span>{f.label}</span>
          <input
            value={headers[f.key]}
            placeholder={f.placeholder}
            onChange={(e) => onChange({ ...headers, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        <span>Result</span>
        <select value={headers.result} onChange={(e) => onChange({ ...headers, result: e.target.value as GameHeaders["result"] })}>
          <option value="1-0">1-0 (White won)</option>
          <option value="0-1">0-1 (Black won)</option>
          <option value="1/2-1/2">½-½ (Draw)</option>
          <option value="*">* (Unknown)</option>
        </select>
      </label>
    </div>
  );
}

function PgnExport({
  headers,
  analysis,
  pgn,
  commentFixes,
  setCommentFixes,
}: {
  headers: GameHeaders;
  analysis: Analysis;
  pgn: string;
  commentFixes: boolean;
  setCommentFixes: (v: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const fileName = pgnFileName(headers);
  const download = () => {
    const url = URL.createObjectURL(new Blob([pgn], { type: "application/x-chess-pgn" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pgn);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      return true;
    } catch {
      return false; // clipboard blocked; the text is selectable
    }
  };
  const [shareable] = useState(() => canShareFiles());
  const [sending, setSending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const share = async () => {
    try {
      await navigator.share({ files: [pgnFile(pgn, fileName)], title: gameTitle(headers) });
    } catch {
      // cancelled, or the share sheet refused the file
    }
  };
  const toLichess = async () => {
    setSendError(null);
    // Open the tab now, while the click still counts, then point it at the game.
    const tab = window.open("about:blank", "_blank");
    setSending("lichess");
    try {
      const url = await importToLichess(pgn);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      tab?.close();
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(null);
    }
  };
  const toChessCom = async () => {
    const ok = await copy();
    setSendError(ok ? null : "Copy the PGN above first, then paste it on Chess.com.");
    window.open(CHESSCOM_ANALYSIS, "_blank", "noopener");
  };
  const stop = analysis.stoppedAt !== null ? analysis.plies[analysis.stoppedAt] : null;
  return (
    <div className="pgn">
      {stop && (
        <p className="warn">
          The PGN stops before {stop.label ?? plyLabel(stop)}. Fix that move to include the rest of the game.
        </p>
      )}
      <textarea readOnly value={pgn} rows={10} aria-label="PGN text" onFocus={(e) => e.currentTarget.select()} />
      <label className="inline">
        <input type="checkbox" checked={commentFixes} onChange={(e) => setCommentFixes(e.target.checked)} />
        Add a comment to each corrected move
      </label>
      <div className="row">
        <button type="button" className="primary" onClick={download}>
          Download {fileName}
        </button>
        <button type="button" className="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        {shareable ? (
          <button type="button" className="secondary" onClick={share}>
            Share…
          </button>
        ) : (
          <a className="button secondary" href={mailtoHref(pgn, headers)}>
            Email
          </a>
        )}
      </div>
      <h3 className="send-title">Analyse it</h3>
      <div className="row">
        <button type="button" className="secondary" onClick={toLichess} disabled={sending === "lichess"}>
          {sending === "lichess" ? "Sending to Lichess…" : "Open in Lichess"}
        </button>
        <button type="button" className="secondary" onClick={toChessCom}>
          Open in Chess.com
        </button>
      </div>
      <p className="hint">
        Lichess imports the game in one click; imported games are public there. For Chess.com the PGN is copied: paste it
        into its analysis board.
      </p>
      {sendError && (
        <p className="error" role="alert">
          {sendError}
        </p>
      )}
    </div>
  );
}

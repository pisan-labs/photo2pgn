import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Extraction, GameHeaders } from "../lib/schema";
import { rowsToPlies, type Analysis, type PlyResult, type PlyStatus } from "../lib/repair";
import { useAnalysis } from "../lib/useAnalysis";
import { buildPgn, pgnFileName } from "../lib/pgn";
import { Board, moveSquares } from "./Board";

export interface ReviewSession {
  extraction: Extraction;
  edits: Record<number, string>;
  headers: GameHeaders;
  images: string[]; // object URLs or demo image URL; empty after a reload
  demo: boolean;
}

interface Props {
  session: ReviewSession;
  onChange: (s: ReviewSession) => void;
  onStartOver: () => void;
}

const STATUS_LABEL: Record<PlyStatus, string> = {
  ok: "OK",
  unsure: "Unclear handwriting",
  fixed: "Corrected, please check",
  skipped: "Left out of the game",
  illegal: "Not a legal move",
  unchecked: "Not checked yet",
};

function plyLabel(p: PlyResult) {
  return `${p.moveNumber}${p.color === "w" ? "." : "..."}`;
}

function cellText(p: PlyResult, edits: Record<number, string>) {
  if (p.san) return p.san;
  if (p.status === "skipped") return p.reading?.san || p.reading?.written || "-";
  return edits[p.index] ?? (p.reading?.san || p.reading?.written || "?");
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
  plies,
  analysis,
  busy,
}: Props & { plies: ReturnType<typeof rowsToPlies>; analysis: Analysis; busy: boolean }) {
  const { extraction, edits, headers } = session;
  const firstToCheck = analysis.plies.find((p) => p.status !== "ok")?.index ?? null;
  const [selected, setSelected] = useState<number | null>(firstToCheck ?? (plies.length ? 0 : null));
  const [commentFixes, setCommentFixes] = useState(false);

  const counts = useMemo(() => {
    const c: Record<PlyStatus, number> = { ok: 0, unsure: 0, fixed: 0, skipped: 0, illegal: 0, unchecked: 0 };
    for (const p of analysis.plies) c[p.status]++;
    return { ...c, inserted: analysis.plies.filter((p) => p.inserted).length };
  }, [analysis]);

  const setEdit = (index: number, value: string | null) => {
    const next = { ...edits };
    if (value === null) delete next[index];
    else next[index] = value;
    onChange({ ...session, edits: next });
  };

  const sel = selected !== null ? analysis.plies[selected] : undefined;
  const detailRef = useRef<HTMLElement>(null);
  // On a phone the editor sits below the move list; bring it into view.
  const pick = (i: number) => {
    setSelected(i);
    if (window.matchMedia("(max-width: 720px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  // Arrow keys step through the moves when focus is not in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        setSelected((s) => {
          const n = (s ?? -1) + (e.key === "ArrowRight" ? 1 : -1);
          return Math.max(0, Math.min(analysis.plies.length - 1, n));
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [analysis.plies.length]);

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
              : counts.fixed + counts.unsure + counts.skipped > 0
                ? counts.fixed + counts.unsure + counts.skipped === 1
                  ? "The game is legal; 1 move is worth a look."
                  : `The game is legal; ${counts.fixed + counts.unsure + counts.skipped} moves are worth a look.`
                : "Every move is legal and clearly read."}
            {analysis.endState === "checkmate" && " Ends in checkmate."}
          </p>
          <ul className="legend">
            <li className="st-fixed">{counts.fixed} corrected</li>
            <li className="st-unsure">{counts.unsure} unclear</li>
            {counts.inserted > 0 && <li className="st-fixed">{counts.inserted} missing from the sheet</li>}
            {counts.skipped > 0 && <li className="st-skipped">{counts.skipped} left out</li>}
            <li className="st-illegal">{counts.illegal} not legal</li>
            {counts.unchecked > 0 && <li className="st-unchecked">{counts.unchecked} not checked yet</li>}
          </ul>
          {extraction.notes && !session.demo && <p className="hint">Note from the reading: {extraction.notes}</p>}
          {session.demo && <p className="hint">This is the demo game: a sample, not read from a photo.</p>}
        </div>
        <div className="row">
          {firstToCheck !== null && (
            <button type="button" onClick={() => pick(nextToCheck(analysis, selected))}>
              Next to check
            </button>
          )}
          <button type="button" className="link" onClick={onStartOver}>
            Start over
          </button>
        </div>
      </section>

      <div className="review-grid">
        <section className="panel photo-panel" aria-label="Scoresheet photo">
          <PhotoViewer images={session.images} />
        </section>

        <section className="panel moves-panel" aria-label="Moves">
          <MoveGrid analysis={analysis} edits={edits} selected={selected} onSelect={pick} />
        </section>

        <section className="panel detail-panel" aria-label="Selected move" ref={detailRef}>
          {sel ? (
            <PlyDetail
              key={sel.index}
              ply={sel}
              edit={edits[sel.index]}
              onEdit={(v) => setEdit(sel.index, v)}
              onPrev={() => setSelected(Math.max(0, sel.index - 1))}
              onNext={() => setSelected(Math.min(analysis.plies.length - 1, sel.index + 1))}
            />
          ) : (
            <p>Select a move.</p>
          )}
        </section>
      </div>

      <div className="review-grid two">
        <section className="panel" aria-labelledby="game-info">
          <h2 id="game-info">Game details</h2>
          <HeadersForm headers={headers} onChange={(h) => onChange({ ...session, headers: h })} />
        </section>
        <section className="panel" aria-labelledby="pgn-title">
          <h2 id="pgn-title">PGN</h2>
          <PgnExport headers={headers} analysis={analysis} commentFixes={commentFixes} setCommentFixes={setCommentFixes} />
        </section>
      </div>
    </div>
  );
}

function nextToCheck(a: Analysis, from: number | null): number {
  const start = (from ?? -1) + 1;
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

function MoveGrid({
  analysis,
  edits,
  selected,
  onSelect,
}: {
  analysis: Analysis;
  edits: Record<number, string>;
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(".cell.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const rows: { number: number; w?: PlyResult; b?: PlyResult }[] = [];
  for (const p of analysis.plies) {
    let row = rows.at(-1);
    if (!row || row.number !== p.moveNumber) rows.push((row = { number: p.moveNumber }));
    row[p.color] = p;
  }
  const cell = (p?: PlyResult) =>
    p ? (
      <button
        type="button"
        className={`cell st-${p.status}${selected === p.index ? " selected" : ""}`}
        onClick={() => onSelect(p.index)}
        title={STATUS_LABEL[p.status]}
        aria-label={`${plyLabel(p)} ${p.inserted ? `${p.inserted.san} (not on the sheet) then ` : ""}${cellText(p, edits)}, ${STATUS_LABEL[p.status]}`}
      >
        {p.inserted && (
          <span className="ins" aria-hidden="true">
            +{p.inserted.san}{" "}
          </span>
        )}
        {cellText(p, edits)}
      </button>
    ) : (
      <span className="cell empty" />
    );
  return (
    <div className="grid-scroll" ref={ref}>
      <table className="moves">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">White</th>
            <th scope="col">Black</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.number}>
              <th scope="row">{r.number}</th>
              <td>{cell(r.w)}</td>
              <td>{cell(r.b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlyDetail({
  ply,
  edit,
  onEdit,
  onPrev,
  onNext,
}: {
  ply: PlyResult;
  edit: string | undefined;
  onEdit: (v: string | null) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [text, setText] = useState(edit ?? ply.san ?? ply.reading?.san ?? "");
  const r = ply.reading;
  const fen = ply.fenAfter ?? ply.fenBefore;
  const last = ply.fenAfter ? moveSquares(ply.fenBefore, ply.san) : null;
  const side = ply.color === "w" ? "White" : "Black";
  const apply = (v: string) => {
    const t = v.trim();
    if (t) onEdit(t);
  };

  return (
    <div className="detail">
      <div className="row detail-head">
        <button type="button" className="secondary small" onClick={onPrev} aria-label="Previous move">
          ←
        </button>
        <h2>
          {plyLabel(ply)} {side}
        </h2>
        <button type="button" className="secondary small" onClick={onNext} aria-label="Next move">
          →
        </button>
        <span className={`badge st-${ply.status}`}>{STATUS_LABEL[ply.status]}</span>
      </div>

      <dl className="facts">
        <dt>On the sheet</dt>
        <dd>
          {r ? (
            <>
              <code>{r.written || "(blank)"}</code>
              {r.san && r.san !== r.written && (
                <>
                  {" "}
                  read as <code>{r.san}</code>
                </>
              )}
              {r.legibility !== "clear" && ` (${r.legibility})`}
              {r.alternatives.length > 0 && (
                <>
                  ; could also be {r.alternatives.map((a, i) => <code key={i}>{a}</code>).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}
                </>
              )}
            </>
          ) : (
            "(blank)"
          )}
        </dd>
        {ply.sheetNumber !== ply.moveNumber && (
          <>
            <dt>Sheet row</dt>
            <dd>{ply.sheetNumber}</dd>
          </>
        )}
        {ply.inserted && (
          <>
            <dt>Missing before it</dt>
            <dd>
              <code>
                {ply.inserted.label} {ply.inserted.san}
              </code>{" "}
              (not on the sheet)
            </dd>
          </>
        )}
        {ply.san && (
          <>
            <dt>In the PGN</dt>
            <dd>
              <code>
                {ply.label} {ply.san}
              </code>
            </dd>
          </>
        )}
      </dl>
      {ply.note && <p className="note">{ply.note}</p>}

      {ply.status !== "unchecked" && (
        <form
          className="edit"
          onSubmit={(e) => {
            e.preventDefault();
            apply(text);
          }}
        >
          <label htmlFor="move-edit">Correct move</label>
          <div className="row">
            <input
              id="move-edit"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              placeholder="e.g. Nf3"
              aria-describedby="move-edit-hint"
            />
            <button type="submit">Use</button>
          </div>
          <p className="hint" id="move-edit-hint">
            A move missing before this one? Type both, like <code>e5 Nf6</code>. Not a move at all? Type{" "}
            <code>-</code> to leave it out.
          </p>
          {ply.suggestions.length > 0 && (
            <div className="chips" aria-label="Legal moves">
              {ply.suggestions.slice(0, 12).map((s) => (
                <button key={s} type="button" className="chip" onClick={() => onEdit(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="row">
            {(ply.status === "fixed" || ply.status === "unsure") && ply.san && (
              <button
                type="button"
                className="secondary"
                onClick={() => onEdit(ply.inserted ? `${ply.inserted.san} ${ply.san}` : ply.san!)}
              >
                {ply.inserted ? `${ply.inserted.san} then ${ply.san} is right` : `${ply.san} is right`}
              </button>
            )}
            {ply.inserted && ply.san && (
              <button type="button" className="secondary" onClick={() => onEdit(ply.san!)}>
                Remove the inserted {ply.inserted.san}
              </button>
            )}
            {ply.status !== "skipped" && ply.status !== "ok" && (
              <button type="button" className="secondary" onClick={() => onEdit("-")}>
                Leave this entry out
              </button>
            )}
            {edit !== undefined && (
              <button type="button" className="link" onClick={() => onEdit(null)}>
                Undo my change
              </button>
            )}
          </div>
        </form>
      )}

      {fen && (
        <Board
          fen={fen}
          lastMove={last}
          caption={
            ply.san
              ? `After ${ply.label} ${ply.san}`
              : ply.status === "skipped"
                ? "Position when the entry was left out"
                : `Before ${ply.label ?? plyLabel(ply)}, ${side} to move`
          }
        />
      )}
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
  commentFixes,
  setCommentFixes,
}: {
  headers: GameHeaders;
  analysis: Analysis;
  commentFixes: boolean;
  setCommentFixes: (v: boolean) => void;
}) {
  const pgn = useMemo(() => buildPgn(headers, analysis, { commentFixes }), [headers, analysis, commentFixes]);
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
    } catch {
      // clipboard blocked; the text is selectable
    }
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
      </div>
    </div>
  );
}

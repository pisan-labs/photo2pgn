// The game as an analysis board: the board on the left, the moves on the
// right with the buttons to step through them underneath. On a phone: the
// board, the buttons, then the moves.
import { useEffect, useRef } from "react";
import type { GameHeaders } from "../lib/schema";
import type { Analysis, PlyResult, PlyStatus } from "../lib/repair";
import { START, plyLabel, stepTo, type BoardView } from "../lib/view";
import { Board } from "./Board";

export const STATUS_LABEL: Record<PlyStatus, string> = {
  ok: "OK",
  unsure: "Unclear handwriting",
  fixed: "Corrected, please check",
  guess: "Best guess: please check",
  skipped: "Left out of the game",
  illegal: "Not a legal move",
  unchecked: "Not checked yet",
};

export function cellText(p: PlyResult, edits: Record<number, string>) {
  if (p.san) return p.san;
  if (p.status === "skipped") return p.reading?.san || p.reading?.written || "-";
  return edits[p.index] ?? (p.reading?.san || p.reading?.written || "?");
}

interface Props {
  analysis: Analysis;
  edits: Record<number, string>;
  headers: GameHeaders;
  selected: number;
  onSelect: (i: number) => void;
  view: BoardView;
  flipped: boolean;
  onFlip: () => void;
  onBoardMove: (san: string) => void;
}

export function GameViewer({ analysis, edits, headers, selected, onSelect, view, flipped, onFlip, onBoardMove }: Props) {
  const last = analysis.plies.length - 1;
  const white = headers.white.trim() || "White";
  const black = headers.black.trim() || "Black";
  return (
    <section className="panel game-view" aria-label="Game">
      <div className="gv-board">
        <Board fen={view.fen} lastMove={view.lastMove} flipped={flipped} onMove={view.editable ? onBoardMove : undefined} caption={view.caption} />
      </div>
      <div className="gv-players">
        <span className="gv-player">
          <span className="gv-dot white" aria-hidden="true" />
          {white}
        </span>
        <span className="gv-player">
          <span className="gv-dot black" aria-hidden="true" />
          {black}
        </span>
        {headers.result !== "*" && <span className="gv-result">{headers.result.replace("1/2", "½")}</span>}
      </div>
      <MoveList analysis={analysis} edits={edits} selected={selected} onSelect={onSelect} />
      <div className="gv-controls" role="group" aria-label="Step through the game">
        <button type="button" className="gv-btn" aria-label="Go to the start" title="Start (Home)" onClick={() => onSelect(START)} disabled={selected <= START}>
          <Icon d="M5 5v14M19 5 9 12l10 7z" />
        </button>
        <button type="button" className="gv-btn" aria-label="Previous move" title="Previous (←)" onClick={() => onSelect(stepTo(analysis, selected - 1))} disabled={selected <= START}>
          <Icon d="M15 5 8 12l7 7" />
        </button>
        <button type="button" className="gv-btn" aria-label="Next move" title="Next (→)" onClick={() => onSelect(stepTo(analysis, selected + 1))} disabled={selected >= last}>
          <Icon d="m9 5 7 7-7 7" />
        </button>
        <button type="button" className="gv-btn" aria-label="Go to the end" title="End (End)" onClick={() => onSelect(last)} disabled={selected >= last}>
          <Icon d="M19 5v14M5 5l10 7-10 7z" />
        </button>
        <button type="button" className="gv-btn" aria-label="Flip board" title="Flip board" aria-pressed={flipped} onClick={onFlip}>
          <Icon d="M7 4v15m0 0-3-3m3 3 3-3M17 20V5m0 0-3 3m3-3 3 3" />
        </button>
      </div>
    </section>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoveList({
  analysis,
  edits,
  selected,
  onSelect,
}: {
  analysis: Analysis;
  edits: Record<number, string>;
  selected: number;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the current move in view inside the list, without scrolling the page.
  useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>(".cell.selected");
    if (!box) return;
    if (!el) {
      if (selected === START) box.scrollTop = 0;
      return;
    }
    const head = box.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < b.top + head) box.scrollTop -= b.top + head - r.top + 4;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 4;
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
        aria-current={selected === p.index ? "step" : undefined}
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
    <div className="gv-moves" ref={ref}>
      <table className="moves">
        <thead className="sr-only">
          <tr>
            <th scope="col">Move</th>
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

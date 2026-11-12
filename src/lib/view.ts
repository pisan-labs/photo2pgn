// What the game viewer shows at each step: the starting position (START),
// then the position after each move, like an online analysis board.
import { Chess } from "chess.js";
import type { Analysis, PlyResult } from "./repair";

export const START = -1;
export const START_FEN = new Chess().fen();

export interface BoardView {
  fen: string;
  lastMove: { from: string; to: string } | null;
  caption: string;
  /** The person is changing this move on the board: tap a piece, then its square. */
  editable: boolean;
}

/** From and to squares of a SAN move in a position, for highlighting. */
export function moveSquares(fenBefore: string | null, san: string | null) {
  if (!fenBefore || !san) return null;
  try {
    const m = new Chess(fenBefore).move(san);
    return { from: m.from, to: m.to };
  } catch {
    return null;
  }
}

export function plyLabel(p: PlyResult): string {
  return p.label ?? `${p.moveNumber}${p.color === "w" ? "." : "..."}`;
}

/** A step through the game, kept between the start and the last move. */
export function stepTo(analysis: Analysis, target: number): number {
  return Math.max(START, Math.min(analysis.plies.length - 1, target));
}

/** The board at step `selected`; `editing` asks for the position before that move, to play it. */
export function boardView(analysis: Analysis, selected: number, editing = false): BoardView {
  const start = analysis.plies[0]?.fenBefore ?? START_FEN;
  const p = selected >= 0 ? analysis.plies[selected] : undefined;
  if (!p) return { fen: start, lastMove: null, caption: "Starting position", editable: false };
  const side = p.color === "w" ? "White" : "Black";
  if (editing && p.fenBefore && p.status !== "skipped") {
    return { fen: p.fenBefore, lastMove: null, caption: `${side} to move: tap a piece, then its square`, editable: true };
  }
  if (p.fenAfter && p.san) {
    return { fen: p.fenAfter, lastMove: moveSquares(p.fenBefore, p.san), caption: `After ${plyLabel(p)} ${p.san}`, editable: false };
  }
  if (p.fenBefore) {
    const caption = p.status === "skipped" ? "Position when the entry was left out" : `Before ${plyLabel(p)}, ${side} to move`;
    return { fen: p.fenBefore, lastMove: null, caption, editable: false };
  }
  // Past the move that needs fixing: the game has not been replayed this far.
  const stop = analysis.stoppedAt !== null ? analysis.plies[analysis.stoppedAt] : undefined;
  return {
    fen: analysis.finalFen,
    lastMove: null,
    caption: stop ? `Not checked yet: fix the move in red (${plyLabel(stop)}) first` : "Not checked yet",
    editable: false,
  };
}

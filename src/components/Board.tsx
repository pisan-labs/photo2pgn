import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";

// Cburnett's pieces from Wikimedia Commons, BSD licence (src/assets/pieces/LICENSE.txt).
const PIECE_FILES = import.meta.glob<string>("../assets/pieces/*.svg", { eager: true, query: "?url", import: "default" });
const pieceUrl = (color: "w" | "b", type: string) => PIECE_FILES[`../assets/pieces/${color}${type.toUpperCase()}.svg`];
const FILES = "abcdefgh";
const PROMOTIONS = [
  ["q", "Queen"],
  ["r", "Rook"],
  ["b", "Bishop"],
  ["n", "Knight"],
] as const;

interface Props {
  fen: string;
  lastMove?: { from: string; to: string } | null;
  caption?: string;
  flipped?: boolean;
  /** When given, the person can make a move: tap a piece, then its square. */
  onMove?: (san: string) => void;
  /**
   * The position the move is made in, when the board shows the one after it.
   * The piece that moved can be dragged (or tapped, then a square tapped)
   * straight to another square, or back to its starting square: that takes
   * the move back, and the board shows the position before it until a piece
   * is moved there. Another piece of that side can be moved instead.
   */
  moveFen?: string;
}

/** The SAN of a move from one square to another, or null if it is not legal. */
export function sanFor(fen: string, from: string, to: string, promotion?: string): string | null {
  try {
    return new Chess(fen).move({ from, to, promotion: promotion ?? "q" }).san;
  } catch {
    return null;
  }
}

/** A piece picked up: where it stands in the position the move is made in, and where it is drawn. */
interface Pick {
  source: Square;
  shownAt: Square;
}

interface Drag extends Pick {
  pointerId: number;
  color: "w" | "b";
  type: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moving: boolean;
  box?: { left: number; top: number; width: number; height: number }; // the board, measured when the drag starts
}

const DRAG_START_PX = 6;

/**
 * A board from White's side (or Black's when flipped); highlights the last
 * move. With onMove, a piece can be dragged to its new square, or tapped and
 * then its square tapped.
 */
export function Board({ fen, lastMove, caption, flipped = false, onMove, moveFen }: Props) {
  const playFen = moveFen ?? fen;
  const play = useMemo(() => new Chess(playFen), [playFen]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The move shown was taken back: the board shows the position before it.
  const [back, setBack] = useState(false);
  // The move just made, shown at once while the game is checked again.
  const [pending, setPending] = useState<{ fen: string; from: string; to: string } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const lastDrop = useRef(0);

  const from = pick?.source ?? null;
  // The piece that moved, picked up where it now stands: it stays there until it is put down elsewhere.
  const moved = Boolean(moveFen && lastMove && !back && pick && pick.source === lastMove.from && pick.shownAt === lastMove.to);
  const home = moved ? (lastMove!.from as Square) : null;
  // The position before the move: taken back, or another piece of that side is being moved instead.
  const before = !pending && (back || promo !== null || (pick !== null && !moved));
  const shown = useMemo(() => (pending ? new Chess(pending.fen) : before ? play : new Chess(fen)), [pending, before, play, fen]);
  const board = useMemo(() => shown.board(), [shown]);
  const targets = useMemo(() => {
    if (!from || pending) return new Set<string>();
    const to = new Set<string>(play.moves({ square: from, verbose: true }).map((m) => m.to));
    if (moved) to.delete(lastMove!.to); // where it already stands
    return to;
  }, [play, from, pending, moved, lastMove]);
  const own = (sq: string) => play.get(sq as Square)?.color === play.turn();
  const highlight = pending ? { from: pending.from, to: pending.to } : before ? null : lastMove;

  /** The piece a press or tap on a square picks up. */
  const pickAt = (sq: Square): Pick | null => {
    if (before || !moveFen || !lastMove) return own(sq) ? { source: sq, shownAt: sq } : null;
    // As shown, after the move: the piece that moved stands on its new square, and its old one is empty.
    if (sq === lastMove.to && own(lastMove.from)) return { source: lastMove.from as Square, shownAt: sq };
    return own(sq) && sq !== lastMove.from ? { source: sq, shownAt: sq } : null;
  };

  const takeBack = () => {
    setBack(true);
    setPick(null);
  };

  const commit = (to: Square, piece: Square, promotion?: string) => {
    const isPromotion = !promotion && play.get(piece)?.type === "p" && (to[1] === "8" || to[1] === "1");
    if (isPromotion) {
      setPromo({ from: piece, to });
      return;
    }
    const after = new Chess(playFen);
    try {
      const m = after.move({ from: piece, to, promotion: promotion ?? "q" });
      setPending({ fen: after.fen(), from: m.from, to: m.to });
      setPick(null);
      setPromo(null);
      onMove?.(m.san);
    } catch {
      setPick(null);
    }
  };

  const tap = (sq: Square) => {
    if (!onMove || pending || Date.now() - lastDrop.current < 300) return;
    if (pick) {
      if (sq === home) return takeBack();
      if (targets.has(sq)) return commit(sq, pick.source);
      // The same piece again puts it down; another piece of that side is picked up instead.
      const next = sq === pick.shownAt ? null : pickAt(sq);
      setPick(next && next.source !== pick.source ? next : null);
      return;
    }
    setPick(pickAt(sq));
  };

  // Dragging: a press on a piece follows the pointer once it has moved a little.
  const squareAt = (x: number, y: number): Square | null => {
    const r = boardRef.current?.getBoundingClientRect();
    if (!r || x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
    const col = Math.floor(((x - r.left) / r.width) * 8);
    const row = Math.floor(((y - r.top) / r.height) * 8);
    const f = flipped ? 7 - col : col;
    const rank = flipped ? row + 1 : 8 - row;
    return `${FILES[f]}${rank}` as Square;
  };
  const press = (e: React.PointerEvent, sq: Square) => {
    if (!onMove || pending || e.button !== 0) return;
    const p = pickAt(sq);
    const piece = p ? play.get(p.source) : null;
    if (!p || !piece) return;
    setDrag({ pointerId: e.pointerId, ...p, color: piece.color, type: piece.type, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moving: false });
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const far = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_START_PX;
      if (!drag.moving && !far) return;
      e.preventDefault();
      if (!drag.moving) setPick({ source: drag.source, shownAt: drag.shownAt });
      const r = drag.box ?? boardRef.current?.getBoundingClientRect();
      const box = r ? { left: r.left, top: r.top, width: r.width, height: r.height } : undefined;
      setDrag({ ...drag, x: e.clientX, y: e.clientY, moving: true, box });
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      setDrag(null);
      if (!drag.moving) return; // a tap: the click handler has it
      lastDrop.current = Date.now();
      const to = squareAt(e.clientX, e.clientY);
      // The piece that moved, dropped on its starting square: the move is taken back.
      const movedPiece = moveFen && lastMove && !back && drag.source === lastMove.from && drag.shownAt === lastMove.to;
      if (movedPiece && to === lastMove.from) return takeBack();
      const legal = new Set(play.moves({ square: drag.source, verbose: true }).map((m) => m.to));
      if (to && legal.has(to) && !(movedPiece && to === lastMove.to)) commit(to, drag.source);
      else setPick(null);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // squareAt and commit read the latest render through closure on each drag change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, play, back]);

  const dragging = drag?.moving ? drag : null;
  const boardBox = dragging?.box;
  const ranks = flipped ? [...board].reverse() : board;
  return (
    <figure className="board-wrap">
      <div
        ref={boardRef}
        className={`board${onMove ? " interactive" : ""}${dragging ? " dragging" : ""}`}
        role={onMove ? "grid" : "img"}
        aria-label={caption ? `Board: ${caption}` : "Board"}
      >
        {ranks.map((rank, ri) => {
          const r = flipped ? 7 - ri : ri;
          const cells = flipped ? [...rank].reverse() : rank;
          return cells.map((cell, fi) => {
            const f = flipped ? 7 - fi : fi;
            const sq = `${FILES[f]}${8 - r}` as Square;
            const dark = (r + f) % 2 === 1;
            const hl = highlight && (highlight.from === sq || highlight.to === sq);
            const hidden = dragging && dragging.shownAt === sq;
            const picked = pick && !dragging && pick.shownAt === sq;
            const cls = `sq ${dark ? "dark" : "light"}${hl ? " hl" : ""}${picked ? " picked" : ""}${targets.has(sq) ? " target" : ""}${home === sq ? " home" : ""}`;
            const content = (
              <>
                {cell && <img className={`pc${hidden ? " lifted" : ""}`} src={pieceUrl(cell.color, cell.type)} alt="" draggable={false} />}
                {fi === 7 && <span className="coord rank">{8 - r}</span>}
                {ri === 7 && <span className="coord file">{FILES[f]}</span>}
              </>
            );
            return onMove ? (
              <button
                key={sq}
                type="button"
                className={cls}
                onClick={() => tap(sq)}
                onPointerDown={(e) => press(e, sq)}
                aria-label={`${sq}${cell ? ` ${cell.color === "w" ? "white" : "black"} ${cell.type}` : ""}`}
              >
                {content}
              </button>
            ) : (
              <div key={sq} className={cls}>
                {content}
              </div>
            );
          });
        })}
      </div>
      {dragging && boardBox && (
        <img
          className="pc drag-pc"
          src={pieceUrl(dragging.color, dragging.type)}
          alt=""
          draggable={false}
          style={{
            width: boardBox.width / 8,
            height: boardBox.height / 8,
            left: dragging.x - boardBox.left - boardBox.width / 16,
            top: dragging.y - boardBox.top - boardBox.height / 16,
          }}
        />
      )}
      {promo && onMove && (
        <div className="row promo" role="group" aria-label="Promote to">
          {PROMOTIONS.map(([p, name]) => (
            <button key={p} type="button" className="secondary small" aria-label={name} onClick={() => commit(promo.to, promo.from, p)}>
              <img className="promo-pc" src={pieceUrl(play.turn(), p)} alt="" draggable={false} />
            </button>
          ))}
          <button type="button" className="link" onClick={() => (setPromo(null), setPick(null))}>
            Cancel
          </button>
        </div>
      )}
      <figcaption>
        {boardHint({ pending: Boolean(pending), dragging: Boolean(dragging), picked: Boolean(pick), moved, back }) ?? caption}
        {back && !pending && !pick && onMove && (
          <>
            {" "}
            <button type="button" className="link put-back" onClick={() => setBack(false)}>
              Put the move back
            </button>
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** What the board says while a move is being changed; null: the caption. */
export function boardHint(s: { pending: boolean; dragging: boolean; picked: boolean; moved: boolean; back: boolean }): string | null {
  if (s.pending) return null;
  if (s.dragging) return s.moved ? "Drop it on its new square, or on its starting square to take the move back." : "Drop it on its new square.";
  if (s.picked) return s.moved ? "Tap its new square, or its starting square (the ring) to take the move back." : "Tap its new square, or the piece again to put it down.";
  if (s.back) return "Move taken back. Now play the right move: drag a piece, or tap it and then its square.";
  return null;
}

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
   * The position the move is made in, when the board shows the one after it:
   * tapping a piece of the side that moved takes the move back (the piece that
   * moved goes back to where it came from) and shows where it can go instead.
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

interface Drag {
  pointerId: number;
  source: Square; // where the piece stands in the position the move is made in
  shownAt: Square; // where it was picked up on the board as shown
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
  const [from, setFrom] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The move just made, shown at once while the game is checked again.
  const [pending, setPending] = useState<{ fen: string; from: string; to: string } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const lastDrop = useRef(0);

  // While a piece is lifted the board shows the position the move is made in.
  const lifted = !pending && (from !== null || promo !== null);
  const shown = useMemo(() => (pending ? new Chess(pending.fen) : lifted ? play : new Chess(fen)), [pending, lifted, play, fen]);
  const board = useMemo(() => shown.board(), [shown]);
  const targets = useMemo(
    () => (from && !pending ? new Set(play.moves({ square: from, verbose: true }).map((m) => m.to)) : new Set<string>()),
    [play, from, pending],
  );
  const own = (sq: string) => play.get(sq as Square)?.color === play.turn();
  const highlight = pending ? { from: pending.from, to: pending.to } : lifted ? null : lastMove;

  /** The piece a press or tap on a square picks up, in the position the move is made in. */
  const sourceOf = (sq: Square): Square | null => {
    if (lifted) return own(sq) ? sq : null;
    if (moveFen && lastMove && sq === lastMove.to && own(lastMove.from)) return lastMove.from as Square;
    return own(sq) ? sq : null;
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
      setFrom(null);
      setPromo(null);
      onMove?.(m.san);
    } catch {
      setFrom(null);
    }
  };

  const tap = (sq: Square) => {
    if (!onMove || pending || Date.now() - lastDrop.current < 300) return;
    if (from && targets.has(sq)) return commit(sq, from);
    if (from) {
      // Another piece of the same side, or the same one again to put it down.
      setFrom(sq !== from && own(sq) ? sq : null);
      return;
    }
    setFrom(sourceOf(sq));
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
    const source = sourceOf(sq);
    const piece = source ? play.get(source) : null;
    if (!source || !piece) return;
    setDrag({ pointerId: e.pointerId, source, shownAt: sq, color: piece.color, type: piece.type, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moving: false });
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const far = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_START_PX;
      if (!drag.moving && !far) return;
      e.preventDefault();
      if (!drag.moving) setFrom(drag.source);
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
      const legal = new Set(play.moves({ square: drag.source, verbose: true }).map((m) => m.to));
      if (to && legal.has(to)) commit(to, drag.source);
      else setFrom(null);
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
  }, [drag, play]);

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
            const hidden = dragging && dragging.source === sq;
            const cls = `sq ${dark ? "dark" : "light"}${hl ? " hl" : ""}${from === sq && !dragging ? " picked" : ""}${targets.has(sq) ? " target" : ""}`;
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
          <button type="button" className="link" onClick={() => (setPromo(null), setFrom(null))}>
            Cancel
          </button>
        </div>
      )}
      {lifted ? (
        <figcaption>{dragging ? "Drop it on its new square." : "Tap a square to move it there, or the piece again to put it back."}</figcaption>
      ) : (
        caption && <figcaption>{caption}</figcaption>
      )}
    </figure>
  );
}

import { Chess, type Square } from "chess.js";
import { useMemo, useState } from "react";

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
}

/** The SAN of a move from one square to another, or null if it is not legal. */
export function sanFor(fen: string, from: string, to: string, promotion?: string): string | null {
  try {
    return new Chess(fen).move({ from, to, promotion: promotion ?? "q" }).san;
  } catch {
    return null;
  }
}

/** A board from White's side (or Black's when flipped); highlights the last move. */
export function Board({ fen, lastMove, caption, flipped = false, onMove }: Props) {
  const chess = useMemo(() => new Chess(fen), [fen]);
  const board = useMemo(() => chess.board(), [chess]);
  const [from, setFrom] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const targets = useMemo(
    () => (from ? new Set(chess.moves({ square: from, verbose: true }).map((m) => m.to)) : new Set<string>()),
    [chess, from],
  );

  const tap = (sq: Square) => {
    if (!onMove) return;
    const piece = chess.get(sq);
    if (from && targets.has(sq)) {
      const isPromotion = chess.get(from)?.type === "p" && (sq[1] === "8" || sq[1] === "1");
      if (isPromotion) setPromo({ from, to: sq });
      else {
        const san = sanFor(fen, from, sq);
        if (san) onMove(san);
      }
      setFrom(null);
      return;
    }
    setFrom(piece && piece.color === chess.turn() ? sq : null);
  };

  const ranks = flipped ? [...board].reverse() : board;
  return (
    <figure className="board-wrap">
      <div
        className={`board${onMove ? " interactive" : ""}`}
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
            const hl = lastMove && (lastMove.from === sq || lastMove.to === sq);
            const cls = `sq ${dark ? "dark" : "light"}${hl ? " hl" : ""}${from === sq ? " picked" : ""}${targets.has(sq) ? " target" : ""}`;
            const content = (
              <>
                {cell && <img className="pc" src={pieceUrl(cell.color, cell.type)} alt="" draggable={false} />}
                {fi === 7 && <span className="coord rank">{8 - r}</span>}
                {ri === 7 && <span className="coord file">{FILES[f]}</span>}
              </>
            );
            return onMove ? (
              <button key={sq} type="button" className={cls} onClick={() => tap(sq)} aria-label={`${sq}${cell ? ` ${cell.color === "w" ? "white" : "black"} ${cell.type}` : ""}`}>
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
      {promo && onMove && (
        <div className="row promo" role="group" aria-label="Promote to">
          {PROMOTIONS.map(([p, name]) => (
            <button
              key={p}
              type="button"
              className="secondary small"
              aria-label={name}
              onClick={() => {
                const san = sanFor(fen, promo.from, promo.to, p);
                setPromo(null);
                if (san) onMove(san);
              }}
            >
              <img className="promo-pc" src={pieceUrl(chess.turn(), p)} alt="" draggable={false} />
            </button>
          ))}
        </div>
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

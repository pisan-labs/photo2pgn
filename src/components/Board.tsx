import { Chess, type Square } from "chess.js";
import { useMemo } from "react";

const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = "abcdefgh";

interface Props {
  fen: string;
  lastMove?: { from: string; to: string } | null;
  caption?: string;
}

/** A plain board from White's side; highlights the last move. */
export function Board({ fen, lastMove, caption }: Props) {
  const board = useMemo(() => new Chess(fen).board(), [fen]);
  return (
    <figure className="board-wrap">
      <div className="board" role="img" aria-label={caption ? `Board: ${caption}` : "Board"}>
        {board.map((rank, r) =>
          rank.map((cell, f) => {
            const sq = `${FILES[f]}${8 - r}` as Square;
            const dark = (r + f) % 2 === 1;
            const hl = lastMove && (lastMove.from === sq || lastMove.to === sq);
            return (
              <div key={sq} className={`sq ${dark ? "dark" : "light"}${hl ? " hl" : ""}`}>
                {cell && <span className={`pc ${cell.color === "w" ? "white" : "black"}`}>{GLYPH[cell.type]}</span>}
                {f === 0 && <span className="coord rank">{8 - r}</span>}
                {r === 7 && <span className="coord file">{FILES[f]}</span>}
              </div>
            );
          }),
        )}
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
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

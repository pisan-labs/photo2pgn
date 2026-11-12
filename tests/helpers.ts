import type { Extraction, MoveRow, PlyReading } from "../src/lib/schema";

/** Morphy vs Duke of Brunswick and Count Isouard, Paris 1858. */
export const OPERA_GAME =
  "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#".split(
    " ",
  );

export function clear(san: string, written = san): PlyReading {
  return { written, san, alternatives: [], legibility: "clear" };
}

/** Build rows from a flat list of plies, with per-ply overrides by index. */
export function rowsFrom(
  sans: string[],
  overrides: Record<number, Partial<PlyReading> | null> = {},
): MoveRow[] {
  const rows: MoveRow[] = [];
  for (let i = 0; i < sans.length; i += 2) {
    const ply = (k: number): PlyReading | null => {
      if (k >= sans.length) return null;
      if (overrides[k] === null) return null;
      return { ...clear(sans[k]), ...(overrides[k] ?? {}) };
    };
    rows.push({ number: i / 2 + 1, white: ply(i), black: ply(i + 1) });
  }
  return rows;
}

export function extraction(rows: MoveRow[], partial: Partial<Extraction> = {}): Extraction {
  return {
    isScoresheet: true,
    notationLanguage: "en",
    headers: {
      event: "Paris Opera",
      site: "Paris",
      date: "1858.??.??",
      round: "",
      board: "",
      white: "Morphy, Paul",
      black: "Duke Karl / Count Isouard",
      whiteElo: "",
      blackElo: "",
      result: "1-0",
    },
    rows,
    notes: "",
    ...partial,
  };
}

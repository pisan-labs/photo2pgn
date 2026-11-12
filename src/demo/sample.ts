// A worked example that needs no API call: Morphy's 1858 Opera game, as if
// read from a handwritten sheet, with the kinds of misreadings real sheets
// produce: a near miss, an alternative found nine moves back, an unsure
// reading, castling written with zeros, and a smudged move near the end that
// is left for the person to pick.
import type { Extraction, PlyReading } from "../lib/schema";

const MOVES =
  "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#".split(
    " ",
  );

const MISREAD: Record<number, Partial<PlyReading>> = {
  6: { written: "dxe6", san: "dxe6" }, // 4. dxe5: the 5 looks like a 6
  12: { written: "Qd3", san: "Qd3", alternatives: ["Qb3"], legibility: "unclear" }, // 7. Qb3
  22: { written: "0-0-0", san: "O-O-O" },
  27: { legibility: "unclear", alternatives: ["Qe7"] }, // 14...Qe6
  31: { written: "Ke7", san: "Ke7" }, // 16...Nxb8: a smudge
};

export const DEMO_EXTRACTION: Extraction = {
  isScoresheet: true,
  notationLanguage: "en",
  headers: {
    event: "Paris Opera",
    site: "Paris FRA",
    date: "1858.??.??",
    round: "",
    board: "",
    white: "Morphy, Paul",
    black: "Duke Karl / Count Isouard",
    whiteElo: "",
    blackElo: "",
    result: "1-0",
  },
  rows: Array.from({ length: Math.ceil(MOVES.length / 2) }, (_, r) => {
    const ply = (i: number): PlyReading | null =>
      i < MOVES.length ? { written: MOVES[i], san: MOVES[i], alternatives: [], legibility: "clear", ...MISREAD[i] } : null;
    return { number: r + 1, white: ply(2 * r), black: ply(2 * r + 1) };
  }),
  notes: "Demo: a sample game, not read from a photo.",
};

export const DEMO_IMAGE_URL = "/demo-scoresheet.svg";

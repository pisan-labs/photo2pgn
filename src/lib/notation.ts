// Turning handwritten move text into SAN that chess.js can try, and parsing
// SAN-like text into parts so near misses can be scored against legal moves.

type PieceMap = Record<string, "K" | "Q" | "R" | "B" | "N">;

// Piece letters by language. Only used when the sheet is not in English,
// because some letters mean different pieces (French R = roi = king).
const PIECE_LETTERS: Record<string, PieceMap> = {
  de: { K: "K", D: "Q", T: "R", L: "B", S: "N" },
  fr: { R: "K", D: "Q", T: "R", F: "B", C: "N" },
  es: { R: "K", D: "Q", T: "R", A: "B", C: "N" },
  it: { R: "K", D: "Q", T: "R", A: "B", C: "N" },
  pt: { R: "K", D: "Q", T: "R", B: "B", C: "N" },
  nl: { K: "K", D: "Q", T: "R", L: "B", P: "N" },
  sv: { K: "K", D: "Q", T: "R", L: "B", S: "N" },
  no: { K: "K", D: "Q", T: "R", L: "B", S: "N" },
  da: { K: "K", D: "Q", T: "R", L: "B", S: "N" },
  pl: { K: "K", H: "Q", W: "R", G: "B", S: "N" },
  cs: { K: "K", D: "Q", V: "R", S: "B", J: "N" },
  hu: { K: "K", V: "Q", B: "R", F: "B", H: "N" },
  tr: { Ş: "K", S: "K", V: "Q", K: "R", F: "B", A: "N" },
  ru: { Кр: "K", К: "N", Ф: "Q", Л: "R", С: "B" },
};

export function supportedLanguages(): string[] {
  return ["en", ...Object.keys(PIECE_LETTERS)];
}

/** Clean up punctuation and symbols that do not change the move. */
export function cleanMoveText(text: string): string {
  let s = text.normalize("NFC").trim();
  s = s.replace(/\s+/g, "");
  s = s.replace(/[×:]/g, "x");
  s = s.replace(/[–—−]/g, "-");
  // Annotations and check / mate markers: chess.js works these out itself.
  s = s.replace(/(e\.?p\.?)$/i, "");
  s = s.replace(/(ch|dbl\.?ch)$/i, "");
  s = s.replace(/[!?]+$/g, "");
  s = s.replace(/[+#†‡]+$/g, "");
  s = s.replace(/[!?]+$/g, "");
  // Castling: 0-0, o-o, OO, 0-0-0 ...
  if (/^[0Oo](-?[0Oo]){2}$/.test(s)) return "O-O-O";
  if (/^[0Oo]-?[0Oo]$/.test(s)) return "O-O";
  // Promotion spelled e8Q, e8(Q), e8/Q, e8=Q.
  s = s.replace(/^(.*[a-h][18])[=/(]?([QRBNDTLSFCAHWVJ])\)?$/, "$1=$2");
  return s;
}

function translatePieces(s: string, lang: string): string {
  const map = PIECE_LETTERS[lang];
  if (!map) return s;
  // Multi-letter keys first (Russian Кр).
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (s.startsWith(k)) {
      s = map[k] + s.slice(k.length);
      break;
    }
  }
  return s.replace(/=([^\s])$/, (_m, p: string) => "=" + (map[p] ?? p));
}

/**
 * Variants of a move to try, most faithful first. Duplicates removed.
 * `lang` is the sheet's notation language; English SAN from Claude uses "en".
 */
export function moveVariants(text: string, lang = "en"): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };
  const base = cleanMoveText(text);
  if (!base) return out;
  const translated = lang === "en" ? base : translatePieces(base, lang);
  for (const s of [translated, base]) {
    add(s);
    // A leading P for a pawn move.
    if (/^P[a-h]/.test(s)) add(s.slice(1));
    // Lower-case piece letters: n, r, q, k are never files.
    if (/^[nrqk][a-h1-8x]/.test(s)) add(s[0].toUpperCase() + s.slice(1));
    // "b" is either the b-pawn or a bishop written small.
    if (/^b[a-h1-8x]/.test(s) && !/^b[1-8]$/.test(s)) add("B" + s.slice(1));
    // Pawn capture written without the x: ed5 -> exd5.
    if (/^[a-h][a-h][1-8]/.test(s)) add(s[0] + "x" + s.slice(1));
  }
  return out;
}

export type ParsedMove =
  | { castle: "K" | "Q" }
  | {
      castle?: undefined;
      piece: "P" | "K" | "Q" | "R" | "B" | "N";
      pieceWritten: boolean;
      fromFile?: string;
      fromRank?: string;
      capture: boolean;
      to: string;
      promo?: string;
    };

const SAN_RE =
  /^([KQRBN])?([a-h])?([1-8])?-?(x)?([a-h][1-8])(?:=?([QRBN]))?$/;

/** Parse SAN-like text (already cleaned and translated) into parts. */
export function parseMove(text: string): ParsedMove | null {
  const s = text;
  if (s === "O-O") return { castle: "K" };
  if (s === "O-O-O") return { castle: "Q" };
  const m = SAN_RE.exec(s);
  if (!m) return null;
  const [, piece, fromFile, fromRank, x, to, promo] = m;
  return {
    piece: (piece as "K" | "Q" | "R" | "B" | "N" | undefined) ?? "P",
    pieceWritten: Boolean(piece),
    fromFile,
    fromRank,
    capture: Boolean(x),
    to,
    promo,
  };
}

// Pairs that are easy to confuse in handwriting.
const FILE_CONFUSIONS = ["ad", "ce", "bh", "ag", "ef"];
const RANK_CONFUSIONS = ["17", "38", "35", "56", "68", "27", "14"];

function confusable(a: string, b: string, pairs: string[]): boolean {
  return pairs.some((p) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
}

/**
 * How far a reading is from a legal move (both parsed from SAN). 0 is an exact
 * match; 1 is about one misread character. Infinity means "not a plausible
 * misreading".
 */
export function readingDistance(reading: ParsedMove, move: ParsedMove): number {
  if (reading.castle || move.castle) {
    if (reading.castle && move.castle) return reading.castle === move.castle ? 0 : 1;
    // Castling written as a king move: Kg1, Kc8.
    const kingTo: Record<string, string[]> = { K: ["g1", "g8"], Q: ["c1", "c8"] };
    if (move.castle && !reading.castle && reading.piece === "K") {
      return kingTo[move.castle].includes(reading.to) ? 0.3 : Infinity;
    }
    return Infinity;
  }
  let cost = 0;
  if (reading.piece !== move.piece) {
    // A missing piece letter (f3 for Nf3) is a smaller slip than a wrong one.
    cost += reading.pieceWritten ? 1 : 0.8;
  }
  const [rf, rr] = reading.to;
  const [mf, mr] = move.to;
  if (rf !== mf) cost += confusable(rf, mf, FILE_CONFUSIONS) ? 0.6 : 1;
  if (rr !== mr) cost += confusable(rr, mr, RANK_CONFUSIONS) ? 0.6 : 1;
  // SAN only names the origin when it must; compare what both sides state.
  if (reading.fromFile && move.fromFile && reading.fromFile !== move.fromFile) cost += 0.5;
  if (reading.fromRank && move.fromRank && reading.fromRank !== move.fromRank) cost += 0.5;
  if (reading.capture && !move.capture) cost += 0.3;
  if (!reading.capture && move.capture) cost += 0.15;
  if ((reading.promo ?? null) !== (move.promo ?? null)) cost += 0.5;
  return cost;
}

/** Check and mate marks in the handwriting, compared with the actual move. */
export function markerCost(written: string, san: string): number {
  const t = written.trim();
  const wroteMate = /(#|\+\+|‡)$/.test(t);
  const wroteCheck = !wroteMate && /(\+|†|ch)$/.test(t);
  const isMate = san.endsWith("#");
  const isCheck = san.endsWith("+");
  if (wroteMate && !isMate) return 0.3;
  if (wroteCheck && !isCheck && !isMate) return 0.15;
  return 0;
}

function confusableChar(a: string, b: string): boolean {
  return confusable(a, b, FILE_CONFUSIONS) || confusable(a, b, RANK_CONFUSIONS);
}

/**
 * Distance between a partly legible reading and a legal move, for readings
 * with _ for characters that could not be made out (N_3, _xd4) or that do not
 * parse as SAN. A weighted edit distance: _ matches any one character for
 * 0.25, easily confused characters cost 0.6, anything else 1. Capture marks
 * are ignored, since players often leave them out.
 */
export function patternDistance(pattern: string, san: string): number {
  const a = pattern.replace(/x/g, "");
  const b = cleanMoveText(san).replace(/x/g, "");
  const sub = (p: string, q: string) => (p === q ? 0 : p === "_" ? 0.25 : confusableChar(p, q) ? 0.6 : 1);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub(a[i - 1], b[j - 1]));
    }
    prev = cur;
  }
  return prev[b.length];
}

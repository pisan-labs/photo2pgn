// Replays the moves read from a scoresheet and repairs misreadings.
//
// Claude reads the handwriting; this module decides what is legal. Each ply
// can be the primary reading, one of Claude's alternatives, the raw written
// text in the sheet's own notation, a legal move about one misread character
// away, or (for a blank or unreadable cell) any legal move. Each choice has a
// cost; a small beam search keeps the cheapest paths and gives up on a ply
// when continuing would cost more than leaving the rest for the person.
// Anything other than the primary reading is flagged for review; nothing is
// changed silently.
import { Chess } from "chess.js";
import type { MoveRow, PlyReading } from "./schema";
import { cleanMoveText, markerCost, moveVariants, parseMove, readingDistance, type ParsedMove } from "./notation";

export type PlyStatus = "ok" | "unsure" | "fixed" | "illegal" | "unchecked";
export type ChoiceSource = "edit" | "reading" | "alternative" | "written" | "near-miss" | "guess";

export interface PlyInput {
  moveNumber: number;
  color: "w" | "b";
  reading: PlyReading | null; // null: the cell was empty
}

export interface PlyResult extends PlyInput {
  index: number;
  status: PlyStatus;
  san: string | null; // the legal move chosen, canonical SAN
  source: ChoiceSource | null;
  note: string;
  fenBefore: string | null;
  fenAfter: string | null;
  suggestions: string[]; // legal moves worth offering in a picker
}

export interface Analysis {
  plies: PlyResult[];
  legalCount: number; // plies before the first one that could not be made legal
  stoppedAt: number | null; // index of that ply
  finalFen: string;
  endState: "checkmate" | "stalemate" | null;
}

// Costs. A full character misread is about 1.
const COST = {
  readingUnclear: 0.1,
  written: 0.3,
  alternative: 0.4, // + 0.1 per rank in Claude's list
  nearMiss: { clear: 1.5, unclear: 1.0, illegible: 0.5 },
  guess: 2.5,
  // Choosing anything but a legal, clearly written move.
  overrideClear: 2,
  // Giving up at a ply and leaving it for the person: about one fix too many.
  stop: 4,
};
const NEAR_MISS_LIMIT = 1.2;
const BEAM_WIDTH = 48;
const BEAM_WIDTH_AFTER_GUESS = 600;

/** Flatten scoresheet rows into plies, dropping trailing empty cells. */
export function rowsToPlies(rows: MoveRow[]): PlyInput[] {
  const sorted = [...rows].sort((a, b) => a.number - b.number);
  const plies: PlyInput[] = [];
  for (const row of sorted) {
    plies.push({ moveNumber: row.number, color: "w", reading: row.white });
    plies.push({ moveNumber: row.number, color: "b", reading: row.black });
  }
  while (plies.length && isBlank(plies[plies.length - 1].reading)) plies.pop();
  return plies;
}

function isBlank(r: PlyReading | null): boolean {
  return !r || (!r.san.trim() && !r.written.trim());
}

interface Candidate {
  san: string;
  cost: number;
  source: ChoiceSource;
}

interface BeamState {
  fen: string;
  cost: number;
  choices: Candidate[];
}

/** The SAN chess.js gives for the first variant that is legal, or null. */
function legalSan(chess: Chess, texts: string[]): string | null {
  for (const t of texts) {
    try {
      const m = chess.move(t);
      chess.undo();
      return m.san;
    } catch {
      // not legal in this position
    }
  }
  return null;
}

function candidatesFor(fen: string, ply: PlyInput, lang: string, edit: string | undefined): Candidate[] {
  const chess = new Chess(fen);
  const legal = chess.moves();
  if (legal.length === 0) return [];

  if (edit !== undefined) {
    // The person's own entry is final: legal or not, nothing else is tried.
    const san = legalSan(chess, moveVariants(edit, "en"));
    return san ? [{ san, cost: 0, source: "edit" }] : [];
  }

  const r = ply.reading;
  const out = new Map<string, Candidate>();
  const add = (san: string, cost: number, source: ChoiceSource) => {
    const marks = r ? markerCost(r.written || r.san, san) : 0;
    const prev = out.get(san);
    if (!prev || prev.cost > cost + marks) out.set(san, { san, cost: cost + marks, source });
  };

  const legibility = r?.legibility ?? "illegible";
  const primary = r && r.san.trim() ? legalSan(chess, moveVariants(r.san, "en")) : null;
  const override = primary && legibility === "clear" ? COST.overrideClear : 0;

  if (primary) add(primary, legibility === "clear" ? 0 : COST.readingUnclear, "reading");
  if (r) {
    r.alternatives.slice(0, 3).forEach((alt, k) => {
      const san = legalSan(chess, moveVariants(alt, "en"));
      if (san) add(san, override + COST.alternative + 0.1 * k, "alternative");
    });
    if (r.written.trim()) {
      const san = legalSan(chess, moveVariants(r.written, lang));
      if (san) add(san, override + COST.written, "written");
    }
  }
  // A clear, legal reading: a near miss would cost more than stopping, so
  // only Claude's own alternatives compete with it.
  if (override) return [...out.values()].sort((a, b) => a.cost - b.cost);

  // Near misses: legal moves about one character away from what was read.
  const readings: ParsedMove[] = [];
  if (r) {
    for (const t of [r.san, ...r.alternatives]) for (const v of moveVariants(t, "en")) readings.push(parseMove(v)!);
    for (const v of moveVariants(r.written, lang)) readings.push(parseMove(v)!);
  }
  const parsedReadings = readings.filter(Boolean);
  if (parsedReadings.length) {
    for (const san of legal) {
      const m = parseMove(cleanMoveText(san));
      if (!m) continue;
      const d = Math.min(...parsedReadings.map((p) => readingDistance(p, m)));
      if (d <= NEAR_MISS_LIMIT) add(san, override + COST.nearMiss[legibility] + d, "near-miss");
    }
  }

  // A blank or unreadable cell: any legal move is possible, and the moves
  // after it decide.
  if (isBlank(r) || legibility === "illegible" || !r!.san.trim()) {
    for (const san of legal) add(san, COST.guess, "guess");
  }

  return [...out.values()].sort((a, b) => a.cost - b.cost);
}

function noteFor(ply: PlyInput, c: Candidate): string {
  const read = ply.reading?.san || ply.reading?.written || "";
  switch (c.source) {
    case "edit":
      return "Entered by you.";
    case "reading":
      return ply.reading?.legibility === "clear" ? "" : `Handwriting unclear; read as ${c.san}.`;
    case "alternative":
      return `Read as "${read}"; the alternative reading ${c.san} fits the game better.`;
    case "written":
      return `Used the move as written ("${ply.reading?.written}") in the sheet's notation: ${c.san}.`;
    case "near-miss":
      return `Read as "${read}", which does not fit here; ${c.san} is the closest legal move.`;
    case "guess":
      return `The cell was blank or unreadable; ${c.san} fits the moves that follow.`;
  }
}

function statusFor(c: Candidate, ply: PlyInput): PlyStatus {
  if (c.source === "edit") return "ok";
  if (c.source === "reading") return ply.reading?.legibility === "clear" ? "ok" : "unsure";
  return "fixed";
}

/** Legal moves to offer in a picker: the closest readings first. */
function suggestionsFor(fen: string, ply: PlyInput, lang: string): string[] {
  const sans = candidatesFor(fen, ply, lang, undefined)
    .filter((c) => c.source !== "guess")
    .slice(0, 6)
    .map((c) => c.san);
  for (const s of new Chess(fen).moves()) if (!sans.includes(s)) sans.push(s);
  return sans;
}

/** Replay using only the primary readings and edits. Null if any ply fails. */
function primaryPath(plies: PlyInput[], start: string, edits: Record<number, string>): Candidate[] | null {
  const chess = new Chess(start);
  const out: Candidate[] = [];
  for (let i = 0; i < plies.length; i++) {
    const r = plies[i].reading;
    const text = edits[i] ?? (r && r.legibility !== "illegible" ? r.san : "");
    const san = text.trim() ? legalSan(chess, moveVariants(text, "en")) : null;
    if (!san) return null;
    chess.move(san);
    out.push({ san, cost: 0, source: edits[i] !== undefined ? "edit" : "reading" });
  }
  return out;
}

function search(plies: PlyInput[], start: string, lang: string, edits: Record<number, string>) {
  let beam: BeamState[] = [{ fen: start, cost: 0, choices: [] }];
  let stopped: { state: BeamState; at: number; total: number } | null = null;

  for (let i = 0; i < plies.length; i++) {
    const next: BeamState[] = [];
    const seen = new Map<string, number>();
    let guessed = false;
    for (const state of beam) {
      const cands = candidatesFor(state.fen, plies[i], lang, edits[i]);
      if (cands.length === 0) {
        const total = state.cost + COST.stop;
        if (!stopped || total < stopped.total) stopped = { state, at: i, total };
        continue;
      }
      const hasGuess = cands.some((c) => c.source === "guess");
      guessed ||= hasGuess;
      for (const c of hasGuess ? cands : cands.slice(0, 8)) {
        const chess = new Chess(state.fen);
        chess.move(c.san);
        const fen = chess.fen();
        const cost = state.cost + c.cost;
        // Two paths reaching the same position: keep the cheaper.
        const at = seen.get(fen);
        if (at !== undefined && next[at].cost <= cost) continue;
        const s: BeamState = { fen, cost, choices: [...state.choices, c] };
        if (at !== undefined) next[at] = s;
        else {
          seen.set(fen, next.length);
          next.push(s);
        }
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    // Drop paths that already cost more than giving up would.
    const ceiling = Math.min(stopped?.total ?? Infinity, (next[0]?.cost ?? 0) + COST.stop);
    beam = next.filter((s) => s.cost <= ceiling).slice(0, guessed ? BEAM_WIDTH_AFTER_GUESS : BEAM_WIDTH);
    if (beam.length === 0) break;
  }

  const finished = beam[0];
  if (finished && finished.choices.length === plies.length && (!stopped || finished.cost <= stopped.total)) {
    return { choices: finished.choices, stoppedAt: null };
  }
  return { choices: stopped!.state.choices, stoppedAt: stopped!.at };
}

/**
 * Replay the plies, choosing the cheapest legal reading for each.
 * `edits` maps ply index to a move the person typed.
 */
export function analyzeGame(
  plies: PlyInput[],
  opts: { lang?: string; edits?: Record<number, string>; startFen?: string } = {},
): Analysis {
  const lang = opts.lang ?? "en";
  const edits = opts.edits ?? {};
  const start = new Chess(opts.startFen).fen();

  const fast = primaryPath(plies, start, edits);
  const { choices, stoppedAt } = fast ? { choices: fast, stoppedAt: null } : search(plies, start, lang, edits);

  const results: PlyResult[] = [];
  const replay = new Chess(start);
  plies.forEach((ply, index) => {
    const c = choices[index];
    if (c) {
      const fenBefore = replay.fen();
      replay.move(c.san);
      const status = statusFor(c, ply);
      results.push({
        ...ply,
        index,
        status,
        san: c.san,
        source: c.source,
        note: noteFor(ply, c),
        fenBefore,
        fenAfter: replay.fen(),
        suggestions: status === "ok" ? [] : suggestionsFor(fenBefore, ply, lang),
      });
    } else if (index === stoppedAt) {
      const fenBefore = replay.fen();
      const read = edits[index] ?? (ply.reading?.san || ply.reading?.written || "");
      const over = replay.isCheckmate()
        ? " The game is already checkmate."
        : replay.isStalemate()
          ? " The game is already stalemate."
          : "";
      results.push({
        ...ply,
        index,
        status: "illegal",
        san: null,
        source: null,
        note: `"${read || "(blank)"}" is not a legal move here and no close reading fits.${over}`,
        fenBefore,
        fenAfter: null,
        suggestions: over ? [] : suggestionsFor(fenBefore, ply, lang),
      });
    } else {
      results.push({
        ...ply,
        index,
        status: "unchecked",
        san: null,
        source: null,
        note: "Not checked yet: fix the move marked in red first.",
        fenBefore: null,
        fenAfter: null,
        suggestions: [],
      });
    }
  });

  return {
    plies: results,
    legalCount: choices.length,
    stoppedAt,
    finalFen: replay.fen(),
    endState: replay.isCheckmate() ? "checkmate" : replay.isStalemate() ? "stalemate" : null,
  };
}

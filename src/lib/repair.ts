// Replays the moves read from a scoresheet and repairs misreadings, including
// sheets in very poor handwriting.
//
// Claude reads the handwriting; this module decides what is legal. For each
// ply the candidates are, from cheapest to dearest:
//   - the primary reading (exact match against the legal moves),
//   - one of Claude's alternative readings, or the text as written in the
//     sheet's own notation,
//   - a near miss: a legal move about one or two misread characters away,
//     including partial readings with _ for unreadable characters,
//   - a guess: any legal move, priced by how far it is from what was read.
// A beam search keeps the cheapest paths. When even the best path needs an
// expensive fix, the search backtracks: it tries changing earlier moves that
// could explain the failure (the same side's moves with that piece, and the
// last few plies), even clearly read legal ones, since a confident misreading
// often only breaks a move several plies later. Guesses among equally
// distant moves prefer natural ones (recaptures, captures, checks). Stopping
// is priced per unplayed ply, so a guess that makes the rest of the game
// legal wins; fixes that come in clusters cost extra, so a chain of fixes
// through garbage loses to stopping and asking the person. Players also
// skip or repeat moves when writing, which shifts every later move into the
// other column; so a cell can be left out, or a missing move inserted
// before it, when its reading does not fit and the moves after it then do.
// Every choice other than the primary reading is flagged for review.
import { Chess } from "chess.js";
import type { MoveRow, PlyReading } from "./schema";
import {
  cleanMoveText,
  markerCost,
  moveVariants,
  parseMove,
  patternDistance,
  readingDistance,
  type ParsedMove,
} from "./notation";

export type PlyStatus = "ok" | "unsure" | "fixed" | "skipped" | "illegal" | "unchecked";
export type ChoiceSource =
  | "edit"
  | "reading"
  | "alternative"
  | "written"
  | "near-miss"
  | "guess"
  | "backtrack"
  | "skip";

export interface PlyInput {
  moveNumber: number; // in the game (1. e4 e5 2. ...), whatever the sheet says
  sheetNumber: number; // the row number written on the sheet
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
  suggestions: string[]; // legal moves worth offering in a picker, best first
  support: number; // for a fixed move: how many following moves fit as read
  label: string | null; // the move's number in the game, "12." or "12..."
  // A move missing from the sheet, played just before this cell's move.
  inserted: { san: string; label: string; fenBefore: string; fenAfter: string } | null;
}

export interface Analysis {
  plies: PlyResult[];
  legalCount: number; // plies before the first one left unplayed
  stoppedAt: number | null; // index of that ply
  finalFen: string;
  endState: "checkmate" | "stalemate" | null;
}

type Legibility = PlyReading["legibility"];

// Costs. A full misread character is about 1.
const COST = {
  readingUnclear: 0.1,
  ambiguous: 0.3, // the reading fits two legal moves (Nd7 with knights on b8 and f6)
  written: 0.3,
  alternative: 0.4, // + 0.1 per rank in Claude's list
  // A clear reading that needs fixing is rarer than an unclear one.
  nearMiss: { clear: 2.5, unclear: 1.0, illegible: 0.5 } as Record<Legibility, number>,
  nearMissLimit: { clear: 1.2, unclear: 2.0, illegible: 3.0 } as Record<Legibility, number>,
  guess: { clear: 5.0, unclear: 3.0, illegible: 2.5 } as Record<Legibility, number>,
  guessPerDistance: 0.5,
  guessDistanceCap: 4,
  // Changing a legal, clearly read move (only while backtracking).
  override: 2,
  // A fix within CLUSTER_PLIES of the previous fix: garbage, not handwriting.
  cluster: 2,
  // Each ply left unplayed when the search gives up.
  stopPerPly: 1,
  // A cell that is not a move in the game (repeated or extra on the sheet).
  skip: 3.5,
  // A move missing from the sheet, before this cell (+ the natural-move prior).
  insert: 4,
};
const SHIFT_STATES = 6; // paths on which skipping or inserting is tried
const CLUSTER_PLIES = 2;
const MAX_BACKTRACKS = 12;
const RECENT_PLIES = 4; // always reconsidered when backtracking
// A backtracked path is kept in the beam this many plies even if it looks
// dearer: the path it competes with has not paid for its later fixes yet.
const PROTECT_PLIES = 10;
const PROTECTED_SLOTS = 8;
const EXACT = 0.15; // a missing x is still an exact reading
const TROUBLE = 2; // a step this expensive makes the search backtrack
const WINDOW = 20; // how far back backtracking looks
const BEAM_WIDTH = 48;
const BEAM_WIDTH_BLANK = 200; // after a blank cell many moves nearly tie
const GUESSES_FOR_LEGAL = 10; // guesses tried for a legal but doubtful reading

/** Flatten scoresheet rows into plies, dropping trailing empty cells. */
export function rowsToPlies(rows: MoveRow[]): PlyInput[] {
  const sorted = [...rows].sort((a, b) => a.number - b.number);
  const plies: PlyInput[] = [];
  for (const row of sorted) {
    for (const [color, reading] of [
      ["w", row.white],
      ["b", row.black],
    ] as const) {
      plies.push({ moveNumber: Math.floor(plies.length / 2) + 1, sheetNumber: row.number, color, reading });
    }
  }
  while (plies.length && isBlank(plies[plies.length - 1].reading)) plies.pop();
  return plies;
}

function isBlank(r: PlyReading | null): boolean {
  return !r || (!r.san.trim() && !r.written.trim());
}

// ---- readings, prepared once per ply ----

interface ReadingInfo {
  legibility: Legibility;
  blank: boolean;
  primary: ParsedMove[];
  alternatives: ParsedMove[][];
  written: ParsedMove[];
  all: ParsedMove[]; // every parsed variant, for distances
  patterns: string[]; // partial or unparseable readings, for patternDistance
  marks: string; // where check and mate signs are read from
  text: string; // for notes
}

function parseAll(text: string, lang: string): { parsed: ParsedMove[]; patterns: string[] } {
  const parsed: ParsedMove[] = [];
  const patterns: string[] = [];
  for (const v of moveVariants(text, lang)) {
    const p = parseMove(v);
    if (p) parsed.push(p);
    else if (/[a-h1-8_]/.test(v)) patterns.push(v);
  }
  return { parsed, patterns };
}

function prepare(r: PlyReading | null, lang: string): ReadingInfo {
  if (!r) {
    return { legibility: "illegible", blank: true, primary: [], alternatives: [], written: [], all: [], patterns: [], marks: "", text: "" };
  }
  const primary = parseAll(r.san, "en");
  const alternatives = r.alternatives.slice(0, 5).map((a) => parseAll(a, "en"));
  const written = parseAll(r.written, lang);
  const legibility: Legibility = r.san.trim() ? r.legibility : "illegible";
  return {
    legibility,
    blank: isBlank(r) || (legibility === "illegible" && !primary.parsed.length && !written.patterns.length && !written.parsed.length),
    primary: primary.parsed,
    alternatives: alternatives.map((a) => a.parsed),
    written: written.parsed,
    all: [...primary.parsed, ...alternatives.flatMap((a) => a.parsed), ...written.parsed],
    patterns: [...new Set([...primary.patterns, ...alternatives.flatMap((a) => a.patterns), ...written.patterns])],
    marks: r.written || r.san,
    text: r.san || r.written,
  };
}

// ---- positions, cached by FEN ----

interface Position {
  fen: string;
  sans: string[];
  parsed: (ParsedMove | null)[];
}

class Positions {
  private cache = new Map<string, Position>();
  get(fen: string): Position {
    let p = this.cache.get(fen);
    if (!p) {
      const sans = new Chess(fen).moves();
      p = { fen, sans, parsed: sans.map((s) => parseMove(cleanMoveText(s))) };
      this.cache.set(fen, p);
    }
    return p;
  }
}

/** Legal moves that a reading names exactly. */
function exact(pos: Position, readings: ParsedMove[]): number[] {
  const out: number[] = [];
  pos.parsed.forEach((m, i) => {
    if (m && readings.some((r) => readingDistance(r, m) <= EXACT)) out.push(i);
  });
  return out;
}

function distanceTo(info: ReadingInfo, m: ParsedMove | null, san: string): number {
  let d = Infinity;
  if (m) for (const r of info.all) d = Math.min(d, readingDistance(r, m));
  for (const p of info.patterns) d = Math.min(d, patternDistance(p, san));
  return d;
}

// ---- candidates for one ply in one position ----

interface Candidate {
  san: string; // "" for a skipped cell
  cost: number;
  source: ChoiceSource;
  insert?: string; // a missing move played first
  skip?: boolean;
}

/** The person's entry: "-" leaves the cell out; "e5 Nf6" inserts e5 first. */
export function parseEdit(edit: string): { skip: true } | { moves: string[] } {
  const t = edit.trim();
  if (t === "-" || t === "–" || t === "—") return { skip: true };
  return { moves: t.split(/[\s,]+/).filter(Boolean).slice(0, 2) };
}

function exactSans(pos: Position, text: string): string[] {
  const e = prepare({ written: text, san: text, alternatives: [], legibility: "clear" }, "en");
  return exact(pos, e.primary).map((i) => pos.sans[i]);
}

function editCandidates(pos: Position, edit: string, positions: Positions): Candidate[] {
  const e = parseEdit(edit);
  if ("skip" in e) return [{ san: "", cost: 0, source: "edit", skip: true }];
  if (e.moves.length === 0) return [];
  if (e.moves.length === 1) return exactSans(pos, e.moves[0]).map((san) => ({ san, cost: 0, source: "edit" }));
  const out: Candidate[] = [];
  for (const first of exactSans(pos, e.moves[0])) {
    for (const san of exactSans(positions.get(play(pos.fen, first)), e.moves[1])) {
      out.push({ san, cost: 0, source: "edit", insert: first });
    }
  }
  return out;
}

/** The position after a candidate (a skipped cell leaves it unchanged). */
function apply(fen: string, c: Candidate): string {
  if (c.skip) return fen;
  const chess = new Chess(fen);
  if (c.insert) chess.move(c.insert);
  chess.move(c.san);
  return chess.fen();
}

/**
 * A small preference among guesses for natural moves, so that ties between
 * equally distant guesses (above all for blank cells) break sensibly.
 */
function prior(m: ParsedMove | null, san: string, lastTo: string | null, moveNumber: number): number {
  let p = 0;
  if (san.endsWith("#")) p -= 1;
  else if (san.endsWith("+")) p -= 0.2;
  if (!m) return p;
  if (m.castle) return p - 0.3;
  if (m.capture) p -= m.to === lastTo ? 0.8 : 0.3; // recaptures most of all
  if (m.piece === "K") p += 0.5;
  if (m.piece === "Q" && moveNumber <= 8) p += 0.3;
  return p;
}

interface Where {
  lastTo: string | null; // destination of the previous ply
  moveNumber: number;
}

function candidates(
  pos: Position,
  info: ReadingInfo,
  edit: string | undefined,
  backtracking: boolean,
  where: Where,
  positions: Positions,
  allGuesses = false,
): { cands: Candidate[]; blankGuess: boolean } {
  // The person's own entry is final: legal or not, nothing else is tried.
  if (edit !== undefined) return { cands: editCandidates(pos, edit, positions), blankGuess: false };
  if (pos.sans.length === 0) return { cands: [], blankGuess: false };

  const out = new Map<string, Candidate>();
  const add = (i: number, cost: number, source: ChoiceSource) => {
    const san = pos.sans[i];
    const total = cost + markerCost(info.marks, san);
    const prev = out.get(san);
    if (!prev || prev.cost > total) out.set(san, { san, cost: total, source });
  };

  const leg = info.legibility;
  const primary = exact(pos, info.primary);
  const clearLegal = primary.length > 0 && leg === "clear";
  const override = clearLegal ? COST.override : 0;

  const extra = primary.length > 1 ? COST.ambiguous : 0;
  for (const i of primary) add(i, (leg === "clear" ? 0 : COST.readingUnclear) + extra, "reading");
  info.alternatives.forEach((alt, k) => {
    for (const i of exact(pos, alt)) add(i, override + COST.alternative + 0.1 * k, "alternative");
  });
  for (const i of exact(pos, info.written)) add(i, override + COST.written, "written");

  // A clear, legal reading only competes with Claude's own alternatives,
  // except while backtracking.
  if (clearLegal && !backtracking) return { cands: sorted(out), blankGuess: false };

  const natural = (i: number) => prior(pos.parsed[i], pos.sans[i], where.lastTo, where.moveNumber);
  if (info.blank) {
    pos.sans.forEach((_, i) => add(i, COST.guess.illegible + natural(i), "guess"));
    return { cands: sorted(out), blankGuess: true };
  }

  const fix: ChoiceSource = override ? "backtrack" : "near-miss";
  const dist = pos.sans.map((san, i) => distanceTo(info, pos.parsed[i], san));
  dist.forEach((d, i) => {
    if (d <= COST.nearMissLimit[leg]) add(i, override + COST.nearMiss[leg] + d, fix);
  });

  // Guesses, closest first. For a legal but doubtful reading only a few.
  let order = pos.sans.map((_, i) => i).sort((a, b) => dist[a] - dist[b]);
  if (primary.length > 0 && !allGuesses) order = order.slice(0, GUESSES_FOR_LEGAL);
  for (const i of order) {
    const d = Math.min(dist[i], COST.guessDistanceCap);
    add(i, override + COST.guess[leg] + COST.guessPerDistance * d + natural(i), override ? "backtrack" : "guess");
  }
  return { cands: sorted(out), blankGuess: false };
}

function sorted(m: Map<string, Candidate>): Candidate[] {
  return [...m.values()].sort((a, b) => a.cost - b.cost);
}

// ---- the search ----

interface Node {
  fen: string;
  cost: number;
  cand: Candidate | null;
  parent: Node | null;
  depth: number; // plies played
  lastFix: number; // ply index of the most recent fix, or -99
  protectUntil: number; // kept in the beam up to this ply (backtracked paths)
}

interface Ctx {
  plies: PlyInput[];
  infos: ReadingInfo[];
  edits: Record<number, string>;
  positions: Positions;
  best: { node: Node; at: number; total: number } | null; // the cheapest place to give up
}

const FIXES = new Set<ChoiceSource>(["near-miss", "guess", "backtrack", "skip"]);

function giveUp(ctx: Ctx, node: Node, at: number) {
  const total = node.cost + COST.stopPerPly * (ctx.plies.length - at);
  if (!ctx.best || total < ctx.best.total) ctx.best = { node, at, total };
}

function lastTo(node: Node): string | null {
  const m = node.cand ? parseMove(cleanMoveText(node.cand.san)) : null;
  return m && !m.castle ? m.to : null;
}

function where(ctx: Ctx, node: Node): Where {
  return { lastTo: lastTo(node), moveNumber: ctx.plies[node.depth]?.moveNumber ?? 1 };
}

function candidatesAt(ctx: Ctx, node: Node, backtracking: boolean, allGuesses = false) {
  const i = node.depth;
  const pos = ctx.positions.get(node.fen);
  return candidates(pos, ctx.infos[i], ctx.edits[i], backtracking, where(ctx, node), ctx.positions, allGuesses);
}

/**
 * When a cell's reading is not legal here, the sheet may be shifted: try
 * leaving the cell out, or inserting a missing move before it so that the
 * reading becomes legal. The moves after it decide whether the shift holds.
 */
function shiftCandidates(ctx: Ctx, node: Node): Candidate[] {
  const i = node.depth;
  const info = ctx.infos[i];
  if (ctx.edits[i] !== undefined || info.blank) return [];
  const pos = ctx.positions.get(node.fen);
  if (exact(pos, info.primary).length > 0) return [];
  const read = info.legibility === "clear" ? 0 : COST.readingUnclear;
  const w = where(ctx, node);
  const inserts: Candidate[] = [];
  pos.sans.forEach((g, gi) => {
    const after = ctx.positions.get(play(node.fen, g));
    for (const m of exact(after, info.primary)) {
      const cost = COST.insert + read + prior(pos.parsed[gi], g, w.lastTo, w.moveNumber);
      inserts.push({ san: after.sans[m], cost, source: "reading", insert: g });
    }
  });
  const skip: Candidate = { san: "", cost: COST.skip, source: "skip", skip: true };
  return [skip, ...inserts.sort((a, b) => a.cost - b.cost).slice(0, 8)];
}

/** The extra cost of a candidate given the path so far (clustered fixes). */
function isFix(ctx: Ctx, i: number, c: Candidate): boolean {
  if (c.source === "edit" || ctx.infos[i].blank) return false;
  return FIXES.has(c.source) || Boolean(c.insert) || Boolean(c.skip);
}

function pathCost(ctx: Ctx, node: Node, c: Candidate): number {
  const i = node.depth;
  const fix = isFix(ctx, i, c);
  return fix && i - node.lastFix <= CLUSTER_PLIES ? COST.cluster : 0;
}

function child(ctx: Ctx, node: Node, c: Candidate, fen: string): Node {
  const fix = isFix(ctx, node.depth, c);
  return {
    fen,
    cost: node.cost + c.cost + pathCost(ctx, node, c),
    cand: c,
    parent: node,
    depth: node.depth + 1,
    lastFix: fix ? node.depth : node.lastFix,
    protectUntil: node.protectUntil,
  };
}

function play(fen: string, san: string): string {
  const chess = new Chess(fen);
  chess.move(san);
  return chess.fen();
}

/** Advance a beam by one ply. Builds positions only for the paths it keeps. */
function step(ctx: Ctx, beam: Node[], i: number): { next: Node[]; width: number } {
  const proposals: { parent: Node; cand: Candidate; cost: number }[] = [];
  let blank = false;
  beam.forEach((node, rank) => {
    // Stopping here (ply i left for the person) is always an option.
    giveUp(ctx, node, i);
    const { cands, blankGuess } = candidatesAt(ctx, node, false);
    blank ||= blankGuess;
    const shifts = rank < SHIFT_STATES ? shiftCandidates(ctx, node) : [];
    for (const c of [...cands, ...shifts]) {
      proposals.push({ parent: node, cand: c, cost: node.cost + c.cost + pathCost(ctx, node, c) });
    }
  });
  proposals.sort((a, b) => a.cost - b.cost);
  const width = blank ? BEAM_WIDTH_BLANK : BEAM_WIDTH;
  const ceiling = ctx.best?.total ?? Infinity;
  const next: Node[] = [];
  const seen = new Set<string>();
  const boards = new Map<Node, Chess>();
  const extend = (p: (typeof proposals)[number]) => {
    let fen: string;
    if (p.cand.skip || p.cand.insert) fen = apply(p.parent.fen, p.cand);
    else {
      let chess = boards.get(p.parent);
      if (!chess) boards.set(p.parent, (chess = new Chess(p.parent.fen)));
      chess.move(p.cand.san);
      fen = chess.fen();
      chess.undo();
    }
    if (seen.has(fen)) return false; // a cheaper path already reached it
    seen.add(fen);
    next.push(child(ctx, p.parent, p.cand, fen));
    return true;
  };
  for (const p of proposals) {
    if (next.length >= width || p.cost >= ceiling) break;
    extend(p);
  }
  // Protected paths keep their cheapest continuation.
  const extended = new Set(next.map((n) => n.parent));
  for (const p of proposals) {
    if (p.parent.protectUntil < i || extended.has(p.parent) || p.cost >= ceiling) continue;
    if (extend(p)) extended.add(p.parent);
  }
  return { next, width };
}

/**
 * Ply j is in trouble on the path ending at `node`. Try changing one earlier
 * move that could be to blame, replay the plies after it as read, and keep
 * the paths on which ply j then reads cheaply.
 */
function backtrack(ctx: Ctx, node: Node, j: number, budget: number): Node[] {
  const target = ctx.infos[j].primary[0] ?? ctx.infos[j].alternatives.find((a) => a.length)?.[0];
  if (!target) return [];
  const chain: Node[] = [];
  for (let n: Node | null = node; n; n = n.parent) chain.unshift(n); // chain[k]: before ply k
  const side = ctx.plies[j].color;
  const blamed = (k: number) => {
    if (k >= j - RECENT_PLIES) return true;
    if (ctx.plies[k].color !== side) return false;
    const san = chain[k + 1].cand!.san;
    const m = san ? parseMove(cleanMoveText(san)) : null;
    if (!m || m.castle || target.castle) return Boolean(m?.castle && target.castle);
    return m.piece === target.piece || m.to === target.to;
  };

  const found: Node[] = [];
  for (let k = j - 1; k >= Math.max(0, j - WINDOW); k--) {
    if (ctx.edits[k] !== undefined || !blamed(k)) continue;
    const was = chain[k + 1].cand!.san;
    // Every legal move is worth a try here: only the replay decides.
    const options = candidatesAt(ctx, chain[k], true, true).cands.filter((c) => c.san !== was);
    for (const c of options) {
      let cur = { ...child(ctx, chain[k], c, apply(chain[k].fen, c)), protectUntil: j + PROTECT_PLIES };
      if (cur.cost >= budget) continue;
      // Replay the plies after k as read, then ply j.
      for (let m = k + 1; m <= j && cur; m++) {
        const next = candidatesAt(ctx, cur, false).cands[0];
        if (!next || (m === j && next.cost >= TROUBLE)) {
          cur = null as unknown as Node;
          break;
        }
        cur = child(ctx, cur, next, apply(cur.fen, next));
        if (cur.cost >= budget) {
          cur = null as unknown as Node;
          break;
        }
      }
      if (cur) found.push(cur);
    }
  }
  return found.sort((a, b) => a.cost - b.cost).slice(0, PROTECTED_SLOTS);
}

function merge(a: Node[], b: Node[], width: number): Node[] {
  const byFen = new Map<string, Node>();
  for (const n of [...a, ...b]) {
    const prev = byFen.get(n.fen);
    if (!prev || n.cost < prev.cost) byFen.set(n.fen, n);
  }
  return [...byFen.values()].sort((x, y) => x.cost - y.cost).slice(0, width);
}

function path(node: Node): Candidate[] {
  const out: Candidate[] = [];
  for (let n: Node | null = node; n?.cand; n = n.parent) out.push(n.cand);
  return out.reverse();
}

function search(ctx: Ctx, start: string): { choices: Candidate[]; stoppedAt: number | null } {
  const n = ctx.plies.length;
  let beam: Node[] = [{ fen: start, cost: 0, cand: null, parent: null, depth: 0, lastFix: -99, protectUntil: -1 }];
  let backtracks = 0;
  let reached = 0;

  for (let i = 0; i < n && beam.length; i++) {
    const before = beam[0];
    let { next, width } = step(ctx, beam, i);
    // Never rewrite earlier moves to make the person's own entry fit: if it
    // is not legal, say so at that move.
    const trouble = next.length === 0 || next[0].cost - before.cost >= TROUBLE;
    if (trouble && ctx.edits[i] === undefined && backtracks < MAX_BACKTRACKS) {
      backtracks++;
      const found = backtrack(ctx, before, i, ctx.best?.total ?? Infinity);
      next = merge(next, found, width + found.length);
    }
    const ceiling = ctx.best?.total ?? Infinity;
    beam = next.filter((node) => node.cost < ceiling);
    reached = i + 1;
  }

  const done = beam.length && reached === n ? beam[0] : null;
  if (done && (!ctx.best || done.cost <= ctx.best.total)) return { choices: path(done), stoppedAt: null };
  if (ctx.best) return { choices: path(ctx.best.node), stoppedAt: ctx.best.at };
  return { choices: [], stoppedAt: 0 };
}

/** Replay using only the primary readings and edits. Null if any ply fails. */
function primaryPath(ctx: Ctx, start: string): Candidate[] | null {
  const chess = new Chess(start);
  const out: Candidate[] = [];
  for (let i = 0; i < ctx.plies.length; i++) {
    const pos = ctx.positions.get(chess.fen());
    const edit = ctx.edits[i];
    const info = ctx.infos[i];
    let matches: number[];
    if (edit !== undefined) {
      const e = parseEdit(edit);
      if (!("moves" in e) || e.moves.length !== 1) return null; // a skip or an insert: search
    }
    if (edit !== undefined) matches = exact(pos, prepare({ written: edit, san: edit, alternatives: [], legibility: "clear" }, "en").primary);
    else if (info.legibility === "illegible") return null;
    else matches = exact(pos, info.primary);
    if (matches.length !== 1) return null;
    const san = pos.sans[matches[0]];
    chess.move(san);
    out.push({ san, cost: 0, source: edit !== undefined ? "edit" : "reading" });
  }
  return out;
}

// ---- results ----

function noteFor(info: ReadingInfo, c: Candidate, support: number): string {
  const read = info.text;
  const fits = support > 0 ? ` The next ${support} move${support > 1 ? "s" : ""} fit as read.` : "";
  if (c.skip) {
    return c.source === "edit"
      ? "Left out by you."
      : `Left out of the game: "${read}" does not fit here, and the moves after it fit without it (a repeated or extra entry on the sheet?).${fits}`;
  }
  const missing = c.insert
    ? `A move seems to be missing from the sheet before this one; ${c.insert} (not on the sheet) fits. `
    : "";
  switch (c.source) {
    case "edit":
      return c.insert ? `Entered by you, with ${c.insert} before it.` : "Entered by you.";
    case "reading":
      return missing
        ? `${missing}Then "${read}" reads as ${c.san}.${fits}`
        : info.legibility === "clear"
          ? ""
          : `Handwriting unclear; read as ${c.san}.`;
    case "alternative":
      return `${missing}Read as "${read}"; the alternative reading ${c.san} fits the game.${fits}`;
    case "written":
      return `${missing}Used the move as written ("${read}") in the sheet's notation: ${c.san}.${fits}`;
    case "near-miss":
      return `Read as "${read}", which does not fit here; ${c.san} is the closest legal move.${fits}`;
    case "backtrack":
      return `Read as "${read}", which is legal, but the moves after it only fit ${c.san}.${fits}`;
    case "guess":
      return info.blank
        ? `The cell was blank or unreadable; ${c.san} is a guess.${fits}`
        : `Read as "${read}", which does not fit here; ${c.san} is a guess.${fits}`;
    case "skip":
      return "";
  }
}

function statusFor(c: Candidate, info: ReadingInfo): PlyStatus {
  if (c.skip) return "skipped";
  if (c.source === "edit") return "ok";
  if (c.insert) return "fixed";
  if (c.source === "reading") return info.legibility === "clear" && c.cost < COST.ambiguous ? "ok" : "unsure";
  return "fixed";
}

/** "12." or "12..." for the side to move in a position. */
function labelOf(chess: Chess): string {
  return `${chess.moveNumber()}${chess.turn() === "w" ? "." : "..."}`;
}

/** Legal moves to offer in a picker, closest to the reading first. */
function suggestionsFor(ctx: Ctx, fen: string, i: number): string[] {
  const pos = ctx.positions.get(fen);
  const w = { lastTo: null, moveNumber: ctx.plies[i].moveNumber };
  const first = candidates(pos, ctx.infos[i], undefined, true, w, ctx.positions)
    .cands.slice(0, 8)
    .map((c) => c.san);
  return [...new Set([...first, ...pos.sans])];
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
  const start = new Chess(opts.startFen).fen();
  const ctx: Ctx = {
    plies,
    infos: plies.map((p) => prepare(p.reading, lang)),
    edits: opts.edits ?? {},
    positions: new Positions(),
    best: null,
  };

  const fast = primaryPath(ctx, start);
  const { choices, stoppedAt } = fast ? { choices: fast, stoppedAt: null } : search(ctx, start);

  // How many cells after each one were played exactly as read.
  const clean = (c: Candidate) => (c.source === "reading" || c.source === "edit") && !c.insert && !c.skip;
  const support = choices.map(() => 0);
  for (let i = choices.length - 2; i >= 0; i--) {
    support[i] = clean(choices[i + 1]) ? 1 + support[i + 1] : 0;
  }

  const results: PlyResult[] = [];
  const replay = new Chess(start);
  plies.forEach((ply, index) => {
    const c = choices[index];
    const info = ctx.infos[index];
    if (c) {
      let inserted: PlyResult["inserted"] = null;
      if (c.insert) {
        const fenBefore = replay.fen();
        const label = labelOf(replay);
        replay.move(c.insert);
        inserted = { san: replay.history().at(-1) ?? c.insert, label, fenBefore, fenAfter: replay.fen() };
      }
      const fenBefore = replay.fen();
      const label = c.skip ? null : labelOf(replay);
      if (!c.skip) replay.move(c.san);
      const status = statusFor(c, info);
      results.push({
        ...ply,
        index,
        status,
        san: c.skip ? null : c.san,
        source: c.source,
        note: noteFor(info, c, support[index]),
        fenBefore,
        fenAfter: c.skip ? fenBefore : replay.fen(),
        suggestions: status === "ok" ? [] : suggestionsFor(ctx, inserted?.fenBefore ?? fenBefore, index),
        support: status === "fixed" || status === "skipped" ? support[index] : 0,
        label,
        inserted,
      });
    } else if (index === stoppedAt) {
      const fenBefore = replay.fen();
      const read = ctx.edits[index] ?? info.text;
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
        note: over
          ? `"${read || "(blank)"}" comes after the end of the game.${over}`
          : ctx.edits[index] !== undefined
            ? `"${read}" is not a legal move here. Pick one of the legal moves below.`
            : `"${read || "(blank)"}" does not fit here, and the moves after it do not settle what it was. Pick the right move: the closest are listed first.`,
        fenBefore,
        fenAfter: null,
        suggestions: over ? [] : suggestionsFor(ctx, fenBefore, index),
        support: 0,
        label: labelOf(replay),
        inserted: null,
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
        support: 0,
        label: null,
        inserted: null,
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

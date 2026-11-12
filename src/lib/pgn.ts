// PGN export (PGN standard, section 8: export format).
import type { GameHeaders } from "./schema";
import type { Analysis } from "./repair";


export function escapeTagValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n\t]+/g, " ").trim();
}

function escapeComment(v: string): string {
  return v.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** Coerce a date to YYYY.MM.DD with ?? for unknown parts. */
export function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (!s) return "????.??.??";
  if (/^(\d{4}|\?{4})\.(\d{2}|\?{2})\.(\d{2}|\?{2})$/.test(s)) return s;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}.${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}`;
  // Day first, as on most scoresheets outside the US: 14.03.2026, 14/3/26.
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}.${m[2].padStart(2, "0")}.${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{4})$/.exec(s);
  if (m) return `${m[1]}.??.??`;
  return "????.??.??";
}

export interface PgnOptions {
  /** Add a {comment} after each move that was corrected or guessed. */
  commentFixes?: boolean;
}

export function buildTags(h: GameHeaders): [string, string][] {
  const value = (v: string) => (v.trim() ? v.trim() : "?");
  const tags: [string, string][] = [
    ["Event", value(h.event)],
    ["Site", value(h.site)],
    ["Date", normalizeDate(h.date)],
    ["Round", value(h.round)],
    ["White", value(h.white)],
    ["Black", value(h.black)],
    ["Result", h.result || "*"],
  ];
  if (h.board.trim()) tags.push(["Board", h.board.trim()]);
  if (/^\d+$/.test(h.whiteElo.trim())) tags.push(["WhiteElo", h.whiteElo.trim()]);
  if (/^\d+$/.test(h.blackElo.trim())) tags.push(["BlackElo", h.blackElo.trim()]);
  return tags;
}

/** Build the PGN text for the legal part of the game. */
export function buildPgn(headers: GameHeaders, analysis: Analysis, opts: PgnOptions = {}): string {
  const tags = buildTags(headers);
  const result = tags.find(([k]) => k === "Result")![1];
  const lines = tags.map(([k, v]) => `[${k} "${escapeTagValue(v)}"]`);

  const tokens: string[] = [];
  let needNumber = true;
  // Numbers come from the game ("12..." for Black), not from the sheet, which
  // may be shifted by a skipped or missing move.
  const emit = (label: string, san: string, comment: string | null) => {
    if (label.endsWith("...")) {
      if (needNumber) tokens.push(label);
    } else tokens.push(label);
    tokens.push(san);
    needNumber = false;
    if (comment) {
      tokens.push(`{${escapeComment(comment)}}`);
      needNumber = true; // a black move after a comment repeats its number
    }
  };
  for (const p of analysis.plies) {
    if (p.status === "illegal" || p.status === "unchecked") break;
    const fixed = opts.commentFixes && p.status !== "ok" && p.status !== "unsure";
    if (p.inserted) emit(p.inserted.label, p.inserted.san, fixed ? "Not on the sheet." : null);
    if (p.san && p.label) emit(p.label, p.san, fixed && p.note ? p.note : null);
  }
  if (analysis.stoppedAt !== null) {
    const where = analysis.plies[analysis.stoppedAt].label ?? "here";
    tokens.push(`{Moves from ${where} on could not be read as legal moves.}`);
  }
  tokens.push(result);

  // Wrap movetext at 79 characters; never split a token, except comments,
  // which may break at spaces.
  const words = tokens.flatMap((t) => (t.startsWith("{") ? t.split(" ") : [t]));
  const movetext: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > 79) {
      movetext.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) movetext.push(line);

  return `${lines.join("\n")}\n\n${movetext.join("\n")}\n`;
}

/** A file name like Carlsen-Nepomniachtchi-2026.03.14.pgn */
export function pgnFileName(h: GameHeaders): string {
  const part = (s: string) =>
    s
      .split(",")[0]
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "")
      .slice(0, 30);
  const white = part(h.white) || "White";
  const black = part(h.black) || "Black";
  const date = normalizeDate(h.date).replace(/\?/g, "").replace(/\.+$/, "");
  return `${white}-${black}${date ? "-" + date : ""}.pgn`;
}

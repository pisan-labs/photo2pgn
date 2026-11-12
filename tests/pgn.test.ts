import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { analyzeGame, rowsToPlies } from "../src/lib/repair";
import { buildPgn, normalizeDate, pgnFileName } from "../src/lib/pgn";
import { OPERA_GAME, extraction, rowsFrom } from "./helpers";

describe("normalizeDate", () => {
  it.each([
    ["", "????.??.??"],
    ["2026.03.14", "2026.03.14"],
    ["2026-3-4", "2026.03.04"],
    ["14.03.2026", "2026.03.14"],
    ["14/3/26", "2026.03.14"],
    ["2026", "2026.??.??"],
    ["1858.??.??", "1858.??.??"],
    ["March 2026", "????.??.??"],
  ])("%s -> %s", (raw, want) => expect(normalizeDate(raw)).toBe(want));
});

describe("buildPgn", () => {
  const ex = extraction(rowsFrom(OPERA_GAME));
  const analysis = analyzeGame(rowsToPlies(ex.rows));

  it("writes the seven tag roster in order and a parseable game", () => {
    const pgn = buildPgn(ex.headers, analysis);
    const tagNames = [...pgn.matchAll(/^\[(\w+) /gm)].map((m) => m[1]);
    expect(tagNames.slice(0, 7)).toEqual(["Event", "Site", "Date", "Round", "White", "Black", "Result"]);
    expect(pgn).toContain('[Round "?"]');
    expect(pgn.trim().endsWith("Rd8# 1-0")).toBe(true);

    const chess = new Chess();
    chess.loadPgn(pgn);
    expect(chess.isCheckmate()).toBe(true);
    expect(chess.getHeaders().White).toBe("Morphy, Paul");
  });

  it("wraps movetext under 80 characters", () => {
    const pgn = buildPgn(ex.headers, analysis);
    const movetext = pgn.split("\n\n")[1];
    for (const line of movetext.split("\n")) expect(line.length).toBeLessThan(80);
  });

  it("escapes quotes and backslashes in tags", () => {
    const pgn = buildPgn({ ...ex.headers, event: 'The "Big" One \\ 2026' }, analysis);
    expect(pgn).toContain('[Event "The \\"Big\\" One \\\\ 2026"]');
  });

  it("adds Elo tags only when they are numbers", () => {
    const pgn = buildPgn({ ...ex.headers, whiteElo: "2100", blackElo: "n/a" }, analysis);
    expect(pgn).toContain('[WhiteElo "2100"]');
    expect(pgn).not.toContain("BlackElo");
  });

  it("comments corrected moves when asked, and still parses", () => {
    const rows = rowsFrom(OPERA_GAME, { 7: { san: "Bxf4", written: "Bxf4" } });
    const a = analyzeGame(rowsToPlies(rows));
    const pgn = buildPgn(ex.headers, a, { commentFixes: true });
    expect(pgn).toContain("{Read as");
    expect(pgn).toMatch(/\} 5\. Qxf3/);
    const chess = new Chess();
    chess.loadPgn(pgn);
    expect(chess.isCheckmate()).toBe(true);
  });

  it("stops at the first unreadable move with a comment", () => {
    // A move the person entered that is not legal stops the game there.
    const a = analyzeGame(rowsToPlies(rowsFrom(OPERA_GAME)), { edits: { 10: "Bd4" } });
    const pgn = buildPgn({ ...ex.headers, result: "*" }, a);
    expect(pgn.replace(/\s+/g, " ")).toContain("{Moves from 6. on could not be read as legal moves.} *");
    const chess = new Chess();
    chess.loadPgn(pgn);
    expect(chess.history()).toHaveLength(10);
  });
});

describe("pgnFileName", () => {
  it("builds a safe name from players and date", () => {
    expect(pgnFileName({ ...extraction([]).headers, white: "Müller, Jörg", black: "O'Neil", date: "2026.03.14" })).toBe(
      "Muller-ONeil-2026.03.14.pgn",
    );
    expect(pgnFileName({ ...extraction([]).headers, white: "", black: "", date: "" })).toBe("White-Black.pgn");
    expect(pgnFileName({ ...extraction([]).headers, date: "1858.??.??" })).toBe("Morphy-DukeKarlCountIsouard-1858.pgn");
  });
});

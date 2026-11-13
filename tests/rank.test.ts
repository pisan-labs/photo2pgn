// The other moves offered for one move, most likely first.
import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { analyzeGame, rankMoves, rowsToPlies } from "../src/lib/repair";
import { DEMO_EXTRACTION } from "../src/demo/sample";
import { rowsFrom, OPERA_GAME } from "./helpers";

describe("rankMoves", () => {
  it("offers every other legal move, without the one chosen", () => {
    const plies = rowsToPlies(rowsFrom(OPERA_GAME));
    const a = analyzeGame(plies);
    const r = rankMoves(plies, a, 10);
    const legal = new Chess(a.plies[10].fenBefore!).moves();
    expect(r).not.toContain(a.plies[10].san);
    expect(new Set(r)).toEqual(new Set(legal.filter((m) => m !== a.plies[10].san)));
  });

  it("puts what was written first when the engine chose another move", () => {
    // 3. d4 written as an unclear c4: the engine plays d4, and c4 is the first alternative.
    const plies = rowsToPlies(rowsFrom(OPERA_GAME, { 4: { written: "c4", san: "c4", legibility: "unclear" } }));
    const a = analyzeGame(plies);
    expect(a.plies[4].san).toBe("d4");
    expect(rankMoves(plies, a, 4)[0]).toBe("c4");
  });

  it("ranks moves like the reading first, and the moves after them decide between those", () => {
    const plies = rowsToPlies(DEMO_EXTRACTION.rows);
    const a = analyzeGame(plies);
    // 14...Qe6, unclear: the likeliest others are queen moves too.
    expect(rankMoves(plies, a, 27).slice(0, 3).every((m) => m.startsWith("Q"))).toBe(true);
    // 17. R_8: rook moves on the d-file before anything else.
    expect(rankMoves(plies, a, 32)[0]).toMatch(/^R/);
  });

  it("has nothing to offer for the only legal move, the start, or a move not checked yet", () => {
    const plies = rowsToPlies(DEMO_EXTRACTION.rows);
    const a = analyzeGame(plies);
    expect(rankMoves(plies, a, 31)).toEqual([]); // 16...Nxb8, forced
    expect(rankMoves(plies, a, -1)).toEqual([]);
    const stopped = analyzeGame(rowsToPlies(rowsFrom(OPERA_GAME)), { edits: { 10: "Bd4" } });
    expect(rankMoves(rowsToPlies(rowsFrom(OPERA_GAME)), stopped, 20)).toEqual([]);
  });
});

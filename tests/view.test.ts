// What the game viewer's board shows at each step.
import { describe, expect, it } from "vitest";
import { analyzeGame, rowsToPlies } from "../src/lib/repair";
import { START, START_FEN, boardView, manyFixes, moveSquares, plyLabel, stepTo } from "../src/lib/view";
import { rowsFrom, OPERA_GAME } from "./helpers";

const opera = analyzeGame(rowsToPlies(rowsFrom(OPERA_GAME)));

describe("boardView", () => {
  it("starts from the starting position and shows each move played, with its squares", () => {
    expect(boardView(opera, START)).toEqual({ fen: START_FEN, lastMove: null, caption: "Starting position", editable: false });
    const first = boardView(opera, 0);
    expect(first.caption).toBe("After 1. e4");
    expect(first.lastMove).toEqual({ from: "e2", to: "e4" });
    expect(first.fen).toBe(opera.plies[0].fenAfter);
    expect(boardView(opera, opera.plies.length - 1).caption).toBe("After 17. Rd8#");
  });

  it("shows the position before a move when it is being changed on the board", () => {
    const v = boardView(opera, 1, true);
    expect(v).toMatchObject({ fen: opera.plies[1].fenBefore, editable: true, caption: "Black to move: tap a piece, then its square" });
  });

  it("stops at a move that needs fixing, and says so for the moves after it", () => {
    // The person's own edit is final, so an illegal one (6. Bd4) stops the game there.
    const bad = analyzeGame(rowsToPlies(rowsFrom(OPERA_GAME)), { edits: { 10: "Bd4" } });
    expect(bad.stoppedAt).toBe(10);
    expect(boardView(bad, 10)).toMatchObject({ fen: bad.plies[10].fenBefore, editable: false, caption: "Before 6., White to move" });
    expect(boardView(bad, bad.plies.length - 1)).toMatchObject({ fen: bad.finalFen, caption: "Not checked yet: fix the move in red (6.) first" });
  });

  it("shows where an entry was left out", () => {
    const skipped = { ...opera, plies: opera.plies.map((p, i) => (i === 3 ? { ...p, status: "skipped" as const, san: null, fenAfter: null } : p)) };
    expect(boardView(skipped, 3)).toMatchObject({ caption: "Position when the entry was left out", fen: opera.plies[3].fenBefore });
    // Not editable on the board: nothing was played there.
    expect(boardView(skipped, 3, true).editable).toBe(false);
  });
});

describe("helpers", () => {
  it("keeps steps between the start and the last move", () => {
    expect(stepTo(opera, -5)).toBe(START);
    expect(stepTo(opera, 3)).toBe(3);
    expect(stepTo(opera, 999)).toBe(opera.plies.length - 1);
  });
  it("labels moves and finds their squares", () => {
    expect(plyLabel(opera.plies[1])).toBe("1...");
    expect(plyLabel({ ...opera.plies[2], label: null })).toBe("2.");
    expect(moveSquares(START_FEN, "Nf3")).toEqual({ from: "g1", to: "f3" });
    expect(moveSquares(START_FEN, "Nf6")).toBeNull();
    expect(moveSquares(null, "e4")).toBeNull();
  });
});

describe("many fixes", () => {
  it("warns when a quarter of the moves were changed or guessed", () => {
    expect(manyFixes(opera)).toBe(false);
    const mark = (k: number) => ({ ...opera, plies: opera.plies.map((p, i) => (i < k ? { ...p, status: i % 2 ? ("guess" as const) : ("fixed" as const) } : p)) });
    expect(manyFixes(mark(8))).toBe(false); // 8 of 33
    expect(manyFixes(mark(9))).toBe(true); // 9 of 33
    expect(manyFixes({ ...opera, plies: opera.plies.slice(0, 4).map((p) => ({ ...p, status: "guess" as const })) })).toBe(false); // too short to tell
  });
});

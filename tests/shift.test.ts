// Sheets where the player skipped or repeated a move, so every later move
// sits in the other column.
import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { analyzeGame, rowsToPlies } from "../src/lib/repair";
import { buildPgn } from "../src/lib/pgn";
import { OPERA_GAME, extraction, rowsFrom } from "./helpers";

const analyze = (sans: string[], edits: Record<number, string> = {}) =>
  analyzeGame(rowsToPlies(rowsFrom(sans)), { edits });

function pgnMoves(a: ReturnType<typeof analyzeGame>): string[] {
  const chess = new Chess();
  chess.loadPgn(buildPgn(extraction([]).headers, a));
  return chess.history();
}

describe("shifted sheets", () => {
  it("inserts a move the player forgot to write", () => {
    // 5...dxe5 is missing: from there every move is in the wrong column.
    const sheet = [...OPERA_GAME.slice(0, 9), ...OPERA_GAME.slice(10)];
    const a = analyze(sheet);
    expect(a.stoppedAt).toBeNull();
    expect(a.plies[9]).toMatchObject({ san: "Bc4", status: "fixed" });
    expect(a.plies[9].inserted).toMatchObject({ san: "dxe5", label: "5..." });
    expect(a.plies[9].label).toBe("6.");
    expect(a.plies[9].note).toContain("missing from the sheet");
    expect(pgnMoves(a)).toEqual(OPERA_GAME);
    expect(a.endState).toBe("checkmate");
  });

  it("leaves out a move written twice", () => {
    const sheet = [...OPERA_GAME.slice(0, 12), "Qb3", ...OPERA_GAME.slice(12)];
    const a = analyze(sheet);
    expect(a.stoppedAt).toBeNull();
    const skipped = a.plies.filter((p) => p.status === "skipped");
    expect(skipped).toHaveLength(1);
    expect([12, 13]).toContain(skipped[0].index);
    expect(pgnMoves(a)).toEqual(OPERA_GAME);
  });

  it("does not shift a clean game", () => {
    const a = analyze(OPERA_GAME);
    expect(a.plies.every((p) => p.status === "ok" && !p.inserted)).toBe(true);
  });

  it("takes '-' as 'leave this cell out' and 'e5 Nf6' as an inserted move", () => {
    const repeated = [...OPERA_GAME.slice(0, 12), "Qb3", ...OPERA_GAME.slice(12)];
    const skipped = analyze(repeated, { 13: "-" });
    expect(skipped.plies[13]).toMatchObject({ status: "skipped", source: "edit", note: "Left out by you." });
    expect(pgnMoves(skipped)).toEqual(OPERA_GAME);

    const missing = [...OPERA_GAME.slice(0, 9), ...OPERA_GAME.slice(10)];
    const inserted = analyze(missing, { 9: "dxe5 Bc4" });
    expect(inserted.plies[9]).toMatchObject({ status: "ok", san: "Bc4", inserted: { san: "dxe5" } });
    expect(pgnMoves(inserted)).toEqual(OPERA_GAME);
  });

  it("numbers the PGN by the game, with a comment for the inserted move when asked", () => {
    const missing = [...OPERA_GAME.slice(0, 9), ...OPERA_GAME.slice(10)];
    const pgn = buildPgn(extraction([]).headers, analyze(missing), { commentFixes: true });
    expect(pgn.replace(/\s+/g, " ")).toContain("5. Qxf3 dxe5 {Not on the sheet.} 6. Bc4");
  });
});

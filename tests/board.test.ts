import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { sanFor } from "../src/components/Board";
import { analyzeGame, rowsToPlies } from "../src/lib/repair";
import { buildPgn } from "../src/lib/pgn";
import { OPERA_GAME, extraction, rowsFrom } from "./helpers";

describe("moves made on the board", () => {
  it("turns squares into SAN, or null when illegal", () => {
    const start = new Chess().fen();
    expect(sanFor(start, "g1", "f3")).toBe("Nf3");
    expect(sanFor(start, "e2", "e5")).toBeNull();
  });
  it("promotes to the piece asked for", () => {
    const fen = "8/P7/8/8/8/8/7k/K7 w - - 0 1";
    expect(sanFor(fen, "a7", "a8")).toBe("a8=Q");
    expect(sanFor(fen, "a7", "a8", "n")).toBe("a8=N");
  });
});

describe("notes", () => {
  it("go into the PGN as a comment before the first move, and it still parses", () => {
    const a = analyzeGame(rowsToPlies(rowsFrom(OPERA_GAME)));
    const pgn = buildPgn(extraction([]).headers, a, { notes: "Played at the opera {Paris}\nduring The Barber of Seville" });
    expect(pgn).toContain("{Played at the opera Paris during The Barber of Seville} 1. e4");
    const chess = new Chess();
    chess.loadPgn(pgn);
    expect(chess.isCheckmate()).toBe(true);
  });
});

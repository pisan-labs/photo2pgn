// The engine on real scoresheets the owner sent, transcribed as written.
import { describe, expect, it } from "vitest";
import { analyzeGame, rowsToPlies } from "../src/lib/repair";
import { rowsFrom } from "./helpers";
import { CHESSCOM_SHEET, DING_GUKESH_14 } from "./samples/sheets";

describe("real sheets", () => {
  it("World Championship 2024 game 14, captures written without x: the exact game, nothing flagged", () => {
    const a = analyzeGame(rowsToPlies(rowsFrom(DING_GUKESH_14.written)));
    expect(a.stoppedAt).toBeNull();
    expect(a.plies.map((p) => p.san)).toEqual(DING_GUKESH_14.truth);
    expect(a.plies.every((p) => p.status === "ok")).toBe(true);
  });

  it("a club sheet with recording slips: a legal game with the impossible entries flagged, nothing red", () => {
    const a = analyzeGame(rowsToPlies(rowsFrom(CHESSCOM_SHEET.written)));
    expect(a.stoppedAt).toBeNull();
    const flagged = a.plies.filter((p) => p.status !== "ok");
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.length).toBeLessThanOrEqual(3);
    // 22...Nxe4 cannot be played: Black has no knight left by then.
    expect(flagged.map((p) => p.index)).toContain(43);
  });
});

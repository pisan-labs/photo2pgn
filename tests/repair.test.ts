import { describe, expect, it } from "vitest";
import { analyzeGame, rowsToPlies } from "../src/lib/repair";
import { OPERA_GAME, rowsFrom } from "./helpers";

const analyze = (...args: Parameters<typeof rowsFrom>) => analyzeGame(rowsToPlies(rowsFrom(...args)));

describe("analyzeGame", () => {
  it("accepts a clean game and ends in checkmate", () => {
    const a = analyze(OPERA_GAME);
    expect(a.stoppedAt).toBeNull();
    expect(a.legalCount).toBe(OPERA_GAME.length);
    expect(a.plies.every((p) => p.status === "ok")).toBe(true);
    expect(a.endState).toBe("checkmate");
    expect(a.plies.at(-1)!.san).toBe("Rd8#");
  });

  it("fixes a near miss and flags it", () => {
    // 4. dxe5 misread as dxe6, which is not legal.
    const a = analyze(OPERA_GAME, { 6: { san: "dxe6", written: "dxe6" } });
    expect(a.stoppedAt).toBeNull();
    expect(a.plies[6]).toMatchObject({ san: "dxe5", status: "fixed", source: "near-miss" });
    expect(a.plies[6].note).toContain("dxe6");
  });

  it("finds an alternative nine moves before the move it breaks", () => {
    // 7. Qb3 read as Qd3: legal, but then 16. Qb8+ is impossible.
    const a = analyze(OPERA_GAME, { 12: { san: "Qd3", written: "Qd3", alternatives: ["Qb3"], legibility: "unclear" } });
    expect(a.stoppedAt).toBeNull();
    expect(a.plies[12]).toMatchObject({ san: "Qb3", status: "fixed", source: "alternative" });
  });

  it("keeps an unclear legal reading when the game still fits", () => {
    // 6...Nf6 read as Nh6 (legal); 7...Qe7 and everything after still work.
    const a = analyze(OPERA_GAME, { 11: { san: "Nh6", written: "Nh6", alternatives: ["Nf6"], legibility: "unclear" } });
    expect(a.plies[11].status === "unsure" || a.plies[11].status === "fixed").toBe(true);
    expect(a.stoppedAt).toBeNull();
  });

  it("prefers an alternative reading over a near miss", () => {
    // 4...Bxf3 read as Bxf4 (illegal); Claude also offered Bxf3.
    const a = analyze(OPERA_GAME, { 7: { san: "Bxf4", written: "Bxf4", alternatives: ["Bxf3"], legibility: "unclear" } });
    expect(a.plies[7]).toMatchObject({ san: "Bxf3", source: "alternative" });
  });

  it("does not change a clear mate to make a stray later move legal", () => {
    const a = analyze([...OPERA_GAME, "Ke7"]);
    expect(a.plies[OPERA_GAME.length - 1]).toMatchObject({ san: "Rd8#", status: "ok" });
    expect(a.stoppedAt).toBe(OPERA_GAME.length);
  });

  it("analyzes a game quickly", () => {
    const t = performance.now();
    analyze(OPERA_GAME, { 6: { san: "dxe6", written: "dxe6" }, 9: { san: "", written: "", legibility: "illegible" } });
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it("goes back and uses an alternative when a legal misreading breaks a later move", () => {
    // 6...Nf6 read as Nh6 (legal). Then 7...Qe7 is fine, but 12...Rd8 etc.
    // are fine too; use a move that only works with the right reading:
    // 3...Bg4 read as Be6 (legal), which makes 4...Bxf3 impossible.
    const a = analyze(OPERA_GAME, {
      5: { san: "Be6", written: "Be6", alternatives: ["Bg4"], legibility: "unclear" },
    });
    expect(a.stoppedAt).toBeNull();
    expect(a.plies[5]).toMatchObject({ san: "Bg4", status: "fixed", source: "alternative" });
    expect(a.plies[7].san).toBe("Bxf3");
  });

  it("reads castling written with zeros as clean", () => {
    const a = analyze(OPERA_GAME, { 22: { san: "0-0-0", written: "0-0-0" } });
    expect(a.plies[22]).toMatchObject({ san: "O-O-O", status: "ok" });
  });

  it("guesses a blank cell in the middle from the moves after it", () => {
    const a = analyze(OPERA_GAME, { 9: { san: "", written: "", legibility: "illegible" } });
    expect(a.stoppedAt).toBeNull();
    expect(a.plies[9]).toMatchObject({ san: "dxe5", status: "fixed", source: "guess" });
  });

  it("uses the written German text when the English reading is wrong", () => {
    const rows = rowsFrom(OPERA_GAME, { 2: { san: "Nf2", written: "Sf3" } });
    const a = analyzeGame(rowsToPlies(rows), { lang: "de" });
    expect(a.plies[2]).toMatchObject({ san: "Nf3", status: "fixed", source: "written" });
  });

  it("stops at a move nothing can repair and leaves the rest unchecked", () => {
    const a = analyze(OPERA_GAME, { 10: { san: "Ka5", written: "Ka5" } });
    expect(a.stoppedAt).toBe(10);
    expect(a.plies[10].status).toBe("illegal");
    expect(a.plies[10].suggestions.length).toBeGreaterThan(0);
    expect(a.plies[11].status).toBe("unchecked");
    expect(a.legalCount).toBe(10);
  });

  it("takes the person's edit as final", () => {
    const plies = rowsToPlies(rowsFrom(OPERA_GAME, { 10: { san: "Ka5" } }));
    const fixed = analyzeGame(plies, { edits: { 10: "Bc4" } });
    expect(fixed.stoppedAt).toBeNull();
    expect(fixed.plies[10]).toMatchObject({ san: "Bc4", status: "ok", source: "edit" });

    const wrong = analyzeGame(plies, { edits: { 10: "Bd4" } });
    expect(wrong.stoppedAt).toBe(10);
  });

  it("drops empty trailing cells", () => {
    const rows = rowsFrom(OPERA_GAME.slice(0, 5));
    expect(rows.at(-1)!.black).toBeNull();
    expect(rowsToPlies(rows)).toHaveLength(5);
  });

  it("flags moves written after checkmate", () => {
    const a = analyze([...OPERA_GAME, "Ke7"]);
    expect(a.stoppedAt).toBe(OPERA_GAME.length);
    expect(a.plies.at(-1)!.note).toContain("checkmate");
  });

  it("marks a legal but unclear reading as unsure", () => {
    const a = analyze(OPERA_GAME, { 0: { legibility: "unclear" } });
    expect(a.plies[0]).toMatchObject({ san: "e4", status: "unsure" });
  });
});

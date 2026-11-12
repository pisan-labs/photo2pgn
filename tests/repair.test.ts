import { describe, expect, it } from "vitest";
import { analyzeGame, rowsToPlies } from "../src/lib/repair";
import type { PlyReading } from "../src/lib/schema";
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
    expect(performance.now() - t).toBeLessThan(1500 * Number(process.env.PERF_FACTOR ?? 1));
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

  it("guesses a clearly written but impossible move when the rest of the game fits", () => {
    // 6. Bc4 written as "Ka5". Qa3 and Bc4 both lead to the same game, so
    // either is a fair guess; the right one must be offered.
    const a = analyze(OPERA_GAME, { 10: { san: "Ka5", written: "Ka5" } });
    expect(a.stoppedAt).toBeNull();
    expect(a.plies[10]).toMatchObject({ status: "fixed", source: "guess" });
    expect(a.plies[10].support).toBeGreaterThanOrEqual(20);
    expect(a.plies[10].suggestions).toContain("Bc4");
    expect(a.plies[10].note).toMatch(/next \d+ moves fit/);
  });

  it("stops instead of forcing a different game onto the sheet", () => {
    const OTHER = "c4 e6 Nc3 d5 cxd5 exd5 Bg5 Be7 e3 O-O Bd3 Nbd7 Qc2 Re8 Nge2 Nf8 O-O-O c6 h3 Qa5 Kb1 b5".split(" ");
    const a = analyze([...OPERA_GAME.slice(0, 10), ...OTHER]);
    expect(a.stoppedAt).not.toBeNull();
    expect(a.stoppedAt!).toBeLessThanOrEqual(12);
    expect(a.plies.filter((p) => p.status === "fixed")).toHaveLength(0);
    expect(a.plies[a.stoppedAt!].status).toBe("illegal");
    expect(a.plies[a.stoppedAt! + 1].status).toBe("unchecked");
  });

  it("reads a sheet in awful handwriting: every third move misread and unclear", () => {
    const swap: Record<string, string> = { "4": "6", "5": "3", "3": "8", "6": "5", f: "e", e: "c", d: "a", c: "e", b: "h", g: "a" };
    const misread: Record<number, Partial<PlyReading>> = {};
    OPERA_GAME.forEach((m, i) => {
      const k = [...m].findIndex((ch) => swap[ch] !== undefined);
      if (i % 3 !== 1 || k < 0) return;
      const w = m.slice(0, k) + swap[m[k]] + m.slice(k + 1);
      misread[i] = { san: w, written: w, legibility: "unclear" };
    });
    const t = performance.now();
    const a = analyze(OPERA_GAME, misread);
    expect(performance.now() - t).toBeLessThan(3000 * Number(process.env.PERF_FACTOR ?? 1));
    expect(a.stoppedAt).toBeNull();
    const idx = Object.keys(misread).map(Number);
    const right = idx.filter((i) => a.plies[i].san === OPERA_GAME[i].replace("#", "#")).length;
    expect(right).toBeGreaterThanOrEqual(idx.length - 1);
    // Every misread move is flagged for review, and the right move is offered.
    for (const i of idx) {
      expect(a.plies[i].status).not.toBe("ok");
      expect(a.plies[i].suggestions).toContain(OPERA_GAME[i]);
    }
  });

  it("uses partial readings with _ and guesses three blank cells in a row", () => {
    const a = analyze(OPERA_GAME, {
      4: { san: "", written: "_4", legibility: "illegible" }, // 3. d4
      13: { san: "", written: "Q_7", legibility: "illegible" }, // 7...Qe7
      18: { san: "", written: "", legibility: "illegible" }, // 10. Nxb5
      19: { san: "", written: "", legibility: "illegible" }, // 10...cxb5
      20: { san: "", written: "", legibility: "illegible" }, // 11. Bxb5+
    });
    expect(a.stoppedAt).toBeNull();
    expect([4, 13, 18, 19, 20].map((i) => a.plies[i].san)).toEqual(["d4", "Qe7", "Nxb5", "cxb5", "Bxb5+"]);
    expect(a.endState).toBe("checkmate");
  });

  it("backtracks to a clearly written legal move that breaks a later one", () => {
    // 3...Bg4 written clearly as Be6, no alternatives: 4...Bxf3 is then impossible.
    const a = analyze(OPERA_GAME, { 5: { san: "Be6", written: "Be6" } });
    expect(a.stoppedAt).toBeNull();
    expect(a.plies[5]).toMatchObject({ san: "Bg4", status: "fixed", source: "backtrack" });
    expect(a.plies.filter((p) => p.status === "fixed")).toHaveLength(1);
    expect(a.plies[5].note).toContain("legal, but the moves after it only fit Bg4");
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

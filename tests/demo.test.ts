import { describe, expect, it } from "vitest";
import { analyzeGame, rowsToPlies } from "../src/lib/repair";
import { DEMO_EXTRACTION } from "../src/demo/sample";

describe("demo game", () => {
  it("shows each review state", () => {
    const a = analyzeGame(rowsToPlies(DEMO_EXTRACTION.rows));
    expect(a.plies[6]).toMatchObject({ san: "dxe5", status: "fixed", source: "near-miss" });
    expect(a.plies[12]).toMatchObject({ san: "Qb3", status: "fixed", source: "alternative" });
    expect(a.plies[22]).toMatchObject({ san: "O-O-O", status: "ok" });
    expect(a.plies[27]).toMatchObject({ san: "Qe6", status: "unsure" });
    // 16...Ke7 is impossible, and Nxb8 the only legal move: taken, nothing else changed.
    expect(a.plies[29]).toMatchObject({ san: "Nxd7", status: "ok" });
    expect(a.plies[31]).toMatchObject({ san: "Nxb8", status: "fixed", source: "forced" });
    expect(a.plies[31].note).toContain("only legal move");
    // The smudged last move: no move after it can confirm it, so it is a guess
    // for the person to check, with the best guesses (mate first) to pick from.
    expect(a.stoppedAt).toBeNull();
    expect(a.plies[32]).toMatchObject({ san: "Rd8#", status: "guess" });
    expect(a.plies[32].suggestions[0]).toBe("Rd8#");
    expect(a.plies[32].suggestions.length).toBeGreaterThan(3);
    expect(a.plies[32].note).toContain("please check it");
    expect(a.endState).toBe("checkmate");
  });
  it("takes the person's pick as final", () => {
    const a = analyzeGame(rowsToPlies(DEMO_EXTRACTION.rows), { edits: { 32: "Rd8#" } });
    expect(a.plies[32]).toMatchObject({ status: "ok", source: "edit" });
    expect(a.plies.filter((p) => p.status === "guess")).toHaveLength(0);
  });
});

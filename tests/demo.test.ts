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
    // The smudged 16...Ke7, two plies from the end: too little game left to
    // back a guess, so it is left for the person, with Nxb8 offered first.
    expect(a.stoppedAt).toBe(31);
    expect(a.plies[31].status).toBe("illegal");
    expect(a.plies[31].suggestions[0]).toBe("Nxb8");
    expect(a.plies[32].status).toBe("unchecked");
  });
  it("finishes in checkmate once the red move is fixed", () => {
    const a = analyzeGame(rowsToPlies(DEMO_EXTRACTION.rows), { edits: { 31: "Nxb8" } });
    expect(a.stoppedAt).toBeNull();
    expect(a.plies[31]).toMatchObject({ status: "ok", source: "edit" });
    expect(a.endState).toBe("checkmate");
  });
});

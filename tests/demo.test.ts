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
    expect(a.stoppedAt).toBe(31);
    expect(a.plies[31].suggestions[0]).toBe("Nxb8");
    expect(a.plies[32].status).toBe("unchecked");
  });
  it("finishes in checkmate once the red move is fixed", () => {
    const a = analyzeGame(rowsToPlies(DEMO_EXTRACTION.rows), { edits: { 31: "Nxb8" } });
    expect(a.stoppedAt).toBeNull();
    expect(a.endState).toBe("checkmate");
  });
});

import { describe, expect, it } from "vitest";
import { cleanMoveText, markerCost, moveVariants, parseMove, readingDistance } from "../src/lib/notation";

describe("cleanMoveText", () => {
  it("normalizes castling written with zeros or letters", () => {
    expect(cleanMoveText("0-0")).toBe("O-O");
    expect(cleanMoveText("0-0-0")).toBe("O-O-O");
    expect(cleanMoveText("o-o")).toBe("O-O");
    expect(cleanMoveText("OOO")).toBe("O-O-O");
  });
  it("drops check, mate and annotation marks", () => {
    expect(cleanMoveText("Qb8+")).toBe("Qb8");
    expect(cleanMoveText("Rd8#")).toBe("Rd8");
    expect(cleanMoveText("Nf3!?")).toBe("Nf3");
    expect(cleanMoveText("exd6 e.p.")).toBe("exd6");
    expect(cleanMoveText("Bb5ch")).toBe("Bb5");
  });
  it("treats × and : as captures", () => {
    expect(cleanMoveText("B×f3")).toBe("Bxf3");
    expect(cleanMoveText("L:f3")).toBe("Lxf3");
  });
  it("normalizes promotion spellings", () => {
    expect(cleanMoveText("e8Q")).toBe("e8=Q");
    expect(cleanMoveText("e8(Q)")).toBe("e8=Q");
    expect(cleanMoveText("dxe1/N")).toBe("dxe1=N");
  });
});

describe("moveVariants", () => {
  it("translates German piece letters", () => {
    expect(moveVariants("Sf3", "de")[0]).toBe("Nf3");
    expect(moveVariants("Lb5", "de")[0]).toBe("Bb5");
    expect(moveVariants("Dxd8", "de")[0]).toBe("Qxd8");
    expect(moveVariants("e8D", "de")[0]).toBe("e8=Q");
  });
  it("translates French letters, where R is the king", () => {
    expect(moveVariants("Rf1", "fr")[0]).toBe("Kf1");
    expect(moveVariants("Cf3", "fr")[0]).toBe("Nf3");
    expect(moveVariants("Tf1", "fr")[0]).toBe("Rf1");
  });
  it("translates Russian letters", () => {
    expect(moveVariants("Кf3", "ru")[0]).toBe("Nf3");
    expect(moveVariants("Крe2", "ru")[0]).toBe("Ke2");
  });
  it("leaves English untouched and offers lower-case piece variants", () => {
    expect(moveVariants("Rf1", "en")[0]).toBe("Rf1");
    expect(moveVariants("nf3")).toContain("Nf3");
    expect(moveVariants("bxc3")).toEqual(["bxc3", "Bxc3"]);
    expect(moveVariants("Pe4")).toContain("e4");
    expect(moveVariants("ed5")).toContain("exd5");
  });
  it("returns nothing for blank text", () => {
    expect(moveVariants("  ")).toEqual([]);
  });
});

describe("parseMove and readingDistance", () => {
  const d = (reading: string, legal: string) => readingDistance(parseMove(reading)!, parseMove(legal)!);
  it("parses the parts of SAN", () => {
    expect(parseMove("Nbd7")).toMatchObject({ piece: "N", fromFile: "b", to: "d7", capture: false });
    expect(parseMove("exd5")).toMatchObject({ piece: "P", fromFile: "e", to: "d5", capture: true });
    expect(parseMove("O-O")).toEqual({ castle: "K" });
    expect(parseMove("hello")).toBeNull();
  });
  it("scores an exact match as 0", () => {
    expect(d("Nf3", "Nf3")).toBe(0);
  });
  it("scores a confusable rank lower than an arbitrary one", () => {
    expect(d("dxe6", "dxe5")).toBeLessThan(d("dxe2", "dxe5"));
    expect(d("dxe6", "dxe5")).toBeLessThanOrEqual(0.6);
  });
  it("treats a missing piece letter as a small slip", () => {
    expect(d("f3", "Nf3")).toBeLessThan(d("Bf3", "Nf3"));
  });
  it("matches castling written as a king move, not other king moves", () => {
    expect(d("Kg1", "O-O")).toBeLessThan(0.5);
    expect(d("O-O", "Kf1")).toBe(Infinity);
  });
});

describe("markerCost", () => {
  it("charges for a written mate that is not mate", () => {
    expect(markerCost("Rd8#", "Rd8")).toBeGreaterThan(0);
    expect(markerCost("Rd8#", "Rd8#")).toBe(0);
    expect(markerCost("Qb8+", "Qb8+")).toBe(0);
    expect(markerCost("Qb8+", "Qb8")).toBeGreaterThan(0);
    expect(markerCost("Nf3", "Nf3+")).toBe(0);
  });
});

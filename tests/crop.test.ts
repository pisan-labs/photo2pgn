import { describe, expect, it } from "vitest";
import { adjustCrop } from "../src/components/PhotoEditor";
import { FULL } from "../src/lib/image";

describe("adjustCrop", () => {
  it("moves a corner and keeps the box inside the photo", () => {
    expect(adjustCrop(FULL, "nw", 0.2, 0.1)).toEqual({ x: 0.2, y: 0.1, w: 0.8, h: 0.9 });
    expect(adjustCrop(FULL, "se", -0.3, -0.5)).toEqual({ x: 0, y: 0, w: 0.7, h: 0.5 });
    expect(adjustCrop(FULL, "ne", 0.5, -0.5)).toEqual(FULL);
  });
  it("never makes the box smaller than a tenth", () => {
    const c = adjustCrop(FULL, "se", -2, -2);
    expect(c.w).toBeCloseTo(0.1);
    expect(c.h).toBeCloseTo(0.1);
  });
  it("moves the whole box without leaving the photo", () => {
    const small = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    expect(adjustCrop(small, "move", 0.1, 0.1)).toEqual({ x: 0.30000000000000004, y: 0.30000000000000004, w: 0.5, h: 0.5 });
    expect(adjustCrop(small, "move", 1, -1)).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
  });
});

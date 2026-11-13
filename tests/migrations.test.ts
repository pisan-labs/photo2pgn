// Applied migrations never change (later changes go in a new file): each one
// is pinned to the sha256 of what was applied. 0003 was written by the Plabs
// session and copied here byte for byte from claude-built-apps 1b6fc57.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const APPLIED: [string, string][] = [
  ["0001_init.sql", "1832745baede240370edaa68bda49eb3b38ea7e13cc892e57e81b7eeed1bb3fc"],
  ["0002_games.sql", "eed2943bfacdf8f5103d651b3eab8cd96a7726de648428a065c53931563f14e9"],
  ["0003_admin_counts.sql", "4af07300acb6a6fbdd48a55f4e707a7b1dbc9ae5e22d89ce172c492c61710abf"],
];

describe("migrations", () => {
  for (const [file, sha] of APPLIED) {
    it(`${file} is exactly what was applied`, () => {
      expect(createHash("sha256").update(readFileSync(`supabase/migrations/${file}`)).digest("hex")).toBe(sha);
    });
  }
  it("has no other migration that is not pinned here", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()).toEqual(APPLIED.map(([f]) => f));
  });
});

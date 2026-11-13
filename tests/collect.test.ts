// Sheets read by the HintWise reader while the person was away: into My games.
import { describe, expect, it, vi } from "vitest";
import type { MyJob } from "../src/lib/api";
import { collectReadings, gameFromReading, sentAt } from "../src/lib/collect";
import { InMemoryRepository } from "../src/lib/repository";
import { Library, type SavedGame } from "../src/lib/library";
import { extraction, rowsFrom, OPERA_GAME } from "./helpers";

const EX = extraction(rowsFrom(OPERA_GAME));
const at = "2026-11-13T10:00:00.000Z";
const job = (id: string, partial: Partial<MyJob>): MyJob => ({ id, status: "queued", createdAt: at, updatedAt: at, imageCount: 1, ...partial });

describe("a reading as a game", () => {
  it("is saved under the job's id, untouched, with its PGN", () => {
    const g = gameFromReading("job-1", EX, EX.headers, new Date(at));
    expect(g).toMatchObject({ id: "job-1", title: "Morphy, Paul vs Duke Karl / Count Isouard, Paris Opera", updated_at: at });
    expect(g.game).toEqual({ headers: EX.headers, extraction: EX, edits: {}, notes: "" });
    expect(g.pgn).toContain("17. Rd8# 1-0");
  });
});

describe("collecting", () => {
  it("saves each finished reading, forgets it, and lists the waiting and the failed", async () => {
    const library = new Library(new InMemoryRepository<SavedGame>());
    const forget = vi.fn(async () => undefined);
    const list = vi.fn(async () => [
      job("wait", {}),
      job("busy", { status: "running" }),
      job("done", { status: "done", result: EX }),
      job("bad", { status: "error", error: { code: "reader_failed", message: "Too blurry." } }),
      job("gone", { status: "error", error: { code: "cancelled", message: "Cancelled." } }),
      job("blank", { status: "done", result: { ...EX, isScoresheet: false, rows: [], notes: "A shopping list." } }),
    ]);
    const r = await collectReadings({ token: "tok", list, forget, save: (g) => library.save(g), has: (id) => library.has(id) });
    expect(list).toHaveBeenCalledWith("tok");
    expect(r.saved.map((g) => g.id)).toEqual(["done"]);
    expect(await library.has("done")).toBe(true);
    expect(r.waiting.map((j) => j.id)).toEqual(["wait", "busy"]);
    expect(r.failed).toEqual([
      { id: "bad", createdAt: at, message: "Too blurry." },
      { id: "blank", createdAt: at, message: expect.stringContaining("Claude noted: A shopping list.") },
    ]);
    // The saved one and the cancelled one are forgotten; the failed ones wait to be dismissed.
    expect(forget.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["done", "gone"]);
  });

  it("never saves over a game already in My games, and keeps a Chess TD pairing", async () => {
    const save = vi.fn(async () => undefined);
    const forget = vi.fn(async () => {
      throw new Error("offline");
    });
    const done = [job("a", { status: "done", result: EX }), job("b", { status: "done", result: EX })];
    const r = await collectReadings({
      token: "tok",
      list: async () => done,
      forget,
      save,
      has: async (id) => id === "a", // saved on an earlier round, whose forget did not get through
      headersFor: (id, h) => (id === "b" ? { ...h, black: "Allies", round: "3" } : h),
    });
    expect(save).toHaveBeenCalledOnce();
    expect(r.saved[0].game.headers).toMatchObject({ black: "Allies", round: "3" });
    expect(r.saved[0].title).toBe("Morphy, Paul vs Allies, Paris Opera");
    expect(forget).toHaveBeenCalledTimes(2);
  });

  it("says something even without the reader's own message", async () => {
    const r = await collectReadings({
      token: "tok",
      list: async () => [job("x", { status: "error" }), job("y", { status: "done" })],
      forget: async () => undefined,
      save: async () => undefined,
    });
    expect(r.failed.map((f) => f.message)).toEqual(["The sheet could not be read.", expect.stringMatching(/^No moves were found[^]*unclear\.$/)]);
  });
});

describe("when it was sent", () => {
  it("gives the time today, and the day otherwise", () => {
    const now = new Date(2026, 10, 13, 15, 0);
    expect(sentAt(new Date(2026, 10, 13, 10, 42).toISOString(), now, "en-GB")).toBe("10:42");
    expect(sentAt(new Date(2026, 10, 10, 9, 5).toISOString(), now, "en-GB")).toBe("Tue 9:05");
  });
});

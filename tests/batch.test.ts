// Several scoresheets at once: each read on its own, a few at a time, saved in My games.
import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { batchSummary, readBatch, stopsBatch, type SheetState } from "../src/lib/batch";
import { CapReached } from "../src/lib/llm";
import { ApiError } from "../src/lib/api";
import { ReadFailed, type PhotoInput } from "../src/lib/read";
import type { ReadOutcome } from "../src/lib/reading";
import type { SavedGame } from "../src/lib/library";
import { extraction, rowsFrom, OPERA_GAME } from "./helpers";

const EX = extraction(rowsFrom(OPERA_GAME));
const at = "2026-11-15T10:00:00.000Z";
const photo = (data: string): PhotoInput => ({ mediaType: "image/jpeg", data });

function run(sheets: string[], read: (photos: PhotoInput[]) => Promise<ReadOutcome>, extra: { concurrency?: number; signal?: AbortSignal } = {}) {
  const states = new Map<number, SheetState[]>();
  const saved: SavedGame[] = [];
  const onStop = vi.fn();
  let id = 0;
  const done = readBatch(sheets, {
    photos: async (s) => [photo(s)],
    read,
    save: async (g) => saved.push(g),
    newId: () => `g${++id}`,
    onState: (i, st) => states.set(i, [...(states.get(i) ?? []), st]),
    onStop,
    now: () => new Date(at),
    ...extra,
  });
  const last = () => sheets.map((_, i) => states.get(i)?.at(-1)?.kind);
  return { done, states, saved, onStop, last };
}

describe("reading several sheets", () => {
  it("reads each sheet on its own and saves each game", async () => {
    const read = vi.fn(async (): Promise<ReadOutcome> => ({ kind: "read", extraction: EX }));
    const r = run(["a", "b", "c"], read);
    await r.done;
    expect(read.mock.calls.map((c) => (c as unknown as PhotoInput[][])[0][0].data)).toEqual(["a", "b", "c"]);
    expect(r.last()).toEqual(["ready", "ready", "ready"]);
    expect(r.states.get(0)?.map((s) => s.kind)).toEqual(["reading", "ready"]);
    expect(r.saved.map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
    expect(r.saved[0]).toMatchObject({ updated_at: at, game: { extraction: EX, edits: {} } });
    expect(r.onStop).not.toHaveBeenCalled();
  });

  it("reads no more than two at a time", async () => {
    let busy = 0;
    let most = 0;
    const read = async (): Promise<ReadOutcome> => {
      most = Math.max(most, ++busy);
      await new Promise((ok) => setTimeout(ok, 5));
      busy--;
      return { kind: "read", extraction: EX };
    };
    await run(["a", "b", "c", "d", "e"], read).done;
    expect(most).toBe(2);
    const one = run(["a", "b", "c"], read, { concurrency: 1 });
    most = 0;
    await one.done;
    expect(most).toBe(1);
  });

  it("keeps going past a sheet that cannot be read, and says why", async () => {
    const read = vi.fn(async (photos: PhotoInput[]): Promise<ReadOutcome> => {
      if (photos[0].data === "blurry") throw new ReadFailed("unreadable", "Claude did not return a transcription.");
      if (photos[0].data === "list") return { kind: "read", extraction: { ...EX, isScoresheet: false, rows: [], notes: "A shopping list." } };
      return { kind: "read", extraction: EX };
    });
    const r = run(["blurry", "list", "ok"], read, { concurrency: 1 });
    await r.done;
    expect(r.last()).toEqual(["failed", "failed", "ready"]);
    expect(r.states.get(0)?.at(-1)).toEqual({ kind: "failed", message: "Claude did not return a transcription." });
    expect(r.states.get(1)?.at(-1)).toMatchObject({ message: expect.stringContaining("Claude noted: A shopping list.") });
    expect(r.saved).toHaveLength(1);
    expect(r.onStop).not.toHaveBeenCalled();
  });

  it("stops the sheets not yet started when the credits run out", async () => {
    const cap = new CapReached("user-day", "2026-11-16T00:00:00Z");
    const read = vi.fn(async (photos: PhotoInput[]): Promise<ReadOutcome> => {
      if (photos[0].data === "b") throw cap;
      return { kind: "read", extraction: EX };
    });
    const r = run(["a", "b", "c", "d"], read, { concurrency: 1 });
    await r.done;
    expect(r.last()).toEqual(["ready", "failed", "skipped", "skipped"]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(r.onStop).toHaveBeenCalledExactlyOnceWith(cap);
  });

  it("hands sheets sent to the HintWise reader back as queued", async () => {
    const job = { jobId: "job-1", viewToken: "v", createdAt: at };
    const r = run(["a"], async () => ({ kind: "queued", job }));
    await r.done;
    expect(r.states.get(0)?.at(-1)).toEqual({ kind: "queued", job });
    expect(r.saved).toHaveLength(0);
  });

  it("starts no more sheets once stopped by the person", async () => {
    const ctrl = new AbortController();
    const read = vi.fn(async (): Promise<ReadOutcome> => {
      ctrl.abort();
      return { kind: "read", extraction: EX };
    });
    const r = run(["a", "b", "c"], read, { concurrency: 1, signal: ctrl.signal });
    await r.done;
    // The sheet already being read is kept: its credit is spent.
    expect(r.last()).toEqual(["ready", "skipped", "skipped"]);
  });

  it("does nothing for no sheets", async () => {
    const read = vi.fn();
    await run([], read).done;
    expect(read).not.toHaveBeenCalled();
  });
});

describe("what stops a batch", () => {
  it("is running out of credits or a rejected key, not one bad photo", () => {
    expect(stopsBatch(new CapReached("user-day", at))).toBe(true);
    expect(stopsBatch(new ApiError("limit_credits", "No credits to spare."))).toBe(true);
    expect(stopsBatch(new Anthropic.APIError(401, undefined, "bad key", undefined))).toBe(true);
    expect(stopsBatch(new Anthropic.APIError(429, undefined, "slow down", undefined))).toBe(false);
    expect(stopsBatch(new ReadFailed("unreadable", "No."))).toBe(false);
    expect(stopsBatch(new Error("offline"))).toBe(false);
  });
});

describe("the summary", () => {
  it("counts the read and the sent", () => {
    const g = { id: "x" } as SavedGame;
    expect(batchSummary([{ kind: "ready", game: g }, { kind: "failed", message: "no" }])).toBe("1 of 2 read");
    expect(batchSummary([{ kind: "ready", game: g }, { kind: "queued", job: { jobId: "j", viewToken: "v" } }])).toBe("1 of 2 read, 1 with the HintWise reader");
  });
});

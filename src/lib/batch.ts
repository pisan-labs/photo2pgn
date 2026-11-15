// Several scoresheets at once. Each sheet (one game, on one or two photos) is
// read on its own, a few at a time, and each game read in the page is saved
// in My games at once; a sheet sent to the HintWise reader arrives there
// later (collect.ts). Each sheet costs one credit. Running out of credits, or
// a rejected key, stops the sheets not yet started.
import Anthropic from "@anthropic-ai/sdk";
import type { QueuedJob } from "./api";
import { gameFromReading, noMovesMessage } from "./collect";
import type { SavedGame } from "./library";
import type { PhotoInput } from "./read";
import { describeError, type ReadOutcome } from "./reading";

/** Sheets per batch. */
export const MAX_SHEETS = 10;
/** Sheets read at the same time: gentle on the gateway and on a visitor's rate limits. */
export const CONCURRENCY = 2;

export type SheetState =
  | { kind: "waiting" }
  | { kind: "reading" }
  | { kind: "ready"; game: SavedGame }
  | { kind: "queued"; job: QueuedJob }
  | { kind: "failed"; message: string }
  /** Not started: the batch was stopped, by the person or by a failure. */
  | { kind: "skipped" };

export interface BatchDeps<S> {
  /** The sheet's photos, ready to send. */
  photos: (sheet: S) => Promise<PhotoInput[]>;
  read: (photos: PhotoInput[]) => Promise<ReadOutcome>;
  save: (game: SavedGame) => Promise<unknown>;
  newId: () => string;
  onState: (index: number, state: SheetState) => void;
  /** Called once, with the failure that stopped the rest. */
  onStop?: (err: unknown) => void;
  concurrency?: number;
  signal?: AbortSignal;
  now?: () => Date;
}

/** A failure the next sheet would meet too: no credits left, a rejected key. */
export function stopsBatch(err: unknown): boolean {
  if (describeError(err).ownKey) return true;
  return err instanceof Anthropic.APIError && (err.status === 401 || err.status === 403);
}

export async function readBatch<S>(sheets: S[], deps: BatchDeps<S>): Promise<void> {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (next < sheets.length) {
      const i = next++;
      if (stopped || deps.signal?.aborted) {
        deps.onState(i, { kind: "skipped" });
        continue;
      }
      deps.onState(i, { kind: "reading" });
      try {
        const outcome = await deps.read(await deps.photos(sheets[i]));
        if (outcome.kind === "queued") {
          deps.onState(i, { kind: "queued", job: outcome.job });
          continue;
        }
        const none = noMovesMessage(outcome.extraction);
        if (none) {
          deps.onState(i, { kind: "failed", message: none });
          continue;
        }
        const game = gameFromReading(deps.newId(), outcome.extraction, outcome.extraction.headers, deps.now?.());
        await deps.save(game);
        deps.onState(i, { kind: "ready", game });
      } catch (err) {
        if (!stopped && stopsBatch(err)) {
          stopped = true;
          deps.onStop?.(err);
        }
        deps.onState(i, { kind: "failed", message: describeError(err).message });
      }
    }
  };
  const n = Math.max(1, Math.min(deps.concurrency ?? CONCURRENCY, sheets.length));
  await Promise.all(Array.from({ length: n }, worker));
}

/** "2 of 3 read", for the batch's heading once it is done. */
export function batchSummary(states: SheetState[]): string {
  const read = states.filter((s) => s.kind === "ready").length;
  const sent = states.filter((s) => s.kind === "queued").length;
  const parts = [`${read} of ${states.length} read`];
  if (sent) parts.push(`${sent} with the HintWise reader`);
  return parts.join(", ");
}

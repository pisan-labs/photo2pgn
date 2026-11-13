// Readings by the HintWise reader (halflife) arrive while the person is away.
// On each visit, and every POLL_MS while one is waiting, the page asks for the
// person's readings; each finished one is saved in My games under the job's
// id (two devices collecting it at once save the one game) and then
// forgotten on the server. A failed one stays listed until it is dismissed.
import { forgetJob, listMyJobs, type MyJob } from "./api";
import { gameTitle } from "./export";
import type { SavedGame } from "./library";
import { buildPgn } from "./pgn";
import { analyzeGame, rowsToPlies } from "./repair";
import type { Extraction, GameHeaders } from "./schema";

export const POLL_MS = 20_000;

/** A reading as a game in My games, untouched by the person yet. */
export function gameFromReading(id: string, extraction: Extraction, headers: GameHeaders = extraction.headers, now = new Date()): SavedGame {
  const analysis = analyzeGame(rowsToPlies(extraction.rows), { lang: extraction.notationLanguage || "en" });
  return {
    id,
    title: gameTitle(headers),
    pgn: buildPgn(headers, analysis, { notes: "" }),
    updated_at: now.toISOString(),
    game: { headers, extraction, edits: {}, notes: "" },
  };
}

export interface Failed {
  id: string;
  createdAt: string;
  message: string;
}

export interface Collected {
  /** Saved in My games by this call. */
  saved: SavedGame[];
  /** Still with the reader, oldest first. */
  waiting: MyJob[];
  /** Could not be read; listed until dismissed. */
  failed: Failed[];
}

export interface CollectDeps {
  token: string;
  save: (game: SavedGame) => Promise<unknown>;
  /** Already in My games on this device: forget it without saving over the person's changes. */
  has?: (id: string) => Promise<boolean>;
  /** The headers to save a reading with (a Chess TD hand-off fills in its pairing). */
  headersFor?: (id: string, headers: GameHeaders) => GameHeaders;
  list?: typeof listMyJobs;
  forget?: typeof forgetJob;
  now?: () => Date;
}

const NO_MOVES = "No moves were found: this does not look like a chess scoresheet, or the photo is too unclear.";

export async function collectReadings(deps: CollectDeps): Promise<Collected> {
  const list = deps.list ?? listMyJobs;
  const forget = deps.forget ?? forgetJob;
  const out: Collected = { saved: [], waiting: [], failed: [] };
  for (const job of await list(deps.token)) {
    if (job.status === "queued" || job.status === "running") {
      out.waiting.push(job);
      continue;
    }
    if (job.status === "error") {
      // A reading the person cancelled needs no word.
      if (job.error?.code === "cancelled") await forget(job.id, deps.token).catch(() => undefined);
      else out.failed.push({ id: job.id, createdAt: job.createdAt, message: job.error?.message ?? "The sheet could not be read." });
      continue;
    }
    const ex = job.result;
    if (!ex || !ex.isScoresheet || ex.rows.length === 0) {
      out.failed.push({ id: job.id, createdAt: job.createdAt, message: ex?.notes ? `${NO_MOVES} Claude noted: ${ex.notes}` : NO_MOVES });
      continue;
    }
    if (!(await deps.has?.(job.id))) {
      const game = gameFromReading(job.id, ex, deps.headersFor?.(job.id, ex.headers) ?? ex.headers, deps.now?.());
      await deps.save(game);
      out.saved.push(game);
    }
    // Saved: the next poll would only save it again. A failure here is retried then.
    await forget(job.id, deps.token).catch(() => undefined);
  }
  return out;
}

/** "10:42", or "Tue 10:42" when it was not today. */
export function sentAt(iso: string, now = new Date(), locale?: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString(locale, { weekday: "short" })} ${time}`;
}

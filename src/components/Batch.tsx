// Several sheets read in this page: each one's progress, and its game to
// open once read. Games are saved in My games as they arrive.
import { batchSummary, type SheetState } from "../lib/batch";
import type { SavedGame } from "../lib/library";

export interface BatchItem {
  previews: string[];
  state: SheetState;
}

export interface BatchRun {
  items: BatchItem[];
  running: boolean;
  /** The person asked to start no more sheets. */
  stopping: boolean;
}

function status(s: SheetState) {
  switch (s.kind) {
    case "waiting":
      return "Waiting its turn.";
    case "reading":
      return "Reading…";
    case "queued":
      return "With the HintWise reader: it will appear in My games in 1–3 minutes.";
    case "failed":
      return `Could not be read. ${s.message}`;
    case "skipped":
      return "Not read.";
    case "ready":
      return s.game.title;
  }
}

export function BatchPanel({
  run,
  onOpen,
  onStop,
  onClose,
}: {
  run: BatchRun;
  onOpen: (g: SavedGame) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const n = run.items.length;
  return (
    <section className="panel batch" aria-live="polite" aria-label="Sheets being read">
      <div className="batch-head">
        {run.running && <div className="spinner small" aria-hidden="true" />}
        <p>
          {run.running ? (
            <>
              <strong>Reading {n} sheets.</strong> Keep this page open; each game is saved in My games as soon as it is read.
            </>
          ) : (
            <>
              <strong>Done: {batchSummary(run.items.map((it) => it.state))}.</strong> The games are in My games.
            </>
          )}
        </p>
        {run.running ? (
          !run.stopping && (
            <button type="button" className="link" onClick={onStop}>
              Stop after these
            </button>
          )
        ) : (
          <button type="button" className="link" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <ol className="batch-list">
        {run.items.map((it, i) => (
          <li key={it.previews[0] ?? i} className={`batch-item st-${it.state.kind}`}>
            {it.previews[0] && <img src={it.previews[0]} alt="" />}
            <span>
              <strong>Sheet {i + 1}</strong>
              {it.previews.length > 1 ? ` (${it.previews.length} pages)` : ""}: {status(it.state)}
            </span>
            {it.state.kind === "ready" && (
              <button
                type="button"
                className="primary small"
                onClick={() => it.state.kind === "ready" && onOpen(it.state.game)}
                aria-label={`Open sheet ${i + 1}: ${it.state.game.title}`}
              >
                Open
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

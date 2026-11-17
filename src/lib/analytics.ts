// HintWise first-party analytics. public/hw-events.js is the platform's script,
// copied byte for byte (tests/analytics.test.ts pins it): it counts page views,
// time on the page and links followed out, with no cookie and nothing kept in
// the browser, and sends nothing under Global Privacy Control or Do Not Track.
// The app's own events go through track(): a fixed name and short scalar
// props, never what a person photographed, read, typed or named (no moves,
// players, events, ids or keys).

export type ExportWay = "download" | "copy" | "share" | "email" | "lichess" | "chesscom";

export interface AppEvents {
  /** Sheets sent to be read, and whose key pays: HintWise credits or the person's own. */
  read_started: { sheets: number; key: "credits" | "own_key" };
  /** A game taken out of the app, and whether it was the demo game. */
  pgn_exported: { how: ExportWay; demo: boolean };
  /** The demo game opened in the review (no API call). */
  demo_opened: Record<string, never>;
}

type Tracker = { hintwise?: { track?: (name: string, props?: Record<string, string | number | boolean>) => void } };

/** Sends one app event when the script is loaded; never throws, never blocks. */
export function track<K extends keyof AppEvents>(name: K, props: AppEvents[K], win: Tracker = globalThis as Tracker): void {
  try {
    win.hintwise?.track?.(name, props);
  } catch {
    // analytics must never get in the way of the app
  }
}

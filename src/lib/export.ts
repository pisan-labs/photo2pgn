// Sending a finished PGN elsewhere: Lichess (imported in one click), an
// email, or the phone's share sheet. Every one of these happens only when
// the person presses its button.
import type { GameHeaders } from "./schema";

export const LICHESS_IMPORT = "https://lichess.org/api/import";
export const CHESSCOM_ANALYSIS = "https://www.chess.com/analysis";

export class ExportFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportFailed";
  }
}

/**
 * Import the game into Lichess (no account needed) and return its page.
 * Imported games are public on Lichess.
 */
export async function importToLichess(pgn: string, doFetch: typeof fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await doFetch(LICHESS_IMPORT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ pgn }).toString(),
    });
  } catch {
    throw new ExportFailed("Could not reach Lichess. Check your connection and try again.");
  }
  if (res.status === 429) throw new ExportFailed("Lichess is limiting imports from this network. Try again in a few minutes.");
  if (!res.ok) throw new ExportFailed(`Lichess did not accept the game (HTTP ${res.status}).`);
  const body = (await res.json().catch(() => ({}))) as { url?: unknown; id?: unknown };
  if (typeof body.url === "string" && body.url.startsWith("https://lichess.org/")) return body.url;
  if (typeof body.id === "string" && /^[A-Za-z0-9]{8}$/.test(body.id)) return `https://lichess.org/${body.id}`;
  throw new ExportFailed("Lichess answered without a link to the game.");
}

export function gameTitle(h: GameHeaders): string {
  const white = h.white.trim() || "White";
  const black = h.black.trim() || "Black";
  const event = h.event.trim();
  return `${white} vs ${black}${event ? `, ${event}` : ""}`;
}

/** An email with the PGN in the body (and the file name to save it under). */
export function mailtoHref(pgn: string, headers: GameHeaders): string {
  const subject = `PGN: ${gameTitle(headers)}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(pgn)}`;
}

export function pgnFile(pgn: string, name: string): File {
  return new File([pgn], name, { type: "application/x-chess-pgn" });
}

/** Whether this browser can hand a file to the phone's share sheet. */
export function canShareFiles(nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  try {
    return Boolean(nav?.canShare?.({ files: [pgnFile("1. e4 *", "test.pgn")] }));
  } catch {
    return false;
  }
}

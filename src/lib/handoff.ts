// Hand-off with Chess TD (protocol v1, agreed with the Chess TD session,
// 12 Nov 2026). Chess TD opens photo2pgn in a new tab:
//
//   /?from=chesstd&v=1&ref=<nonce>&return=<Chess TD URL>&event=&round=&board=&white=&black=&date=YYYY-MM-DD
//
// The arbiter reads and checks the sheet here, then "Send to Chess TD":
//   (a) postMessage to window.opener, to the return URL's origin only, and
//       wait about 3 s for {type: "photo2pgn/received", ref} from that origin;
//   (b) otherwise go to the return URL with &photo2pgn=<base64url(JSON)>
//       inside its hash, which never reaches a server.
// The return URL counts only when its origin is on RETURN_ORIGINS.
import type { Analysis } from "./repair";
import type { GameHeaders } from "./schema";
import { plyLabel } from "./view";

export const RETURN_ORIGINS = ["https://chesstd.hintwise.org", "http://localhost:5173", "http://localhost:4173"];
export const HANDOFF_STORAGE = "photo2pgn.handoff";
export const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_RETURN_PAYLOAD = 16 * 1024;
const PARAMS = ["from", "v", "ref", "return", "event", "round", "board", "white", "black", "date"];
const HINTS = ["event", "round", "board", "white", "black"] as const;

export interface Handoff {
  from: "chesstd";
  ref: string;
  /** Null when the return URL was missing or its origin is not allowed. */
  returnUrl: string | null;
  returnOrigin: string | null;
  hints: Partial<GameHeaders>;
  createdAt: number;
}

export type WarningKind = "filled" | "unsure" | "illegal" | "skipped";
export interface Warning {
  ply: number; // half-moves from 1, in the PGN
  kind: WarningKind;
  text: string;
}

export interface ResultMessage {
  type: "photo2pgn/result";
  v: 1;
  ref: string;
  pgn: string;
  white: string;
  black: string;
  result: GameHeaders["result"];
  warnings: Warning[];
}

/** The hand-off a Chess TD link asks for, or null if this is not one. */
export function handoffFromUrl(href: string, now = Date.now()): Handoff | null {
  const q = new URL(href).searchParams;
  const ref = q.get("ref") ?? "";
  if (q.get("from") !== "chesstd" || q.get("v") !== "1" || !/^[A-Za-z0-9_-]{16,32}$/.test(ref)) return null;
  let returnUrl: string | null = null;
  let returnOrigin: string | null = null;
  try {
    const u = new URL(q.get("return") ?? "");
    if (RETURN_ORIGINS.includes(u.origin)) [returnUrl, returnOrigin] = [u.href, u.origin];
  } catch {
    // no usable return URL: the PGN is shown to copy
  }
  const hints: Partial<GameHeaders> = {};
  for (const k of HINTS) {
    const v = q.get(k)?.trim().slice(0, 100);
    if (v) hints[k] = v;
  }
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q.get("date") ?? "");
  if (date) hints.date = `${date[1]}.${date[2]}.${date[3]}`;
  return { from: "chesstd", ref, returnUrl, returnOrigin, hints, createdAt: now };
}

/** The page's address without the hand-off parameters. */
export function withoutHandoffParams(href: string): string {
  const u = new URL(href);
  for (const p of PARAMS) u.searchParams.delete(p);
  return u.pathname + u.search + u.hash;
}

export function isFresh(h: Handoff | null | undefined, now = Date.now()): h is Handoff {
  return Boolean(h && h.from === "chesstd" && now - h.createdAt < HANDOFF_TTL_MS);
}

/** Chess TD knows the pairing: its names, event, round, board and date win over the handwriting. */
export function applyHints(headers: GameHeaders, hints: Partial<GameHeaders>): GameHeaders {
  return { ...headers, ...hints };
}

/** Every move the arbiter should look at, numbered as in the PGN. */
export function warningsOf(analysis: Analysis): Warning[] {
  const out: Warning[] = [];
  let ply = 0;
  for (const p of analysis.plies) {
    const written = p.reading?.written || "";
    if (p.inserted) {
      ply++;
      out.push({ ply, kind: "filled", text: `${p.inserted.label} ${p.inserted.san}: not on the sheet, added so the moves after it fit` });
    }
    if (p.status === "illegal") {
      out.push({ ply: ply + 1, kind: "illegal", text: `${plyLabel(p)} "${written || "blank"}" is not a legal move; the game stops here` });
      break;
    }
    if (p.status === "skipped") {
      out.push({ ply: ply + 1, kind: "skipped", text: `An entry on the sheet ("${written || "blank"}") was left out here` });
      continue;
    }
    if (!p.san) break; // not checked: the PGN ends before it
    ply++;
    const move = `${plyLabel(p)} ${p.san}`;
    if (p.status === "fixed") {
      out.push({ ply, kind: "filled", text: `${move}: the sheet has "${written || "blank"}"${p.note ? `; ${p.note}` : ""}` });
    } else if (p.status === "unsure") {
      out.push({ ply, kind: "unsure", text: `${move}: unclear handwriting ("${written || "blank"}")` });
    }
  }
  return out;
}

export function resultMessage(h: Handoff, headers: GameHeaders, analysis: Analysis, pgn: string): ResultMessage {
  return {
    type: "photo2pgn/result",
    v: 1,
    ref: h.ref,
    pgn,
    white: headers.white,
    black: headers.black,
    result: headers.result,
    warnings: warningsOf(analysis),
  };
}

export function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The return URL carrying the message in its hash, or null when there is none or it is too long. */
export function returnHref(h: Handoff, msg: ResultMessage): string | null {
  if (!h.returnUrl) return null;
  const payload = base64url(JSON.stringify(msg));
  if (payload.length > MAX_RETURN_PAYLOAD) return null;
  const u = new URL(h.returnUrl);
  const hash = u.hash || "#";
  u.hash = `${hash}${hash.includes("?") ? "&" : "?"}photo2pgn=${payload}`;
  return u.href;
}

/** Chess TD's reply that it has the game: from the return origin, for this ref. */
export function isReceived(ev: { origin: string; data: unknown }, h: Handoff): boolean {
  const d = ev.data as { type?: unknown; v?: unknown; ref?: unknown } | null;
  return ev.origin === h.returnOrigin && d?.type === "photo2pgn/received" && d.v === 1 && d.ref === h.ref;
}

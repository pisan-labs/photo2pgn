// The Chess TD hand-off (protocol v1): the link in, the result out.
import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { analyzeGame, rowsToPlies } from "../src/lib/repair";
import { buildPgn } from "../src/lib/pgn";
import { DEMO_EXTRACTION } from "../src/demo/sample";
import {
  MAX_RETURN_PAYLOAD,
  applyHints,
  base64url,
  handoffFromUrl,
  isFresh,
  isReceived,
  resultMessage,
  returnHref,
  warningsOf,
  withoutHandoffParams,
  type Handoff,
} from "../src/lib/handoff";
import { rowsFrom, OPERA_GAME } from "./helpers";

const REF = "abcDEF0123456789_-xy";
const RETURN = "https://chesstd.hintwise.org/#/t/42/rounds/3/games?board=5";
const link = (extra: Record<string, string> = {}) => {
  const q = new URLSearchParams({ from: "chesstd", v: "1", ref: REF, return: RETURN, ...extra });
  return `https://photo2pgn.hintwise.org/?${q}`;
};
const decode = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
};

describe("the link from Chess TD", () => {
  it("reads the ref, the return URL and the pairing hints", () => {
    const h = handoffFromUrl(link({ event: " Club Ch ", round: "3", board: "5", white: "Ding, Liren", black: "Gukesh D", date: "2024-12-12" }), 1000)!;
    expect(h).toEqual({
      from: "chesstd",
      ref: REF,
      returnUrl: RETURN,
      returnOrigin: "https://chesstd.hintwise.org",
      hints: { event: "Club Ch", round: "3", board: "5", white: "Ding, Liren", black: "Gukesh D", date: "2024.12.12" },
      createdAt: 1000,
    });
  });

  it("is not a hand-off without from=chesstd, v=1 and a well-formed ref", () => {
    expect(handoffFromUrl("https://photo2pgn.hintwise.org/")).toBeNull();
    expect(handoffFromUrl(link({ from: "other" }))).toBeNull();
    expect(handoffFromUrl(link({ v: "2" }))).toBeNull();
    expect(handoffFromUrl(link({ ref: "short" }))).toBeNull();
    expect(handoffFromUrl(link({ ref: "has spaces in it, sixteen+" }))).toBeNull();
  });

  it("uses the return URL only on an allowed origin", () => {
    for (const bad of ["https://evil.example/#/x", "https://chesstd.hintwise.org.evil.example/", "javascript:alert(1)", ""]) {
      const h = handoffFromUrl(link({ return: bad }))!;
      expect([h.returnUrl, h.returnOrigin]).toEqual([null, null]);
    }
    expect(handoffFromUrl(link({ return: "http://localhost:5173/#/games" }))!.returnOrigin).toBe("http://localhost:5173");
  });

  it("cuts long hints and ignores a malformed date", () => {
    const h = handoffFromUrl(link({ white: "x".repeat(300), date: "12/12/2024" }))!;
    expect(h.hints.white).toHaveLength(100);
    expect(h.hints.date).toBeUndefined();
  });

  it("takes its parameters out of the address and keeps the rest", () => {
    expect(withoutHandoffParams(`${link({ round: "3" })}&keep=1#x`)).toBe("/?keep=1#x");
  });

  it("lasts a day, and the pairing wins over the handwriting", () => {
    const h = handoffFromUrl(link(), 0)!;
    expect(isFresh(h, 1000)).toBe(true);
    expect(isFresh(h, 25 * 3600 * 1000)).toBe(false);
    expect(isFresh(null)).toBe(false);
    expect(applyHints(DEMO_EXTRACTION.headers, { white: "Morphy, P." }).white).toBe("Morphy, P.");
    expect(applyHints(DEMO_EXTRACTION.headers, {}).black).toBe(DEMO_EXTRACTION.headers.black);
  });
});

describe("the result sent back", () => {
  it("warns about every corrected, unclear and guessed move, numbered as in the PGN", () => {
    const a = analyzeGame(rowsToPlies(DEMO_EXTRACTION.rows));
    const w = warningsOf(a);
    expect(w.map((x) => x.kind)).toEqual(expect.arrayContaining(["filled", "unsure"]));
    expect(w.at(-1)).toMatchObject({ ply: 33, kind: "filled" });
    expect(w.at(-1)!.text).toMatch(/^17\. Rd8#: best guess, not confirmed/);
    // A typed move that is not legal ends the game there, and says so.
    const stopped = warningsOf(analyzeGame(rowsToPlies(DEMO_EXTRACTION.rows), { edits: { 31: "Kd8" } }));
    expect(stopped.at(-1)).toMatchObject({ ply: 32, kind: "illegal" });
    for (const x of w.filter((x) => x.kind !== "illegal")) {
      // The ply number points at that move in the game.
      const p = a.plies[x.ply - 1];
      expect(x.text.startsWith(`${p.label} ${p.san}`)).toBe(true);
    }
  });

  it("counts an inserted move and skips a left-out entry", () => {
    // The sheet forgot 1... e5 and wrote 3. d4 twice: e5 inserted before Nf3, the second d4 left out.
    const a = analyzeGame(rowsToPlies(rowsFrom(["e4", "Nf3", "d6", "d4", "d4", "Bg4"])), { edits: { 1: "e5 Nf3", 4: "-" } });
    expect(a.stoppedAt).toBeNull();
    const w = warningsOf(a);
    expect(w).toEqual([
      { ply: 2, kind: "filled", text: "1... e5: not on the sheet, added so the moves after it fit" },
      { ply: 6, kind: "skipped", text: 'An entry on the sheet ("d4") was left out here' },
    ]);
    // The numbers are the PGN's: ply 2 is e5, and ply 6 is the move after the left-out entry.
    const game = new Chess();
    for (const m of a.plies.flatMap((p) => [p.inserted?.san, p.san].filter(Boolean) as string[])) game.move(m);
    expect(game.history()).toEqual(["e4", "e5", "Nf3", "d6", "d4", "Bg4"]);
  });

  it("builds the message, and a return URL that carries it in the hash", () => {
    const h = handoffFromUrl(link())!;
    const a = analyzeGame(rowsToPlies(rowsFrom(OPERA_GAME)));
    const pgn = buildPgn(DEMO_EXTRACTION.headers, a);
    const msg = resultMessage(h, DEMO_EXTRACTION.headers, a, pgn);
    expect(msg).toMatchObject({ type: "photo2pgn/result", v: 1, ref: REF, result: "1-0", warnings: [] });
    const href = returnHref(h, msg)!;
    expect(href.startsWith("https://chesstd.hintwise.org/#/t/42/rounds/3/games?board=5&photo2pgn=")).toBe(true);
    expect(decode(new URL(href).hash.split("photo2pgn=")[1])).toEqual(msg);
    // No query in the hash yet, no hash at all.
    expect(returnHref({ ...h, returnUrl: "https://chesstd.hintwise.org/#/games" }, msg)).toMatch(/#\/games\?photo2pgn=/);
    expect(returnHref({ ...h, returnUrl: "https://chesstd.hintwise.org/" }, msg)).toMatch(/\/#\?photo2pgn=/);
  });

  it("does not go back without an allowed return URL, or with too much to carry", () => {
    const h = handoffFromUrl(link())!;
    const msg = resultMessage(h, DEMO_EXTRACTION.headers, analyzeGame([]), "x".repeat(MAX_RETURN_PAYLOAD));
    expect(returnHref(h, msg)).toBeNull();
    expect(returnHref({ ...h, returnUrl: null }, { ...msg, pgn: "" })).toBeNull();
  });

  it("encodes names with accents as UTF-8", () => {
    expect(decode(base64url(JSON.stringify({ n: "Ñandú, José ½" })))).toEqual({ n: "Ñandú, José ½" });
  });

  it("accepts Chess TD's reply only from the return origin, for this ref", () => {
    const h: Handoff = handoffFromUrl(link())!;
    const ok = { origin: "https://chesstd.hintwise.org", data: { type: "photo2pgn/received", v: 1, ref: REF } };
    expect(isReceived(ok, h)).toBe(true);
    expect(isReceived({ ...ok, origin: "https://evil.example" }, h)).toBe(false);
    expect(isReceived({ ...ok, data: { ...ok.data, ref: "other-ref-0123456789" } }, h)).toBe(false);
    expect(isReceived({ ...ok, data: null }, h)).toBe(false);
    expect(isReceived(ok, { ...h, returnOrigin: null })).toBe(false);
  });
});

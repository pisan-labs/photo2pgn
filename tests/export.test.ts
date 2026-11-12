import { describe, expect, it, vi } from "vitest";
import { ExportFailed, LICHESS_IMPORT, canShareFiles, gameTitle, importToLichess, mailtoHref, pgnFile } from "../src/lib/export";
import { extraction } from "./helpers";

const headers = extraction([]).headers;
const PGN = '[Event "Paris Opera"]\n\n1. e4 e5 1-0\n';

describe("Lichess import", () => {
  it("posts the PGN as a form and returns the game's page", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id: "AbCd1234", url: "https://lichess.org/AbCd1234" }), { status: 200 }));
    expect(await importToLichess(PGN, fetch as unknown as typeof globalThis.fetch)).toBe("https://lichess.org/AbCd1234");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(LICHESS_IMPORT);
    expect(new URLSearchParams(String(init!.body)).get("pgn")).toBe(PGN);
  });
  it("builds the link from the id when only the id comes back", async () => {
    const fetch = async () => new Response(JSON.stringify({ id: "Zz9Yy8Xx" }), { status: 200 });
    expect(await importToLichess(PGN, fetch as unknown as typeof globalThis.fetch)).toBe("https://lichess.org/Zz9Yy8Xx");
  });
  it("explains failures", async () => {
    const answers: [() => Promise<Response>, RegExp][] = [
      [async () => new Response("", { status: 429 }), /limiting/],
      [async () => new Response("bad pgn", { status: 400 }), /HTTP 400/],
      [async () => new Response(JSON.stringify({ url: "https://evil.example/" }), { status: 200 }), /without a link/],
      [
        async () => {
          throw new TypeError("offline");
        },
        /reach Lichess/,
      ],
    ];
    for (const [fetch, message] of answers) {
      await expect(importToLichess(PGN, fetch as unknown as typeof globalThis.fetch)).rejects.toThrow(message);
      await expect(importToLichess(PGN, fetch as unknown as typeof globalThis.fetch)).rejects.toBeInstanceOf(ExportFailed);
    }
  });
});

describe("email and sharing", () => {
  it("puts the players and event in the subject and the PGN in the body", () => {
    expect(gameTitle(headers)).toBe("Morphy, Paul vs Duke Karl / Count Isouard, Paris Opera");
    expect(gameTitle({ ...headers, white: "", black: "", event: "" })).toBe("White vs Black");
    const href = mailtoHref(PGN, headers);
    const q = new URLSearchParams(href.slice("mailto:?".length));
    expect(q.get("subject")).toBe("PGN: Morphy, Paul vs Duke Karl / Count Isouard, Paris Opera");
    expect(q.get("body")).toBe(PGN);
  });
  it("makes a .pgn file and asks the browser whether it can share files", async () => {
    const f = pgnFile(PGN, "game.pgn");
    expect([f.name, f.type, await f.text()]).toEqual(["game.pgn", "application/x-chess-pgn", PGN]);
    expect(canShareFiles({ canShare: () => true } as unknown as Navigator)).toBe(true);
    expect(canShareFiles({} as Navigator)).toBe(false);
    expect(canShareFiles(undefined)).toBe(false);
  });
});

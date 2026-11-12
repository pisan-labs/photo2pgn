import { describe, expect, it } from "vitest";
import { InMemoryRepository, type Repository } from "../src/lib/repository";
import { Library, LocalRepository, type SavedGame } from "../src/lib/library";
import { memoryStorage } from "../src/lib/llm";
import { extraction, rowsFrom, OPERA_GAME } from "./helpers";

const ex = extraction(rowsFrom(OPERA_GAME));
const game = (id: string, updated_at: string, title = "Morphy vs Duke"): SavedGame => ({
  id,
  title,
  updated_at,
  pgn: "1. e4 e5 *",
  game: { headers: ex.headers, extraction: ex, edits: {}, notes: "" },
});

const broken: Repository<SavedGame> = {
  list: async () => {
    throw new Error("relation app_photo2pgn.games does not exist");
  },
  get: async () => undefined,
  put: async () => {
    throw new Error("offline");
  },
  remove: async () => {
    throw new Error("offline");
  },
};

describe("LocalRepository", () => {
  it("keeps games in storage across instances", async () => {
    const storage = memoryStorage();
    await new LocalRepository<SavedGame>("k", storage).put(game("a", "2026-11-12T10:00:00Z"));
    const again = new LocalRepository<SavedGame>("k", storage);
    expect((await again.get("a"))?.title).toBe("Morphy vs Duke");
    await again.remove("a");
    expect(await again.list()).toEqual([]);
  });
  it("survives broken or missing storage", async () => {
    const storage = memoryStorage();
    storage.setItem("k", "not json");
    expect(await new LocalRepository<SavedGame>("k", storage).list()).toEqual([]);
    const none = new LocalRepository<SavedGame>("k", null);
    await none.put(game("a", "x"));
    expect(await none.list()).toEqual([]);
  });
});

describe("Library", () => {
  it("merges device and account, newer copy winning, newest first", async () => {
    const device = new InMemoryRepository([game("a", "2026-11-12T10:00:00Z", "old title"), game("b", "2026-11-10T00:00:00Z")]);
    const account = new InMemoryRepository([game("a", "2026-11-12T11:00:00Z", "new title"), game("c", "2026-11-11T00:00:00Z")]);
    const { games, accountError } = await new Library(device, account).list();
    expect(accountError).toBeNull();
    expect(games.map((g) => [g.id, g.where, g.title])).toEqual([
      ["a", "both", "new title"],
      ["c", "account", "Morphy vs Duke"],
      ["b", "device", "Morphy vs Duke"],
    ]);
  });
  it("saves and removes in both places", async () => {
    const device = new InMemoryRepository<SavedGame>();
    const account = new InMemoryRepository<SavedGame>();
    const lib = new Library(device, account);
    expect(await lib.save(game("a", "2026-11-12T10:00:00Z"))).toEqual({ accountError: null });
    expect(await account.get("a")).toBeTruthy();
    await lib.remove("a");
    expect(await device.list()).toEqual([]);
    expect(await account.list()).toEqual([]);
  });
  it("keeps working from the device when the account is unavailable", async () => {
    const device = new InMemoryRepository<SavedGame>();
    const lib = new Library(device, broken);
    expect((await lib.save(game("a", "2026-11-12T10:00:00Z"))).accountError).toContain("offline");
    const listing = await lib.list();
    expect(listing.games.map((g) => g.where)).toEqual(["device"]);
    expect(listing.accountError).toContain("does not exist");
    expect((await lib.remove("a")).accountError).toContain("offline");
    expect(await device.list()).toEqual([]);
  });
  it("works with no account at all", async () => {
    const lib = new Library(new InMemoryRepository<SavedGame>());
    expect(lib.hasAccount).toBe(false);
    expect(await lib.save(game("a", "t"))).toEqual({ accountError: null });
    expect(await lib.remove("a")).toEqual({ accountError: null });
  });
});

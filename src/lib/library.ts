// "My games": every game is saved in this browser as it is edited, and, for
// a signed-in visitor, in their HintWise account too (Supabase,
// app_photo2pgn.games, own rows only), so a sheet photographed on a phone
// can be finished on a computer. Photos are never stored.
import type { Entity, Repository } from "./repository";
import type { Extraction, GameHeaders } from "./schema";

export interface GameData {
  headers: GameHeaders;
  extraction: Extraction;
  edits: Record<number, string>;
  notes?: string;
}

export interface SavedGame extends Entity {
  title: string;
  game: GameData;
  pgn: string;
  updated_at: string;
}

export type Where = "device" | "account" | "both";

/** A Repository kept in localStorage (or any Storage), as one JSON object. */
export class LocalRepository<T extends Entity> implements Repository<T> {
  constructor(
    private readonly key: string,
    private readonly storage: Storage | null = safeLocalStorage(),
  ) {}

  private read(): Record<string, T> {
    try {
      return JSON.parse(this.storage?.getItem(this.key) ?? "{}") as Record<string, T>;
    } catch {
      return {};
    }
  }

  private write(items: Record<string, T>) {
    try {
      this.storage?.setItem(this.key, JSON.stringify(items));
    } catch {
      // storage full or blocked: the game stays open in the page
    }
  }

  async list(): Promise<T[]> {
    return Object.values(this.read());
  }

  async get(id: string): Promise<T | undefined> {
    return this.read()[id];
  }

  async put(item: T): Promise<T> {
    const items = this.read();
    items[item.id] = item;
    this.write(items);
    return item;
  }

  async remove(id: string): Promise<void> {
    const items = this.read();
    delete items[id];
    this.write(items);
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export interface Listing {
  games: (SavedGame & { where: Where })[];
  /** Set when the account could not be reached: the device's games are shown. */
  accountError: string | null;
}

export class Library {
  constructor(
    private readonly device: Repository<SavedGame>,
    private readonly account: Repository<SavedGame> | null = null,
  ) {}

  get hasAccount(): boolean {
    return this.account !== null;
  }

  /** Both stores merged by id, the newer copy winning; newest game first. */
  async list(): Promise<Listing> {
    const local = await this.device.list();
    let remote: SavedGame[] = [];
    let accountError: string | null = null;
    if (this.account) {
      try {
        remote = await this.account.list();
      } catch (e) {
        accountError = e instanceof Error ? e.message : String(e);
      }
    }
    const byId = new Map<string, SavedGame & { where: Where }>();
    for (const g of local) byId.set(g.id, { ...g, where: "device" });
    for (const g of remote) {
      const mine = byId.get(g.id);
      if (!mine) byId.set(g.id, { ...g, where: "account" });
      else byId.set(g.id, { ...(g.updated_at > mine.updated_at ? g : mine), where: "both" });
    }
    const games = [...byId.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { games, accountError };
  }

  /** Save on the device, then to the account; an account failure is reported, not thrown. */
  async save(game: SavedGame): Promise<{ accountError: string | null }> {
    await this.device.put(game);
    if (!this.account) return { accountError: null };
    try {
      const row: SavedGame & { where?: Where } = { ...game };
      delete row.where; // shown in the list only, not a column
      await this.account.put(row);
      return { accountError: null };
    } catch (e) {
      return { accountError: e instanceof Error ? e.message : String(e) };
    }
  }

  async remove(id: string): Promise<{ accountError: string | null }> {
    await this.device.remove(id);
    if (!this.account) return { accountError: null };
    try {
      await this.account.remove(id);
      return { accountError: null };
    } catch (e) {
      return { accountError: e instanceof Error ? e.message : String(e) };
    }
  }
}

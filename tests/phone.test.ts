import { describe, expect, it } from "vitest";
import { SHARED_CACHE, takeSharedPhotos } from "../src/lib/shared";
import { isIos } from "../src/lib/install";

function fakeCaches(entries: Record<string, Response>) {
  const store = new Map(Object.entries(entries));
  const cache = {
    keys: async () => [...store.keys()].map((k) => new Request(`https://app.test${k}`)),
    match: async (r: Request) => store.get(new URL(r.url).pathname),
    delete: async (r: Request) => store.delete(new URL(r.url).pathname),
  };
  const opened: string[] = [];
  return {
    store,
    opened,
    caches: { open: async (name: string) => (opened.push(name), cache) } as unknown as CacheStorage,
  };
}

describe("photos shared into the app", () => {
  it("takes them out of the cache once, in order, with their names", async () => {
    const f = fakeCaches({
      "/shared/1": new Response(new Blob(["two"], { type: "image/jpeg" }), { headers: { "x-name": "page%202.jpg" } }),
      "/shared/0": new Response(new Blob(["one"], { type: "image/png" }), { headers: { "x-name": "page%201.png" } }),
    });
    const files = await takeSharedPhotos(f.caches);
    expect(f.opened).toEqual([SHARED_CACHE]);
    expect(files.map((x) => [x.name, x.type])).toEqual([
      ["page 1.png", "image/png"],
      ["page 2.jpg", "image/jpeg"],
    ]);
    expect(f.store.size).toBe(0);
    expect(await takeSharedPhotos(f.caches)).toEqual([]);
  });
  it("does nothing without Cache Storage", async () => {
    expect(await takeSharedPhotos(undefined)).toEqual([]);
  });
});

describe("install tip", () => {
  it("knows an iPhone from an Android phone", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isIos("Mozilla/5.0 (Linux; Android 15; Pixel 7)")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { SHARED_CACHE, takeSharedPhotos } from "../src/lib/shared";
import { installWay, iosShareHint, isIos } from "../src/lib/install";

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

describe("the install page", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  const android = "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
  const way = (ua: string, o: { standalone?: boolean; canPrompt?: boolean } = {}) =>
    installWay({ standalone: o.standalone ?? false, canPrompt: o.canPrompt ?? false, ua });

  it("picks the way this browser installs it", () => {
    expect(way(iphone, { standalone: true })).toBe("installed");
    expect(way(android, { standalone: true, canPrompt: true })).toBe("installed");
    expect(way(android, { canPrompt: true })).toBe("prompt");
    expect(way(mac, { canPrompt: true })).toBe("prompt");
    expect(way(iphone)).toBe("ios");
    expect(way(android)).toBe("android-menu");
    expect(way(mac)).toBe("desktop");
  });

  it("says where Share is in each iOS browser", () => {
    expect(iosShareHint(iphone)).toContain("bottom of the screen");
    expect(iosShareHint(iphone.replace("Version/18.0", "CriOS/140.0"))).toContain("address bar");
    expect(iosShareHint(iphone.replace("Version/18.0", "FxiOS/140.0"))).toContain("menu");
  });
});

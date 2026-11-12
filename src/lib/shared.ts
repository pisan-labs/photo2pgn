// Photos shared into the app from another app (Android share sheet). The
// service worker (public/sw.js) puts them in Cache Storage; the page takes
// them out once. They never leave the phone unless the person reads them.
export const SHARED_CACHE = "photo2pgn-shared";

export async function takeSharedPhotos(store: CacheStorage | undefined = globalThis.caches): Promise<File[]> {
  if (!store) return [];
  const cache = await store.open(SHARED_CACHE);
  const keys = [...(await cache.keys())].sort((a, b) => a.url.localeCompare(b.url));
  const files: File[] = [];
  for (const key of keys) {
    const res = await cache.match(key);
    await cache.delete(key);
    if (!res) continue;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get("x-name") ?? "shared.jpg");
    files.push(new File([blob], name, { type: blob.type || "image/jpeg" }));
  }
  return files;
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

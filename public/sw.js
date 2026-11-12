// photo2pgn service worker.
//
// - Opens the app without a connection: the page and its hashed assets are
//   cached as they are loaded (the reading itself still needs a connection).
// - Receives photos shared from other apps on Android (the manifest's
//   share_target): they go into this phone's Cache Storage, never to a
//   server, and the page picks them up as pages of the sheet.
// It never touches /api/* or other sites (sign-in, the gateway, Anthropic).
const SHELL = "photo2pgn-shell-v1";
const SHARED = "photo2pgn-shared";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest"])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("photo2pgn-shell-") && key !== SHELL) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") event.respondWith(networkFirst(event.request));
  else if (url.pathname.startsWith("/assets/")) event.respondWith(cacheFirst(event.request));
});

async function receiveShare(request) {
  const form = await request.formData();
  const files = form
    .getAll("photos")
    .filter((f) => typeof f === "object" && f && String(f.type).startsWith("image/"))
    .slice(0, 2);
  const cache = await caches.open(SHARED);
  for (const key of await cache.keys()) await cache.delete(key);
  await Promise.all(
    files.map((f, i) =>
      cache.put(`/shared/${i}`, new Response(f, { headers: { "content-type": f.type, "x-name": encodeURIComponent(f.name || `photo-${i + 1}.jpg`) } })),
    ),
  );
  return Response.redirect(`/?shared=${files.length}`, 303);
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(SHELL)).put("/", res.clone());
    return res;
  } catch {
    return (await caches.match("/")) || Response.error();
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
  return res;
}

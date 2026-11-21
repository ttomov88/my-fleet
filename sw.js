// Bump CACHE_NAME whenever icons, manifest.json or vendor/ change: those are served cache-first.
// The app's own code (index.html, css/, js/) is network-first, so updates show up right away.
const CACHE_NAME = "fleet-log-v11";
// The app itself: these must download for a new version to install.
const CORE = ["./", "./index.html", "./css/app.css", "./js/i18n.js", "./js/app.js", "./manifest.json", "./vendor/supabase.js"];
// Nice to have offline. A missing or misplaced icon must never block an app update.
const OPTIONAL = [
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/badge-96.png",
  "./vendor/fonts/inter-latin-wght-normal.woff2",
  "./vendor/fonts/inter-cyrillic-wght-normal.woff2"
];

self.addEventListener("install", (event) => {
  // cache: "reload" skips the browser's HTTP cache so a new version never stores stale files.
  const fresh = (url) => new Request(url, { cache: "reload" });
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(CORE.map(fresh)).then(() =>
        Promise.all(OPTIONAL.map((url) => cache.add(fresh(url)).catch(() => {})))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // Only this app's old versions. Other apps on ttomov88.github.io share this cache storage.
      Promise.all(keys.filter((k) => k.startsWith("fleet-log-") && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;   // let the browser handle anything that isn't a plain read
  // Only the app's own files. Account data (Supabase) must always come fresh from the network.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  const isPage = event.request.mode === "navigate" || event.request.destination === "document";
  const isAppCode = isPage || /\/(css|js)\/[^/]+$/.test(new URL(event.request.url).pathname);

  if (isAppCode) {
    // Network-first for the app's own code so updates show up immediately; the cached copy is
    // only used offline (pages fall back to index.html if this exact URL was never cached).
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((r) => r || (isPage ? caches.match("./index.html") : Response.error())))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest, vendor library) that rarely change.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});

// The daily 08:00 reminder (and the test notification) sent by the server.
self.addEventListener("push", (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch (e) { msg = { body: event.data ? event.data.text() : "" }; }
  const tag = msg.tag || "fleet-log";
  event.waitUntil(self.registration.showNotification(msg.title || "My Fleet", {
    body: msg.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag,
    renotify: true   // a new reminder with the same tag still makes a sound
  }));
});

// Tapping a reminder opens the app (or brings it to the front if it's already open).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) { if ("focus" in w) return w.focus(); }
      return self.clients.openWindow("./");
    })
  );
});

// Bump CACHE_NAME whenever icons or manifest.json change: those are served cache-first.
const CACHE_NAME = "fleet-log-v4";
// The app itself: these must download for a new version to install.
const CORE = ["./", "./index.html", "./manifest.json"];
// Nice to have offline. A missing or misplaced icon must never block an app update.
const OPTIONAL = [
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/badge-96.png"
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
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;   // let the browser handle anything that isn't a plain read
  const isPage = event.request.mode === "navigate" || event.request.destination === "document";

  if (isPage) {
    // Network-first for the app's HTML so updates show up immediately; the cached copy is
    // only used offline (falling back to index.html if this exact URL was never cached).
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest) that rarely change.
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

// The page asks the service worker to show reminder notifications (required on Android).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SHOW_NOTIFICATION") {
    const { title, options } = event.data;
    // waitUntil keeps the worker alive until the notification is actually shown.
    event.waitUntil(self.registration.showNotification(title, options));
  }
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

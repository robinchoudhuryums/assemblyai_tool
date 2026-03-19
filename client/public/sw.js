// Self-destructing service worker — clears all caches and unregisters itself.
// The previous service worker cached stale assets and caused blank screens.
// Caching PHI-containing responses locally is also a HIPAA concern.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});

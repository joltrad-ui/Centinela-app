// Primero la red; si no hay conexión, la última copia guardada.
const CACHE = "centinela-v2";
const SHELL = ["./", "index.html", "app.css", "app.js", "engine.js", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && !key.startsWith("centinela-datos")).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // El barrido (data/) lo guarda la propia app, que sabe cuándo ha cambiado.
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/") || url.pathname.includes("/data/")) return;
  const key = url.origin + url.pathname; // sin el ?t= que evita la caché del navegador
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key).then((hit) => hit ?? Response.error())),
  );
});

/* Open RO PV Scanner - offline cache (v1.11, 14-Nov-2026).
   Keeps the page, the plate rules, the libraries and the plate reader on the phone after the first visit,
   so scanning works in a basement with no signal. Change CACHE whenever any of these files change. */
const CACHE = "pvscan-v1.11";
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";   // the 11 MB reader runtime (too big to keep in the repo)
const FILES = [
  "./", "index.html", "plate.js",
  "lib/ort.min.js", "lib/tesseract.min.js", "lib/xlsx.full.min.js", "lib/jszip.min.js",
  "lang/fpo_xs.onnx",
  ORT + "ort-wasm-simd-threaded.mjs", ORT + "ort-wasm-simd-threaded.wasm"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("pvscan-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.url.startsWith(ORT)) { e.respondWith(caches.match(req.url).then(hit => hit || fetch(req))); return; }   // reader runtime: phone copy first
  if (new URL(req.url).origin !== self.location.origin) return;   // otherwise only this site's own files
  const path = new URL(req.url).pathname;
  const isPage = req.mode === "navigate" || /\/(index\.html)?$/.test(path);
  if (isPage || /\/plate\.js$/.test(path)) {
    // the page and the plate rules (small, change often): network first to pick up updates, phone copy if no signal
    const key = isPage ? "index.html" : "plate.js";
    e.respondWith(
      Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 4000))])
        .then(res => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); return res; } throw new Error("bad response"); })
        .catch(() => caches.match(key, { ignoreSearch: true }).then(r => r || (isPage ? caches.match("./") : undefined)))
    );
    return;
  }
  // everything else: the copy on the phone first, the network only if it isn't cached yet
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});

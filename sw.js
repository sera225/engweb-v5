// Eng Flash v5 Service Worker
// 關鍵:Network-first 策略,確保使用者永遠拿最新版
// 版本號變更會觸發瀏覽器重新安裝 SW

const CACHE = 'eng-flash-v5';
const ASSETS = ['/', '/index.html', '/app.js', '/questions.js', '/style.css', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;

  // Network-first:優先抓新版,離線時才用快取
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok && e.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});

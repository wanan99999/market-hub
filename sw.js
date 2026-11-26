// 只缓存本应用外壳（离线也能打开）；五个网站的数据始终走网络，保证最新
var CACHE = 'hub-v6';
var SHELL = ['./', 'index.html', 'app.css?v=3', 'app.js?v=6', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.indexOf('/market-hub/') !== 0) return; // 其它网站不拦截
  // 网络优先，断网时用缓存
  e.respondWith(fetch(e.request).then(function (r) {
    var copy = r.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return r;
  }).catch(function () { return caches.match(e.request); }));
});

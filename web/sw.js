const PREFIX = `boombox-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const CACHE = PREFIX + '1.0.0';
const FILES = ['./', './index.html', './styles.css', './js/app.js', './js/engine.js', './js/code.js', './icon.svg', './manifest.webmanifest'];
const urls = FILES.map(p => new URL(p, self.registration.scope).href);
async function check() {
  const c = await caches.open(CACHE), missing = [];
  for (const u of urls) { const r = await c.match(u, {ignoreVary:true}); if (!r || !r.ok) missing.push(u); }
  return {ready:missing.length === 0, missing, total:urls.length, version:CACHE};
}
async function save() {
  const c = await caches.open(CACHE), report = await check();
  if (report.missing.length) await c.addAll(report.missing.map(u => new Request(u, {cache:'reload'})));
  return check();
}
self.addEventListener('install', e => e.waitUntil((async () => { if (!(await save()).ready) throw Error('Incomplete cache'); await self.skipWaiting(); })()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  if ((await check()).ready) for (const n of await caches.keys()) if (n.startsWith(PREFIX) && n !== CACHE) await caches.delete(n);
  await self.clients.claim();
})()));
self.addEventListener('message', e => {
  if (!e.data || !['CHECK_OFFLINE','SAVE_OFFLINE'].includes(e.data.type)) return;
  e.waitUntil((async () => { let r; try { r = await (e.data.type === 'SAVE_OFFLINE' ? save() : check()); } catch (err) { r = {...await check(),error:String(err.message)}; } if (e.ports[0]) e.ports[0].postMessage(r); })());
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || !urls.includes(u.href)) return;
  e.respondWith((async () => { const c = await caches.open(CACHE); return await c.match(e.request, {ignoreVary:true}) || fetch(e.request); })());
});

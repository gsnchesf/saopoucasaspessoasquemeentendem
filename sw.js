/* Service worker: deixa o organizador funcionando offline quando
   servido por http(s) e permite instalá-lo como app no celular. */

const CACHE = 'organizador-v6';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './js/core.js', './js/db.js', './js/ui.js', './js/vendor/supabase.js', './js/config.js', './js/auth.js', './js/agenda.js', './js/semana.js', './js/faculdade.js', './js/importar.js', './js/trabalho.js',
  './js/habitos.js', './js/metas.js', './js/hoje.js', './js/ajustes.js', './js/admin.js', './js/app.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Rede primeiro (para receber atualizações); cache quando estiver offline.
self.addEventListener('fetch', e => {
  // Só os arquivos do próprio app; chamadas ao servidor (Supabase) passam direto.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list[0] ? list[0].focus() : self.clients.openWindow('./')));
});

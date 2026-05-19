// ❤️U Festival 2026 – Service Worker
// Versie ophogen bij elke deploy zodat de cache wordt ververst
const CACHE_VERSION = 'heartu-v1.0.0';

const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

// Bestanden die altijd gecached worden bij installatie (app shell)
const STATIC_ASSETS = [
  '/heartU-festival-app.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Sansation:ital,wght@0,300;0,400;0,700;1,300&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

// ==================== INSTALL ====================
// Gecached bij eerste installatie van de SW
self.addEventListener('install', event => {
  console.log('[SW] Installeren…');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Statische assets cachen');
        // addAll faalt als één resource niet laadt (bv. fonts offline)
        // Gebruik Promise.allSettled via aparte add-calls om robuust te zijn
        return Promise.allSettled(
          STATIC_ASSETS.map(url => cache.add(url).catch(err => {
            console.warn('[SW] Kon niet cachen:', url, err);
          }))
        );
      })
      .then(() => {
        console.log('[SW] Installatie klaar, direct activeren');
        return self.skipWaiting(); // nieuwe SW meteen actief
      })
  );
});

// ==================== ACTIVATE ====================
// Verwijder oude caches bij activatie van een nieuwe SW-versie
self.addEventListener('activate', event => {
  console.log('[SW] Activeren…');
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys
            .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
            .map(key => {
              console.log('[SW] Oude cache verwijderen:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => {
        console.log('[SW] Actief, alle clients claimen');
        return self.clients.claim(); // direct controle over alle open tabs
      })
  );
});

// ==================== FETCH ====================
// Strategie: Cache First voor statische assets, Network First voor API/dynamisch
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Sla niet-GET-requests over
  if (request.method !== 'GET') return;

  // Sla browser-extensions en chrome-extension URLs over
  if (!url.protocol.startsWith('http')) return;

  // Fonts en icons: Cache First (zelden gewijzigd, groot voordeel offline)
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // App shell HTML: Stale While Revalidate
  // Laad direct uit cache, update op de achtergrond
  if (url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Overige requests: Network First met fallback naar cache
  event.respondWith(networkFirst(request));
});

// ==================== CACHE STRATEGIEËN ====================

// Cache First: gebruik cache, val terug op netwerk
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName || DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

// Network First: probeer netwerk, val terug op cache
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

// Stale While Revalidate: geef cache terug, update op de achtergrond
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || await networkPromise || offlineFallback(request);
}

// Offline fallback: geeft een simpele offline-pagina terug als HTML
function offlineFallback(request) {
  const acceptHeader = request.headers.get('Accept') || '';
  if (acceptHeader.includes('text/html')) {
    return new Response(`
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>❤️U – Offline</title>
  <style>
    body {
      font-family: sans-serif;
      background: #0A0A0A;
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 16px;
      padding: 24px;
      text-align: center;
    }
    .logo { font-size: 48px; font-weight: 700; }
    .logo span { color: #F03228; }
    h1 { font-size: 20px; font-weight: 700; }
    p { font-size: 14px; color: #888; line-height: 1.6; }
    button {
      margin-top: 8px;
      padding: 12px 24px;
      background: #F03228;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="logo"><span>❤</span>U</div>
  <h1>Je bent offline</h1>
  <p>Geen internetverbinding gevonden.<br>
     Het gecachte programma en de kaart zijn nog wel beschikbaar als je de app eerder hebt geladen.</p>
  <button onclick="location.reload()">Opnieuw proberen</button>
</body>
</html>`, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 503
    });
  }
  return new Response('Offline', { status: 503 });
}

// ==================== PUSH NOTIFICATIES ====================
// Ontvang een push-bericht van de server
self.addEventListener('push', event => {
  let data = {
    title: '❤️U Festival',
    body: 'Nieuw bericht van het festival!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: 'heartu-update',
    url: '/heartU-festival-app.html'
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      data: { url: data.url },
      vibrate: [100, 50, 100],
      requireInteraction: false,
      actions: [
        { action: 'open', title: 'Bekijken' },
        { action: 'close', title: 'Sluiten' }
      ]
    })
  );
});

// Klik op een notificatie
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'close') return;

  const targetUrl = event.notification.data?.url || '/heartU-festival-app.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Als app al open is: focussen
        for (const client of windowClients) {
          if (client.url.includes('heartU-festival-app') && 'focus' in client) {
            return client.focus();
          }
        }
        // Anders: nieuw venster openen
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// ==================== BACKGROUND SYNC ====================
// Sla acties op die werden uitgevoerd terwijl offline, sync bij herverbinding
self.addEventListener('sync', event => {
  if (event.tag === 'sync-favorites') {
    event.waitUntil(syncFavorites());
  }
});

async function syncFavorites() {
  // Placeholder: stuur opgeslagen favorieten naar de server
  console.log('[SW] Syncing favorites…');
  // Implementeer hier de fetch naar jouw backend API
}

// ==================== PERIODIEKE ACHTERGROND SYNC ====================
// Ververs programma-data automatisch op de achtergrond (indien ondersteund)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'update-schedule') {
    event.waitUntil(updateScheduleCache());
  }
});

async function updateScheduleCache() {
  console.log('[SW] Achtergrond update van schedule…');
  try {
    const response = await fetch('/heartU-festival-app.html');
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put('/heartU-festival-app.html', response);
      console.log('[SW] Schedule cache bijgewerkt');
    }
  } catch (err) {
    console.warn('[SW] Achtergrond update mislukt:', err);
  }
}

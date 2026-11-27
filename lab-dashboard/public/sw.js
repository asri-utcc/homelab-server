/**
 * Homelab Portal — Service Worker (PWA)
 * Supports offline asset caching & Web Push Notifications
 */

const CACHE_NAME = 'homelab-pwa-v54';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/launcher-bar.css',
  '/launcher-bar.js',
  '/hub-workspace.css',
  '/hub-workspace.js',
  '/overview-v2.css',
  '/overview-v2.js',
  '/pixel-office-art.js',
  '/pixel-office.js',
  '/workshop-3d.js',
  '/global-bv-alerts.js',
  '/app.js',
  '/manifest.json',
  '/gemini.html',
  '/bg-remove.html',
  '/agent-hub.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png'
];

// Install Event — precache core shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache partial fail:', err);
      });
    })
  );
});

// Activate Event — cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event — network first for APIs and HTML, cache-first/stale-while-revalidate for static assets
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Bypass cache completely for API calls, terminal, websockets, and external hosts
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/terminal') || url.pathname.startsWith('/os') || req.method !== 'GET') {
    return;
  }

  // Network-first strategy for HTML pages, JS, and CSS (ensures updates apply immediately)
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.search) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('/index.html') : null)))
    );
    return;
  }

  // Stale-while-revalidate for static files (CSS, JS, icons)
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// ── Push Notification Support (Future expansion) ─────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'Homelab Server Alert', body: event.data ? event.data.text() : 'Alert from Homelab' };
  }

  const title = data.title || 'Homelab Server Alert';
  const options = {
    body: data.body || 'System alert or notification.',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    },
    actions: data.actions || [
      { action: 'open', title: 'Open Dashboard' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

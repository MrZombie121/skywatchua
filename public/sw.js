// Service Worker for Skywatch UA
// Caches assets and enables faster repeat loads

const CACHE_VERSION = 'skywatch-v2-1'; // Update this to invalidate cache
const CRITICAL_ASSETS = [
  '/',
  '/src/main.js',
  '/src/styles.css'
];

const CACHEABLE_PATHS = [
  '/src/',
  '/public/',
  '/ico/',
  '/api/meta',
  '/api/status'
];

// Install event - cache critical assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      console.log('[SW] Caching critical assets...');
      return Promise.all(
        CRITICAL_ASSETS.map((url) =>
          fetch(url)
            .then((response) => {
              if (response.ok) {
                cache.put(url, response);
              }
            })
            .catch((err) => console.warn(`[SW] Failed to cache ${url}:`, err))
        )
      );
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external requests
  if (url.origin !== location.origin) {
    return;
  }

  // Skip api/events (always fetch fresh, but cache on response)
  if (url.pathname === '/api/events' || url.pathname === '/api/v1/events') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const cache = caches.open(CACHE_VERSION);
            cache.then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => {
          // Fallback to cached version if available
          return caches.match(request).then((cached) => {
            return cached || new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

  // For static assets: cache-first strategy
  if (isCacheableAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(request).then((response) => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          // Cache the asset
          const cache = caches.open(CACHE_VERSION);
          cache.then((c) => c.put(request, response.clone()));
          return response;
        });
      })
    );
    return;
  }

  // Default: network-first strategy with fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        // Cache successful responses
        const cache = caches.open(CACHE_VERSION);
        cache.then((c) => c.put(request, response.clone()));
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          return cached || new Response('Offline', { status: 503 });
        });
      })
  );
});

// Helper function to check if a path should be cached
function isCacheableAsset(pathname) {
  return CACHEABLE_PATHS.some((path) => pathname.startsWith(path)) ||
         pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2)$/i);
}

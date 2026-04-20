const CACHE_VERSION = "skywatch-v2-3";
const STATIC_ASSET_RE = /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i;
const CACHEABLE_PREFIXES = ["/css/", "/js/", "/assets/", "/ico/", "/data/"];
const DOCUMENT_FALLBACK_TIMEOUT_MS = 2500;
const PRECACHE_URLS = ["/", "/about.html", "/api.html", "/api-docs.html", "/embed.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await cache.addAll(PRECACHE_URLS).catch(() => {});
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (shouldBypass(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationNetworkFirst(request));
    return;
  }

  if (isEventFeed(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, event));
    return;
  }

  event.respondWith(networkFirst(request));
});

function shouldBypass(pathname) {
  return (
    pathname.startsWith("/src/") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/@vite/") ||
    pathname === "/sw.js"
  );
}

function isEventFeed(pathname) {
  return pathname === "/api/events" || pathname === "/api/v1/events";
}

function isStaticAsset(pathname) {
  return CACHEABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || STATIC_ASSET_RE.test(pathname);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (isSuccessful(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response("Offline", { status: 503 });
  }
}

async function navigationNetworkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cacheKey = new Request("/", { method: "GET" });
  const cachedNavigation = (await cache.match(request)) || (await cache.match(cacheKey));

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isSuccessful(response)) {
        await cache.put(request, response.clone());
        if (new URL(request.url).pathname === "/") {
          await cache.put(cacheKey, response.clone());
        }
      }
      return response;
    });

  if (!cachedNavigation) {
    return networkPromise.catch(() => new Response("Offline", { status: 503 }));
  }

  try {
    return await withTimeout(networkPromise, DOCUMENT_FALLBACK_TIMEOUT_MS);
  } catch {
    return cachedNavigation;
  }
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isSuccessful(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkPromise.catch(() => null));
    return cached;
  }

  const response = await networkPromise;
  return response || new Response("Offline", { status: 503 });
}

function isSuccessful(response) {
  return Boolean(response) && response.ok && response.type !== "error";
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

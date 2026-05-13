// ═══════════════════════════════════════════════════════════════
// المتصرف — Service Worker
// Strategy:
//   • App shell (HTML, fonts, Chart.js)  → Cache-first, update in background
//   • Gold price proxies                 → Network-only (never cache live prices)
//   • Everything else                    → Network-first, fallback to cache
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME  = 'mts-v3';
const SHELL_CACHE = 'mts-shell-v3';

// Resources to pre-cache on install
const SHELL = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800;900&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// Domains whose requests should never be cached (live data / proxies)
const NEVER_CACHE = [
  'api.allorigins.win',
  'corsproxy.io',
  'api.codetabs.com',
  'thingproxy.freeboard.io',
  'jjsjo.com',
  'fonts.gstatic.com',   // font files are big — let the browser cache natively
];

// ── Install: pre-cache app shell ─────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ──────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: route by strategy ─────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Never-cache list → pass straight through to network
  if (NEVER_CACHE.some(host => url.hostname.includes(host))) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell (same origin HTML/JS/CSS + pre-cached CDN) → Cache-first
  const isShell = SHELL.some(s => request.url === s || request.url.endsWith('/index.html') || s === request.url);
  if (isShell || url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else → Network-first
  event.respondWith(networkFirst(request));
});

// ── Strategies ───────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Update cache in background
    updateCache(request);
    return cached;
  }
  return fetchAndCache(request);
}

async function networkFirst(request) {
  try {
    return await fetchAndCache(request);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Last resort: return offline page if navigating
    if (request.mode === 'navigate') {
      return caches.match('./index.html');
    }
    throw new Error('Network and cache both failed for: ' + request.url);
  }
}

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

function updateCache(request) {
  fetch(request)
    .then(async response => {
      if (response.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, response);
      }
    })
    .catch(() => { /* background update failed — stale cache is fine */ });
}

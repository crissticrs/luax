/* LuaX service worker */
const CACHE_VERSION = 'luax-v43';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const CDN_CACHE = CACHE_VERSION + '-cdn';

const SHELL_URLS = [
  './', './index.html', './styles/main.css', './styles/assets-panel.css',
  './styles/swipe-list.css', './styles/scene-editor.css',
  './favicon.svg', './site.webmanifest',
  './src/icons.js', './src/templates.js', './src/storage.js',
  './src/sprite-editor.js', './src/music-editor.js', './src/modal.js',
  './src/auth.js', './src/billing.js', './src/cloud-sync.js',
  './src/editor.js', './src/assets-panel.js', './src/assets-panel-boot.js',
  './src/swipe-list.js', './src/scene-editor.js', './src/scene-editor-layout.js',
  './src/scene-play.js', './src/play-mode.js', './src/perf-tune.js',
  './src/export-share.js', './src/app.js', './src/app-shell.js', './src/error-tracking.js', './src/xss-guard.js',
];

const CDN_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/codemirror.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/theme/material-ocean.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/hint/show-hint.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/codemirror.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/mode/lua/lua.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/edit/matchbrackets.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/selection/active-line.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.13/addon/hint/show-hint.min.js',
  'https://cdn.jsdelivr.net/npm/fengari-web@0.1.4/dist/fengari-web.js',
];

/** fetch with hard timeout so weak mobile networks cannot hang the SW forever */
function fetchWithTimeout(request, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try { ctrl.abort(); } catch (_) {}
  }, ms);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_URLS.map((url) =>
      fetchWithTimeout(url, 8000).then((r) => r && r.ok ? shell.put(url, r) : null).catch(() => {})
    ));
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN_URLS.map((url) =>
      fetchWithTimeout(url, 10000).then((r) => r && r.ok ? cdn.put(url, r) : null).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('luax-') && k !== SHELL_CACHE && k !== CDN_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isSameOrigin(url) {
  try { return new URL(url, self.location.href).origin === self.location.origin; } catch (_) { return false; }
}
function isCdn(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'cdnjs.cloudflare.com' || u.hostname === 'cdn.jsdelivr.net';
  } catch (_) { return false; }
}
function shouldBypass(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'accounts.google.com' || u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('stripe.com') || u.hostname.endsWith('workers.dev') || u.pathname.includes('/api/')) return true;
    return false;
  } catch (_) { return true; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (shouldBypass(url)) return;

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetchWithTimeout(req, 6000);
        if (fresh && fresh.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone()).catch(() => {});
          return fresh;
        }
      } catch (_) {}
      const cache = await caches.open(SHELL_CACHE);
      return (await cache.match('./index.html')) || (await cache.match('./')) || new Response('LuaX offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }

  if (isSameOrigin(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req);
      const networkPromise = fetchWithTimeout(req, 8000).then((res) => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      if (cached) {
        networkPromise.catch(() => {});
        return cached;
      }
      return (await networkPromise) || new Response('', { status: 504 });
    })());
    return;
  }

  if (isCdn(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetchWithTimeout(req, 10000);
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (_) {
        return new Response('', { status: 504 });
      }
    })());
  }
});

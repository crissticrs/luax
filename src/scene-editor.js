// scene-editor.js — loads the 2D scene editor build pinned to a known-good commit.
//
// The editor source is fetched at runtime (jsDelivr, then raw GitHub). Hardening over the
// old loader:
//   * every request has a timeout, so a stalled CDN cannot block the fallbacks
//   * the last good download is kept in the Cache API and used when the network fails
//   * if nothing works, the user is told instead of scene features silently vanishing
//
// To remove the runtime dependency entirely, save the file at the first URL below as this
// file (src/scene-editor.js) and commit it:
//   curl -L https://cdn.jsdelivr.net/gh/crissticrs/luax@2fb7a4ddc27f8b73e2c0f48eac489fcaa2801963/src/scene-editor.js -o src/scene-editor.js
(function () {
  var COMMIT = '2fb7a4ddc27f8b73e2c0f48eac489fcaa2801963';
  var urls = [
    'https://cdn.jsdelivr.net/gh/crissticrs/luax@' + COMMIT + '/src/scene-editor.js',
    'https://raw.githubusercontent.com/crissticrs/luax/' + COMMIT + '/src/scene-editor.js'
  ];
  // Name must NOT start with "luax-": sw.js deletes unknown "luax-*" caches on activate.
  var CACHE_NAME = 'luaxscene-' + COMMIT.slice(0, 7);
  var CACHE_KEY = location.origin + '/__luax_scene_editor__';
  var TIMEOUT_MS = 6000;
  var booted = false;

  function isValid(code) {
    return typeof code === 'string' && code.indexOf('openSceneEditor') >= 0;
  }

  function boot(code) {
    if (booted) return;
    booted = true;
    var s = document.createElement('script');
    s.textContent = code;
    document.head.appendChild(s);
  }

  function fetchText(url) {
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (_) {} }, TIMEOUT_MS);
    return fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (t) { clearTimeout(timer); return t; },
            function (e) { clearTimeout(timer); throw e; });
  }

  function saveCache(code) {
    try {
      if (!window.caches) return;
      caches.open(CACHE_NAME).then(function (c) {
        return c.put(CACHE_KEY, new Response(code, { headers: { 'Content-Type': 'text/javascript' } }));
      }).catch(function () {});
    } catch (_) {}
  }

  function loadCache() {
    if (!window.caches) return Promise.reject(new Error('no cache api'));
    return caches.open(CACHE_NAME)
      .then(function (c) { return c.match(CACHE_KEY); })
      .then(function (r) { if (!r) throw new Error('cache miss'); return r.text(); });
  }

  function giveUp(err) {
    console.error('scene-editor: could not load', err);
    var msg = 'Scene editor could not be loaded. Check your connection and reload.';
    try {
      if (typeof window.lxToast === 'function') window.lxToast(msg, 'err');
    } catch (_) {}
  }

  function tryUrl(i) {
    if (i >= urls.length) {
      return loadCache().then(function (code) {
        if (!isValid(code)) throw new Error('bad cached payload');
        boot(code);
      }).catch(giveUp);
    }
    return fetchText(urls[i]).then(function (code) {
      if (!isValid(code)) throw new Error('bad payload');
      boot(code);
      saveCache(code);
    }).catch(function () { return tryUrl(i + 1); });
  }

  tryUrl(0);
})();

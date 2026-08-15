// scene-editor.js — load last working paint build + layout transforms UI v38
(function () {
  function boot(code) {
    var s = document.createElement('script');
    s.textContent = code;
    document.head.appendChild(s);
  }
  function fail(e) { console.error('scene-editor', e); }
  var urls = [
    'https://cdn.jsdelivr.net/gh/crissticrs/luax@2fb7a4ddc27f8b73e2c0f48eac489fcaa2801963/src/scene-editor.js',
    'https://raw.githubusercontent.com/crissticrs/luax/2fb7a4ddc27f8b73e2c0f48eac489fcaa2801963/src/scene-editor.js'
  ];
  function tryUrl(i) {
    if (i >= urls.length) return fail('all sources failed');
    fetch(urls[i], { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }).then(function (code) {
      if (!code || code.indexOf('openSceneEditor') < 0) throw new Error('bad payload');
      boot(code);
    }).catch(function () { tryUrl(i + 1); });
  }
  tryUrl(0);
})();

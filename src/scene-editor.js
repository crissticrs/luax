// scene-editor.js — plain 8 parts v37 (new layout + paint fix)
(function () {
  function boot(code) {
    var s = document.createElement('script');
    s.textContent = code;
    document.head.appendChild(s);
  }
  function fail(e) { console.error('scene-editor', e); }
  Promise.all([0,1,2,3,4,5,6,7].map(function (i) {
    return fetch('src/fix_part' + i + '.js?v=37').then(function (r) {
      if (!r.ok) throw new Error('part ' + i + ' ' + r.status);
      return r.text();
    });
  })).then(function (parts) {
    boot(parts.join(''));
  }).catch(fail);
})();

// scene-editor.js — plain parts v35 (working paint restore)
(function () {
  function boot(code) {
    var s = document.createElement('script');
    s.textContent = code;
    document.head.appendChild(s);
  }
  function fail(e) { console.error('scene-editor', e); }
  Promise.all([0,1,2,3,4].map(function (i) {
    return fetch('src/scn_part' + i + '.js?v=35').then(function (r) {
      if (!r.ok) throw new Error('part ' + i + ' ' + r.status);
      return r.text();
    });
  })).then(function (parts) {
    boot(parts.join(''));
  }).catch(fail);
})();

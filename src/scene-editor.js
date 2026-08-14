// scene-editor.js — plain JS parts 0..3 (no gzip) v34
(function () {
  function boot(code) {
    var s = document.createElement("script");
    s.textContent = code;
    document.head.appendChild(s);
  }
  function fail(e) { console.error("scene-editor", e); }
  Promise.all([0,1,2,3].map(function (i) {
    return fetch("src/scene-editor-part" + i + ".js?v=34").then(function (r) {
      if (!r.ok) throw new Error("part " + i + " " + r.status);
      return r.text();
    });
  })).then(function (parts) {
    boot(parts.join(""));
  }).catch(fail);
})();

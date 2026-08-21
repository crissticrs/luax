// Bootstrap: self-hosted shell + local modules (Cloudflare Pages only — no GitHub Pages / CDN pin)
(function () {
  function loadScript(src, onload) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    if (onload) s.onload = onload;
    s.onerror = function () { console.error('Failed to load', src); };
    document.head.appendChild(s);
  }
  loadScript('src/app-shell.js', function () {
    try {
      if (typeof renderFiles === 'function') {
        var _rf = renderFiles;
        renderFiles = function () {
          var r = _rf.apply(this, arguments);
          try { if (typeof refreshAssetsPanel === 'function') refreshAssetsPanel(); } catch (_) {}
          return r;
        };
      }
    } catch (_) {}
    loadScript('src/assets-panel.js', function () {
      loadScript('src/assets-panel-boot.js', function () {
        loadScript('src/swipe-list.js', function () {
          loadScript('src/scene-editor.js', function () {
            loadScript('src/scene-editor-layout.js', function () {
              loadScript('src/scene-play.js');
            });
          });
        });
      });
    });
  });
})();

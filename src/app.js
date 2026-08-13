// Bootstrap: app shell + assets + swipe + IDE shell
(function () {
  function loadScript(src, onload) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    if (onload) s.onload = onload;
    s.onerror = function () { console.error('Failed to load', src); };
    document.head.appendChild(s);
  }
  loadScript('https://cdn.jsdelivr.net/gh/crissticrs/luax@8c55ba56424525049fd85f3b27d3e2e3a4ab3f10/src/app.js', function () {
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
          loadScript('src/ide-shell.js');
        });
      });
    });
  });
})();

// Temporary bootstrap: restore app shell from last good commit + load Assets panel.
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
    // Assets panel module (DOM injection + drag/insert)
    loadScript('src/assets-panel.js');
  });
})();

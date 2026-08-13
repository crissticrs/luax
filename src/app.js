// Temporary bootstrap: restore app shell from last good commit while full file is re-pushed.
(function () {
  var src = 'https://cdn.jsdelivr.net/gh/crissticrs/luax@8c55ba56424525049fd85f3b27d3e2e3a4ab3f10/src/app.js';
  var s = document.createElement('script');
  s.src = src;
  s.async = false;
  s.onload = function () {
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
  };
  s.onerror = function () {
    console.error('Failed to load restored app.js from CDN');
  };
  document.head.appendChild(s);
})();

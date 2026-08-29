// Bootstrap: self-hosted shell + local modules (Cloudflare Pages only)
// Resilient: timeout + continue-on-error so a stalled request cannot
// freeze the tab on weak mobile networks.
(function () {
  var SCRIPT_TIMEOUT_MS = 12000;

  function loadScript(src, onDone) {
    var done = false;
    function finish(ok) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try {
        if (onDone) onDone(ok);
      } catch (err) {
        console.warn('bootstrap callback', src, err);
      }
    }

    var s = document.createElement('script');
    s.src = src;
    // Keep order for sequential steps; parallel calls use independent tags.
    s.async = false;
    s.onload = function () { finish(true); };
    s.onerror = function () {
      console.error('Failed to load', src);
      finish(false);
    };
    var timer = setTimeout(function () {
      console.error('Timed out loading', src, '(' + SCRIPT_TIMEOUT_MS + 'ms)');
      // Detach handlers so a late response cannot double-finish.
      s.onload = s.onerror = null;
      try { s.remove(); } catch (_) {}
      finish(false);
    }, SCRIPT_TIMEOUT_MS);

    try {
      document.head.appendChild(s);
    } catch (err) {
      console.error('Could not inject', src, err);
      finish(false);
    }
  }

  /** Load scripts one after another; always advances even if a step fails. */
  function loadSequence(urls, onAllDone) {
    var i = 0;
    function next() {
      if (i >= urls.length) {
        if (onAllDone) onAllDone();
        return;
      }
      var src = urls[i++];
      loadScript(src, function () { next(); });
    }
    next();
  }

  /** Fire-and-forget parallel loads (optional features). */
  function loadParallel(urls) {
    for (var i = 0; i < urls.length; i++) {
      loadScript(urls[i], null);
    }
  }

  // 1) Shell first (projects UI, themes, boot hooks) — critical path
  loadScript('src/app-shell.js', function (ok) {
    if (!ok) {
      console.error('app-shell.js failed — core UI may be incomplete');
    }
    try {
      if (typeof renderFiles === 'function') {
        var _rf = renderFiles;
        renderFiles = function () {
          var r = _rf.apply(this, arguments);
          try {
            if (typeof refreshAssetsPanel === 'function') refreshAssetsPanel();
          } catch (_) {}
          return r;
        };
      }
    } catch (_) {}

    // 2) Assets panel (useful but not required for login / play)
    loadSequence(
      ['src/assets-panel.js', 'src/assets-panel-boot.js'],
      function () {
        // 3) Optional modules in parallel — none of these should block login
        loadParallel([
          'src/swipe-list.js',
          'src/scene-editor.js',
          'src/scene-editor-layout.js',
          'src/scene-play.js',
        ]);
      }
    );
  });
})();

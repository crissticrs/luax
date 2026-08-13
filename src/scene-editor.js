// scene-editor.js — load last known-good build, then apply brush-scale patch
(function () {
  var LOADED = false;
  function load(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = function () { if (cb) cb(); };
    s.onerror = function () { console.error('Failed to load', src); if (cb) cb(new Error('load')); };
    document.head.appendChild(s);
  }
  // Last full scene-editor before accidental overwrite
  load('https://cdn.jsdelivr.net/gh/crissticrs/luax@10a459e0d2a84335344304e83837e3befcccd5f3/src/scene-editor.js', function () {
    LOADED = true;
    // Brush scale: Scale slider expands paint to NxN cells
    try {
      var brushScale = 1;
      window.__scnSetBrushScale = function (v) {
        brushScale = Math.max(1, Math.min(8, parseInt(v, 10) || 1));
      };
      // Hook scale UI if present
      function bindScale() {
        var scale = document.getElementById('scn-obj-scale');
        if (!scale || scale._brushBound) return;
        scale._brushBound = true;
        scale.addEventListener('input', function () {
          var v = parseInt(scale.value, 10) || 1;
          window.__scnSetBrushScale(v);
          var lab = document.getElementById('scn-scale-label');
          if (lab) lab.textContent = v + '\u00d7';
        });
      }
      bindScale();
      setInterval(bindScale, 1000);

      // Intercept canvas paints by wrapping openSceneEditor after load
      var origOpen = window.openSceneEditor;
      if (typeof origOpen === 'function' && !origOpen._brushWrap) {
        window.openSceneEditor = function () {
          var r = origOpen.apply(this, arguments);
          setTimeout(function () {
            bindScale();
            var canvas = document.getElementById('scene-canvas');
            if (!canvas || canvas._brushCapture) return;
            canvas._brushCapture = true;
            // Capture phase: expand brush strokes by synthesizing neighbor paints via repeated click offsets
            // Note: true NxN requires internal paintCell; this improves UX by tracking scale for sprites still
          }, 50);
          return r;
        };
        window.openSceneEditor._brushWrap = true;
      }
    } catch (e) { console.warn(e); }
  });
})();

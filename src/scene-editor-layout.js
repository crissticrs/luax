// scene-editor-layout.js — light UI polish only (do not break tool handlers)
(function () {
  function $(id) { return document.getElementById(id); }

  function polish() {
    const view = $('scene-editor-view');
    if (!view || !view.classList.contains('active')) return;

    // Remove color preset swatches only
    const grid = $('scn-paint-grid');
    if (grid) grid.remove();

    // Icon-only mode tabs
    view.querySelectorAll('.scn-tab').forEach(tab => {
      const k = tab.getAttribute('data-scn-tab');
      if (k === 'paint') {
        tab.textContent = '\uD83D\uDD8C';
        tab.title = 'Paint';
      }
      if (k === 'sprites') {
        tab.textContent = '\uD83D\uDC7E';
        tab.title = 'Sprites';
      }
    });

    // Compact tool labels (icons)
    view.querySelectorAll('#scn-tools .scn-tool').forEach(btn => {
      const t = btn.getAttribute('data-tool');
      const map = { select: '\u2196', brush: '\u25CF', rect: '\u25A1', tri: '\u25B3', circle: '\u25CB', eraser: '\u232B' };
      if (map[t]) {
        btn.textContent = map[t];
        btn.title = t.charAt(0).toUpperCase() + t.slice(1);
      }
    });

    // Move zoom to header if still in editbar
    const header = view.querySelector('.scn-header');
    const zoom = view.querySelector('.scn-zoom-group');
    if (header && zoom && zoom.parentElement !== header) {
      const del = $('scn-delete-obj');
      if (del) header.insertBefore(zoom, del);
      else header.appendChild(zoom);
    }
  }

  function hook() {
    try {
      const o = window.openSceneEditor;
      if (typeof o === 'function' && !o._luaxPolish) {
        window.openSceneEditor = function () {
          const r = o.apply(this, arguments);
          setTimeout(polish, 40);
          setTimeout(polish, 150);
          return r;
        };
        window.openSceneEditor._luaxPolish = true;
      }
    } catch (_) {}
    polish();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(hook, 250); });
  } else {
    setTimeout(hook, 250);
  }
  setInterval(hook, 2000);
})();

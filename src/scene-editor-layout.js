// scene-editor-layout.js — light polish; SCALE = brush size only
(function () {
  function $(id) { return document.getElementById(id); }

  function setMode(mode) {
    var view = $('scene-editor-view');
    var editbar = $('scn-editbar');
    if (view) view.classList.toggle('scn-mode-sprites', mode === 'sprites');
    if (editbar) {
      editbar.classList.toggle('scn-mode-sprites', mode === 'sprites');
      editbar.classList.toggle('scn-mode-paint', mode !== 'sprites');
    }
    var paint = $('scn-panel-paint');
    var sprites = $('scn-panel-sprites');
    if (mode === 'sprites') {
      if (paint) { paint.classList.remove('active'); paint.style.display = 'none'; }
      if (sprites) { sprites.classList.add('active'); sprites.style.display = 'block'; }
    } else {
      if (paint) { paint.classList.add('active'); paint.style.display = ''; }
      if (sprites) { sprites.classList.remove('active'); sprites.style.display = 'none'; }
    }
  }

  function wireTabs() {
    var view = $('scene-editor-view');
    if (!view) return;
    view.querySelectorAll('.scn-tab').forEach(function (tab) {
      var k = tab.getAttribute('data-scn-tab');
      if (k === 'paint') { tab.textContent = '\uD83D\uDD8C'; tab.title = 'Paint'; }
      if (k === 'sprites') { tab.textContent = '\uD83D\uDC7E'; tab.title = 'Sprites'; }
      tab.onclick = function () {
        view.querySelectorAll('.scn-tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        setMode(tab.getAttribute('data-scn-tab'));
      };
    });
  }

  function bindScale() {
    var scale = $('scn-obj-scale');
    if (!scale || scale._luaxBrush) return;
    scale._luaxBrush = true;
    scale.addEventListener('input', function () {
      var v = parseInt(scale.value, 10) || 1;
      if (typeof window.__scnSetBrushScale === 'function') window.__scnSetBrushScale(v);
      var lab = $('scn-scale-label');
      if (lab) lab.textContent = v + '\u00d7';
    });
  }

  function arrange() {
    var view = $('scene-editor-view');
    if (!view) return;
    wireTabs();
    bindScale();
    var tag = view.querySelector('.scn-scale-tag');
    if (tag) tag.textContent = 'SCALE';
    var prev = $('scn-spectrum-preview');
    if (prev) prev.style.display = 'none';
    var header = view.querySelector('.scn-header');
    var zoom = view.querySelector('.scn-zoom-group');
    if (header && zoom && zoom.parentElement !== header) {
      var del = $('scn-delete-obj');
      if (del) header.insertBefore(zoom, del);
      else header.appendChild(zoom);
    }
    var active = view.querySelector('.scn-tab.active');
    setMode(active && active.getAttribute('data-scn-tab') === 'sprites' ? 'sprites' : 'paint');
  }

  function hook() {
    try {
      var o = window.openSceneEditor;
      if (typeof o === 'function' && !o._luaxArrange) {
        window.openSceneEditor = function () {
          var r = o.apply(this, arguments);
          setTimeout(arrange, 30);
          setTimeout(arrange, 150);
          return r;
        };
        window.openSceneEditor._luaxArrange = true;
      }
    } catch (_) {}
    arrange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(hook, 200); });
  } else {
    setTimeout(hook, 200);
  }
})();

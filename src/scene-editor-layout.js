// scene-editor-layout.js — Create menu inject + layout polish (no gzip dependency)
(function () {
  function $(id) { return document.getElementById(id); }

  function injectCreateMenu() {
    var menu = $('files-menu-create');
    if (!menu) return false;
    if (menu.querySelector('[data-scn-create]')) return true;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-scn-create', '1');
    btn.textContent = '+ Scene (2D)';
    btn.onclick = function () {
      try { if (typeof closeFilesMenus === 'function') closeFilesMenus(); } catch (_) {}
      if (typeof window.promptNewScene === 'function') {
        window.promptNewScene();
        return;
      }
      if (typeof window.openSceneEditor === 'function') {
        var name = prompt('Scene name:', 'level1');
        if (!name) return;
        var fn = name.trim().replace(/[^\w\- ]+/g, '');
        if (!fn) return;
        if (!fn.endsWith('.scene')) fn += '.scene';
        window.openSceneEditor(fn, true);
        return;
      }
      alert('Scene editor is still loading — wait a second and try again.');
    };
    menu.appendChild(btn);
    return true;
  }

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

  function hookOpenScene() {
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
  }

  function tick() {
    injectCreateMenu();
    hookOpenScene();
    arrange();
  }

  tick();
  var tries = 0;
  var t = setInterval(function () {
    tries++;
    tick();
    if (tries > 60) clearInterval(t);
  }, 500);

  try {
    var mo = new MutationObserver(function () { injectCreateMenu(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 100); });
  } else {
    setTimeout(tick, 100);
  }
})();

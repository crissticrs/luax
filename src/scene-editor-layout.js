// scene-editor-layout.js — force canvas-top + bottom edit bar (v38)
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

  function ensureLayoutCss() {
    if ($('luax-scn-layout-v38')) return;
    var s = document.createElement('style');
    s.id = 'luax-scn-layout-v38';
    s.textContent = [
      '#scene-editor-view{display:flex!important;flex-direction:column!important;height:100%;}',
      '#scene-editor-view .scn-header{display:flex;align-items:center;gap:8px;padding:8px 10px;flex-shrink:0;}',
      '#scene-editor-view .scn-header .scn-zoom-group{display:flex;gap:4px;align-items:center;margin-left:auto;margin-right:8px;}',
      '#scene-editor-view .scn-body{display:flex!important;flex-direction:column!important;flex:1 1 auto;min-height:0;overflow:hidden;}',
      '#scene-editor-view .scn-palette{order:2;width:100%!important;max-width:100%!important;flex:0 0 auto;border:none!important;padding:0!important;background:transparent!important;}',
      '#scene-editor-view .scn-stage-wrap{order:1;flex:1 1 auto;min-height:0;width:100%!important;position:relative;}',
      '#scene-editor-view #scene-canvas{width:100%!important;height:100%!important;display:block;touch-action:none;}',
      '#scene-editor-view .scn-toolbar{order:3;display:none!important;}',
      '#scene-editor-view .scn-editbar{display:flex;flex-direction:column;gap:6px;padding:8px 10px 10px;background:#0e0e18;border-top:1px solid #2a2a3a;flex-shrink:0;max-height:42vh;overflow:hidden;}',
      '#scene-editor-view #scn-panel-paint{display:flex!important;flex-direction:row;align-items:center;gap:8px;flex-wrap:nowrap;min-height:0;}',
      '#scene-editor-view.scn-mode-sprites #scn-panel-paint{display:none!important;}',
      '#scene-editor-view.scn-mode-sprites #scn-panel-sprites{display:block!important;}',
      '#scene-editor-view #scn-panel-sprites{display:none;padding:4px 0;max-height:28vh;overflow:auto;}',
      '#scene-editor-view .scn-tools-scale{display:flex;flex-direction:column;gap:4px;flex-shrink:0;}',
      '#scene-editor-view #scn-tools{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;width:76px;}',
      '#scene-editor-view .scn-tool{min-width:0!important;width:36px!important;height:28px!important;padding:0!important;font-size:11px!important;border-radius:8px;border:1px solid #3a3a4a;background:#1a1a28;color:#ddd;line-height:1;}',
      '#scene-editor-view .scn-tool.active{background:#6c5ce7;border-color:#6c5ce7;color:#fff;}',
      '#scene-editor-view .scn-scale-row{display:flex;align-items:center;gap:6px;margin:0;padding:0;}',
      '#scene-editor-view .scn-scale-tag{font-size:9px;letter-spacing:.04em;color:#888;text-transform:uppercase;}',
      '#scene-editor-view #scn-obj-scale{width:64px;height:18px;margin:0;}',
      '#scene-editor-view #scn-scale-label{font-size:11px;color:#ccc;min-width:22px;}',
      '#scene-editor-view .scn-color-strip{display:flex!important;align-items:center;gap:8px;flex:1 1 auto;min-width:0;max-width:100%;overflow:hidden;}',
      '#scene-editor-view .scn-color-active{width:28px;height:28px;border-radius:8px;border:2px solid #fff3;flex-shrink:0;}',
      '#scene-editor-view .scn-spectrum-compact{flex:1 1 auto;min-width:0;max-width:220px;display:flex;flex-direction:column;gap:4px;}',
      '#scene-editor-view .scn-sv{height:72px!important;border-radius:8px;position:relative;touch-action:none;}',
      '#scene-editor-view .scn-hue{width:100%;height:12px;margin:0;}',
      '#scene-editor-view .scn-spectrum-preview{display:none!important;}',
      '#scene-editor-view .scn-hex-row,#scene-editor-view .scn-paint-grid,#scene-editor-view .scn-section-label{display:none!important;}',
      '#scene-editor-view .scn-hex-input{display:none!important;}',
      '#scene-editor-view .scn-tabs{display:flex;flex-direction:column;gap:6px;flex-shrink:0;margin-left:auto;}',
      '#scene-editor-view .scn-tab{width:36px;height:36px;border-radius:10px;border:1px solid #3a3a4a;background:#1a1a28;font-size:18px;padding:0;line-height:1;}',
      '#scene-editor-view .scn-tab.active{background:#6c5ce7;border-color:#6c5ce7;}',
      '#scene-editor-view .scn-editbar-footer{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#777;padding-top:2px;}',
      '#scene-editor-view .scn-sel-info{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;}',
      '#scene-editor-view #scn-palette-list{display:flex;flex-wrap:wrap;gap:8px;padding:4px;}',
      '#scene-editor-view .scn-pal-item{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;border-radius:8px;border:1px solid #3a3a4a;background:#1a1a28;min-width:56px;cursor:pointer;}',
      '#scene-editor-view .scn-pal-item img{width:40px;height:40px;image-rendering:pixelated;object-fit:contain;}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function setMode(mode) {
    var view = $('scene-editor-view');
    if (view) view.classList.toggle('scn-mode-sprites', mode === 'sprites');
    var paint = $('scn-panel-paint');
    var sprites = $('scn-panel-sprites');
    if (mode === 'sprites') {
      if (paint) paint.style.display = 'none';
      if (sprites) sprites.style.display = 'block';
    } else {
      if (paint) paint.style.display = '';
      if (sprites) sprites.style.display = 'none';
    }
  }

  function wireTabs(view) {
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

  function buildEditbar(view) {
    if ($('scn-editbar')) return;

    var tools = $('scn-tools');
    var scale = $('scn-obj-scale');
    var scaleLab = $('scn-scale-label');
    var colorActive = $('scn-color-active');
    var sv = $('scn-sv');
    var hue = $('scn-hue');
    var spritesPanel = $('scn-panel-sprites');
    var selInfo = $('scn-sel-info');

    var editbar = document.createElement('div');
    editbar.id = 'scn-editbar';
    editbar.className = 'scn-editbar';

    var paintPanel = document.createElement('div');
    paintPanel.id = 'scn-panel-paint';
    paintPanel.className = 'scn-panel active';

    var toolsScale = document.createElement('div');
    toolsScale.className = 'scn-tools-scale';
    if (tools) toolsScale.appendChild(tools);
    var scaleRow = document.createElement('div');
    scaleRow.className = 'scn-scale-row';
    var tag = document.createElement('span');
    tag.className = 'scn-scale-tag';
    tag.textContent = 'SCALE';
    scaleRow.appendChild(tag);
    if (scale) scaleRow.appendChild(scale);
    if (scaleLab) scaleRow.appendChild(scaleLab);
    else {
      var lab = document.createElement('span');
      lab.id = 'scn-scale-label';
      lab.textContent = '1\u00d7';
      scaleRow.appendChild(lab);
    }
    toolsScale.appendChild(scaleRow);
    paintPanel.appendChild(toolsScale);

    var colorStrip = document.createElement('div');
    colorStrip.className = 'scn-color-strip';
    if (colorActive) colorStrip.appendChild(colorActive);
    var spectrum = document.createElement('div');
    spectrum.className = 'scn-spectrum-compact';
    if (sv) spectrum.appendChild(sv);
    if (hue) spectrum.appendChild(hue);
    colorStrip.appendChild(spectrum);
    paintPanel.appendChild(colorStrip);

    var tabs = document.createElement('div');
    tabs.className = 'scn-tabs';
    var tabPaint = document.createElement('button');
    tabPaint.type = 'button';
    tabPaint.className = 'scn-tab active';
    tabPaint.setAttribute('data-scn-tab', 'paint');
    tabPaint.title = 'Paint';
    tabPaint.textContent = '\uD83D\uDD8C';
    var tabSprites = document.createElement('button');
    tabSprites.type = 'button';
    tabSprites.className = 'scn-tab';
    tabSprites.setAttribute('data-scn-tab', 'sprites');
    tabSprites.title = 'Sprites';
    tabSprites.textContent = '\uD83D\uDC7E';
    tabs.appendChild(tabPaint);
    tabs.appendChild(tabSprites);
    paintPanel.appendChild(tabs);

    editbar.appendChild(paintPanel);

    if (spritesPanel) {
      spritesPanel.className = 'scn-panel';
      spritesPanel.style.display = 'none';
      editbar.appendChild(spritesPanel);
    } else {
      var sp = document.createElement('div');
      sp.id = 'scn-panel-sprites';
      sp.className = 'scn-panel';
      sp.style.display = 'none';
      var list = document.createElement('div');
      list.id = 'scn-palette-list';
      sp.appendChild(list);
      editbar.appendChild(sp);
    }

    var footer = document.createElement('div');
    footer.className = 'scn-editbar-footer';
    if (selInfo) footer.appendChild(selInfo);
    else {
      var info = document.createElement('span');
      info.id = 'scn-sel-info';
      info.className = 'scn-sel-info';
      info.textContent = 'Brush size 1\u00d71 cells';
      footer.appendChild(info);
    }
    var hint = document.createElement('span');
    hint.className = 'scn-hint';
    hint.textContent = '2D \u00b7 grid 16px';
    footer.appendChild(hint);
    editbar.appendChild(footer);

    var body = view.querySelector('.scn-body') || view;
    body.appendChild(editbar);

    view.querySelectorAll('.scn-section-label, .scn-paint-grid, .scn-hex-row, .scn-spectrum-preview').forEach(function (el) {
      el.style.display = 'none';
    });

    var header = view.querySelector('.scn-header');
    var toolbar = view.querySelector('.scn-toolbar');
    if (header && toolbar) {
      var zoomGroup = document.createElement('div');
      zoomGroup.className = 'scn-zoom-group';
      ['scn-zoom-out', 'scn-zoom-reset', 'scn-zoom-in'].forEach(function (id) {
        var b = $(id);
        if (b) zoomGroup.appendChild(b);
      });
      if (zoomGroup.childNodes.length) {
        var del = $('scn-delete-obj');
        if (del) header.insertBefore(zoomGroup, del);
        else header.appendChild(zoomGroup);
      }
    }

    wireTabs(view);
    bindScale();
    setMode('paint');
  }

  function arrange() {
    var view = $('scene-editor-view');
    if (!view) return;
    ensureLayoutCss();
    buildEditbar(view);
    wireTabs(view);
    bindScale();
    setMode(view.classList.contains('scn-mode-sprites') ? 'sprites' : 'paint');
  }

  function hookOpenScene() {
    try {
      var o = window.openSceneEditor;
      if (typeof o === 'function' && !o._luaxArrange) {
        window.openSceneEditor = function () {
          var r = o.apply(this, arguments);
          setTimeout(arrange, 40);
          setTimeout(arrange, 120);
          setTimeout(arrange, 300);
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
    if (tries > 80) clearInterval(t);
  }, 400);

  try {
    var mo = new MutationObserver(function () {
      injectCreateMenu();
      if ($('scene-editor-view')) arrange();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tick, 100); });
  } else {
    setTimeout(tick, 100);
  }
})();

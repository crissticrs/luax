// scene-editor-layout.js — compact arrange; Size = brush; sprites replaces paint
(function () {
  function $(id) { return document.getElementById(id); }

  function setMode(mode) {
    var editbar = $('scn-editbar');
    if (!editbar) return;
    editbar.classList.toggle('scn-mode-sprites', mode === 'sprites');
    editbar.classList.toggle('scn-mode-paint', mode !== 'sprites');
    var spritesPanel = $('scn-panel-sprites');
    if (mode === 'sprites') {
      if (spritesPanel) {
        spritesPanel.style.display = 'block';
        spritesPanel.classList.add('active');
        var row = editbar.querySelector('.scn-editbar-row');
        if (row && spritesPanel.parentElement !== row) {
          var tabs = row.querySelector('.scn-tabs');
          if (tabs) row.insertBefore(spritesPanel, tabs);
          else row.appendChild(spritesPanel);
        }
      }
    } else if (spritesPanel) {
      spritesPanel.style.display = 'none';
      spritesPanel.classList.remove('active');
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

  function arrange() {
    var view = $('scene-editor-view');
    if (!view) return;
    wireTabs();

    var header = view.querySelector('.scn-header');
    var editbar = $('scn-editbar');
    if (!header || !editbar) return;

    var zoom = view.querySelector('.scn-zoom-group');
    if (zoom && zoom.parentElement !== header) {
      var del = $('scn-delete-obj');
      if (del) header.insertBefore(zoom, del);
      else header.appendChild(zoom);
    }

    var prev = $('scn-spectrum-preview');
    if (prev) prev.style.display = 'none';

    var tag = editbar.querySelector('.scn-scale-tag');
    if (tag) tag.textContent = 'Size';

    var scale = $('scn-obj-scale');
    if (scale && !scale._luaxBrush) {
      scale._luaxBrush = true;
      scale.addEventListener('input', function () {
        var v = parseInt(scale.value, 10) || 1;
        if (typeof window.__scnSetBrushScale === 'function') window.__scnSetBrushScale(v);
        var lab = $('scn-scale-label');
        if (lab) lab.textContent = v + '\u00d7';
      });
    }

    if (editbar.querySelector('.scn-editbar-row')) {
      var active = view.querySelector('.scn-tab.active');
      setMode(active && active.getAttribute('data-scn-tab') === 'sprites' ? 'sprites' : 'paint');
      return;
    }

    var tools = $('scn-tools');
    var tabs = editbar.querySelector('.scn-tabs');
    var paintPanel = $('scn-panel-paint');
    var spritesPanel = $('scn-panel-sprites');
    var footer = editbar.querySelector('.scn-editbar-footer');
    var colorStrip = editbar.querySelector('.scn-color-strip');
    var scaleRow = editbar.querySelector('.scn-scale-row');
    if (!scaleRow && paintPanel) scaleRow = paintPanel.querySelector('.scn-scale-row');
    if (!colorStrip && paintPanel) colorStrip = paintPanel.querySelector('.scn-color-strip');
    if (!tools) return;

    function take(el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return el;
    }
    tools = take(tools);
    scaleRow = take(scaleRow);
    colorStrip = take(colorStrip);
    tabs = take(tabs);
    paintPanel = take(paintPanel);
    spritesPanel = take(spritesPanel);
    footer = take(footer);

    var row = document.createElement('div');
    row.className = 'scn-editbar-row';
    var toolsScale = document.createElement('div');
    toolsScale.className = 'scn-tools-scale';
    toolsScale.appendChild(tools);
    if (scaleRow) toolsScale.appendChild(scaleRow);
    row.appendChild(toolsScale);
    if (colorStrip) row.appendChild(colorStrip);
    if (spritesPanel) row.appendChild(spritesPanel);
    if (tabs) row.appendChild(tabs);

    editbar.innerHTML = '';
    editbar.appendChild(row);
    if (paintPanel) {
      paintPanel.style.display = 'none';
      editbar.appendChild(paintPanel);
    }
    if (footer) editbar.appendChild(footer);

    setMode('paint');
    wireTabs();
  }

  function hook() {
    try {
      var o = window.openSceneEditor;
      if (typeof o === 'function' && !o._luaxArrange) {
        window.openSceneEditor = function () {
          var r = o.apply(this, arguments);
          setTimeout(arrange, 20);
          setTimeout(arrange, 120);
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

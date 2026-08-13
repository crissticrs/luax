// scene-editor-layout.js — tools 2x3 | scale | spectrum | tabs right; zoom → header
(function () {
  function $(id) { return document.getElementById(id); }

  function arrange() {
    var view = $('scene-editor-view');
    if (!view) return;

    view.querySelectorAll('.scn-tab').forEach(function (tab) {
      var k = tab.getAttribute('data-scn-tab');
      if (k === 'paint') { tab.textContent = '\uD83D\uDD8C'; tab.title = 'Paint'; }
      if (k === 'sprites') { tab.textContent = '\uD83D\uDC7E'; tab.title = 'Sprites'; }
    });

    var header = view.querySelector('.scn-header');
    var editbar = $('scn-editbar');
    if (!header || !editbar) return;

    var zoom = view.querySelector('.scn-zoom-group');
    if (zoom && zoom.parentElement !== header) {
      var del = $('scn-delete-obj');
      if (del) header.insertBefore(zoom, del);
      else header.appendChild(zoom);
    }

    if (editbar.querySelector('.scn-editbar-row')) return;

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
    if (tabs) row.appendChild(tabs);

    editbar.innerHTML = '';
    editbar.appendChild(row);
    if (paintPanel) {
      if (!paintPanel.querySelector('.scn-color-strip')) paintPanel.style.display = 'none';
      editbar.appendChild(paintPanel);
    }
    if (spritesPanel) editbar.appendChild(spritesPanel);
    if (footer) editbar.appendChild(footer);
  }

  function hook() {
    try {
      var o = window.openSceneEditor;
      if (typeof o === 'function' && !o._luaxArrange) {
        window.openSceneEditor = function () {
          var r = o.apply(this, arguments);
          setTimeout(arrange, 20);
          setTimeout(arrange, 100);
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

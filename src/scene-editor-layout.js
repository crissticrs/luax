// scene-editor-layout.js — restructure scene editor chrome after load
(function () {
  const UNDO_MAX = 40;
  let undoStack = [];
  let redoStack = [];

  function $(id) { return document.getElementById(id); }

  function snapshotFromGlobal() {
    try {
      // sceneData is inside IIFE — use canvas-backed store via save/load trick not available
      // Instead hook into window helpers if we export them
      if (typeof window.__scnGetData === 'function') return window.__scnGetData();
    } catch (_) {}
    return null;
  }

  function ensureUndoExports() {
    // no-op if scene editor already has undo; layout only needs DOM
  }

  function rebuildChrome() {
    const view = $('scene-editor-view');
    if (!view) return false;
    if (view.querySelector('.scn-editbar-main')) return true; // already new layout

    const header = view.querySelector('.scn-header');
    const editbar = view.querySelector('.scn-editbar');
    if (!header || !editbar) return false;

    // Move zoom into header before Delete/Save
    let zoom = editbar.querySelector('.scn-zoom-group') || header.querySelector('.scn-zoom-group');
    if (!zoom) {
      zoom = document.createElement('div');
      zoom.className = 'scn-zoom-group';
      zoom.innerHTML =
        '<button type="button" class="btn btn-sm" id="scn-zoom-out">−</button>' +
        '<button type="button" class="btn btn-sm" id="scn-zoom-reset">100%</button>' +
        '<button type="button" class="btn btn-sm" id="scn-zoom-in">+</button>';
    }
    const del = $('scn-delete-obj');
    const save = $('scn-save');
    if (zoom.parentNode) zoom.parentNode.removeChild(zoom);
    if (del && del.parentNode === header) header.insertBefore(zoom, del);
    else if (save && save.parentNode === header) header.insertBefore(zoom, save);
    else header.appendChild(zoom);

    // Collect existing controls
    const tools = $('scn-tools');
    const colorActive = $('scn-color-active');
    const sv = $('scn-sv');
    const hue = $('scn-hue');
    const hexRow = editbar.querySelector('.scn-hex-row');
    const paintGrid = $('scn-paint-grid');
    const scaleRow = editbar.querySelector('.scn-scale-row');
    const palette = $('scn-palette-list');
    const footer = editbar.querySelector('.scn-editbar-footer');
    const paintTab = editbar.querySelector('[data-scn-tab="paint"]');
    const spritesTab = editbar.querySelector('[data-scn-tab="sprites"]');

    // Build columns
    const main = document.createElement('div');
    main.className = 'scn-editbar-main';

    const colTools = document.createElement('div');
    colTools.className = 'scn-col scn-col-tools';
    colTools.id = 'scn-tools';
    if (tools) {
      Array.from(tools.querySelectorAll('.scn-tool')).forEach(b => colTools.appendChild(b));
    }

    const colSpec = document.createElement('div');
    colSpec.className = 'scn-col scn-col-spectrum';
    if (colorActive) colSpec.appendChild(colorActive);
    const specBox = document.createElement('div');
    specBox.className = 'scn-spectrum-compact';
    if (sv) specBox.appendChild(sv);
    if (hue) specBox.appendChild(hue);
    colSpec.appendChild(specBox);
    if (hexRow) colSpec.appendChild(hexRow);

    const colAct = document.createElement('div');
    colAct.className = 'scn-col scn-col-actions';
    if (scaleRow) colAct.appendChild(scaleRow);
    const undoRow = document.createElement('div');
    undoRow.className = 'scn-undo-row';
    undoRow.innerHTML =
      '<button type="button" class="btn btn-sm" id="scn-undo" title="Undo">↶ Undo</button>' +
      '<button type="button" class="btn btn-sm" id="scn-redo" title="Redo">↷ Redo</button>';
    colAct.appendChild(undoRow);
    if (paintGrid) colAct.appendChild(paintGrid);

    const colTabs = document.createElement('div');
    colTabs.className = 'scn-col scn-col-tabs';
    if (paintTab) {
      paintTab.className = 'scn-tab' + (paintTab.classList.contains('active') ? ' active' : '');
      colTabs.appendChild(paintTab);
    } else {
      const t = document.createElement('button');
      t.type = 'button'; t.className = 'scn-tab active'; t.setAttribute('data-scn-tab', 'paint');
      t.textContent = 'Paint'; colTabs.appendChild(t);
    }
    if (spritesTab) {
      spritesTab.className = 'scn-tab' + (spritesTab.classList.contains('active') ? ' active' : '');
      colTabs.appendChild(spritesTab);
    } else {
      const t = document.createElement('button');
      t.type = 'button'; t.className = 'scn-tab'; t.setAttribute('data-scn-tab', 'sprites');
      t.textContent = 'Sprites'; colTabs.appendChild(t);
    }

    main.appendChild(colTools);
    main.appendChild(colSpec);
    main.appendChild(colAct);
    main.appendChild(colTabs);

    // Clear editbar and reassemble
    const spritesPanel = $('scn-panel-sprites');
    const paintPanel = $('scn-panel-paint');
    editbar.innerHTML = '';
    editbar.appendChild(main);
    if (paintPanel) {
      paintPanel.className = 'scn-panel';
      paintPanel.innerHTML = '';
      editbar.appendChild(paintPanel);
    }
    if (spritesPanel) {
      editbar.appendChild(spritesPanel);
      if (palette && !spritesPanel.contains(palette)) {
        spritesPanel.innerHTML = '';
        spritesPanel.appendChild(palette);
      }
    }
    if (footer) editbar.appendChild(footer);

    // Rewire zoom (moved nodes keep ids)
    try {
      const zi = $('scn-zoom-in'), zo = $('scn-zoom-out'), zr = $('scn-zoom-reset');
      // original handlers stay if same elements; if new buttons, openSceneEditor rebind on next open
    } catch (_) {}

    // Tab rewire
    view.querySelectorAll('.scn-tab').forEach(tab => {
      tab.onclick = () => {
        view.querySelectorAll('.scn-tab').forEach(t => t.classList.remove('active'));
        view.querySelectorAll('.scn-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = $('scn-panel-' + tab.getAttribute('data-scn-tab'));
        if (panel) panel.classList.add('active');
      };
    });

    // Tool rewire
    view.querySelectorAll('#scn-tools .scn-tool').forEach(btn => {
      btn.onclick = () => {
        if (typeof window.__scnSetTool === 'function') window.__scnSetTool(btn.getAttribute('data-tool'));
        else {
          document.querySelectorAll('#scn-tools .scn-tool').forEach(b =>
            b.classList.toggle('active', b === btn));
        }
      };
    });

    return true;
  }

  function tryPatch() {
    try { rebuildChrome(); } catch (e) { console.warn('scene layout', e); }
  }

  // When scene view appears, patch
  const obs = new MutationObserver(() => {
    const v = $('scene-editor-view');
    if (v && v.classList.contains('active')) tryPatch();
  });
  if (document.body) obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });

  function init() {
    tryPatch();
    // Hook openSceneEditor
    try {
      const orig = window.openSceneEditor;
      if (typeof orig === 'function' && !orig._luaxLayout) {
        window.openSceneEditor = function () {
          const r = orig.apply(this, arguments);
          setTimeout(tryPatch, 30);
          setTimeout(tryPatch, 120);
          return r;
        };
        window.openSceneEditor._luaxLayout = true;
      }
    } catch (_) {}
    let n = 0;
    const t = setInterval(() => {
      n++; tryPatch();
      if (n > 25) clearInterval(t);
    }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 200));
  else setTimeout(init, 200);
})();

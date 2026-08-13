// Inject Assets panel into the existing editor UI (no index.html rewrite required)
(function () {
  function ensureCss() {
    if (document.getElementById('luax-assets-panel-css')) return;
    var l = document.createElement('link');
    l.id = 'luax-assets-panel-css';
    l.rel = 'stylesheet';
    l.href = 'styles/assets-panel.css';
    document.head.appendChild(l);
  }

  function ensureDom() {
    var view = document.getElementById('editor-view');
    if (!view) return false;

    var tb = document.getElementById('editor-toolbar');
    if (tb && !document.getElementById('btn-assets-panel')) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm btn-assets-toggle';
      b.id = 'btn-assets-panel';
      b.title = 'Project assets';
      b.setAttribute('aria-pressed', 'false');
      b.textContent = 'Assets';
      b.onclick = function () {
        if (typeof toggleAssetsPanel === 'function') toggleAssetsPanel();
      };
      tb.appendChild(b);
    }

    // Upgrade filters if panel already exists without Scenes
    var filters = document.querySelector('.assets-filters');
    if (filters && !filters.querySelector('[data-assets-filter="scenes"]')) {
      var sb = document.createElement('button');
      sb.type = 'button';
      sb.className = 'assets-filter';
      sb.setAttribute('data-assets-filter', 'scenes');
      sb.textContent = 'Scenes';
      filters.appendChild(sb);
    }

    if (document.getElementById('editor-workspace')) return true;

    var ed = document.getElementById('editor');
    if (!ed) return false;
    var suggest = document.getElementById('luax-suggest-bar');
    var status = document.getElementById('status-bar');
    var parent = ed.parentNode;

    var workspace = document.createElement('div');
    workspace.className = 'editor-workspace';
    workspace.id = 'editor-workspace';

    var mainCol = document.createElement('div');
    mainCol.className = 'editor-main-col';
    mainCol.id = 'editor-main-col';

    parent.insertBefore(workspace, ed);
    mainCol.appendChild(ed);
    if (suggest) mainCol.appendChild(suggest);
    if (status) mainCol.appendChild(status);
    workspace.appendChild(mainCol);

    var aside = document.createElement('aside');
    aside.id = 'assets-panel';
    aside.className = 'assets-panel';
    aside.setAttribute('aria-label', 'Project assets');
    aside.setAttribute('aria-hidden', 'true');
    aside.innerHTML =
      '<div class="assets-panel-header"><strong>Assets</strong>' +
      '<button type="button" class="btn btn-sm assets-close-btn" onclick="setAssetsPanelOpen(false)" title="Close">✕</button></div>' +
      '<div class="assets-panel-tools">' +
      '<input type="search" id="assets-search" class="assets-search" placeholder="Search assets…" autocomplete="off" spellcheck="false">' +
      '<div class="assets-filters">' +
      '<button type="button" class="assets-filter active" data-assets-filter="all">All</button>' +
      '<button type="button" class="assets-filter" data-assets-filter="sprites">Sprites</button>' +
      '<button type="button" class="assets-filter" data-assets-filter="music">Music</button>' +
      '<button type="button" class="assets-filter" data-assets-filter="scenes">Scenes</button>' +
      '</div></div>' +
      '<div id="assets-panel-body" class="assets-panel-body"></div>' +
      '<div id="assets-preview" class="assets-preview"></div>';
    workspace.appendChild(aside);

    if (!document.getElementById('assets-panel-backdrop')) {
      var bd = document.createElement('div');
      bd.id = 'assets-panel-backdrop';
      bd.className = 'assets-panel-backdrop';
      bd.onclick = function () {
        if (typeof setAssetsPanelOpen === 'function') setAssetsPanelOpen(false);
      };
      view.appendChild(bd);
    }
    view.classList.add('assets-closed');
    return true;
  }

  function boot() {
    ensureCss();
    if (!ensureDom()) return;
    try {
      if (typeof initAssetsPanel === 'function') initAssetsPanel();
      else if (typeof refreshAssetsPanel === 'function') refreshAssetsPanel();
    } catch (e) {
      console.warn('assets panel init', e);
    }
    try {
      if (typeof setupAssetsEditorDrop === 'function') setupAssetsEditorDrop();
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(boot, 50);
    });
  } else {
    setTimeout(boot, 50);
  }

  var tries = 0;
  var t = setInterval(function () {
    tries++;
    if (document.getElementById('assets-panel') || tries > 20) {
      clearInterval(t);
      return;
    }
    boot();
  }, 400);
})();

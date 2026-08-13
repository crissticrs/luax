// src/assets-panel.js — dockable Assets browser inside the code editor
// Uses existing projectAssets / projectMusic + real LuaX APIs (gfx.sprite, sfx.music)

const ASSETS_PANEL_KEY = 'luax_assets_panel_open';

const assetsPanelState = {
    open: false,
    query: '',
    filter: 'all',
    previewName: null,
    previewKind: null,
};

function isAssetsPanelDesktop() {
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 900px)').matches;
}

function loadAssetsPanelOpenPref() {
    try {
        const v = localStorage.getItem(ASSETS_PANEL_KEY);
        if (v === '1') return true;
        if (v === '0') return false;
    } catch (_) {}
    return isAssetsPanelDesktop();
}

function saveAssetsPanelOpenPref(open) {
    try { localStorage.setItem(ASSETS_PANEL_KEY, open ? '1' : '0'); } catch (_) {}
}

/** Build insert snippet using real LuaX APIs only */
function assetCodeSnippet(kind, name) {
    const n = String(name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    if (kind === 'music') return 'sfx.music("' + n + '")';
    return 'gfx.sprite("' + n + '", x, y)';
}

function collectProjectAssets() {
    const out = [];
    if (!currentProjectName) return out;
    try {
        const map = (typeof getProjectAssetMap === 'function')
            ? getProjectAssetMap(currentProjectName)
            : (projectAssets && projectAssets[currentProjectName]) || {};
        Object.keys(map || {}).sort().forEach(name => {
            out.push({ kind: 'sprite', name: name, thumb: map[name], category: 'Sprites' });
        });
    } catch (_) {}
    try {
        const music = (typeof getProjectMusicMap === 'function')
            ? getProjectMusicMap(currentProjectName)
            : (projectMusic && projectMusic[currentProjectName]) || {};
        Object.keys(music || {}).sort().forEach(name => {
            out.push({ kind: 'music', name: name, thumb: null, category: 'Music' });
        });
    } catch (_) {}
    return out;
}

function filteredAssetsList() {
    const q = (assetsPanelState.query || '').trim().toLowerCase();
    let list = collectProjectAssets();
    if (assetsPanelState.filter === 'sprites') list = list.filter(a => a.kind === 'sprite');
    if (assetsPanelState.filter === 'music') list = list.filter(a => a.kind === 'music');
    if (q) list = list.filter(a => a.name.toLowerCase().indexOf(q) >= 0);
    return list;
}

function insertAssetAtCursor(kind, name) {
    const snippet = assetCodeSnippet(kind, name);
    if (!editor) {
        try { if (navigator.clipboard) navigator.clipboard.writeText(snippet); } catch (_) {}
        alert('Copied:\n' + snippet);
        return;
    }
    try {
        const doc = editor.getDoc();
        const cur = doc.getCursor();
        if (doc.somethingSelected()) doc.replaceSelection(snippet);
        else doc.replaceRange(snippet, cur);
        editor.focus();
        const lines = snippet.split('\n');
        const end = {
            line: cur.line + lines.length - 1,
            ch: (lines.length === 1 ? cur.ch : 0) + lines[lines.length - 1].length
        };
        doc.setCursor(end);
        try {
            isDirty = true;
            if (typeof updateDirtyUI === 'function') updateDirtyUI();
        } catch (_) {}
    } catch (err) {
        console.warn('insertAssetAtCursor', err);
    }
    if (!isAssetsPanelDesktop()) setAssetsPanelOpen(false);
}

function setAssetsPanelOpen(open) {
    assetsPanelState.open = !!open;
    saveAssetsPanelOpenPref(assetsPanelState.open);
    applyAssetsPanelLayout();
    if (assetsPanelState.open) renderAssetsPanel();
    try {
        if (editor) setTimeout(() => { try { editor.refresh(); } catch (_) {} }, 50);
    } catch (_) {}
}

function toggleAssetsPanel() {
    setAssetsPanelOpen(!assetsPanelState.open);
}

function applyAssetsPanelLayout() {
    const view = document.getElementById('editor-view');
    const panel = document.getElementById('assets-panel');
    const backdrop = document.getElementById('assets-panel-backdrop');
    const btn = document.getElementById('btn-assets-panel');
    if (!view || !panel) return;
    view.classList.toggle('assets-open', assetsPanelState.open);
    view.classList.toggle('assets-closed', !assetsPanelState.open);
    panel.classList.toggle('open', assetsPanelState.open);
    panel.setAttribute('aria-hidden', assetsPanelState.open ? 'false' : 'true');
    if (backdrop) backdrop.classList.toggle('show', assetsPanelState.open && !isAssetsPanelDesktop());
    if (btn) {
        btn.classList.toggle('active', assetsPanelState.open);
        btn.setAttribute('aria-pressed', assetsPanelState.open ? 'true' : 'false');
    }
}

function renderAssetsPanel() {
    const body = document.getElementById('assets-panel-body');
    if (!body) return;
    const list = filteredAssetsList();
    const groups = {};
    list.forEach(a => {
        if (!groups[a.category]) groups[a.category] = [];
        groups[a.category].push(a);
    });
    let html = '';
    ['Sprites', 'Music'].forEach(cat => {
        const items = groups[cat];
        if (!items || !items.length) return;
        html += '<div class="assets-cat-label">' + escapeHtml(cat) + '</div><div class="assets-grid">';
        items.forEach(a => {
            const safe = escapeHtml(a.name);
            let thumb = a.kind === 'sprite' && a.thumb
                ? '<img class="assets-thumb" src="' + a.thumb + '" alt="" draggable="false">'
                : (a.kind === 'music'
                    ? '<div class="assets-icon assets-icon-music" aria-hidden="true">♪</div>'
                    : '<div class="assets-icon" aria-hidden="true">📄</div>');
            html += '<div class="assets-item" draggable="true" data-kind="' + a.kind + '" data-name="' + safe + '" title="' + safe + ' — drag into code or double-click to insert">' +
                thumb + '<span class="assets-name">' + safe + '</span>' +
                '<button type="button" class="assets-insert-btn" data-kind="' + a.kind + '" data-name="' + safe + '" title="Insert into code">Insert</button></div>';
        });
        html += '</div>';
    });
    if (!html) {
        html = '<div class="assets-empty">' +
            (currentProjectName
                ? 'No assets yet.<br><span class="assets-empty-hint">Add sprites from the project Files view, or create music patterns.</span>'
                : 'Open a project to see assets.') +
            '</div>';
    }
    body.innerHTML = html;
    wireAssetsPanelItems(body);
}

function wireAssetsPanelItems(root) {
    if (!root) return;
    root.querySelectorAll('.assets-item').forEach(el => {
        const kind = el.getAttribute('data-kind');
        const name = el.getAttribute('data-name');
        el.addEventListener('dragstart', (e) => {
            try {
                e.dataTransfer.setData('application/x-luax-asset', JSON.stringify({ kind, name }));
                e.dataTransfer.setData('text/plain', assetCodeSnippet(kind, name));
                e.dataTransfer.effectAllowed = 'copy';
            } catch (_) {}
            el.classList.add('dragging');
        });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
        el.addEventListener('click', (e) => {
            if (e.target && e.target.classList && e.target.classList.contains('assets-insert-btn')) return;
            previewAsset(kind, name);
        });
        el.addEventListener('dblclick', (e) => {
            e.preventDefault();
            insertAssetAtCursor(kind, name);
        });
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showAssetsContextMenu(e.clientX, e.clientY, kind, name);
        });
    });
    root.querySelectorAll('.assets-insert-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            insertAssetAtCursor(btn.getAttribute('data-kind'), btn.getAttribute('data-name'));
        });
    });
}

function previewAsset(kind, name) {
    assetsPanelState.previewKind = kind;
    assetsPanelState.previewName = name;
    const box = document.getElementById('assets-preview');
    if (!box) return;
    box.classList.add('show');
    if (kind === 'sprite') {
        let src = '';
        try { const map = getProjectAssetMap(currentProjectName); src = map && map[name]; } catch (_) {}
        box.innerHTML =
            '<div class="assets-preview-head"><span>' + escapeHtml(name) + '</span>' +
            '<button type="button" class="btn btn-sm" onclick="hideAssetsPreview()">✕</button></div>' +
            (src ? '<img src="' + src + '" alt="">' : '<p>No preview</p>') +
            '<button type="button" class="btn btn-primary btn-sm assets-preview-insert" data-kind="sprite" data-name="' + escapeHtml(name) + '">Insert gfx.sprite(…)</button>';
    } else if (kind === 'music') {
        box.innerHTML =
            '<div class="assets-preview-head"><span>♪ ' + escapeHtml(name) + '</span>' +
            '<button type="button" class="btn btn-sm" onclick="hideAssetsPreview()">✕</button></div>' +
            '<p class="assets-preview-meta">Music pattern</p>' +
            '<button type="button" class="btn btn-primary btn-sm assets-preview-insert" data-kind="music" data-name="' + escapeHtml(name) + '">Insert sfx.music(…)</button>' +
            '<button type="button" class="btn btn-sm" onclick="openMusicEditor(\'' + String(name).replace(/'/g, "\\'") + '\')">Edit pattern</button>';
    } else {
        box.innerHTML = '<p>' + escapeHtml(name) + '</p>';
    }
    const ins = box.querySelector('.assets-preview-insert');
    if (ins) ins.onclick = () => insertAssetAtCursor(ins.getAttribute('data-kind'), ins.getAttribute('data-name'));
}

function hideAssetsPreview() {
    const box = document.getElementById('assets-preview');
    if (box) { box.classList.remove('show'); box.innerHTML = ''; }
    assetsPanelState.previewName = null;
}

function hideAssetsContextMenu() {
    const m = document.getElementById('assets-ctx-menu');
    if (m) m.remove();
}

function showAssetsContextMenu(x, y, kind, name) {
    hideAssetsContextMenu();
    const m = document.createElement('div');
    m.id = 'assets-ctx-menu';
    m.className = 'assets-ctx-menu';
    m.innerHTML =
        '<button type="button" data-act="insert">Insert into code</button>' +
        '<button type="button" data-act="preview">Preview</button>' +
        '<button type="button" data-act="copy">Copy path</button>' +
        (kind === 'sprite' ? '<button type="button" data-act="edit-sprite">Edit sprite</button>' : '') +
        (kind === 'music' ? '<button type="button" data-act="edit-music">Edit music</button>' : '') +
        '<button type="button" data-act="delete" class="danger">Delete</button>';
    document.body.appendChild(m);
    const pad = 8;
    const rect = m.getBoundingClientRect();
    let left = x, top = y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    m.style.left = Math.max(pad, left) + 'px';
    m.style.top = Math.max(pad, top) + 'px';
    m.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        hideAssetsContextMenu();
        if (act === 'insert') insertAssetAtCursor(kind, name);
        else if (act === 'preview') previewAsset(kind, name);
        else if (act === 'copy') {
            try {
                if (navigator.clipboard) navigator.clipboard.writeText(name);
            } catch (_) {}
        } else if (act === 'edit-sprite' && typeof openSpriteEditor === 'function') openSpriteEditor(name);
        else if (act === 'edit-music' && typeof openMusicEditor === 'function') openMusicEditor(name);
        else if (act === 'delete') {
            if (!confirm('Delete "' + name + '"?')) return;
            if (kind === 'sprite') {
                try {
                    const map = getProjectAssetMap(currentProjectName);
                    delete map[name];
                    saveProjectAssets();
                    try { delete spriteImageCache[currentProjectName + '::' + name]; } catch (_) {}
                } catch (_) {}
            } else if (kind === 'music') {
                try {
                    const map = getProjectMusicMap(currentProjectName);
                    delete map[name];
                    saveProjectMusic();
                } catch (_) {}
            }
            renderAssetsPanel();
            try { renderFiles(); } catch (_) {}
        }
    });
    setTimeout(() => {
        const closer = (ev) => {
            if (m.contains(ev.target)) return;
            hideAssetsContextMenu();
            document.removeEventListener('pointerdown', closer, true);
        };
        document.addEventListener('pointerdown', closer, true);
    }, 0);
}

function setupAssetsEditorDrop() {
    if (!editor) return;
    const wrap = editor.getWrapperElement && editor.getWrapperElement();
    if (!wrap || wrap._luaxAssetsDrop) return;
    wrap._luaxAssetsDrop = true;
    wrap.addEventListener('dragover', (e) => {
        if (!e.dataTransfer) return;
        const types = Array.from(e.dataTransfer.types || []);
        if (types.indexOf('application/x-luax-asset') >= 0 || types.indexOf('text/plain') >= 0) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            wrap.classList.add('assets-drop-target');
        }
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('assets-drop-target'));
    wrap.addEventListener('drop', (e) => {
        wrap.classList.remove('assets-drop-target');
        e.preventDefault();
        e.stopPropagation();
        let kind = null, name = null, snippet = null;
        try {
            const raw = e.dataTransfer.getData('application/x-luax-asset');
            if (raw) {
                const data = JSON.parse(raw);
                kind = data.kind; name = data.name;
                snippet = assetCodeSnippet(kind, name);
            }
        } catch (_) {}
        if (!snippet) {
            try { snippet = e.dataTransfer.getData('text/plain'); } catch (_) {}
        }
        if (!snippet) return;
        try {
            const coords = editor.coordsChar({ left: e.clientX, top: e.clientY }, 'window');
            editor.getDoc().replaceRange(snippet, coords);
            editor.focus();
            editor.setCursor({ line: coords.line, ch: coords.ch + snippet.length });
            try { isDirty = true; if (typeof updateDirtyUI === 'function') updateDirtyUI(); } catch (_) {}
        } catch (err) {
            console.warn('asset drop', err);
            insertAssetAtCursor(kind || 'sprite', name || snippet);
        }
    });
}

function onAssetsSearchInput(val) {
    assetsPanelState.query = val || '';
    renderAssetsPanel();
}

function onAssetsFilterChange(val) {
    assetsPanelState.filter = val || 'all';
    renderAssetsPanel();
}

function refreshAssetsPanel() {
    if (!document.getElementById('assets-panel')) return;
    if (assetsPanelState.open || document.getElementById('editor-view')?.classList.contains('active')) {
        renderAssetsPanel();
    }
    setupAssetsEditorDrop();
}

function initAssetsPanel() {
    const search = document.getElementById('assets-search');
    if (search && !search._luaxBound) {
        search._luaxBound = true;
        search.addEventListener('input', () => onAssetsSearchInput(search.value));
    }
    document.querySelectorAll('[data-assets-filter]').forEach(btn => {
        if (btn._luaxBound) return;
        btn._luaxBound = true;
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-assets-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            onAssetsFilterChange(btn.getAttribute('data-assets-filter'));
        });
    });
    assetsPanelState.open = loadAssetsPanelOpenPref();
    if (!isAssetsPanelDesktop()) assetsPanelState.open = false;
    applyAssetsPanelLayout();
    setupAssetsEditorDrop();
    window.addEventListener('resize', () => {
        applyAssetsPanelLayout();
        try { if (editor) editor.refresh(); } catch (_) {}
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initAssetsPanel, 0));
} else {
    setTimeout(initAssetsPanel, 0);
}

try {
    window.toggleAssetsPanel = toggleAssetsPanel;
    window.setAssetsPanelOpen = setAssetsPanelOpen;
    window.refreshAssetsPanel = refreshAssetsPanel;
    window.insertAssetAtCursor = insertAssetAtCursor;
    window.hideAssetsPreview = hideAssetsPreview;
    window.setupAssetsEditorDrop = setupAssetsEditorDrop;
    window.assetCodeSnippet = assetCodeSnippet;
} catch (_) {}

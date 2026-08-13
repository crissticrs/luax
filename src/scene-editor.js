// src/scene-editor.js — 2D scene editor (place & move sprites on a canvas)
// Create from files manager: + Create → Scene (2D)

(function () {
    'use strict';

    const SCENES_KEY = 'luax_project_scenes';
    let projectScenes = {};
    let sceneName = null;
    let sceneData = null;
    let selectedId = null;
    let dragState = null;
    let panX = 0, panY = 0;
    let viewScale = 1;
    let imgCache = {};
    let nextObjId = 1;
    let dirty = false;

    function $(id) { return document.getElementById(id); }

    function getProjectName() {
        try {
            if (typeof window.currentProjectName === 'string' && window.currentProjectName) return window.currentProjectName;
            if (typeof currentProjectName === 'string' && currentProjectName) return currentProjectName;
        } catch (_) {}
        return '';
    }

    function loadScenes() {
        try {
            const raw = localStorage.getItem(SCENES_KEY);
            projectScenes = raw ? JSON.parse(raw) : {};
            if (!projectScenes || typeof projectScenes !== 'object') projectScenes = {};
        } catch (_) { projectScenes = {}; }
    }

    function saveScenes() {
        try { localStorage.setItem(SCENES_KEY, JSON.stringify(projectScenes)); } catch (_) {}
    }

    function getProjectSceneMap(name) {
        if (!name) return {};
        if (!projectScenes[name]) projectScenes[name] = {};
        return projectScenes[name];
    }

    function emptyScene() {
        return { w: 480, h: 320, objects: [] };
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&').replace(/</g, '<').replace(/"/g, '"');
    }
    function escapeAttr(s) {
        return String(s).replace(/&/g, '&').replace(/"/g, '"');
    }

    function ensureSceneDom() {
        if ($('scene-editor-view')) return true;

        if (!$('luax-scene-editor-css')) {
            const l = document.createElement('link');
            l.id = 'luax-scene-editor-css';
            l.rel = 'stylesheet';
            l.href = 'styles/scene-editor.css';
            document.head.appendChild(l);
        }

        const view = document.createElement('div');
        view.id = 'scene-editor-view';
        view.className = 'view';
        view.innerHTML =
            '<div class="scn-header">' +
            '<button type="button" class="btn btn-back" id="scn-back">◀ Back</button>' +
            '<span class="spr-title" id="scene-editor-title">Scene</span>' +
            '<button type="button" class="btn btn-sm" id="scn-delete-obj" title="Delete selected">Delete</button>' +
            '<button type="button" class="btn btn-primary btn-sm" id="scn-save">Save</button>' +
            '</div>' +
            '<div class="scn-body">' +
            '<aside class="scn-palette">' +
            '<div class="scn-palette-head">Sprites</div>' +
            '<div class="scn-palette-list" id="scn-palette-list"></div>' +
            '</aside>' +
            '<div class="scn-stage-wrap" id="scn-stage-wrap">' +
            '<canvas id="scene-canvas" width="480" height="320"></canvas>' +
            '</div></div>' +
            '<div class="scn-toolbar">' +
            '<button type="button" class="btn btn-sm" id="scn-zoom-out">−</button>' +
            '<button type="button" class="btn btn-sm" id="scn-zoom-reset">100%</button>' +
            '<button type="button" class="btn btn-sm" id="scn-zoom-in">+</button>' +
            '<span class="scn-sel-info" id="scn-sel-info">Tap a sprite to place · drag to move</span>' +
            '<span class="scn-hint">2D only · grid 16px</span></div>';

        const music = $('music-editor-view');
        const editor = $('editor-view');
        const parent = (music && music.parentNode) || (editor && editor.parentNode) || document.body;
        if (music && music.nextSibling) parent.insertBefore(view, music.nextSibling);
        else if (editor) parent.insertBefore(view, editor);
        else parent.appendChild(view);

        $('scn-back').onclick = () => closeSceneEditor();
        $('scn-save').onclick = () => saveSceneFromEditor();
        $('scn-delete-obj').onclick = () => deleteSelectedObject();
        $('scn-zoom-in').onclick = () => { viewScale = Math.min(3, viewScale * 1.25); drawScene(); };
        $('scn-zoom-out').onclick = () => { viewScale = Math.max(0.35, viewScale / 1.25); drawScene(); };
        $('scn-zoom-reset').onclick = () => { viewScale = 1; panX = 0; panY = 0; drawScene(); };

        const canvas = $('scene-canvas');
        canvas.addEventListener('pointerdown', onCanvasPointerDown);
        canvas.addEventListener('pointermove', onCanvasPointerMove);
        canvas.addEventListener('pointerup', onCanvasPointerUp);
        canvas.addEventListener('pointercancel', onCanvasPointerUp);
        canvas.addEventListener('wheel', onCanvasWheel, { passive: false });

        injectCreateMenu();
        return true;
    }

    function injectCreateMenu() {
        const menu = $('files-menu-create');
        if (!menu || menu.querySelector('[data-scn-create]')) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-scn-create', '1');
        btn.textContent = '+ Scene (2D)';
        btn.onclick = function () {
            try { if (typeof closeFilesMenus === 'function') closeFilesMenus(); } catch (_) {}
            promptNewScene();
        };
        menu.appendChild(btn);
    }

    function promptNewScene() {
        const name = prompt('Scene name:', 'level1');
        if (!name) return;
        let fn = name.trim().replace(/[^\w\- ]+/g, '');
        if (!fn) return;
        if (!fn.endsWith('.scene')) fn += '.scene';
        openSceneEditor(fn, true);
    }

    function openSceneEditor(name, isNew) {
        ensureSceneDom();
        loadScenes();
        const proj = getProjectName();
        if (!proj) return alert('Open a project first');

        const map = getProjectSceneMap(proj);
        sceneName = name || 'level1.scene';
        if (isNew && map[sceneName]) {
            if (!confirm('Scene "' + sceneName + '" exists. Open it?')) return;
        }
        sceneData = map[sceneName] ? JSON.parse(JSON.stringify(map[sceneName])) : emptyScene();
        if (!Array.isArray(sceneData.objects)) sceneData.objects = [];
        sceneData.w = sceneData.w || 480;
        sceneData.h = sceneData.h || 320;
        nextObjId = 1;
        sceneData.objects.forEach(o => { if (o.id >= nextObjId) nextObjId = o.id + 1; });
        selectedId = null;
        panX = 0; panY = 0; viewScale = 1;
        dirty = !!isNew;

        const title = $('scene-editor-title');
        if (title) title.textContent = sceneName;

        preloadSprites().then(() => {
            resizeCanvas();
            refreshPalette();
            drawScene();
        });

        try {
            if (typeof switchView === 'function') switchView('scene-editor-view');
            else {
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                $('scene-editor-view').classList.add('active');
            }
        } catch (_) {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const v = $('scene-editor-view');
            if (v) v.classList.add('active');
        }
        setTimeout(resizeCanvas, 80);
    }

    function closeSceneEditor() {
        if (dirty && !confirm('Unsaved scene changes.\n\nOK = discard\nCancel = stay')) return;
        dirty = false;
        try {
            if (typeof switchView === 'function') switchView('files-view');
            else {
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                const fv = $('files-view');
                if (fv) fv.classList.add('active');
            }
        } catch (_) {}
        try { if (typeof renderFiles === 'function') renderFiles(); } catch (_) {}
    }

    function saveSceneFromEditor() {
        const proj = getProjectName();
        if (!proj || !sceneName || !sceneData) return;
        loadScenes();
        const map = getProjectSceneMap(proj);
        map[sceneName] = JSON.parse(JSON.stringify(sceneData));
        saveScenes();
        dirty = false;
        const info = $('scn-sel-info');
        if (info) {
            info.textContent = 'Saved ✓';
            setTimeout(() => { if (info) info.textContent = 'Tap a sprite to place · drag to move'; }, 1500);
        }
        try { if (typeof renderFiles === 'function') renderFiles(); } catch (_) {}
    }

    function getAssetMap() {
        const proj = getProjectName();
        try {
            if (typeof getProjectAssetMap === 'function') return getProjectAssetMap(proj) || {};
        } catch (_) {}
        return {};
    }

    function preloadSprites() {
        const assets = getAssetMap();
        const names = Object.keys(assets);
        return Promise.all(names.map(name => new Promise(resolve => {
            if (imgCache[name] && imgCache[name].complete) return resolve();
            const img = new Image();
            img.onload = () => { imgCache[name] = img; resolve(); };
            img.onerror = () => resolve();
            img.src = assets[name];
        })));
    }

    function refreshPalette() {
        const list = $('scn-palette-list');
        if (!list) return;
        const assets = getAssetMap();
        const names = Object.keys(assets).sort();
        if (!names.length) {
            list.innerHTML = '<div class="scn-pal-empty">No sprites yet.\nCreate some with + Create → Draw image</div>';
            return;
        }
        list.innerHTML = names.map(fn =>
            '<div class="scn-pal-item" draggable="true" data-sprite="' + escapeAttr(fn) + '">' +
            '<img src="' + assets[fn] + '" alt="">' +
            '<span>' + escapeHtml(fn) + '</span></div>'
        ).join('');

        list.querySelectorAll('.scn-pal-item').forEach(el => {
            const sprite = el.getAttribute('data-sprite');
            el.addEventListener('click', () => placeSpriteAtViewCenter(sprite));
            el.addEventListener('dragstart', (e) => {
                try {
                    e.dataTransfer.setData('text/plain', sprite);
                    e.dataTransfer.effectAllowed = 'copy';
                } catch (_) {}
            });
        });

        const stage = $('scn-stage-wrap');
        if (stage && !stage._dropWired) {
            stage._dropWired = true;
            stage.addEventListener('dragover', (e) => { e.preventDefault(); });
            stage.addEventListener('drop', (e) => {
                e.preventDefault();
                const sprite = e.dataTransfer && e.dataTransfer.getData('text/plain');
                if (!sprite) return;
                const canvas = $('scene-canvas');
                const rect = canvas.getBoundingClientRect();
                const pt = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect);
                addObject(sprite, pt.x, pt.y);
            });
        }
    }

    function placeSpriteAtViewCenter(sprite) {
        const canvas = $('scene-canvas');
        if (!canvas) return;
        const world = screenToWorld(canvas.width / 2, canvas.height / 2, null, true);
        addObject(sprite, world.x, world.y);
    }

    function addObject(sprite, x, y) {
        if (!sceneData) return;
        const id = nextObjId++;
        sceneData.objects.push({ id: id, sprite: sprite, x: snap(x), y: snap(y), scale: 1 });
        selectedId = id;
        dirty = true;
        drawScene();
        updateSelInfo();
    }

    function snap(v) { return Math.round(v / 16) * 16; }

    function deleteSelectedObject() {
        if (!sceneData || selectedId == null) return;
        sceneData.objects = sceneData.objects.filter(o => o.id !== selectedId);
        selectedId = null;
        dirty = true;
        drawScene();
        updateSelInfo();
    }

    function updateSelInfo() {
        const info = $('scn-sel-info');
        if (!info || !sceneData) return;
        const o = sceneData.objects.find(x => x.id === selectedId);
        if (!o) { info.textContent = 'Tap a sprite to place · drag to move'; return; }
        info.textContent = o.sprite + '  @ ' + o.x + ', ' + o.y;
    }

    function resizeCanvas() {
        const canvas = $('scene-canvas');
        const wrap = $('scn-stage-wrap');
        if (!canvas || !wrap) return;
        const r = wrap.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(100, Math.floor(r.width * dpr));
        canvas.height = Math.max(100, Math.floor(r.height * dpr));
        canvas.style.width = r.width + 'px';
        canvas.style.height = r.height + 'px';
        drawScene();
    }

    function screenToWorld(sx, sy, rect, alreadyCanvasSpace) {
        const canvas = $('scene-canvas');
        let x = sx, y = sy;
        if (!alreadyCanvasSpace && rect) {
            x = sx * (canvas.width / rect.width);
            y = sy * (canvas.height / rect.height);
        }
        return { x: (x - panX) / viewScale, y: (y - panY) / viewScale };
    }

    function hitTest(wx, wy) {
        if (!sceneData) return null;
        for (let i = sceneData.objects.length - 1; i >= 0; i--) {
            const o = sceneData.objects[i];
            const img = imgCache[o.sprite];
            const w = (img ? img.naturalWidth : 32) * (o.scale || 1);
            const h = (img ? img.naturalHeight : 32) * (o.scale || 1);
            if (wx >= o.x && wx <= o.x + w && wy >= o.y && wy <= o.y + h) return o;
        }
        return null;
    }

    function drawScene() {
        const canvas = $('scene-canvas');
        if (!canvas || !sceneData) return;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(viewScale, viewScale);

        ctx.fillStyle = 'rgba(30, 34, 48, 0.9)';
        ctx.fillRect(0, 0, sceneData.w, sceneData.h);
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.45)';
        ctx.lineWidth = 2 / viewScale;
        ctx.strokeRect(0, 0, sceneData.w, sceneData.h);

        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1 / viewScale;
        for (let x = 0; x <= sceneData.w; x += 16) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sceneData.h); ctx.stroke();
        }
        for (let y = 0; y <= sceneData.h; y += 16) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sceneData.w, y); ctx.stroke();
        }

        sceneData.objects.forEach(o => {
            const img = imgCache[o.sprite];
            const sc = o.scale || 1;
            const w = (img ? img.naturalWidth : 32) * sc;
            const h = (img ? img.naturalHeight : 32) * sc;
            if (img && img.complete) {
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, o.x, o.y, w, h);
            } else {
                ctx.fillStyle = '#444';
                ctx.fillRect(o.x, o.y, w, h);
            }
            if (o.id === selectedId) {
                ctx.strokeStyle = '#ffea00';
                ctx.lineWidth = 2 / viewScale;
                ctx.strokeRect(o.x - 1, o.y - 1, w + 2, h + 2);
            }
        });
        ctx.restore();
        const zoomBtn = $('scn-zoom-reset');
        if (zoomBtn) zoomBtn.textContent = Math.round(viewScale * 100) + '%';
    }

    function onCanvasPointerDown(e) {
        const canvas = $('scene-canvas');
        if (!canvas || !sceneData) return;
        canvas.setPointerCapture(e.pointerId);
        const rect = canvas.getBoundingClientRect();
        const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect);
        const hit = hitTest(world.x, world.y);
        if (hit) {
            selectedId = hit.id;
            dragState = { id: hit.id, mode: 'move', ox: world.x - hit.x, oy: world.y - hit.y };
            updateSelInfo();
            drawScene();
        } else {
            selectedId = null;
            dragState = { mode: 'pan', ox: e.clientX - panX, oy: e.clientY - panY };
            updateSelInfo();
            drawScene();
        }
    }

    function onCanvasPointerMove(e) {
        if (!dragState || !sceneData) return;
        const canvas = $('scene-canvas');
        const rect = canvas.getBoundingClientRect();
        if (dragState.mode === 'move') {
            const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect);
            const o = sceneData.objects.find(x => x.id === dragState.id);
            if (!o) return;
            o.x = snap(world.x - dragState.ox);
            o.y = snap(world.y - dragState.oy);
            dirty = true;
            updateSelInfo();
            drawScene();
        } else if (dragState.mode === 'pan') {
            panX = e.clientX - dragState.ox;
            panY = e.clientY - dragState.oy;
            drawScene();
        }
    }

    function onCanvasPointerUp(e) {
        dragState = null;
        try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}
    }

    function onCanvasWheel(e) {
        e.preventDefault();
        viewScale = Math.min(3, Math.max(0.35, viewScale * (e.deltaY > 0 ? 0.9 : 1.1)));
        drawScene();
    }

    function enhanceFilesListWithScenes() {
        const list = $('files-list');
        if (!list) return;
        loadScenes();
        const proj = getProjectName();
        if (!proj) return;
        const map = getProjectSceneMap(proj);
        Object.keys(map).sort().forEach(fn => {
            if (list.querySelector('[data-scene="' + fn.replace(/"/g, '') + '"]')) return;
            const div = document.createElement('div');
            div.className = 'list-item';
            div.setAttribute('data-scene', fn);
            div.innerHTML =
                '<div class="item-title">' +
                '<span style="font-size:1.1rem">🗺</span>' +
                '<span>' + escapeHtml(fn) + '</span>' +
                '<span class="item-badge">SCENE</span></div>' +
                '<div class="item-actions">' +
                '<button type="button" class="btn-icon-sm" data-scn-edit="' + escapeAttr(fn) + '" title="Edit">✎</button>' +
                '<button type="button" class="btn btn-delete" data-scn-del="' + escapeAttr(fn) + '" title="Delete">🗑</button>' +
                '</div>';
            div.querySelector('.item-title').onclick = () => openSceneEditor(fn, false);
            const ed = div.querySelector('[data-scn-edit]');
            if (ed) ed.onclick = (e) => { e.stopPropagation(); openSceneEditor(fn, false); };
            const del = div.querySelector('[data-scn-del]');
            if (del) del.onclick = (e) => {
                e.stopPropagation();
                if (!confirm('Delete scene "' + fn + '"?')) return;
                loadScenes();
                delete getProjectSceneMap(getProjectName())[fn];
                saveScenes();
                try { if (typeof renderFiles === 'function') renderFiles(); } catch (_) {}
            };
            list.appendChild(div);
        });
        try { if (typeof enhanceFilesListSwipe === 'function') setTimeout(enhanceFilesListSwipe, 0); } catch (_) {}
    }

    function hookRenderFiles() {
        try {
            const rf = typeof window.renderFiles === 'function' ? window.renderFiles
                : (typeof renderFiles === 'function' ? renderFiles : null);
            if (!rf || rf._luaxScene) return;
            const wrapped = function () {
                const r = rf.apply(this, arguments);
                setTimeout(enhanceFilesListWithScenes, 0);
                setTimeout(injectCreateMenu, 0);
                return r;
            };
            wrapped._luaxScene = true;
            window.renderFiles = wrapped;
            try { renderFiles = wrapped; } catch (_) {}
        } catch (_) {}
    }

    function patchSwitchView() {
        try {
            const sv = typeof window.switchView === 'function' ? window.switchView
                : (typeof switchView === 'function' ? switchView : null);
            if (!sv || sv._luaxScene) return;
            const wrapped = function (id) {
                const r = sv.apply(this, arguments);
                if (id === 'scene-editor-view') {
                    const v = $('scene-editor-view');
                    if (v) { v.classList.add('active'); v.style.display = 'flex'; }
                    setTimeout(resizeCanvas, 50);
                }
                return r;
            };
            wrapped._luaxScene = true;
            window.switchView = wrapped;
            try { switchView = wrapped; } catch (_) {}
        } catch (_) {}
    }

    function initSceneEditor() {
        loadScenes();
        ensureSceneDom();
        injectCreateMenu();
        hookRenderFiles();
        patchSwitchView();
        window.addEventListener('resize', () => {
            if ($('scene-editor-view') && $('scene-editor-view').classList.contains('active')) resizeCanvas();
        });
        let tries = 0;
        const t = setInterval(() => {
            tries++;
            injectCreateMenu(); hookRenderFiles(); patchSwitchView();
            if (tries > 20) clearInterval(t);
        }, 400);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initSceneEditor, 120));
    } else {
        setTimeout(initSceneEditor, 120);
    }

    try {
        window.openSceneEditor = openSceneEditor;
        window.promptNewScene = promptNewScene;
        window.getProjectSceneMap = getProjectSceneMap;
        window.saveSceneFromEditor = saveSceneFromEditor;
    } catch (_) {}
})();

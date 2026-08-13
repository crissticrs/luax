// src/scene-editor.js — 2D scene editor
// Left panel (paint + sprites) · full canvas · pinch zoom · scale · shapes

(function () {
    'use strict';

    const SCENES_KEY = 'luax_project_scenes';
    const SCN_PALETTE = [
        '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200',
        '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#ffffff', '#c3c3c3', '#b97a57',
        '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7',
        '#7f7f7f', '#c3c3c3', '#fafafa', '#e5d3b3', '#d5c4a1', '#a5734d', '#63300f'
    ];

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
    let tool = 'select';
    let paintColor = '#22b14c';
    let brushSize = 16;
    let placeSpriteName = null;
    let shapeStart = null;
    let pinch = null;

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
    function emptyScene() { return { w: 640, h: 360, objects: [] }; }

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
            '<button type="button" class="btn btn-sm" id="scn-delete-obj">Delete</button>' +
            '<button type="button" class="btn btn-primary btn-sm" id="scn-save">Save</button></div>' +
            '<div class="scn-body">' +
            '<aside class="scn-palette">' +
            '<div class="scn-tabs">' +
            '<button type="button" class="scn-tab active" data-scn-tab="paint">Paint</button>' +
            '<button type="button" class="scn-tab" data-scn-tab="sprites">Sprites</button></div>' +
            '<div class="scn-panel active" id="scn-panel-paint">' +
            '<div class="scn-section-label">Tool</div>' +
            '<div class="scn-tool-row" id="scn-tools">' +
            '<button type="button" class="scn-tool active" data-tool="select">↖</button>' +
            '<button type="button" class="scn-tool" data-tool="brush">Brush</button>' +
            '<button type="button" class="scn-tool" data-tool="rect">□</button>' +
            '<button type="button" class="scn-tool" data-tool="tri">△</button>' +
            '<button type="button" class="scn-tool" data-tool="circle">○</button></div>' +
            '<div class="scn-section-label">Color</div>' +
            '<div class="scn-color-active" id="scn-color-active"></div>' +
            '<div class="scn-paint-grid" id="scn-paint-grid"></div>' +
            '<div class="scn-section-label">Brush size</div>' +
            '<div class="scn-scale-row">' +
            '<input type="range" id="scn-brush-size" min="4" max="64" step="4" value="16">' +
            '<span id="scn-brush-label">16</span></div>' +
            '<div class="scn-section-label">Selected scale</div>' +
            '<div class="scn-scale-row">' +
            '<input type="range" id="scn-obj-scale" min="0.25" max="8" step="0.25" value="1">' +
            '<span id="scn-scale-label">1×</span></div></div>' +
            '<div class="scn-panel" id="scn-panel-sprites">' +
            '<div class="scn-section-label">Tap to place</div>' +
            '<div id="scn-palette-list"></div></div></aside>' +
            '<div class="scn-stage-wrap" id="scn-stage-wrap">' +
            '<canvas id="scene-canvas" width="640" height="360"></canvas></div></div>' +
            '<div class="scn-toolbar">' +
            '<button type="button" class="btn btn-sm" id="scn-zoom-out">−</button>' +
            '<button type="button" class="btn btn-sm" id="scn-zoom-reset">100%</button>' +
            '<button type="button" class="btn btn-sm" id="scn-zoom-in">+</button>' +
            '<span class="scn-sel-info" id="scn-sel-info">Paint shapes or place sprites · pinch to zoom</span>' +
            '<span class="scn-hint">2D</span></div>';

        const music = $('music-editor-view');
        const editor = $('editor-view');
        const parent = (music && music.parentNode) || (editor && editor.parentNode) || document.body;
        if (music && music.nextSibling) parent.insertBefore(view, music.nextSibling);
        else if (editor) parent.insertBefore(view, editor);
        else parent.appendChild(view);

        $('scn-back').onclick = () => closeSceneEditor();
        $('scn-save').onclick = () => saveSceneFromEditor();
        $('scn-delete-obj').onclick = () => deleteSelectedObject();
        $('scn-zoom-in').onclick = () => { viewScale = Math.min(4, viewScale * 1.25); drawScene(); updateZoomLabel(); };
        $('scn-zoom-out').onclick = () => { viewScale = Math.max(0.25, viewScale / 1.25); drawScene(); updateZoomLabel(); };
        $('scn-zoom-reset').onclick = () => { viewScale = 1; panX = 0; panY = 0; drawScene(); updateZoomLabel(); };

        view.querySelectorAll('.scn-tab').forEach(tab => {
            tab.onclick = () => {
                view.querySelectorAll('.scn-tab').forEach(t => t.classList.remove('active'));
                view.querySelectorAll('.scn-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const panel = $('scn-panel-' + tab.getAttribute('data-scn-tab'));
                if (panel) panel.classList.add('active');
            };
        });

        view.querySelectorAll('#scn-tools .scn-tool').forEach(btn => {
            btn.onclick = () => setTool(btn.getAttribute('data-tool'));
        });

        const grid = $('scn-paint-grid');
        SCN_PALETTE.forEach(c => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'scn-swatch';
            b.style.background = c;
            b.title = c;
            b.onclick = () => setPaintColor(c);
            grid.appendChild(b);
        });
        setPaintColor(paintColor);

        const brush = $('scn-brush-size');
        if (brush) brush.oninput = () => {
            brushSize = parseInt(brush.value, 10) || 16;
            const lab = $('scn-brush-label');
            if (lab) lab.textContent = String(brushSize);
        };
        const scale = $('scn-obj-scale');
        if (scale) scale.oninput = () => {
            const v = parseFloat(scale.value) || 1;
            const lab = $('scn-scale-label');
            if (lab) lab.textContent = v + '×';
            applyScaleToSelected(v);
        };

        const canvas = $('scene-canvas');
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        const stage = $('scn-stage-wrap');
        stage.addEventListener('touchstart', onTouchStart, { passive: false });
        stage.addEventListener('touchmove', onTouchMove, { passive: false });
        stage.addEventListener('touchend', onTouchEnd, { passive: false });
        stage.addEventListener('touchcancel', onTouchEnd, { passive: false });

        injectCreateMenu();
        return true;
    }

    function setTool(t) {
        tool = t || 'select';
        placeSpriteName = null;
        document.querySelectorAll('#scn-tools .scn-tool').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tool') === tool);
        });
        const canvas = $('scene-canvas');
        if (canvas) canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
        updateSelInfo();
    }

    function setPaintColor(c) {
        paintColor = c;
        const active = $('scn-color-active');
        if (active) active.style.background = c;
        document.querySelectorAll('.scn-swatch').forEach(s => {
            s.classList.toggle('active', s.title === c);
        });
    }

    function applyScaleToSelected(v) {
        if (!sceneData || selectedId == null) return;
        const o = sceneData.objects.find(x => x.id === selectedId);
        if (!o) return;
        if (o.kind === 'sprite' || o.sprite) {
            o.scale = v;
            dirty = true;
            drawScene();
            updateSelInfo();
        } else if (o.kind === 'shape') {
            const cx = o.x + o.w / 2;
            const cy = o.y + o.h / 2;
            if (!o._baseW) { o._baseW = o.w; o._baseH = o.h; }
            o.w = Math.max(4, Math.round(o._baseW * v));
            o.h = Math.max(4, Math.round(o._baseH * v));
            o.x = Math.round(cx - o.w / 2);
            o.y = Math.round(cy - o.h / 2);
            o.scale = v;
            dirty = true;
            drawScene();
            updateSelInfo();
        }
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
        sceneData.objects.forEach(o => {
            if (!o.kind) o.kind = o.sprite ? 'sprite' : 'shape';
        });
        sceneData.w = sceneData.w || 640;
        sceneData.h = sceneData.h || 360;
        nextObjId = 1;
        sceneData.objects.forEach(o => { if (o.id >= nextObjId) nextObjId = o.id + 1; });
        selectedId = null;
        panX = 0; panY = 0; viewScale = 1;
        dirty = !!isNew;
        setTool('select');
        const title = $('scene-editor-title');
        if (title) title.textContent = sceneName;
        preloadSprites().then(() => {
            resizeCanvas();
            refreshPalette();
            drawScene();
            updateZoomLabel();
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
            if (v) { v.classList.add('active'); v.style.display = 'flex'; }
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
        getProjectSceneMap(proj)[sceneName] = JSON.parse(JSON.stringify(sceneData));
        saveScenes();
        dirty = false;
        const info = $('scn-sel-info');
        if (info) {
            info.textContent = 'Saved ✓';
            setTimeout(updateSelInfo, 1200);
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
        return Promise.all(Object.keys(assets).map(name => new Promise(resolve => {
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
            list.innerHTML = '<div class="scn-pal-empty">No sprites yet.\n+ Create → Draw image</div>';
            return;
        }
        list.innerHTML = names.map(fn =>
            '<div class="scn-pal-item" data-sprite="' + escapeAttr(fn) + '">' +
            '<img src="' + assets[fn] + '" alt=""><span>' + escapeHtml(fn) + '</span></div>'
        ).join('');
        list.querySelectorAll('.scn-pal-item').forEach(el => {
            el.onclick = () => {
                placeSpriteName = el.getAttribute('data-sprite');
                tool = 'place-sprite';
                const info = $('scn-sel-info');
                if (info) info.textContent = 'Tap canvas to place “' + placeSpriteName + '”';
            };
        });
    }

    function snap(v) { return Math.round(v / 4) * 4; }

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
        if (!o) {
            info.textContent = tool === 'place-sprite' && placeSpriteName
                ? ('Tap canvas to place “' + placeSpriteName + '”')
                : 'Paint shapes or place sprites · pinch to zoom';
            return;
        }
        if (o.kind === 'sprite' || o.sprite) {
            info.textContent = (o.sprite || 'sprite') + ' @ ' + o.x + ',' + o.y + ' · ' + (o.scale || 1) + '×';
            const scale = $('scn-obj-scale');
            const lab = $('scn-scale-label');
            if (scale) scale.value = String(o.scale || 1);
            if (lab) lab.textContent = (o.scale || 1) + '×';
        } else {
            info.textContent = (o.shape || 'shape') + ' ' + (o.color || '') + ' @ ' + o.x + ',' + o.y;
        }
    }

    function updateZoomLabel() {
        const b = $('scn-zoom-reset');
        if (b) b.textContent = Math.round(viewScale * 100) + '%';
    }

    function resizeCanvas() {
        const canvas = $('scene-canvas');
        const wrap = $('scn-stage-wrap');
        if (!canvas || !wrap) return;
        const r = wrap.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(120, Math.floor(r.width * dpr));
        canvas.height = Math.max(120, Math.floor(r.height * dpr));
        canvas.style.width = r.width + 'px';
        canvas.style.height = r.height + 'px';
        drawScene();
    }

    function screenToWorld(clientX, clientY) {
        const canvas = $('scene-canvas');
        const rect = canvas.getBoundingClientRect();
        const sx = (clientX - rect.left) * (canvas.width / rect.width);
        const sy = (clientY - rect.top) * (canvas.height / rect.height);
        return { x: (sx - panX) / viewScale, y: (sy - panY) / viewScale };
    }

    function objBounds(o) {
        if (o.kind === 'sprite' || o.sprite) {
            const img = imgCache[o.sprite];
            const sc = o.scale || 1;
            return {
                x: o.x, y: o.y,
                w: (img ? img.naturalWidth : 16) * sc,
                h: (img ? img.naturalHeight : 16) * sc
            };
        }
        return { x: o.x, y: o.y, w: o.w || 16, h: o.h || 16 };
    }

    function hitTest(wx, wy) {
        if (!sceneData) return null;
        for (let i = sceneData.objects.length - 1; i >= 0; i--) {
            const o = sceneData.objects[i];
            const b = objBounds(o);
            if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return o;
        }
        return null;
    }

    function drawShape(ctx, o) {
        const color = o.color || '#fff';
        ctx.fillStyle = color;
        const x = o.x, y = o.y, w = o.w || 16, h = o.h || 16;
        if (o.shape === 'rect' || o.shape === 'brush') {
            ctx.fillRect(x, y, w, h);
        } else if (o.shape === 'circle') {
            ctx.beginPath();
            ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (o.shape === 'tri') {
            ctx.beginPath();
            ctx.moveTo(x + w / 2, y);
            ctx.lineTo(x + w, y + h);
            ctx.lineTo(x, y + h);
            ctx.closePath();
            ctx.fill();
        }
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

        ctx.fillStyle = 'rgba(28, 32, 48, 0.95)';
        ctx.fillRect(0, 0, sceneData.w, sceneData.h);
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.5)';
        ctx.lineWidth = 2 / viewScale;
        ctx.strokeRect(0, 0, sceneData.w, sceneData.h);

        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1 / viewScale;
        for (let x = 0; x <= sceneData.w; x += 16) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sceneData.h); ctx.stroke();
        }
        for (let y = 0; y <= sceneData.h; y += 16) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sceneData.w, y); ctx.stroke();
        }

        sceneData.objects.forEach(o => {
            if (o.kind === 'sprite' || o.sprite) {
                const img = imgCache[o.sprite];
                const sc = o.scale || 1;
                const w = (img ? img.naturalWidth : 16) * sc;
                const h = (img ? img.naturalHeight : 16) * sc;
                if (img && img.complete) {
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(img, o.x, o.y, w, h);
                } else {
                    ctx.fillStyle = '#555';
                    ctx.fillRect(o.x, o.y, w, h);
                }
            } else {
                drawShape(ctx, o);
            }
            if (o.id === selectedId) {
                const b = objBounds(o);
                ctx.strokeStyle = '#ffea00';
                ctx.lineWidth = 2 / viewScale;
                ctx.strokeRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
            }
        });

        if (shapeStart && dragState && dragState.mode === 'shape') {
            const preview = {
                kind: 'shape', shape: dragState.shape, color: paintColor,
                x: Math.min(shapeStart.x, dragState.wx),
                y: Math.min(shapeStart.y, dragState.wy),
                w: Math.abs(dragState.wx - shapeStart.x) || 4,
                h: Math.abs(dragState.wy - shapeStart.y) || 4
            };
            ctx.globalAlpha = 0.55;
            drawShape(ctx, preview);
            ctx.globalAlpha = 1;
        }
        ctx.restore();
        updateZoomLabel();
    }

    function onPointerDown(e) {
        if (pinch) return;
        const canvas = $('scene-canvas');
        if (!canvas || !sceneData) return;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        const world = screenToWorld(e.clientX, e.clientY);

        if (tool === 'place-sprite' && placeSpriteName) {
            addSprite(placeSpriteName, world.x, world.y);
            placeSpriteName = null;
            setTool('select');
            return;
        }
        if (tool === 'brush') {
            const s = brushSize;
            addShape('brush', snap(world.x - s / 2), snap(world.y - s / 2), s, s);
            dragState = { mode: 'brush', pointerId: e.pointerId };
            return;
        }
        if (tool === 'rect' || tool === 'tri' || tool === 'circle') {
            shapeStart = { x: snap(world.x), y: snap(world.y) };
            dragState = { mode: 'shape', shape: tool, wx: world.x, wy: world.y, pointerId: e.pointerId };
            drawScene();
            return;
        }

        const hit = hitTest(world.x, world.y);
        if (hit) {
            selectedId = hit.id;
            dragState = { mode: 'move', id: hit.id, ox: world.x - hit.x, oy: world.y - hit.y, pointerId: e.pointerId };
            const scale = $('scn-obj-scale');
            const lab = $('scn-scale-label');
            if (scale) scale.value = String(hit.scale || 1);
            if (lab) lab.textContent = (hit.scale || 1) + '×';
            updateSelInfo();
            drawScene();
        } else {
            selectedId = null;
            dragState = { mode: 'pan', ox: e.clientX - panX, oy: e.clientY - panY, pointerId: e.pointerId };
            updateSelInfo();
            drawScene();
        }
    }

    function onPointerMove(e) {
        if (pinch || !dragState || !sceneData) return;
        if (dragState.pointerId != null && e.pointerId !== dragState.pointerId) return;
        const world = screenToWorld(e.clientX, e.clientY);
        if (dragState.mode === 'move') {
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
        } else if (dragState.mode === 'brush') {
            const s = brushSize;
            addShape('brush', snap(world.x - s / 2), snap(world.y - s / 2), s, s, true);
            drawScene();
        } else if (dragState.mode === 'shape') {
            dragState.wx = world.x;
            dragState.wy = world.y;
            drawScene();
        }
    }

    function onPointerUp(e) {
        if (dragState && dragState.mode === 'shape' && shapeStart) {
            const wx = dragState.wx, wy = dragState.wy;
            const x = Math.min(shapeStart.x, snap(wx));
            const y = Math.min(shapeStart.y, snap(wy));
            const w = Math.max(4, Math.abs(snap(wx) - shapeStart.x));
            const h = Math.max(4, Math.abs(snap(wy) - shapeStart.y));
            addShape(dragState.shape, x, y, w, h);
            shapeStart = null;
        }
        dragState = null;
        shapeStart = null;
        try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}
        drawScene();
    }

    function addSprite(sprite, x, y) {
        if (!sceneData) return;
        const id = nextObjId++;
        sceneData.objects.push({ id: id, kind: 'sprite', sprite: sprite, x: snap(x), y: snap(y), scale: 1 });
        selectedId = id;
        dirty = true;
        drawScene();
        updateSelInfo();
    }

    function addShape(shape, x, y, w, h, mergeBrush) {
        if (!sceneData) return;
        if (mergeBrush && shape === 'brush' && sceneData.objects.length) {
            const last = sceneData.objects[sceneData.objects.length - 1];
            if (last.kind === 'shape' && last.shape === 'brush' && last.x === x && last.y === y) return;
        }
        const id = nextObjId++;
        sceneData.objects.push({
            id: id, kind: 'shape', shape: shape, color: paintColor,
            x: x, y: y, w: w, h: h, scale: 1, _baseW: w, _baseH: h
        });
        if (!mergeBrush) selectedId = id;
        dirty = true;
        if (!mergeBrush) { drawScene(); updateSelInfo(); }
    }

    function onWheel(e) {
        e.preventDefault();
        const worldBefore = screenToWorld(e.clientX, e.clientY);
        viewScale = Math.min(4, Math.max(0.25, viewScale * (e.deltaY > 0 ? 0.9 : 1.1)));
        const canvas = $('scene-canvas');
        const rect = canvas.getBoundingClientRect();
        const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
        panX = sx - worldBefore.x * viewScale;
        panY = sy - worldBefore.y * viewScale;
        drawScene();
        updateZoomLabel();
    }

    function touchDist(t0, t1) {
        return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY) || 1;
    }
    function onTouchStart(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            dragState = null; shapeStart = null;
            pinch = {
                dist: touchDist(e.touches[0], e.touches[1]),
                scale: viewScale, panX: panX, panY: panY,
                midX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                midY: (e.touches[0].clientY + e.touches[1].clientY) / 2
            };
        }
    }
    function onTouchMove(e) {
        if (e.touches.length === 2 && pinch) {
            e.preventDefault();
            const d = touchDist(e.touches[0], e.touches[1]);
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            viewScale = Math.min(4, Math.max(0.25, pinch.scale * (d / pinch.dist)));
            panX = pinch.panX + (midX - pinch.midX);
            panY = pinch.panY + (midY - pinch.midY);
            drawScene();
            updateZoomLabel();
        }
    }
    function onTouchEnd(e) {
        if (e.touches.length < 2) pinch = null;
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
                '<div class="item-title"><span style="font-size:1.1rem">🗺</span>' +
                '<span>' + escapeHtml(fn) + '</span><span class="item-badge">SCENE</span></div>' +
                '<div class="item-actions">' +
                '<button type="button" class="btn-icon-sm" data-scn-edit="' + escapeAttr(fn) + '">✎</button>' +
                '<button type="button" class="btn btn-delete" data-scn-del="' + escapeAttr(fn) + '">🗑</button></div>';
            div.querySelector('.item-title').onclick = () => openSceneEditor(fn, false);
            const ed = div.querySelector('[data-scn-edit]');
            if (ed) ed.onclick = (ev) => { ev.stopPropagation(); openSceneEditor(fn, false); };
            const del = div.querySelector('[data-scn-del]');
            if (del) del.onclick = (ev) => {
                ev.stopPropagation();
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

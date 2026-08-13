// src/scene-editor.js — 2D scene editor (full pixel grid)
// Brush paints one cell · shapes place as 1 cell · sprite spectrum colors

(function () {
    'use strict';

    const SCENES_KEY = 'luax_project_scenes';
    const CELL = 16;
    const SCN_PRESETS = [
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
    let placeSpriteName = null;
    let pinch = null;
    const spectrum = { h: 120, s: 0.7, v: 0.7 };

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
        return { w: 40 * CELL, h: 22 * CELL, cell: CELL, objects: [] };
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&').replace(/</g, '<').replace(/"/g, '"');
    }
    function escapeAttr(s) {
        return String(s).replace(/&/g, '&').replace(/"/g, '"');
    }

    function normalizeHex(v) {
        if (!v) return null;
        let h = String(v).trim();
        if (h[0] !== '#') h = '#' + h;
        if (/^#[0-9a-fA-F]{3}$/.test(h)) {
            h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
        }
        if (!/^#[0-9a-fA-F]{6}$/.test(h)) return null;
        return h.toLowerCase();
    }

    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / d + 2) / 6;
            else h = ((r - g) / d + 4) / 6;
        }
        return { h: h * 360, s: max === 0 ? 0 : d / max, v: max };
    }
    function hsvToRgb(h, s, v) {
        h = ((h % 360) + 360) % 360;
        const c = v * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = v - c;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    }
    function hsvToHex(h, s, v) {
        const [r, g, b] = hsvToRgb(h, s, v);
        const p = (n) => n.toString(16).padStart(2, '0');
        return '#' + p(r) + p(g) + p(b);
    }

    function setPaintColor(hex) {
        const n = normalizeHex(hex) || '#000000';
        paintColor = n;
        const m = n.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (m) {
            const hsv = rgbToHsv(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
            spectrum.h = hsv.h; spectrum.s = hsv.s; spectrum.v = hsv.v;
        }
        updateColorUI();
    }

    function applySpectrumColor() {
        paintColor = hsvToHex(spectrum.h, spectrum.s, spectrum.v);
        updateColorUI();
    }

    function updateColorUI() {
        const active = $('scn-color-active');
        if (active) active.style.background = paintColor;
        const hexInput = $('scn-hex-input');
        if (hexInput && document.activeElement !== hexInput) hexInput.value = paintColor;
        const preview = $('scn-spectrum-preview');
        if (preview) preview.style.background = paintColor;
        const sv = $('scn-sv');
        if (sv) {
            const [hr, hg, hb] = hsvToRgb(spectrum.h, 1, 1);
            sv.style.background =
                'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, rgb(' + hr + ',' + hg + ',' + hb + '))';
            const cursor = $('scn-sv-cursor');
            if (cursor) {
                cursor.style.left = (spectrum.s * 100) + '%';
                cursor.style.top = ((1 - spectrum.v) * 100) + '%';
            }
        }
        const hue = $('scn-hue');
        if (hue) hue.value = String(Math.round(spectrum.h));
        document.querySelectorAll('.scn-swatch').forEach(s => {
            s.classList.toggle('active', normalizeHex(s.title) === paintColor);
        });
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
            '<div class="scn-body"><aside class="scn-palette">' +
            '<div class="scn-tabs">' +
            '<button type="button" class="scn-tab active" data-scn-tab="paint">Paint</button>' +
            '<button type="button" class="scn-tab" data-scn-tab="sprites">Sprites</button></div>' +
            '<div class="scn-panel active" id="scn-panel-paint">' +
            '<div class="scn-section-label">Tool (1 cell)</div>' +
            '<div class="scn-tool-row" id="scn-tools">' +
            '<button type="button" class="scn-tool active" data-tool="select">↖</button>' +
            '<button type="button" class="scn-tool" data-tool="brush">Brush</button>' +
            '<button type="button" class="scn-tool" data-tool="rect">□</button>' +
            '<button type="button" class="scn-tool" data-tool="tri">△</button>' +
            '<button type="button" class="scn-tool" data-tool="circle">○</button>' +
            '<button type="button" class="scn-tool" data-tool="eraser">⌫</button></div>' +
            '<div class="scn-section-label">Color</div>' +
            '<div class="scn-color-active" id="scn-color-active"></div>' +
            '<div class="scn-spectrum-box">' +
            '<div class="scn-sv" id="scn-sv"><div class="scn-sv-cursor" id="scn-sv-cursor"></div></div>' +
            '<input type="range" id="scn-hue" class="scn-hue" min="0" max="360" value="120">' +
            '<div class="scn-hex-row">' +
            '<div class="scn-spectrum-preview" id="scn-spectrum-preview"></div>' +
            '<input type="text" id="scn-hex-input" class="scn-hex-input" maxlength="7" value="#22b14c">' +
            '</div></div>' +
            '<div class="scn-section-label">Presets</div>' +
            '<div class="scn-paint-grid" id="scn-paint-grid"></div>' +
            '<div class="scn-section-label">Selected scale</div>' +
            '<div class="scn-scale-row">' +
            '<input type="range" id="scn-obj-scale" min="1" max="8" step="1" value="1">' +
            '<span id="scn-scale-label">1×</span></div>' +
            '<p class="scn-grid-note">Grid ' + CELL + 'px · click places 1 cell</p></div>' +
            '<div class="scn-panel" id="scn-panel-sprites">' +
            '<div class="scn-section-label">Tap sprite, then cell</div>' +
            '<div id="scn-palette-list"></div></div></aside>' +
            '<div class="scn-stage-wrap" id="scn-stage-wrap">' +
            '<canvas id="scene-canvas" width="640" height="360"></canvas></div></div>' +
            '<div class="scn-toolbar">' +
            '<button type="button" class="btn btn-sm" id="scn-zoom-out">−</button>' +
            '<button type="button" class="btn btn-sm" id="scn-zoom-reset">100%</button>' +
            '<button type="button" class="btn btn-sm" id="scn-zoom-in">+</button>' +
            '<span class="scn-sel-info" id="scn-sel-info">Pixel grid · one cell per click</span>' +
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
        $('scn-zoom-in').onclick = () => { viewScale = Math.min(6, viewScale * 1.25); drawScene(); updateZoomLabel(); };
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
        SCN_PRESETS.forEach(c => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'scn-swatch';
            b.style.background = c;
            b.title = c;
            b.onclick = () => setPaintColor(c);
            grid.appendChild(b);
        });

        const sv = $('scn-sv');
        if (sv) {
            const pickSV = (e) => {
                const r = sv.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
                spectrum.s = x;
                spectrum.v = 1 - y;
                applySpectrumColor();
            };
            sv.addEventListener('pointerdown', (e) => {
                sv.setPointerCapture(e.pointerId);
                pickSV(e);
                const move = (ev) => pickSV(ev);
                const up = () => {
                    sv.removeEventListener('pointermove', move);
                    sv.removeEventListener('pointerup', up);
                };
                sv.addEventListener('pointermove', move);
                sv.addEventListener('pointerup', up);
            });
        }
        const hue = $('scn-hue');
        if (hue) hue.oninput = () => {
            spectrum.h = parseFloat(hue.value) || 0;
            applySpectrumColor();
        };
        const hexInput = $('scn-hex-input');
        if (hexInput) hexInput.onchange = () => {
            const n = normalizeHex(hexInput.value);
            if (n) setPaintColor(n);
            else updateColorUI();
        };

        const scale = $('scn-obj-scale');
        if (scale) scale.oninput = () => {
            const v = parseInt(scale.value, 10) || 1;
            const lab = $('scn-scale-label');
            if (lab) lab.textContent = v + '×';
            applyScaleToSelected(v);
        };

        setPaintColor(paintColor);

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
        if (canvas) canvas.style.cursor = (tool === 'select') ? 'default' : 'crosshair';
        updateSelInfo();
    }

    function cellOf(wx, wy) {
        return { cx: Math.floor(wx / CELL), cy: Math.floor(wy / CELL) };
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
        sceneData.w = sceneData.w || 40 * CELL;
        sceneData.h = sceneData.h || 22 * CELL;
        sceneData.cell = CELL;
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
                document.querySelectorAll('#scn-tools .scn-tool').forEach(b => b.classList.remove('active'));
                const info = $('scn-sel-info');
                if (info) info.textContent = 'Tap a grid cell to place “' + placeSpriteName + '”';
            };
        });
    }

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
            if (tool === 'place-sprite' && placeSpriteName) info.textContent = 'Tap a grid cell to place “' + placeSpriteName + '”';
            else if (tool === 'brush') info.textContent = 'Brush · paints 1 grid cell';
            else if (tool === 'rect' || tool === 'tri' || tool === 'circle') info.textContent = 'Tap cell → places 1 ' + tool;
            else if (tool === 'eraser') info.textContent = 'Eraser · tap cell to clear';
            else info.textContent = 'Pixel grid · one cell per click';
            return;
        }
        if (o.kind === 'sprite' || o.sprite) {
            info.textContent = (o.sprite || 'sprite') + ' cell ' + o.cx + ',' + o.cy + ' · ' + (o.scale || 1) + '×';
            const scale = $('scn-obj-scale');
            const lab = $('scn-scale-label');
            if (scale) scale.value = String(o.scale || 1);
            if (lab) lab.textContent = (o.scale || 1) + '×';
        } else {
            info.textContent = (o.shape || 'cell') + ' ' + (o.color || '') + ' @ ' + o.cx + ',' + o.cy;
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
            const x = (o.cx != null ? o.cx * CELL : o.x) || 0;
            const y = (o.cy != null ? o.cy * CELL : o.y) || 0;
            return { x: x, y: y, w: (img ? img.naturalWidth : CELL) * sc, h: (img ? img.naturalHeight : CELL) * sc };
        }
        const x = o.cx != null ? o.cx * CELL : o.x;
        const y = o.cy != null ? o.cy * CELL : o.y;
        return { x: x, y: y, w: CELL, h: CELL };
    }

    function hitTest(wx, wy) {
        if (!sceneData) return null;
        for (let i = sceneData.objects.length - 1; i >= 0; i--) {
            const o = sceneData.objects[i];
            const b = objBounds(o);
            if (wx >= b.x && wx < b.x + b.w && wy >= b.y && wy < b.y + b.h) return o;
        }
        return null;
    }

    function findShapeAtCell(cx, cy) {
        if (!sceneData) return null;
        for (let i = sceneData.objects.length - 1; i >= 0; i--) {
            const o = sceneData.objects[i];
            if (o.kind === 'shape' && o.cx === cx && o.cy === cy) return o;
        }
        return null;
    }

    function drawShapeCell(ctx, o) {
        const color = o.color || '#fff';
        const x = o.cx * CELL;
        const y = o.cy * CELL;
        ctx.fillStyle = color;
        const shape = o.shape || 'rect';
        if (shape === 'rect' || shape === 'brush') {
            ctx.fillRect(x, y, CELL, CELL);
        } else if (shape === 'circle') {
            ctx.beginPath();
            ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 2 - 0.5, 0, Math.PI * 2);
            ctx.fill();
        } else if (shape === 'tri') {
            ctx.beginPath();
            ctx.moveTo(x + CELL / 2, y + 1);
            ctx.lineTo(x + CELL - 1, y + CELL - 1);
            ctx.lineTo(x + 1, y + CELL - 1);
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

        ctx.fillStyle = 'rgba(20, 24, 36, 0.98)';
        ctx.fillRect(0, 0, sceneData.w, sceneData.h);

        const cols = Math.ceil(sceneData.w / CELL);
        const rows = Math.ceil(sceneData.h / CELL);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1 / viewScale;
        for (let c = 0; c <= cols; c++) {
            const x = c * CELL;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sceneData.h); ctx.stroke();
        }
        for (let r = 0; r <= rows; r++) {
            const y = r * CELL;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sceneData.w, y); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(167, 139, 250, 0.55)';
        ctx.lineWidth = 2 / viewScale;
        ctx.strokeRect(0, 0, sceneData.w, sceneData.h);

        sceneData.objects.forEach(o => {
            if (o.kind === 'shape') drawShapeCell(ctx, o);
        });
        sceneData.objects.forEach(o => {
            if (o.kind === 'sprite' || o.sprite) {
                const img = imgCache[o.sprite];
                const sc = o.scale || 1;
                const x = o.cx != null ? o.cx * CELL : o.x;
                const y = o.cy != null ? o.cy * CELL : o.y;
                const w = (img ? img.naturalWidth : CELL) * sc;
                const h = (img ? img.naturalHeight : CELL) * sc;
                if (img && img.complete) {
                    ctx.imageSmoothingEnabled = false;
                    ctx.drawImage(img, x, y, w, h);
                } else {
                    ctx.fillStyle = '#555';
                    ctx.fillRect(x, y, w, h);
                }
            }
            if (o.id === selectedId) {
                const b = objBounds(o);
                ctx.strokeStyle = '#ffea00';
                ctx.lineWidth = 2 / viewScale;
                ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
            }
        });

        ctx.restore();
        updateZoomLabel();
    }

    function paintCell(cx, cy, shape) {
        if (!sceneData) return;
        const maxC = Math.floor(sceneData.w / CELL);
        const maxR = Math.floor(sceneData.h / CELL);
        if (cx < 0 || cy < 0 || cx >= maxC || cy >= maxR) return;
        const existing = findShapeAtCell(cx, cy);
        if (existing) {
            existing.shape = shape;
            existing.color = paintColor;
            selectedId = existing.id;
            dirty = true;
            return;
        }
        const id = nextObjId++;
        sceneData.objects.push({
            id: id, kind: 'shape', shape: shape, color: paintColor,
            cx: cx, cy: cy, x: cx * CELL, y: cy * CELL, w: CELL, h: CELL
        });
        selectedId = id;
        dirty = true;
    }

    function eraseCell(cx, cy) {
        if (!sceneData) return;
        const before = sceneData.objects.length;
        sceneData.objects = sceneData.objects.filter(o => {
            if (o.kind !== 'shape') return true;
            return !(o.cx === cx && o.cy === cy);
        });
        if (sceneData.objects.length !== before) {
            selectedId = null;
            dirty = true;
        }
    }

    function addSpriteAtCell(sprite, cx, cy) {
        if (!sceneData) return;
        const id = nextObjId++;
        sceneData.objects.push({
            id: id, kind: 'sprite', sprite: sprite,
            cx: cx, cy: cy, x: cx * CELL, y: cy * CELL, scale: 1
        });
        selectedId = id;
        dirty = true;
    }

    function onPointerDown(e) {
        if (pinch) return;
        const canvas = $('scene-canvas');
        if (!canvas || !sceneData) return;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        const world = screenToWorld(e.clientX, e.clientY);
        const { cx, cy } = cellOf(world.x, world.y);

        if (tool === 'place-sprite' && placeSpriteName) {
            addSpriteAtCell(placeSpriteName, cx, cy);
            placeSpriteName = null;
            setTool('select');
            drawScene();
            updateSelInfo();
            return;
        }
        if (tool === 'brush') {
            paintCell(cx, cy, 'brush');
            dragState = { mode: 'paint', shape: 'brush', lastCx: cx, lastCy: cy, pointerId: e.pointerId };
            drawScene();
            updateSelInfo();
            return;
        }
        if (tool === 'rect' || tool === 'tri' || tool === 'circle') {
            paintCell(cx, cy, tool);
            dragState = { mode: 'paint', shape: tool, lastCx: cx, lastCy: cy, pointerId: e.pointerId };
            drawScene();
            updateSelInfo();
            return;
        }
        if (tool === 'eraser') {
            eraseCell(cx, cy);
            dragState = { mode: 'erase', lastCx: cx, lastCy: cy, pointerId: e.pointerId };
            drawScene();
            updateSelInfo();
            return;
        }

        const hit = hitTest(world.x, world.y);
        if (hit) {
            selectedId = hit.id;
            dragState = {
                mode: 'move', id: hit.id, pointerId: e.pointerId,
                startCx: cx, startCy: cy,
                origCx: hit.cx != null ? hit.cx : Math.floor((hit.x || 0) / CELL),
                origCy: hit.cy != null ? hit.cy : Math.floor((hit.y || 0) / CELL)
            };
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
        const { cx, cy } = cellOf(world.x, world.y);

        if (dragState.mode === 'paint') {
            if (cx !== dragState.lastCx || cy !== dragState.lastCy) {
                paintCell(cx, cy, dragState.shape);
                dragState.lastCx = cx;
                dragState.lastCy = cy;
                drawScene();
            }
        } else if (dragState.mode === 'erase') {
            if (cx !== dragState.lastCx || cy !== dragState.lastCy) {
                eraseCell(cx, cy);
                dragState.lastCx = cx;
                dragState.lastCy = cy;
                drawScene();
            }
        } else if (dragState.mode === 'move') {
            const o = sceneData.objects.find(x => x.id === dragState.id);
            if (!o) return;
            const dx = cx - dragState.startCx;
            const dy = cy - dragState.startCy;
            o.cx = dragState.origCx + dx;
            o.cy = dragState.origCy + dy;
            o.x = o.cx * CELL;
            o.y = o.cy * CELL;
            dirty = true;
            updateSelInfo();
            drawScene();
        } else if (dragState.mode === 'pan') {
            panX = e.clientX - dragState.ox;
            panY = e.clientY - dragState.oy;
            drawScene();
        }
    }

    function onPointerUp(e) {
        dragState = null;
        try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}
    }

    function onWheel(e) {
        e.preventDefault();
        const worldBefore = screenToWorld(e.clientX, e.clientY);
        viewScale = Math.min(6, Math.max(0.25, viewScale * (e.deltaY > 0 ? 0.9 : 1.1)));
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
            dragState = null;
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
            viewScale = Math.min(6, Math.max(0.25, pinch.scale * (d / pinch.dist)));
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

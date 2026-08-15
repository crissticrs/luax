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
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }
    function escapeAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
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

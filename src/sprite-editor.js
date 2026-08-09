// src/sprite-editor.js — pixel sprite editor (layers, tools, spectrum, export)

// ============================================================
// PIXEL SPRITE EDITOR (mini Aseprite-style)
// ============================================================
/**
 * Classic Microsoft Paint-style palette (2 rows × 14 = 28 colors).
 * First cell is transparent (eraser).
 * Layout matches the familiar Windows Paint color box.
 */
// Classic Windows Paint colors — 2 rows × 14 (incl. transparent)
const SPRITE_PALETTE = [
    // Row 1
    null,      '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200',
    '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#ffffff', '#c3c3c3', '#b97a57',
    // Row 2
    '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7',
    '#7f7f7f', '#c3c3c3', '#fafafa', '#e5d3b3', '#d5c4a1', '#a5734d', '#63300f',
];

const spriteEd = {
    lockAspect: true,
    w: 16,
    h: 16,
    layers: [],
    activeLayer: 0,
    tool: 'pencil',
    color: '#000000',
    name: '',
    drawing: false,
    dirty: false,
    showGrid: true,
    history: [],
    historyIdx: -1,
    zoom: 1,
    panX: 0,
    panY: 0,
    fullscreen: false,
    _panning: false,
    _panLast: null,
};

function emptySpritePixels(w, h) {
    return new Uint8ClampedArray((w || spriteEd.w) * (h || spriteEd.h) * 4);
}

function createSpriteLayer(name) {
    return {
        name: name || ('Layer ' + (spriteEd.layers.length + 1)),
        visible: true,
        pixels: emptySpritePixels(),
    };
}

function activeLayerPixels() {
    const L = spriteEd.layers[spriteEd.activeLayer];
    return L ? L.pixels : null;
}

/** getter/setter bridge so older code using spriteEd.pixels still works */
Object.defineProperty(spriteEd, 'pixels', {
    get() { return activeLayerPixels(); },
    set(v) {
        if (spriteEd.layers[spriteEd.activeLayer]) {
            spriteEd.layers[spriteEd.activeLayer].pixels = v;
        }
    },
});

function snapshotLayers() {
    return spriteEd.layers.map(L => ({
        name: L.name,
        visible: L.visible,
        pixels: new Uint8ClampedArray(L.pixels),
    }));
}

function restoreLayers(snap) {
    spriteEd.layers = snap.map(L => ({
        name: L.name,
        visible: L.visible,
        pixels: new Uint8ClampedArray(L.pixels),
    }));
    if (spriteEd.activeLayer >= spriteEd.layers.length) {
        spriteEd.activeLayer = Math.max(0, spriteEd.layers.length - 1);
    }
}

function pushSpriteHistory() {
    ensureSpritePixels();
    const snap = snapshotLayers();
    spriteEd.history = spriteEd.history.slice(0, spriteEd.historyIdx + 1);
    spriteEd.history.push(snap);
    if (spriteEd.history.length > 40) spriteEd.history.shift();
    spriteEd.historyIdx = spriteEd.history.length - 1;
}

function spriteUndo() {
    if (spriteEd.historyIdx <= 0) return;
    spriteEd.historyIdx--;
    restoreLayers(spriteEd.history[spriteEd.historyIdx]);
    spriteEd.dirty = true;
    renderSpriteLayersUI();
    redrawSpriteCanvas();
}

function spriteRedo() {
    if (spriteEd.historyIdx >= spriteEd.history.length - 1) return;
    spriteEd.historyIdx++;
    restoreLayers(spriteEd.history[spriteEd.historyIdx]);
    spriteEd.dirty = true;
    renderSpriteLayersUI();
    redrawSpriteCanvas();
}

function addSpriteLayer() {
    pushSpriteHistory();
    spriteEd.layers.push(createSpriteLayer());
    spriteEd.activeLayer = spriteEd.layers.length - 1;
    pushSpriteHistory();
    spriteEd.dirty = true;
    renderSpriteLayersUI();
    redrawSpriteCanvas();
}

function selectSpriteLayer(idx) {
    if (idx < 0 || idx >= spriteEd.layers.length) return;
    spriteEd.activeLayer = idx;
    renderSpriteLayersUI();
}

function toggleSpriteLayerVisible(idx, e) {
    if (e) e.stopPropagation();
    if (!spriteEd.layers[idx]) return;
    pushSpriteHistory();
    spriteEd.layers[idx].visible = !spriteEd.layers[idx].visible;
    pushSpriteHistory();
    spriteEd.dirty = true;
    renderSpriteLayersUI();
    redrawSpriteCanvas();
}

function closeSpriteLayerMenus() {
    document.querySelectorAll('.spr-layer-menu.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.spr-layer-more.open').forEach(m => m.classList.remove('open'));
}

function toggleSpriteLayerMenu(e, btn) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const wrap = btn && btn.closest('.spr-layer-menu-wrap');
    const menu = wrap && wrap.querySelector('.spr-layer-menu');
    if (!menu) return;
    const wasOpen = menu.classList.contains('open');
    closeSpriteLayerMenus();
    if (!wasOpen) {
        const r = btn.getBoundingClientRect();
        menu.style.top = Math.round(r.bottom + 4) + 'px';
        const menuW = 108;
        let left = Math.round(r.right - menuW);
        if (left < 8) left = 8;
        if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
        menu.style.left = left + 'px';
        menu.classList.add('open');
        btn.classList.add('open');
    }
}

function deleteSpriteLayer(idx, e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    closeSpriteLayerMenus();
    if (!spriteEd.layers[idx]) return;
    if (spriteEd.layers.length <= 1) {
        alert('You need at least one layer.');
        return;
    }
    pushSpriteHistory();
    spriteEd.layers.splice(idx, 1);
    if (spriteEd.activeLayer >= spriteEd.layers.length) {
        spriteEd.activeLayer = spriteEd.layers.length - 1;
    } else if (spriteEd.activeLayer > idx) {
        spriteEd.activeLayer -= 1;
    }
    pushSpriteHistory();
    spriteEd.dirty = true;
    renderSpriteLayersUI();
    redrawSpriteCanvas();
}

function renderSpriteLayersUI() {
    const list = document.getElementById('spr-layers-list');
    const title = document.getElementById('spr-layers-title');
    if (title) title.textContent = 'Layers (' + spriteEd.layers.length + ')';
    if (!list) return;
    list.innerHTML = '';
    // top of list = top layer (draw order reverse)
    for (let i = spriteEd.layers.length - 1; i >= 0; i--) {
        const L = spriteEd.layers[i];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spr-layer-item' + (i === spriteEd.activeLayer ? ' active' : '');
        btn.onclick = () => selectSpriteLayer(i);
        const eye = document.createElement('span');
        eye.className = 'spr-layer-eye';
        eye.textContent = L.visible ? '👁' : '👁‍🗨';
        eye.title = L.visible ? 'Hide' : 'Show';
        eye.setAttribute('role', 'button');
        eye.setAttribute('aria-label', (L.visible ? 'Hide' : 'Show') + ' layer ' + L.name);
        eye.onclick = (e) => toggleSpriteLayerVisible(i, e);
        const name = document.createElement('span');
        name.className = 'spr-layer-name';
        name.textContent = L.name;
        const menuWrap = document.createElement('div');
        menuWrap.className = 'spr-layer-menu-wrap';
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'spr-layer-more';
        more.title = 'Layer options';
        more.setAttribute('aria-label', 'Layer options');
        more.textContent = '⋮';
        more.onclick = (e) => toggleSpriteLayerMenu(e, more);
        const menu = document.createElement('div');
        menu.className = 'spr-layer-menu';
        menu.onclick = (e) => e.stopPropagation();
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'spr-layer-menu-item danger';
        del.textContent = 'Delete';
        del.onclick = (e) => deleteSpriteLayer(i, e);
        menu.appendChild(del);
        menuWrap.appendChild(more);
        menuWrap.appendChild(menu);
        btn.appendChild(eye);
        btn.appendChild(name);
        btn.appendChild(menuWrap);
        list.appendChild(btn);
    }
}

function compositeSpritePixels() {
    const out = emptySpritePixels();
    for (let li = 0; li < spriteEd.layers.length; li++) {
        const L = spriteEd.layers[li];
        if (!L.visible) continue;
        const src = L.pixels;
        for (let i = 0; i < out.length; i += 4) {
            const sa = src[i + 3] / 255;
            if (sa <= 0) continue;
            const da = out[i + 3] / 255;
            const outA = sa + da * (1 - sa);
            if (outA <= 0) continue;
            out[i] = Math.round((src[i] * sa + out[i] * da * (1 - sa)) / outA);
            out[i + 1] = Math.round((src[i + 1] * sa + out[i + 1] * da * (1 - sa)) / outA);
            out[i + 2] = Math.round((src[i + 2] * sa + out[i + 2] * da * (1 - sa)) / outA);
            out[i + 3] = Math.round(outA * 255);
        }
    }
    return out;
}

function normalizeSpriteHex(v) {
    if (!v) return null;
    let h = String(v).trim();
    if (h[0] !== '#') h = '#' + h;
    if (/^#[0-9a-fA-F]{3}$/.test(h)) {
        h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(h)) return null;
    return h.toLowerCase();
}

function setSpriteColor(hex) {
    hex = normalizeSpriteHex(hex) || '#000000';
    spriteEd.color = hex;
    if (spriteEd.tool === 'eraser' || spriteEd.tool === 'picker') {
        setSpriteTool('pencil');
    } else {
        renderSpritePalette();
    }
}

// —— Color picker: Presets / Spectrum / Sliders ——
const spriteSpectrum = { h: 0, s: 1, v: 1, open: false, drag: null, tab: 'presets' };

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
    const s = max === 0 ? 0 : d / max;
    return { h: h * 360, s: s, v: max };
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
    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
    ];
}

function hsvToHex(h, s, v) {
    const [r, g, b] = hsvToRgb(h, s, v);
    const p = (n) => n.toString(16).padStart(2, '0');
    return '#' + p(r) + p(g) + p(b);
}

function setSpectrumTab(tab) {
    spriteSpectrum.tab = tab;
    document.querySelectorAll('.spr-picker-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.spr-picker-panel').forEach(p => {
        p.classList.toggle('active', p.id === 'spr-panel-' + tab);
    });
    requestAnimationFrame(() => updateSpectrumUI());
}

function renderSpectrumPresets() {
    const grid = document.getElementById('spr-preset-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const cur = hsvToHex(spriteSpectrum.h, spriteSpectrum.s, spriteSpectrum.v);
    SPRITE_PALETTE.forEach((c) => {
        if (c === null) return; // skip transparent in picker
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spr-swatch';
        btn.style.background = c;
        if (normalizeSpriteHex(c) === normalizeSpriteHex(cur)) btn.classList.add('active');
        btn.title = c;
        btn.onclick = () => {
            let h = c.slice(1);
            const n = parseInt(h, 16);
            const hsv = rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
            spriteSpectrum.h = hsv.h;
            spriteSpectrum.s = hsv.s;
            spriteSpectrum.v = hsv.v;
            updateSpectrumUI();
            renderSpectrumPresets();
        };
        grid.appendChild(btn);
    });
}

function updateSpectrumUI() {
    const hex = hsvToHex(spriteSpectrum.h, spriteSpectrum.s, spriteSpectrum.v);
    const preview = document.getElementById('spr-spectrum-preview');
    const hexInput = document.getElementById('spr-spectrum-hex');
    if (preview) preview.style.background = hex;
    if (hexInput && document.activeElement !== hexInput) hexInput.value = hex;

    // Spectrum tab
    const sv = document.getElementById('spr-sv');
    const hueEl = document.getElementById('spr-hue');
    const svCur = document.getElementById('spr-sv-cursor');
    const hueCur = document.getElementById('spr-hue-cursor');
    if (sv && svCur) {
        const [hr, hg, hb] = hsvToRgb(spriteSpectrum.h, 1, 1);
        sv.style.background = 'rgb(' + hr + ',' + hg + ',' + hb + ')';
        const rect = sv.getBoundingClientRect();
        const w = rect.width || 1;
        const h = rect.height || 1;
        svCur.style.left = (spriteSpectrum.s * w) + 'px';
        svCur.style.top = ((1 - spriteSpectrum.v) * h) + 'px';
    }
    if (hueEl && hueCur) {
        const hueRect = hueEl.getBoundingClientRect();
        const hw = hueRect.width || 1;
        hueCur.style.left = ((spriteSpectrum.h / 360) * hw) + 'px';
    }

    // Sliders tab
    const sh = document.getElementById('spr-slider-hue');
    const ss = document.getElementById('spr-slider-sat');
    const svl = document.getElementById('spr-slider-val');
    const shv = document.getElementById('spr-slider-hue-val');
    const ssv = document.getElementById('spr-slider-sat-val');
    const svv = document.getElementById('spr-slider-val-val');
    if (sh && document.activeElement !== sh) sh.value = Math.round(spriteSpectrum.h);
    if (ss && document.activeElement !== ss) ss.value = Math.round(spriteSpectrum.s * 100);
    if (svl && document.activeElement !== svl) svl.value = Math.round(spriteSpectrum.v * 100);
    if (shv) shv.textContent = Math.round(spriteSpectrum.h) + '°';
    if (ssv) ssv.textContent = Math.round(spriteSpectrum.s * 100) + '%';
    if (svv) svv.textContent = Math.round(spriteSpectrum.v * 100) + '%';

    // Slider track fills
    if (ss) {
        const [hr, hg, hb] = hsvToRgb(spriteSpectrum.h, 1, spriteSpectrum.v);
        const gray = Math.round(spriteSpectrum.v * 255);
        ss.style.background = 'linear-gradient(to right, rgb(' + gray + ',' + gray + ',' + gray + '), rgb(' + hr + ',' + hg + ',' + hb + '))';
    }
    if (svl) {
        const [hr, hg, hb] = hsvToRgb(spriteSpectrum.h, spriteSpectrum.s, 1);
        svl.style.background = 'linear-gradient(to right, #000, rgb(' + hr + ',' + hg + ',' + hb + '))';
    }
}

function openSpriteSpectrum() {
    const cur = normalizeSpriteHex(spriteEd.color) || '#000000';
    let h = cur.slice(1);
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const n = parseInt(h, 16);
    const hsv = rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
    spriteSpectrum.h = hsv.h;
    spriteSpectrum.s = hsv.s;
    spriteSpectrum.v = hsv.v;
    spriteSpectrum.open = true;
    spriteSpectrum.drag = null;

    const overlay = document.getElementById('spr-spectrum-overlay');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    setSpectrumTab(spriteSpectrum.tab || 'presets');
    renderSpectrumPresets();
    requestAnimationFrame(() => updateSpectrumUI());

    if (!overlay._luaxBound) {
        overlay._luaxBound = true;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeSpriteSpectrum(false);
        });

        const sv = document.getElementById('spr-sv');
        const hue = document.getElementById('spr-hue');
        const hexInput = document.getElementById('spr-spectrum-hex');

        function bindDrag(el, kind) {
            const start = (e) => {
                e.preventDefault();
                e.stopPropagation();
                spriteSpectrum.drag = kind;
                move(e);
            };
            const move = (e) => {
                if (spriteSpectrum.drag !== kind) return;
                e.preventDefault();
                const t = e.touches ? e.touches[0] : e;
                if (!t) return;
                const rect = el.getBoundingClientRect();
                if (kind === 'sv') {
                    let x = (t.clientX - rect.left) / rect.width;
                    let y = (t.clientY - rect.top) / rect.height;
                    x = Math.max(0, Math.min(1, x));
                    y = Math.max(0, Math.min(1, y));
                    spriteSpectrum.s = x;
                    spriteSpectrum.v = 1 - y;
                } else {
                    let x = (t.clientX - rect.left) / rect.width;
                    x = Math.max(0, Math.min(1, x));
                    spriteSpectrum.h = x * 360;
                }
                updateSpectrumUI();
            };
            const end = () => { if (spriteSpectrum.drag === kind) spriteSpectrum.drag = null; };

            el.addEventListener('mousedown', start);
            el.addEventListener('touchstart', start, { passive: false });
            window.addEventListener('mousemove', move, { passive: false });
            window.addEventListener('touchmove', move, { passive: false });
            window.addEventListener('mouseup', end);
            window.addEventListener('touchend', end);
            window.addEventListener('touchcancel', end);
        }

        bindDrag(sv, 'sv');
        bindDrag(hue, 'hue');

        // Range sliders
        const sh = document.getElementById('spr-slider-hue');
        const ss = document.getElementById('spr-slider-sat');
        const svl = document.getElementById('spr-slider-val');
        const onSlide = () => {
            spriteSpectrum.h = +sh.value;
            spriteSpectrum.s = +ss.value / 100;
            spriteSpectrum.v = +svl.value / 100;
            updateSpectrumUI();
        };
        [sh, ss, svl].forEach(el => {
            el.addEventListener('input', onSlide);
            el.addEventListener('change', onSlide);
        });

        hexInput.addEventListener('change', () => {
            const n = normalizeSpriteHex(hexInput.value);
            if (!n) { updateSpectrumUI(); return; }
            let hx = n.slice(1);
            const num = parseInt(hx, 16);
            const hsv2 = rgbToHsv((num >> 16) & 255, (num >> 8) & 255, num & 255);
            spriteSpectrum.h = hsv2.h;
            spriteSpectrum.s = hsv2.s;
            spriteSpectrum.v = hsv2.v;
            updateSpectrumUI();
            renderSpectrumPresets();
        });
    }
}

function closeSpriteSpectrum(apply) {
    const overlay = document.getElementById('spr-spectrum-overlay');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    spriteSpectrum.open = false;
    spriteSpectrum.drag = null;
    if (apply) {
        setSpriteColor(hsvToHex(spriteSpectrum.h, spriteSpectrum.s, spriteSpectrum.v));
    }
}

function spritePixelIndex(x, y) {
    return (y * spriteEd.w + x) * 4;
}

function ensureSpritePixels() {
    const n = spriteEd.w * spriteEd.h * 4;
    if (!spriteEd.layers.length) {
        spriteEd.layers = [createSpriteLayer('Layer 1')];
        spriteEd.activeLayer = 0;
    }
    spriteEd.layers.forEach(L => {
        if (!L.pixels || L.pixels.length !== n) {
            const next = emptySpritePixels();
            if (L.pixels && L.pixels.length) {
                next.set(L.pixels.subarray(0, Math.min(L.pixels.length, n)));
            }
            L.pixels = next;
        }
    });
}

function hexToRgba(hex) {
    if (!hex) return [0, 0, 0, 0];
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function rgbaToHex(r, g, b, a) {
    if (a < 8) return null;
    const h = (v) => v.toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
}

function setSpritePixel(x, y, rgba) {
    if (x < 0 || y < 0 || x >= spriteEd.w || y >= spriteEd.h) return;
    const i = spritePixelIndex(x, y);
    spriteEd.pixels[i] = rgba[0];
    spriteEd.pixels[i + 1] = rgba[1];
    spriteEd.pixels[i + 2] = rgba[2];
    spriteEd.pixels[i + 3] = rgba[3];
    spriteEd.dirty = true;
}

function getSpritePixel(x, y) {
    if (x < 0 || y < 0 || x >= spriteEd.w || y >= spriteEd.h) return [0, 0, 0, 0];
    const i = spritePixelIndex(x, y);
    return [
        spriteEd.pixels[i],
        spriteEd.pixels[i + 1],
        spriteEd.pixels[i + 2],
        spriteEd.pixels[i + 3],
    ];
}

function redrawSpriteCanvas() {
    const canvas = document.getElementById('sprite-pixel-canvas');
    if (!canvas) return;
    ensureSpritePixels();

    const wrap = document.getElementById('spr-canvas-wrap');
    const dispW = Math.max(1, Math.floor((wrap && wrap.clientWidth) || canvas.clientWidth || 256));
    const dispH = Math.max(1, Math.floor((wrap && wrap.clientHeight) || canvas.clientHeight || 256));
    const z = Math.max(0.25, Math.min(8, Number(spriteEd.zoom) || 1));
    const base = Math.max(1, Math.min(dispW / spriteEd.w, dispH / spriteEd.h));
    const scale = Math.max(1, base * z);
    const drawW = spriteEd.w * scale;
    const drawH = spriteEd.h * scale;
    canvas.width = dispW;
    canvas.height = dispH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    let ox = Math.floor((dispW - drawW) / 2) + Math.round(spriteEd.panX || 0);
    let oy = Math.floor((dispH - drawH) / 2) + Math.round(spriteEd.panY || 0);

    const chk = 8;
    for (let y = 0; y < dispH; y += chk) {
        for (let x = 0; x < dispW; x += chk) {
            ctx.fillStyle = ((x / chk + y / chk) & 1) ? '#2a2a35' : '#1a1a22';
            ctx.fillRect(x, y, chk, chk);
        }
    }

    const pixels = compositeSpritePixels();
    for (let y = 0; y < spriteEd.h; y++) {
        for (let x = 0; x < spriteEd.w; x++) {
            const i = (y * spriteEd.w + x) * 4;
            const a = pixels[i + 3];
            if (a < 8) continue;
            ctx.fillStyle = 'rgba(' + pixels[i] + ',' + pixels[i + 1] + ',' + pixels[i + 2] + ',' + (a / 255) + ')';
            ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
        }
    }

    if (spriteEd.showGrid && scale >= 3) {
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= spriteEd.w; x++) {
            ctx.beginPath();
            ctx.moveTo(ox + x * scale + 0.5, oy);
            ctx.lineTo(ox + x * scale + 0.5, oy + drawH);
            ctx.stroke();
        }
        for (let y = 0; y <= spriteEd.h; y++) {
            ctx.beginPath();
            ctx.moveTo(ox, oy + y * scale + 0.5);
            ctx.lineTo(ox + drawW, oy + y * scale + 0.5);
            ctx.stroke();
        }
    }

    spriteEd._draw = { ox, oy, scale, dispW, dispH };

    const meta = document.getElementById('spr-footer-meta');
    if (meta) {
        meta.textContent = 'PNG · ' + spriteEd.w + '×' + spriteEd.h + ' · zoom ' + Math.round(z * 100) + '% · ' +
            spriteEd.layers.length + ' layer' + (spriteEd.layers.length === 1 ? '' : 's');
    }
}

function updateSpriteZoomLabel() {
    const z = Math.max(0.25, Math.min(8, Number(spriteEd.zoom) || 1));
    const lab = document.getElementById('spr-zoom-label');
    if (lab) lab.textContent = Math.round(z * 100) + '%';
}
function spriteZoom(dir) {
    const steps = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
    let z = Number(spriteEd.zoom) || 1;
    let i = 0;
    let best = 0;
    for (let s = 0; s < steps.length; s++) {
        if (Math.abs(steps[s] - z) < 0.02) { i = s; best = s; break; }
        if (steps[s] <= z) best = s;
        i = best;
    }
    i = Math.max(0, Math.min(steps.length - 1, i + (dir > 0 ? 1 : -1)));
    spriteEd.zoom = steps[i];
    updateSpriteZoomLabel();
    redrawSpriteCanvas();
}
function spriteZoomReset() {
    spriteEd.zoom = 1;
    spriteEd.panX = 0;
    spriteEd.panY = 0;
    updateSpriteZoomLabel();
    redrawSpriteCanvas();
}
function toggleSpriteMenu() {
    const view = document.getElementById('sprite-editor-view');
    if (!view) return;
    const collapsed = view.classList.toggle('spr-menu-collapsed');
    spriteEd.menuCollapsed = collapsed;
    const arrow = collapsed ? '▼' : '▲';
    const a = document.getElementById('spr-menu-toggle');
    if (a) a.textContent = arrow;
    const b = document.getElementById('spr-fs-menu-btn');
    if (b) b.textContent = arrow;
    setTimeout(() => redrawSpriteCanvas(), 40);
}
function toggleSpriteFullscreen() {
    spriteEd.fullscreen = !spriteEd.fullscreen;
    const view = document.getElementById('sprite-editor-view');
    if (view) {
        view.classList.toggle('spr-fullscreen', spriteEd.fullscreen);
        // entering FS: start with menu visible so user sees tools; can collapse with arrow
        if (spriteEd.fullscreen) {
            view.classList.remove('spr-menu-collapsed');
            spriteEd.menuCollapsed = false;
            const a = document.getElementById('spr-menu-toggle');
            if (a) a.textContent = '▲';
            const b = document.getElementById('spr-fs-menu-btn');
            if (b) b.textContent = '▲';
        }
    }
    const btn = document.getElementById('spr-fs-btn');
    if (btn) btn.textContent = spriteEd.fullscreen ? 'Exit full' : 'Fullscreen';
    setTimeout(() => redrawSpriteCanvas(), 60);
}

function renderSpritePalette() {
    const el = document.getElementById('spr-palette');
    if (!el) return;
    el.innerHTML = '';
    const cur = normalizeSpriteHex(spriteEd.color) || '#000000';
    const isTransparent = spriteEd.tool === 'eraser';

    // Circular color buttons (palette card + next to brushes)
    const applyColorBtn = (fg, baseClass) => {
        if (!fg) return;
        fg.className = baseClass + (isTransparent ? ' checker' : '');
        if (!isTransparent) fg.style.background = cur;
        else fg.style.background = '';
    };
    applyColorBtn(document.getElementById('spr-color-btn'), 'spr-paint-active');
    applyColorBtn(document.getElementById('spr-color-btn-mini'), 'spr-tool-color');

    // Compact preset row (skip transparent — use eraser tool)
    SPRITE_PALETTE.forEach((c) => {
        if (c === null) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spr-swatch';
        btn.style.background = c;
        if (!isTransparent && normalizeSpriteHex(c) === cur) btn.classList.add('active');
        btn.title = c;
        btn.onclick = () => setSpriteColor(c);
        el.appendChild(btn);
    });
}

function setSpriteTool(tool) {
    spriteEd.tool = tool;
    document.querySelectorAll('.spr-tool').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === tool);
    });
    renderSpritePalette();
}

// Canvas size lock: when on, W and H stay equal (perfect square)
if (typeof spriteEd !== 'undefined' && spriteEd.lockAspect == null) {
    spriteEd.lockAspect = true;
}

function syncSpriteSizeUI() {
    const w = spriteEd.w | 0;
    const h = spriteEd.h | 0;
    const wIn = document.getElementById('spr-custom-w');
    const hIn = document.getElementById('spr-custom-h');
    if (wIn) wIn.value = w;
    if (hIn) hIn.value = h;
    const square = (w === h);
    document.querySelectorAll('.spr-size').forEach(b => {
        const s = +b.dataset.size;
        b.classList.toggle('active', square && s === w);
    });
    const lock = document.getElementById('spr-size-lock');
    if (lock) lock.classList.toggle('on', !!spriteEd.lockAspect);
}

function toggleSpriteSizeLock() {
    spriteEd.lockAspect = !spriteEd.lockAspect;
    const lock = document.getElementById('spr-size-lock');
    if (lock) lock.classList.toggle('on', spriteEd.lockAspect);
    if (spriteEd.lockAspect) {
        // force H = W from the width box
        const wIn = document.getElementById('spr-custom-w');
        const hIn = document.getElementById('spr-custom-h');
        if (wIn && hIn) hIn.value = wIn.value;
    }
}

function onSpriteCustomSizeInput(which) {
    if (!spriteEd.lockAspect) return;
    const wIn = document.getElementById('spr-custom-w');
    const hIn = document.getElementById('spr-custom-h');
    if (!wIn || !hIn) return;
    if (which === 'w') hIn.value = wIn.value;
    else wIn.value = hIn.value;
}

function applySpriteCanvasSize(w, h) {
    w = Math.round(Number(w));
    h = Math.round(Number(h));
    if (!(w >= 1 && w <= 512 && h >= 1 && h <= 512)) {
        alert('Size must be between 1 and 512');
        return;
    }
    if (spriteEd.w === w && spriteEd.h === h) {
        syncSpriteSizeUI();
        return;
    }
    if (spriteEd.dirty && !confirm('Resize clears all layers. Continue?')) {
        syncSpriteSizeUI();
        return;
    }
    spriteEd.w = w;
    spriteEd.h = h;
    spriteEd.layers = [createSpriteLayer('Layer 1')];
    spriteEd.activeLayer = 0;
    spriteEd.history = [];
    spriteEd.historyIdx = -1;
    spriteEd.dirty = false;
    pushSpriteHistory();
    renderSpriteLayersUI();
    redrawSpriteCanvas();
    syncSpriteSizeUI();
}

function setSpriteSize(size) {
    size = size | 0;
    if (size < 1 || size > 512) return;
    // preset buttons always make a square
    applySpriteCanvasSize(size, size);
}

function applyCustomSpriteSize() {
    const wIn = document.getElementById('spr-custom-w');
    const hIn = document.getElementById('spr-custom-h');
    if (!wIn || !hIn) return;
    let w = parseInt(wIn.value, 10);
    let h = parseInt(hIn.value, 10);
    if (spriteEd.lockAspect) h = w;
    applySpriteCanvasSize(w, h);
}

function clearSpriteCanvas() {
    if (!confirm('Clear active layer?')) return;
    ensureSpritePixels();
    pushSpriteHistory();
    const p = activeLayerPixels();
    if (p) p.fill(0);
    spriteEd.dirty = true;
    pushSpriteHistory();
    redrawSpriteCanvas();
}

function canvasToGridPos(clientX, clientY) {
    const canvas = document.getElementById('sprite-pixel-canvas');
    if (!canvas) return { x: 0, y: 0, valid: false };
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return { x: 0, y: 0, valid: false };
    const d = spriteEd._draw || { ox: 0, oy: 0, scale: 1, dispW: canvas.width || rect.width, dispH: canvas.height || rect.height };
    const scaleX = (d.dispW || canvas.width) / rect.width;
    const scaleY = (d.dispH || canvas.height) / rect.height;
    const cx = (clientX - rect.left) * scaleX;
    const cy = (clientY - rect.top) * scaleY;
    const sc = Math.max(1, d.scale || 1);
    const x = Math.floor((cx - (d.ox || 0)) / sc);
    const y = Math.floor((cy - (d.oy || 0)) / sc);
    const valid = x >= 0 && y >= 0 && x < spriteEd.w && y < spriteEd.h;
    return {
        x: Math.max(0, Math.min(spriteEd.w - 1, x)),
        y: Math.max(0, Math.min(spriteEd.h - 1, y)),
        valid
    };
}

function floodFill(sx, sy, target, replace) {
    if (target[0] === replace[0] && target[1] === replace[1] &&
        target[2] === replace[2] && target[3] === replace[3]) return;
    const stack = [[sx, sy]];
    const seen = new Uint8Array(spriteEd.w * spriteEd.h);
    while (stack.length) {
        const [x, y] = stack.pop();
        const key = y * spriteEd.w + x;
        if (x < 0 || y < 0 || x >= spriteEd.w || y >= spriteEd.h || seen[key]) continue;
        const p = getSpritePixel(x, y);
        if (p[0] !== target[0] || p[1] !== target[1] || p[2] !== target[2] || p[3] !== target[3]) continue;
        seen[key] = 1;
        setSpritePixel(x, y, replace);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
}

function applySpriteToolAt(clientX, clientY, isDown) {
    ensureSpritePixels();
    const pos = canvasToGridPos(clientX, clientY);
    if (!pos.valid && !isDown) return;
    const x = pos.x, y = pos.y;
    if (spriteEd.tool === 'picker') {
        const p = getSpritePixel(x, y);
        if (p[3] < 8) {
            setSpriteTool('eraser');
        } else {
            setSpriteColor(rgbaToHex(p[0], p[1], p[2], p[3]) || '#ffffff');
        }
        return;
    }
    if (spriteEd.tool === 'fill' && isDown) {
        pushSpriteHistory();
        const fillColor = spriteEd.tool === 'eraser' ? [0,0,0,0] : hexToRgba(spriteEd.color || '#ffffff');
        floodFill(x, y, getSpritePixel(x, y), fillColor);
        pushSpriteHistory();
        redrawSpriteCanvas();
        return;
    }
    if (spriteEd.tool === 'eraser') {
        setSpritePixel(x, y, [0, 0, 0, 0]);
    } else {
        setSpritePixel(x, y, hexToRgba(spriteEd.color || '#ffffff'));
    }
    redrawSpriteCanvas();
}

function setupSpriteCanvasInput() {
    const canvas = document.getElementById('sprite-pixel-canvas');
    const wrap = document.getElementById('spr-canvas-wrap');
    if (!canvas) return;
    if (canvas._luaxCleanup) {
        try { canvas._luaxCleanup(); } catch (_) {}
        canvas._luaxCleanup = null;
    }

    const ptrPos = (e) => {
        if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches.length) {
            return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    };
    const touchDist = (t0, t1) => {
        const dx = t0.clientX - t1.clientX;
        const dy = t0.clientY - t1.clientY;
        return Math.hypot(dx, dy) || 1;
    };
    const touchMid = (t0, t1) => ({
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2
    });

    // pinch: two fingers = zoom + pan (no hand tool needed)
    let pinch = null;
    // mouse pan: right-click or middle-click drag (desktop)
    let mousePan = null;
    // After a pinch, ignore leftover single-finger until all fingers lift
    // (prevents random pixels when zooming / panning with two fingers)
    let blockPaintUntilTouchClear = false;
    // True if current stroke pushed history at start (so we can roll it back)
    let strokePushedHistory = false;

    const endPinch = () => {
        pinch = null;
        document.getElementById('spr-canvas-wrap')?.classList.remove('dragging', 'panning');
    };

    const endMousePan = () => {
        mousePan = null;
        document.getElementById('spr-canvas-wrap')?.classList.remove('dragging', 'panning');
        document.getElementById('sprite-editor-view')?.classList.remove('spr-drawing');
    };

    /** Undo accidental paint from the first finger when a second finger starts a pinch */
    const cancelStrokeForGesture = () => {
        if (!spriteEd.drawing && !strokePushedHistory) {
            spriteEd.drawing = false;
            return;
        }
        spriteEd.drawing = false;
        if (strokePushedHistory && spriteEd.historyIdx >= 0 && spriteEd.history[spriteEd.historyIdx]) {
            try {
                restoreLayers(spriteEd.history[spriteEd.historyIdx]);
                // Drop the history entry for the cancelled stroke
                spriteEd.history = spriteEd.history.slice(0, spriteEd.historyIdx);
                spriteEd.historyIdx = spriteEd.history.length - 1;
            } catch (_) {}
            try { redrawSpriteCanvas(); } catch (_) {}
        }
        strokePushedHistory = false;
    };

    const beginPinchFromTouches = (t0, t1) => {
        cancelStrokeForGesture();
        blockPaintUntilTouchClear = true;
        pinch = {
            startDist: touchDist(t0, t1),
            startZoom: Math.max(0.25, Math.min(8, Number(spriteEd.zoom) || 1)),
            startPanX: spriteEd.panX || 0,
            startPanY: spriteEd.panY || 0,
            startMid: touchMid(t0, t1)
        };
        document.getElementById('sprite-editor-view')?.classList.add('spr-drawing');
        document.getElementById('spr-canvas-wrap')?.classList.add('dragging', 'panning');
    };

    const down = (e) => {
        // Two fingers → zoom & pan mode (and undo any paint from the first finger)
        if (e.touches && e.touches.length >= 2) {
            e.preventDefault();
            e.stopPropagation();
            const t0 = e.touches[0], t1 = e.touches[1];
            beginPinchFromTouches(t0, t1);
            return;
        }

        // Right-click (2) or middle-click (1) → pan on desktop
        if (e.button === 1 || e.button === 2) {
            e.preventDefault();
            e.stopPropagation();
            spriteEd.drawing = false;
            strokePushedHistory = false;
            const p = ptrPos(e);
            mousePan = {
                startX: p.x,
                startY: p.y,
                startPanX: spriteEd.panX || 0,
                startPanY: spriteEd.panY || 0
            };
            document.getElementById('sprite-editor-view')?.classList.add('spr-drawing');
            document.getElementById('spr-canvas-wrap')?.classList.add('dragging', 'panning');
            return;
        }

        if (e.button != null && e.button !== 0) return;
        if (pinch || mousePan) return;
        // Still holding a finger after pinch/zoom — do not paint
        if (blockPaintUntilTouchClear) return;
        // Multi-touch already active (e.g. 2nd finger on another element)
        if (e.touches && e.touches.length > 1) return;

        e.preventDefault();
        e.stopPropagation();
        const p = ptrPos(e);
        document.getElementById('sprite-editor-view')?.classList.add('spr-drawing');
        spriteEd.drawing = true;
        strokePushedHistory = false;
        if (spriteEd.tool !== 'picker' && spriteEd.tool !== 'fill') {
            pushSpriteHistory();
            strokePushedHistory = true;
        }
        applySpriteToolAt(p.x, p.y, true);
    };

    const move = (e) => {
        // Two-finger zoom + pan
        if (e.touches && e.touches.length >= 2) {
            e.preventDefault();
            const t0 = e.touches[0], t1 = e.touches[1];
            if (!pinch) {
                beginPinchFromTouches(t0, t1);
            }
            const dist = touchDist(t0, t1);
            const mid = touchMid(t0, t1);
            let z = pinch.startZoom * (dist / pinch.startDist);
            z = Math.max(0.25, Math.min(8, z));
            spriteEd.zoom = z;
            spriteEd.panX = pinch.startPanX + (mid.x - pinch.startMid.x);
            spriteEd.panY = pinch.startPanY + (mid.y - pinch.startMid.y);
            if (typeof updateSpriteZoomLabel === 'function') updateSpriteZoomLabel();
            redrawSpriteCanvas();
            return;
        }

        // Mouse right/middle drag pan
        if (mousePan) {
            e.preventDefault();
            const p = ptrPos(e);
            spriteEd.panX = mousePan.startPanX + (p.x - mousePan.startX);
            spriteEd.panY = mousePan.startPanY + (p.y - mousePan.startY);
            redrawSpriteCanvas();
            return;
        }

        if (pinch) return; // ignore leftover single finger during pinch
        if (blockPaintUntilTouchClear) return;
        if (!spriteEd.drawing) return;
        e.preventDefault();
        if (spriteEd.tool === 'fill' || spriteEd.tool === 'picker') return;
        const p = ptrPos(e);
        applySpriteToolAt(p.x, p.y, false);
    };

    const up = (e) => {
        if (e) e.preventDefault();

        // Still 2+ fingers on screen — stay in pinch mode
        if (e && e.touches && e.touches.length >= 2) return;

        // One finger left after pinch: keep blocking paint until all fingers up
        if (e && e.touches && e.touches.length === 1 && (pinch || blockPaintUntilTouchClear)) {
            if (pinch) {
                endPinch();
                document.getElementById('sprite-editor-view')?.classList.remove('spr-drawing');
            }
            spriteEd.drawing = false;
            strokePushedHistory = false;
            return;
        }

        // All fingers up
        if (e && e.touches && e.touches.length === 0) {
            blockPaintUntilTouchClear = false;
        }
        // touchend with no touches property (some browsers) or mouseup
        if (!e || !e.touches) {
            blockPaintUntilTouchClear = false;
        }

        if (mousePan) {
            endMousePan();
            return;
        }
        if (pinch) {
            endPinch();
            document.getElementById('sprite-editor-view')?.classList.remove('spr-drawing');
            spriteEd.drawing = false;
            strokePushedHistory = false;
            return;
        }
        if (!spriteEd.drawing) {
            strokePushedHistory = false;
            return;
        }
        // Completed a real single-finger stroke — snapshot result for undo
        strokePushedHistory = false;
        if (spriteEd.tool !== 'picker' && spriteEd.tool !== 'fill') {
            pushSpriteHistory();
        }
        spriteEd.drawing = false;
        document.getElementById('sprite-editor-view')?.classList.remove('spr-drawing');
    };

    const wheel = (e) => {
        e.preventDefault();
        spriteZoom(e.deltaY < 0 ? 1 : -1);
    };

    const targets = [canvas];
    if (wrap) targets.push(wrap);
    targets.forEach(el => {
        el.addEventListener('mousedown', down);
        el.addEventListener('touchstart', down, { passive: false });
        el.addEventListener('touchmove', move, { passive: false });
        el.addEventListener('touchend', up, { passive: false });
        el.addEventListener('touchcancel', up, { passive: false });
        el.addEventListener('wheel', wheel, { passive: false });
        el.addEventListener('contextmenu', ev => ev.preventDefault());
    });
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);

    canvas._luaxCleanup = () => {
        targets.forEach(el => {
            el.removeEventListener('mousedown', down);
            el.removeEventListener('touchstart', down);
            el.removeEventListener('touchmove', move);
            el.removeEventListener('touchend', up);
            el.removeEventListener('touchcancel', up);
            el.removeEventListener('wheel', wheel);
        });
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('blur', up);
    };
    canvas._luaxBound = true;
}

/**
 * Open editor for a new sprite, or edit existing asset by name.
 */
function openSpriteEditor(existingName) {
    if (!isAuthed()) { applyAuthGate(); return; }
    if (!currentProjectName) return alert('Open a project first');

    spriteEd.tool = 'pencil';
    spriteEd.color = '#ffffff';
    spriteEd.drawing = false;
    spriteEd.dirty = false;
    spriteEd.history = [];
    spriteEd.historyIdx = -1;
    spriteEd.showGrid = true;
    spriteEd.layers = [];
    spriteEd.activeLayer = 0;

    if (existingName) {
        spriteEd.name = existingName;
        document.getElementById('sprite-editor-title').textContent = existingName;
        const src = getProjectAssetMap(currentProjectName)[existingName];
        loadSpriteFromDataUrl(src, existingName);
    } else {
        spriteEd.name = '';
        spriteEd.w = 16;
        spriteEd.h = 16;
        spriteEd.layers = [createSpriteLayer('Layer 1')];
        spriteEd.activeLayer = 0;
        document.getElementById('sprite-editor-title').textContent = 'New Sprite';
        document.querySelectorAll('.spr-size').forEach(b => {
            b.classList.toggle('active', +b.dataset.size === 16);
        });
        pushSpriteHistory();
        renderSpriteLayersUI();
        redrawSpriteCanvas();
    syncSpriteSizeUI();
    }

    setSpriteTool('pencil');
    if (!spriteEd.color) spriteEd.color = '#ffffff';
    renderSpritePalette();
    setupSpriteCanvasInput();
    switchView('sprite-editor-view');
    setTimeout(() => {
        renderSpriteLayersUI();
        renderSpritePalette();
        redrawSpriteCanvas();
        setupSpriteCanvasInput();
    }, 50);
    setTimeout(() => { redrawSpriteCanvas(); }, 200);
    if (!window._sprResizeBound) {
        window._sprResizeBound = true;
        window.addEventListener('resize', () => {
            if (document.getElementById('sprite-editor-view')?.classList.contains('active')) {
                redrawSpriteCanvas();
            }
        });
    }
}

function loadSpriteFromDataUrl(dataUrl, name) {
    if (!dataUrl) {
        spriteEd.w = 16;
        spriteEd.h = 16;
        spriteEd.layers = [createSpriteLayer('Layer 1')];
        spriteEd.activeLayer = 0;
        renderSpriteLayersUI();
        redrawSpriteCanvas();
        return;
    }
    const img = new Image();
    img.onload = () => {
        let w = img.naturalWidth || 16;
        let h = img.naturalHeight || 16;
        const snap = [8, 16, 24, 32];
        if (w === h && snap.includes(w)) {
            spriteEd.w = spriteEd.h = w;
        } else {
            const side = Math.min(32, Math.max(8, Math.round(Math.max(w, h))));
            spriteEd.w = spriteEd.h = snap.reduce((a, b) =>
                Math.abs(b - side) < Math.abs(a - side) ? b : a, 16);
        }
        document.querySelectorAll('.spr-size').forEach(b => {
            b.classList.toggle('active', +b.dataset.size === spriteEd.w);
        });
        const tmp = document.createElement('canvas');
        tmp.width = spriteEd.w;
        tmp.height = spriteEd.h;
        const tctx = tmp.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(img, 0, 0, spriteEd.w, spriteEd.h);
        const data = tctx.getImageData(0, 0, spriteEd.w, spriteEd.h);
        spriteEd.layers = [createSpriteLayer('Layer 1')];
        spriteEd.layers[0].pixels = new Uint8ClampedArray(data.data);
        spriteEd.activeLayer = 0;
        spriteEd.dirty = false;
        spriteEd.history = [];
        spriteEd.historyIdx = -1;
        pushSpriteHistory();
        renderSpriteLayersUI();
        redrawSpriteCanvas();
    };
    img.onerror = () => {
        spriteEd.w = 16;
        spriteEd.h = 16;
        spriteEd.layers = [createSpriteLayer('Layer 1')];
        spriteEd.activeLayer = 0;
        pushSpriteHistory();
        renderSpriteLayersUI();
        redrawSpriteCanvas();
    };
    img.src = dataUrl;
}

function closeSpriteEditor() {
    if (spriteEd.dirty && !confirm('Discard unsaved sprite changes?')) return;
    spriteEd.dirty = false;
    spriteEd.fullscreen = false;
    spriteEd.menuCollapsed = false;
    const view = document.getElementById('sprite-editor-view');
    if (view) {
        view.classList.remove('spr-fullscreen', 'spr-menu-collapsed');
    }
    switchView('files-view');
    renderFiles();
}

function saveSpriteFromEditor() {
    if (!currentProjectName) return;
    ensureSpritePixels();
    // Export flattened layers at true pixel size
    const out = document.createElement('canvas');
    out.width = spriteEd.w;
    out.height = spriteEd.h;
    const octx = out.getContext('2d');
    const img = octx.createImageData(spriteEd.w, spriteEd.h);
    img.data.set(compositeSpritePixels());
    octx.putImageData(img, 0, 0);
    const dataUrl = out.toDataURL('image/png');

    let name = spriteEd.name;
    if (!name) {
        name = prompt('Sprite filename (e.g. hero.png)', 'sprite.png');
        if (!name) return;
        name = name.trim().replace(/[^\w.\-]+/g, '_');
        if (!/\.(png|jpg|jpeg|webp)$/i.test(name)) name += '.png';
    }

    const map = getProjectAssetMap(currentProjectName);
    if (map[name] && name !== spriteEd.name && !confirm('Replace existing "' + name + '"?')) return;

    map[name] = dataUrl;
    delete spriteImageCache[currentProjectName + '::' + name];
    saveProjectAssets();
    spriteEd.name = name;
    spriteEd.dirty = false;
    document.getElementById('sprite-editor-title').textContent = name;
    alert('Saved "' + name + '".\n\nIn Lua:\ngfx.sprite("' + name + '", x, y)');
    switchView('files-view');
    renderFiles();
}





/** Encode project into a shareable play URL (hash). Free. */
function encodeSharePayload(obj) {
    try {
        return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    } catch (_) {
        return null;
    }
}
function decodeSharePayload(str) {
    try {
        return JSON.parse(decodeURIComponent(escape(atob(str))));
    } catch (_) {
        try { return JSON.parse(atob(str)); } catch (e2) { return null; }
    }
}

function sharePlayLink() {
    if (!currentProjectName || !projects[currentProjectName]) return;
    const payload = {
        v: 1,
        name: currentProjectName,
        files: projects[currentProjectName],
        gamepad: getProjectGamepad(currentProjectName),
        assets: getProjectAssetMap(currentProjectName)
    };
    const encoded = encodeSharePayload(payload);
    if (!encoded) return alert('Could not build share link');
    if (encoded.length > 1.8e6) {
        return alert('Project is too large to put in a link (images?). Remove some PNGs or use Export instead.');
    }
    const url = location.origin + location.pathname + location.search + '#play=' + encoded;
    const doCopy = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(url);
        }
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return Promise.resolve();
    };
    doCopy().then(() => {
        openModal('Share play link',
            `<p style="font-size:0.9rem;line-height:1.4;margin:0 0 10px">Link copied. Anyone with LuaX can open it and press Play (sign-in still required).</p>
             <textarea readonly style="width:100%;height:90px;font-size:0.75rem;border-radius:8px;background:#0f1115;color:#ccc;border:1px solid #333;padding:8px">${url.replace(/</g,'&lt;')}</textarea>`,
            'OK',
            () => {}
        );
    }).catch(() => {
        prompt('Copy this play link:', url);
    });
}

/** Boot helper: open #play=… shared project (or pending from before sign-in) */
function tryLoadSharedPlay() {
    try {
        let raw = null;
        const h = location.hash || '';
        if (h.startsWith('#play=')) {
            raw = h.slice(6);
            try { sessionStorage.setItem('luax_pending_share', raw); } catch (_) {}
            try { history.replaceState({}, '', location.pathname + location.search); } catch (_) {}
        } else {
            try { raw = sessionStorage.getItem('luax_pending_share'); } catch (_) {}
        }
        if (!raw) return false;
        if (!isAuthed()) return false; // wait until signed in
        const data = decodeSharePayload(raw);
        try { sessionStorage.removeItem('luax_pending_share'); } catch (_) {}
        if (!data || !data.files || !data.files['main.lua']) {
            alert('Invalid share link');
            return false;
        }
        let name = (data.name || 'Shared').replace(/[^\w \-]/g, '').trim() || 'Shared';
        if (projects[name]) name = name + '_' + Date.now().toString(36);
        projects[name] = data.files;
        setProjectGamepad(name, data.gamepad !== false);
        if (data.assets && typeof data.assets === 'object') {
            projectAssets[name] = data.assets;
            saveProjectAssets();
        }
        saveState();
        currentProjectName = name;
        return name;
    } catch (_) {
        return false;
    }
}

function promptNewFile() {
    if (!currentProjectName) return alert('Open a project first');
    if (!LUA_FILE_PRESETS[selectedFilePreset]) selectedFilePreset = 'blank';

    const presetHtml = Object.keys(LUA_FILE_PRESETS).map(k => {
        const p = LUA_FILE_PRESETS[k];
        const sel = k === selectedFilePreset ? ' selected' : '';
        return `<button type="button" class="file-preset-btn${sel}" data-preset="${k}" onclick="selectFilePreset('${k}')">` +
            `${p.name}<span class="fp-desc">${p.desc}</span></button>`;
    }).join('');

    openModal('New Lua File',
        `<input type="text" id="modal-input" placeholder="e.g. player.lua" autocomplete="off">
         <div style="font-size:0.85rem;color:#888;margin:10px 0 6px">Preset</div>
         <div class="template-list">${presetHtml}</div>`,
        'Create',
        () => {
            let name = (document.getElementById('modal-input').value || '').trim();
            if (!name) return alert('Enter a file name');
            if (!name.endsWith('.lua')) name += '.lua';
            if (projects[currentProjectName][name]) return alert('File exists');

            const preset = LUA_FILE_PRESETS[selectedFilePreset] || LUA_FILE_PRESETS.blank;
            let code;
            try {
                code = preset.code(name);
            } catch (_) {
                code = '-- ' + name + '\n';
            }
            projects[currentProjectName][name] = code;
            saveState();
            renderFiles();
            // open it in the editor
            try { openFile(name); } catch (_) {}
        }
    );
}

function deleteFile(e, name) {
    e.stopPropagation();
    if (confirm(`Delete ${name}?`)) {
        delete projects[currentProjectName][name];
        saveState();
        renderFiles();
    }
}

// Export / Import
async function exportProject() {
    if (!currentProjectName) return;
    if (!(await spendCredits('export'))) return;
    const data = {
        name: currentProjectName,
        files: projects[currentProjectName],
        gamepad: getProjectGamepad(currentProjectName),
        assets: getProjectAssetMap(currentProjectName),
        exportedAt: new Date().toISOString(),
        engine: 'LuaX'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = currentProjectName + '.luax.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

function importProject() {
    document.getElementById('import-input').click();
}

function handleImport(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            const files = data.files || data;
            if (typeof files !== 'object') throw new Error('Invalid format');
            let name = data.name || file.name.replace(/\.luadeck\.json$/i, '').replace(/\.json$/i, '') || 'Imported';
            if (projects[name]) name = name + '_' + Date.now();
            projects[name] = files;
            // restore gamepad flag if present (default true)
            setProjectGamepad(name, data.gamepad !== false);
            if (data.assets && typeof data.assets === 'object') {
                projectAssets[name] = data.assets;
                saveProjectAssets();
            }
            if (data.maps && typeof data.maps === 'object') {
                projectMaps[name] = data.maps;
                saveProjectMaps();
            }
            saveState();
            renderProjects();
            alert('Imported as "' + name + '"');
        } catch (err) {
            alert('Import failed: ' + err.message);
        }
        ev.target.value = '';
    };
    reader.readAsText(file);
}

// Import a single .lua file into the current project
function importLuaFile() {
    if (!currentProjectName) return alert('Open a project first');
    document.getElementById('import-lua-input').click();
}

function handleLuaImport(ev) {
    const file = ev.target.files[0];
    if (!file || !currentProjectName) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            let name = file.name || 'imported.lua';
            // normalize extension
            if (!name.toLowerCase().endsWith('.lua')) {
                name = name.replace(/\.[^.]+$/, '') + '.lua';
            }
            // avoid overwriting without asking
            if (projects[currentProjectName][name]) {
                if (!confirm(`"${name}" already exists. Replace it?`)) {
                    ev.target.value = '';
                    return;
                }
            }
            projects[currentProjectName][name] = reader.result;
            saveState();
            renderFiles();
            alert('Imported "' + name + '" into ' + currentProjectName);
        } catch (err) {
            alert('Import failed: ' + err.message);
        }
        ev.target.value = '';
    };
    reader.readAsText(file);
}


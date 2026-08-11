// src/perf-tune.js — loaded after play-mode.js
// Caps canvas DPR, scales raycast resolution, exposes set_quality / fps to Lua.

(function () {
    'use strict';

    const RENDER_QUALITY_KEY = 'luax_render_quality';

    function defaultQuality() {
        try {
            if (typeof isMobileDevice !== 'undefined' && isMobileDevice) return 0.75;
        } catch (_) {}
        return 1;
    }

    function getRenderQuality() {
        try {
            const v = localStorage.getItem(RENDER_QUALITY_KEY);
            if (v != null) {
                const n = parseFloat(v);
                if (n >= 0.35 && n <= 1) return n;
            }
        } catch (_) {}
        return defaultQuality();
    }

    let renderQuality = getRenderQuality();

    function setRenderQuality(q) {
        q = Math.max(0.35, Math.min(1, Number(q) || 1));
        renderQuality = q;
        try { localStorage.setItem(RENDER_QUALITY_KEY, String(q)); } catch (_) {}
        try {
            if (typeof isPlaying !== 'undefined' && isPlaying && typeof resizeCanvas === 'function') {
                resizeCanvas();
            }
        } catch (_) {}
        return renderQuality;
    }

    // ---- Cap device pixel ratio (mobile 3× screens are costly) ----
    if (typeof resizeCanvas === 'function') {
        window.resizeCanvas = function resizedWithQuality() {
            const canvasEl = document.getElementById('game-canvas');
            if (!canvasEl) return;
            const ctx2 = canvasEl.getContext('2d', { alpha: false });
            if (!ctx2) return;

            let dpr = window.devicePixelRatio || 1;
            const mobile = (typeof isMobileDevice !== 'undefined') ? isMobileDevice : false;
            const maxDpr = mobile ? 2 : 2.5;
            dpr = Math.min(dpr, maxDpr);
            const q = renderQuality > 0 ? renderQuality : 1;
            dpr = Math.max(1, dpr * Math.max(0.5, q));

            const rect = canvasEl.getBoundingClientRect();
            canvasEl.width = Math.max(1, Math.floor(rect.width * dpr));
            canvasEl.height = Math.max(1, Math.floor(rect.height * dpr));
            ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        try { resizeCanvas = window.resizeCanvas; } catch (_) {}
    }

    // ---- Quality-scaled raycast (fewer vertical strips on mobile) ----
    function installRaycastQuality() {
        const api = window.LuaDeckAPI;
        if (!api || !api.gfx || typeof api.gfx.raycast !== 'function') return false;
        if (api.gfx._luaxRaycastPatched) return true;

        api.gfx.raycast = function (opts) {
            if (!opts || !opts.map) return;
            const map = opts.map;
            const mapH = map.length;
            if (!mapH) return;
            const mapW = map[0].length;
            const px = (opts.x != null ? opts.x : 1.5) - 1;
            const py = (opts.y != null ? opts.y : 1.5) - 1;
            const angle = opts.angle != null ? opts.angle : 0;
            const fov = opts.fov != null ? opts.fov : (Math.PI / 3);
            const ceilC = opts.ceil || '#1a1c28';
            const floorC = opts.floor || '#2a2c35';
            const fogMax = opts.fog != null ? opts.fog : 16;
            const projScale = opts.scale != null ? opts.scale : 0.66;
            let pitch = opts.pitch != null ? opts.pitch : 0;
            const pitchMax = Math.PI / 2 - 0.01;
            if (pitch > pitchMax) pitch = pitchMax;
            if (pitch < -pitchMax) pitch = -pitchMax;
            const defaultColors = {
                1: '#c44', 2: '#4a8', 3: '#48a', 4: '#a84',
                5: '#84a', 6: '#a48', 7: '#8a4', 8: '#aaa'
            };
            const colors = opts.colors || defaultColors;

            const canvasEl = document.getElementById('game-canvas');
            if (!canvasEl) return;
            const ctx2 = canvasEl.getContext('2d');
            if (!ctx2) return;

            const dpr = window.devicePixelRatio || 1;
            ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
            const w = canvasEl.width / dpr;
            const h = canvasEl.height / dpr;
            const pitchOffset = Math.tan(pitch) * h * 0.5;
            const mid = h / 2 + pitchOffset;

            let rq = opts.quality != null ? Number(opts.quality) : renderQuality;
            if (!(rq > 0)) rq = 1;
            rq = Math.max(0.35, Math.min(1, rq));
            const numRays = Math.max(48, Math.floor(w * rq));
            const colW = w / numRays;

            ctx2.fillStyle = ceilC;
            ctx2.fillRect(0, 0, w, Math.max(0, mid));
            ctx2.fillStyle = floorC;
            ctx2.fillRect(0, Math.max(0, mid), w, h);

            for (let i = 0; i < numRays; i++) {
                const col = i * colW;
                const rayOffset = ((i + 0.5) / numRays - 0.5) * fov;
                const rayAngle = angle + rayOffset;
                const rayDirX = Math.cos(rayAngle);
                const rayDirY = Math.sin(rayAngle);

                let mapX = Math.floor(px);
                let mapY = Math.floor(py);
                const deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
                const deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);

                let stepX, stepY, sideDistX, sideDistY;
                if (rayDirX < 0) {
                    stepX = -1;
                    sideDistX = (px - mapX) * deltaDistX;
                } else {
                    stepX = 1;
                    sideDistX = (mapX + 1 - px) * deltaDistX;
                }
                if (rayDirY < 0) {
                    stepY = -1;
                    sideDistY = (py - mapY) * deltaDistY;
                } else {
                    stepY = 1;
                    sideDistY = (mapY + 1 - py) * deltaDistY;
                }

                let hit = 0;
                let side = 0;
                let wallId = 0;
                const maxSteps = mapW + mapH + 4;
                for (let s = 0; s < maxSteps; s++) {
                    if (sideDistX < sideDistY) {
                        sideDistX += deltaDistX;
                        mapX += stepX;
                        side = 0;
                    } else {
                        sideDistY += deltaDistY;
                        mapY += stepY;
                        side = 1;
                    }
                    if (mapY < 0 || mapY >= mapH || mapX < 0 || mapX >= mapW) {
                        hit = 1;
                        wallId = 1;
                        break;
                    }
                    const cell = map[mapY][mapX];
                    if (cell && cell !== 0) {
                        hit = 1;
                        wallId = cell;
                        break;
                    }
                }
                if (!hit) continue;

                let perpDist;
                if (side === 0) {
                    perpDist = (mapX - px + (1 - stepX) / 2) / rayDirX;
                } else {
                    perpDist = (mapY - py + (1 - stepY) / 2) / rayDirY;
                }
                perpDist = Math.max(0.05, Math.abs(perpDist));

                const lineH = (h / perpDist) * projScale;
                const drawStart = Math.max(0, mid - lineH / 2);
                const drawEnd = Math.min(h, mid + lineH / 2);

                let base = colors[wallId] || colors[1] || '#888';
                let r = 136, g = 136, b = 136;
                if (typeof base === 'string' && base[0] === '#') {
                    const hex = base.length === 4
                        ? base[1] + base[1] + base[2] + base[2] + base[3] + base[3]
                        : base.slice(1);
                    r = parseInt(hex.slice(0, 2), 16) || 0;
                    g = parseInt(hex.slice(2, 4), 16) || 0;
                    b = parseInt(hex.slice(4, 6), 16) || 0;
                }
                if (side === 1) {
                    r = (r * 0.65) | 0;
                    g = (g * 0.65) | 0;
                    b = (b * 0.65) | 0;
                }
                const fog = Math.min(1, perpDist / fogMax);
                r = (r * (1 - fog) + 20 * fog) | 0;
                g = (g * (1 - fog) + 22 * fog) | 0;
                b = (b * (1 - fog) + 28 * fog) | 0;

                ctx2.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
                ctx2.fillRect(Math.floor(col), drawStart, Math.ceil(colW) + 1, drawEnd - drawStart);
            }
        };

        api.gfx._luaxRaycastPatched = true;
        return true;
    }

    installRaycastQuality();

    function exposeSys() {
        const api = window.LuaDeckAPI;
        if (!api || !api.sys) return false;
        api.sys.setQuality = function (q) { return setRenderQuality(q); };
        api.sys.quality = function () { return renderQuality; };
        api.sys.fps = function () {
            try { return typeof currentFps === 'number' ? currentFps : 0; } catch (_) { return 0; }
        };
        return true;
    }
    exposeSys();

    // Inject Lua globals after each PLAY boot (shim reloads every start)
    const LUA_PERF_HELPERS =
        'do\n' +
        '  local js = require("js")\n' +
        '  local api = js.global.LuaDeckAPI\n' +
        '  function set_quality(q) if api and api.sys then return api.sys:setQuality(q) end end\n' +
        '  function quality() if api and api.sys then return api.sys:quality() end return 1 end\n' +
        '  function fps() if api and api.sys then return api.sys:fps() end return 0 end\n' +
        'end\n';

    function injectLuaHelpers() {
        try {
            if (typeof fengari === 'undefined') return;
            const L = fengari.L;
            fengari.lauxlib.luaL_dostring(L, fengari.to_luastring(LUA_PERF_HELPERS));
        } catch (e) {
            console.warn('[LuaX] perf lua inject failed', e);
        }
    }

    function wrapStartPlayMode() {
        if (typeof window.startPlayMode !== 'function') return false;
        if (window.startPlayMode._luaxPerfWrapped) return true;
        const original = window.startPlayMode;
        window.startPlayMode = async function () {
            const result = await original.apply(this, arguments);
            // Shim + main.lua already ran inside original; inject helpers now
            injectLuaHelpers();
            exposeSys();
            installRaycastQuality();
            return result;
        };
        window.startPlayMode._luaxPerfWrapped = true;
        return true;
    }

    wrapStartPlayMode();
    // play-mode may assign startPlayMode again at the end — retry shortly
    setTimeout(wrapStartPlayMode, 0);
    setTimeout(wrapStartPlayMode, 50);

    window.setRenderQuality = setRenderQuality;
    window.getRenderQuality = function () { return renderQuality; };

    console.info('[LuaX] perf-tune active · quality=' + renderQuality.toFixed(2));
})();

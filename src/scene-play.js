// src/scene-play.js — gfx.scene / gfx.scenes for play mode
(function () {
  function loadSceneMap(proj) {
    try {
      if (typeof getProjectSceneMap === 'function') {
        const m = getProjectSceneMap(proj);
        if (m && typeof m === 'object') return m;
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem('luax_project_scenes');
      const all = raw ? JSON.parse(raw) : {};
      return (all && all[proj]) || {};
    } catch (_) { return {}; }
  }

  function drawSceneOnCtx(ctx, apiGfx, name, ox, oy) {
    if (!ctx || !name) return;
    let proj = '';
    try {
      if (typeof currentProjectName === 'string') proj = currentProjectName;
      else if (typeof window.currentProjectName === 'string') proj = window.currentProjectName;
    } catch (_) {}
    if (!proj) return;
    const map = loadSceneMap(proj);
    const data = map[name];
    if (!data || !Array.isArray(data.objects)) return;
    const offX = Number(ox) || 0;
    const offY = Number(oy) || 0;
    const CELL = data.cell || 16;

    data.objects.forEach(function (o) {
      if (!o || o.kind === 'sprite' || o.sprite) return;
      const color = o.color || '#ffffff';
      const cx = o.cx != null ? o.cx : Math.floor((o.x || 0) / CELL);
      const cy = o.cy != null ? o.cy : Math.floor((o.y || 0) / CELL);
      const x = offX + cx * CELL;
      const y = offY + cy * CELL;
      const shape = o.shape || 'rect';
      ctx.fillStyle = color;
      if (shape === 'circle') {
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
      } else {
        ctx.fillRect(x, y, CELL, CELL);
      }
    });

    data.objects.forEach(function (o) {
      if (!o || !(o.kind === 'sprite' || o.sprite)) return;
      const spriteName = o.sprite;
      let img = null;
      try {
        if (apiGfx && typeof apiGfx._spriteImg === 'function') img = apiGfx._spriteImg(spriteName);
      } catch (_) {}
      const sc = o.scale || 1;
      const cx = o.cx != null ? o.cx : Math.floor((o.x || 0) / CELL);
      const cy = o.cy != null ? o.cy : Math.floor((o.y || 0) / CELL);
      const x = offX + cx * CELL;
      const y = offY + cy * CELL;
      if (img) {
        const w = img.naturalWidth * sc;
        const h = img.naturalHeight * sc;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y, w, h);
      } else {
        ctx.fillStyle = '#555';
        ctx.fillRect(x, y, CELL * sc, CELL * sc);
      }
    });
  }

  function patchApi() {
    if (!window.LuaDeckAPI || !window.LuaDeckAPI.gfx) return false;
    const gfx = window.LuaDeckAPI.gfx;
    if (gfx.scene && gfx._luaxScenePatched) return true;

    gfx.scene = function (name, ox, oy) {
      const canvas = document.getElementById('game-canvas');
      const ctx = canvas ? canvas.getContext('2d') : null;
      drawSceneOnCtx(ctx, gfx, name, ox, oy);
    };
    gfx.scenes = function () {
      let proj = '';
      try {
        if (typeof currentProjectName === 'string') proj = currentProjectName;
      } catch (_) {}
      if (!proj) return [];
      return Object.keys(loadSceneMap(proj));
    };
    gfx._luaxScenePatched = true;
    return true;
  }

  function hookStartPlay() {
    try {
      const sp = typeof window.startPlayMode === 'function' ? window.startPlayMode : null;
      if (!sp || sp._luaxScene) return;
      window.startPlayMode = function () {
        patchApi();
        const r = sp.apply(this, arguments);
        try {
          if (typeof fengari !== 'undefined' && fengari.L) {
            const code =
              'if gfx and not gfx.scene then\n' +
              '  local api = (require("js")).global.LuaDeckAPI\n' +
              '  gfx.scene = function(name, x, y) api.gfx:scene(name, x, y) end\n' +
              '  gfx.scenes = function()\n' +
              '    local arr = api.gfx:scenes()\n' +
              '    local t = {}\n' +
              '    if arr then\n' +
              '      local n = tonumber(arr.length) or 0\n' +
              '      for i = 0, n - 1 do t[#t+1] = arr[i] end\n' +
              '    end\n' +
              '    return t\n' +
              '  end\n' +
              'end\n';
            fengari.lauxlib.luaL_dostring(fengari.L, fengari.to_luastring(code));
          }
        } catch (e) {
          console.warn('scene lua inject', e);
        }
        return r;
      };
      window.startPlayMode._luaxScene = true;
    } catch (_) {}
  }

  function init() {
    patchApi();
    hookStartPlay();
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      patchApi();
      hookStartPlay();
      if (tries > 30) clearInterval(t);
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 150); });
  } else {
    setTimeout(init, 150);
  }
})();

// ============================================================
// XSS-safe helpers (names in onclick / HTML)
// ============================================================
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
        .replace(/&/g, '&')
        .replace(/"/g, '"')
        .replace(/</g, '<')
        .replace(/>/g, '>');
}
function sanitizeName(name, fallback) {
    let s = String(name == null ? '' : name).trim();
    s = s.replace(/[\u0000-\u001f\u007f]/g, '');
    if (s.length > 80) s = s.slice(0, 80);
    if (!s) s = fallback || 'Untitled';
    return s;
}
try {
    Object.defineProperty(window, 'esc', { value: esc, writable: false, configurable: true });
} catch (_) { window.esc = esc; }
try {
    Object.defineProperty(window, 'sanitizeName', { value: sanitizeName, writable: false, configurable: true });
} catch (_) { window.sanitizeName = sanitizeName; }

// src/storage.js — localStorage persistence for projects, settings, assets, meta

// ============================================================
// DATA + PERSISTENT SAVE
// ============================================================
const STORAGE_KEY = 'luadeck_projects';
const STORAGE_META = 'luadeck_meta';
const SETTINGS_KEY = 'luadeck_project_settings';
const ASSETS_KEY = 'luadeck_project_assets';
// Per-project sync metadata: { [name]: { updatedAt, deletedAt } }
// updatedAt = last local edit time. deletedAt = tombstone so a delete on this
// device isn't silently overwritten by an older cloud copy from another device.
const PROJECT_META_KEY = 'luax_project_meta';

function loadProjectMeta() {
    try {
        const raw = localStorage.getItem(PROJECT_META_KEY);
        if (!raw) return {};
        const data = JSON.parse(raw);
        return (data && typeof data === 'object') ? data : {};
    } catch (_) {
        return {};
    }
}

function saveProjectMeta() {
    try { localStorage.setItem(PROJECT_META_KEY, JSON.stringify(projectMeta)); } catch (_) {}
}

/**
 * Called on every saveState(). Diffs `projects` against the last-known
 * per-project snapshot so we can stamp only the projects that actually
 * changed (create/edit) or disappeared (delete → tombstone), without having
 * to touch every single call site that mutates a project.
 */
let _lastProjectsSnapshotStr = null;
function touchProjectMeta() {
    const now = Date.now();
    const prevSnapshot = _lastProjectsSnapshotStr || {};
    const currentNames = Object.keys(projects || {});
    currentNames.forEach(name => {
        let str;
        try { str = JSON.stringify(projects[name]); } catch (_) { str = ''; }
        if (prevSnapshot[name] !== str) {
            projectMeta[name] = projectMeta[name] || {};
            projectMeta[name].updatedAt = now;
            delete projectMeta[name].deletedAt;
        }
    });
    Object.keys(prevSnapshot).forEach(name => {
        if (!(name in (projects || {}))) {
            projectMeta[name] = projectMeta[name] || {};
            projectMeta[name].deletedAt = now;
        }
    });
    const nextSnapshot = {};
    currentNames.forEach(name => {
        try { nextSnapshot[name] = JSON.stringify(projects[name]); } catch (_) { nextSnapshot[name] = ''; }
    });
    _lastProjectsSnapshotStr = nextSnapshot;
    saveProjectMeta();
}

function loadProjectsFromStorage() {
    // Try localStorage, then sessionStorage fallback
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (_) {}
    if (!raw) {
        try { raw = sessionStorage.getItem(STORAGE_KEY); } catch (_) {}
    }
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') return data;
    } catch (_) {}
    return null;
}

function loadProjectSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return {};
        const data = JSON.parse(raw);
        return (data && typeof data === 'object') ? data : {};
    } catch (_) {
        return {};
    }
}

// Start empty — user creates their first project (no DemoGame seed)
let projects = loadProjectsFromStorage() || {};

/** Per-project sync metadata — see PROJECT_META_KEY above */
let projectMeta = loadProjectMeta() || {};
(function seedProjectsSnapshot() {
    const snap = {};
    Object.keys(projects).forEach(name => {
        try { snap[name] = JSON.stringify(projects[name]); } catch (_) { snap[name] = ''; }
    });
    _lastProjectsSnapshotStr = snap;
})();

/** Per-project settings: { [name]: { gamepad: boolean } } — gamepad default true */
let projectSettings = loadProjectSettings();

/** Per-project image assets: { [projectName]: { [filename]: dataURL } } */
function loadProjectAssets() {
    try {
        const raw = localStorage.getItem(ASSETS_KEY);
        if (!raw) return {};
        const data = JSON.parse(raw);
        return (data && typeof data === 'object') ? data : {};
    } catch (_) { return {}; }
}
let projectAssets = loadProjectAssets();
const spriteImageCache = {}; // dataURL or name → HTMLImageElement

function saveProjectAssets() {
    try {
        localStorage.setItem(ASSETS_KEY, JSON.stringify(projectAssets));
        return true;
    } catch (e) {
        console.warn('assets save failed', e);
        const msg = (e && e.name === 'QuotaExceededError')
            ? 'Storage full — delete unused images or export the project, then try again.'
            : ('Could not save images: ' + (e && e.message ? e.message : e));
        try { alert(msg); } catch (_) {}
        return false;
    }
}

function getProjectAssetMap(name) {
    if (!name) return {};
    if (!projectAssets[name]) projectAssets[name] = {};
    return projectAssets[name];
}

/**
 * Decode an image File, optionally downscale, re-encode as PNG (pixel-art
 * friendly) or WebP when clearly smaller. Keeps localStorage / Drive lean.
 *
 * opts.maxDim   — longest side in pixels (default 512)
 * opts.pixelArt — nearest-neighbor scaling when true (default true)
 *
 * @returns {Promise<{dataUrl,width,height,origWidth,origHeight,format,scaled,bytesApprox}>}
 */
function compressImageFile(file, opts) {
    opts = opts || {};
    const maxDim = opts.maxDim != null ? opts.maxDim : 512;
    const pixelArt = opts.pixelArt !== false;

    return new Promise((resolve, reject) => {
        if (!file) return reject(new Error('No file'));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                try {
                    let w = img.naturalWidth || 1;
                    let h = img.naturalHeight || 1;
                    const origW = w;
                    const origH = h;
                    if (w > maxDim || h > maxDim) {
                        const s = Math.min(maxDim / w, maxDim / h);
                        w = Math.max(1, Math.round(w * s));
                        h = Math.max(1, Math.round(h * s));
                    }

                    const canvas = document.createElement('canvas');
                    const draw = (tw, th) => {
                        canvas.width = tw;
                        canvas.height = th;
                        const ctx = canvas.getContext('2d');
                        ctx.imageSmoothingEnabled = !pixelArt;
                        if (!pixelArt) {
                            try { ctx.imageSmoothingQuality = 'high'; } catch (_) {}
                        }
                        ctx.clearRect(0, 0, tw, th);
                        ctx.drawImage(img, 0, 0, tw, th);
                    };

                    draw(w, h);

                    let dataUrl = canvas.toDataURL('image/png');
                    let format = 'png';

                    // Use WebP when it is meaningfully smaller (photos, not tiny pixel art)
                    try {
                        const webp = canvas.toDataURL('image/webp', 0.82);
                        if (webp.indexOf('data:image/webp') === 0 && webp.length < dataUrl.length * 0.8) {
                            dataUrl = webp;
                            format = 'webp';
                        }
                    } catch (_) {}

                    // Still too large for storage → scale down further
                    if (dataUrl.length > 1.2e6) {
                        const factor = Math.sqrt(1.0e6 / dataUrl.length);
                        w = Math.max(1, Math.round(w * factor));
                        h = Math.max(1, Math.round(h * factor));
                        draw(w, h);
                        dataUrl = canvas.toDataURL('image/png');
                        format = 'png';
                        try {
                            const webp2 = canvas.toDataURL('image/webp', 0.75);
                            if (webp2.indexOf('data:image/webp') === 0 && webp2.length < dataUrl.length) {
                                dataUrl = webp2;
                                format = 'webp';
                            }
                        } catch (_) {}
                    }

                    resolve({
                        dataUrl: dataUrl,
                        width: w,
                        height: h,
                        origWidth: origW,
                        origHeight: origH,
                        format: format,
                        scaled: (w !== origW || h !== origH),
                        bytesApprox: Math.round(dataUrl.length * 0.75)
                    });
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject(new Error('Invalid or unsupported image'));
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

try {
    window.compressImageFile = compressImageFile;
} catch (_) {}


function getProjectGamepad(name) {
    if (!name) return true;
    const s = projectSettings[name];
    if (s && typeof s.gamepad === 'boolean') return s.gamepad;
    return true; // default ON for mobile projects
}

function setProjectGamepad(name, enabled) {
    if (!name) return;
    if (!projectSettings[name]) projectSettings[name] = {};
    projectSettings[name].gamepad = !!enabled;
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(projectSettings));
    } catch (_) {}
}

function closeFilesMenus() {
    document.querySelectorAll('.files-menu.open').forEach(m => m.classList.remove('open'));
}
function toggleFilesMenu(which) {
    const id = which === 'create' ? 'files-menu-create' : 'files-menu-more';
    const menu = document.getElementById(id);
    if (!menu) return;
    const wasOpen = menu.classList.contains('open');
    closeFilesMenus();
    if (!wasOpen) menu.classList.add('open');
}
// Close create/more menus on outside click
document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('.files-menu-wrap')) return;
    try { closeFilesMenus(); } catch (_) {}
});

function updateGamepadToggleUI() {
    try {
        const pv = document.getElementById('projects-view');
        if (pv && pv.classList.contains('active')) renderProjects();
    } catch (_) {}
}

function toggleProjectGamepad() {
    if (currentProjectName) toggleProjectGamepadFor(currentProjectName);
}

function toggleProjectGamepadFor(name) {
    if (!name) return;
    if (typeof isMobileDevice !== 'undefined' && !isMobileDevice) {
        alert('On-screen gamepad is for phones / tablets.\nDesktop uses keyboard (WASD) + mouse.');
        return;
    }
    const next = !getProjectGamepad(name);
    setProjectGamepad(name, next);
    renderProjects();
    alert(next
        ? ('Gamepad enabled for "' + name + '"\n\nJoystick + buttons will show when you PLAY.')
        : ('Gamepad disabled for "' + name + '"\n\nOn-screen controls stay hidden during PLAY.'));
}

let currentProjectName = null;
let currentFileName = null;
let modalCallback = null;
let selectedTemplate = "empty";
let selectedFilePreset = "blank";

/** Presets for "+ Lua file" — each is a full .lua starter */
const LUA_FILE_PRESETS = {
    blank: {
        name: "Blank file",
        desc: "Empty script with a short comment",
        code: (fname) => `-- ${fname}\n`
    },
    gameloop: {
        name: "Basic game loop",
        desc: "_update + _draw skeleton",
        code: () => `-- Basic game loop
function _update(dt)
    -- put logic here
end

function _draw()
    gfx.cls("#1a1c28")
    gfx.text("Hello LuaX", 16, 40, "#fff", "20px sans-serif")
end
`
    },
    dirs: {
        name: "4-direction sprite sheet",
        desc: "2x2 sheet: Front / Right / Left / Back",
        code: () => `-- 2x2 sprite sheet demo
-- Import your PNG first, then set SHEET to the exact file name.
-- Layout:  0 Front | 1 Right
--          2 Left  | 3 Back

local SHEET = "player.png"   -- change to your imported image name
local dir = 0
local names = { "Front", "Right", "Left", "Back" }

function _update(dt)
    local ax = -axis(0)  -- invert X so left/right match the stick
    local ay = axis(1)
    if btn(0) or ay < -0.4 then dir = 3 end  -- up    -> Back
    if btn(1) or ay >  0.4 then dir = 0 end  -- down  -> Front
    if btn(2) or ax < -0.4 then dir = 2 end  -- left  -> Left
    if btn(3) or ax >  0.4 then dir = 1 end  -- right -> Right
end

function _draw()
    gfx.cls("#4a6a70")

    local size = 120
    local cx = gfx.width() / 2 - size / 2
    local cy = gfx.height() / 2 - size / 2

    -- cols=2, rows=2 auto-splits the sheet
    gfx.anim(SHEET, dir, cx, cy, 0, 0, size, size, 2, 2)

    gfx.text(names[dir + 1], 12, 28, "#fff", "18px sans-serif")
    gfx.text("Move: stick / arrows", 12, gfx.height() - 28, "#cde", "14px sans-serif")
end
`
    },
    walk: {
        name: "Walk cycle animation",
        desc: "Horizontal strip — auto frame from time",
        code: () => `-- Horizontal walk-cycle sheet
-- Import a strip (e.g. 4 frames in a row), set SHEET + NFRAMES.

local SHEET = "walk.png"   -- your sprite sheet name
local NFRAMES = 4          -- how many frames in the row
local FPS = 8              -- animation speed
local t = 0
local frame = 0

function _update(dt)
    t = t + dt
    frame = math.floor(t * FPS) % NFRAMES
end

function _draw()
    gfx.cls("#1a1c28")
    local size = 96
    local cx = gfx.width() / 2 - size / 2
    local cy = gfx.height() / 2 - size / 2
    -- 1 row, NFRAMES columns
    gfx.anim(SHEET, frame, cx, cy, 0, 0, size, size, NFRAMES, 1)
    gfx.text("frame " .. frame, 12, 28, "#fff", "16px sans-serif")
end
`
    },
    move: {
        name: "Move a sprite",
        desc: "Player image + stick movement",
        code: () => `-- Move an imported sprite with the stick / arrows

local SHEET = "player.png"  -- change to your image name
local x, y = 160, 200
local speed = 120

function _update(dt)
    local ax, ay = axis(0), axis(1)
    if btn(2) then ax = -1 end
    if btn(3) then ax =  1 end
    if btn(0) then ay = -1 end
    if btn(1) then ay =  1 end
    x = x + ax * speed * dt
    y = y + ay * speed * dt
end

function _draw()
    gfx.cls("#1a1c28")
    gfx.sprite(SHEET, x, y, 64, 64)
    gfx.text("Move with stick / arrows", 12, 28, "#aaa", "14px sans-serif")
end
`
    },
    bounce: {
        name: "Bouncing ball",
        desc: "Simple physics demo, no assets needed",
        code: () => `-- Bouncing ball — no images required

local x, y = 100, 80
local vx, vy = 140, 0
local r = 18
local g = 500

function _update(dt)
    vy = vy + g * dt
    x = x + vx * dt
    y = y + vy * dt
    local w, h = gfx.width(), gfx.height()
    if x < r then x = r; vx = math.abs(vx) end
    if x > w - r then x = w - r; vx = -math.abs(vx) end
    if y > h - r then y = h - r; vy = -math.abs(vy) * 0.85 end
end

function _draw()
    gfx.cls("#0d1118")
    gfx.circlefill(x, y, r, "#6c5ce7")
    gfx.text("Bouncing ball", 12, 28, "#fff", "16px sans-serif")
end
`
    },
    music: {
        name: "Music tracker demo",
        desc: "4-channel step sequencer background tune",
        code: () => `-- Chiptune demo — 4 channels × 16 steps
local C4 = sfx.note("C4")
local D4 = sfx.note("D4")
local E4 = sfx.note("E4")
local F4 = sfx.note("F4")
local G4 = sfx.note("G4")
local A4 = sfx.note("A4")
local C3 = sfx.note("C3")
local E3 = sfx.note("E3")
local F3 = sfx.note("F3")
local G3 = sfx.note("G3")
local C5 = sfx.note("C5")

local started = false

function _update(dt)
    if not started then
        started = true
        sfx.music({
            bpm = 110,
            loop = true,
            wave = "square",
            steps = 16,
            -- melody
            {
                C4, 0, E4, 0, G4, 0, E4, 0,
                F4, 0, A4, 0, G4, 0, 0, 0
            },
            -- bass
            {
                C3, C3, 0, 0, E3, E3, 0, 0,
                F3, F3, 0, 0, G3, G3, 0, 0
            },
            -- sparkle
            {
                C5, 0, 0, 0, G4, 0, 0, 0,
                A4, 0, 0, 0, G4, 0, 0, 0
            },
            {}
        })
    end
end

function _draw()
    gfx.cls("#0d1118")
    gfx.text("Music tracker", 16, 40, "#fff", "20px sans-serif")
    gfx.text(sfx.playing() and "Playing..." or "Stopped", 16, 72, "#6c5ce7", "16px sans-serif")
    gfx.text("EXIT stops the tune", 16, 100, "#888", "14px sans-serif")
end
`
    }
};

function selectFilePreset(k) {
    selectedFilePreset = k;
    document.querySelectorAll('.file-preset-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.preset === k);
    });
}

let isDirty = false;
let savedContent = "";
let lastSaveOk = true;
let lastSaveAt = null;

function saveState() {
    const json = JSON.stringify(projects);
    let ok = false;
    touchProjectMeta();
    try {
        localStorage.setItem(STORAGE_KEY, json);
        localStorage.setItem(STORAGE_META, JSON.stringify({ savedAt: Date.now() }));
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(projectSettings)); } catch (_) {}
        ok = true;
    } catch (err) {
        console.warn('localStorage save failed', err);
        try {
            sessionStorage.setItem(STORAGE_KEY, json);
            ok = true;
        } catch (err2) {
            console.warn('sessionStorage save failed', err2);
            ok = false;
        }
    }
    lastSaveOk = ok;
    lastSaveAt = Date.now();
    updateSaveIndicator();
    return ok;
}

function updateSaveIndicator() {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    if (!lastSaveOk) {
        el.textContent = '⚠ Save failed — use Backup!';
        el.className = 'save-indicator warn';
        return;
    }
    if (!lastSaveAt) {
        el.textContent = 'Projects are stored on this device';
        el.className = 'save-indicator';
        return;
    }
    const sec = Math.round((Date.now() - lastSaveAt) / 1000);
    const when = sec < 5 ? 'just now' : sec < 60 ? sec + 's ago' : Math.round(sec / 60) + 'm ago';
    el.textContent = '✓ Saved on this device · ' + when;
    el.className = 'save-indicator ok';
}

// Keep saving when user leaves the tab (important on iOS Safari)
window.addEventListener('pagehide', () => { saveState(); });
window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveState();
});
setInterval(() => { if (lastSaveAt) updateSaveIndicator(); }, 15000);

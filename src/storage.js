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

let projects = loadProjectsFromStorage() || {};
try { window.projects = projects; } catch (_) {}

let projectMeta = loadProjectMeta() || {};
(function seedProjectsSnapshot() {
    const snap = {};
    Object.keys(projects).forEach(name => {
        try { snap[name] = JSON.stringify(projects[name]); } catch (_) { snap[name] = ''; }
    });
    _lastProjectsSnapshotStr = snap;
})();

let projectSettings = loadProjectSettings();

function loadProjectAssets() {
    try {
        const raw = localStorage.getItem(ASSETS_KEY);
        if (!raw) return {};
        const data = JSON.parse(raw);
        return (data && typeof data === 'object') ? data : {};
    } catch (_) { return {}; }
}
let projectAssets = loadProjectAssets();
const spriteImageCache = {};

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

                    try {
                        const webp = canvas.toDataURL('image/webp', 0.82);
                        if (webp.indexOf('data:image/webp') === 0 && webp.length < dataUrl.length * 0.8) {
                            dataUrl = webp;
                            format = 'webp';
                        }
                    } catch (_) {}

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
    return true;
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
document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('.files-menu-wrap')) return;
    try { closeFilesMenus(); } catch (_) {}
});

function updateGamepadToggleUI() {
    try {
        const pv = document.getElementById('projects-view');
        if (pv && pv.classList.contains('active') && typeof window.renderProjects === 'function') {
            window.renderProjects();
        }
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
    try { if (typeof window.renderProjects === 'function') window.renderProjects(); } catch (_) {}
    alert(next
        ? ('Gamepad enabled for "' + name + '"\n\nJoystick + buttons will show when you PLAY.')
        : ('Gamepad disabled for "' + name + '"\n\nOn-screen controls stay hidden during PLAY.'));
}

let currentProjectName = null;
let currentFileName = null;
let modalCallback = null;
let selectedTemplate = "empty";
let selectedFilePreset = "blank";

const LUA_FILE_PRESETS = {
    blank: {
        name: "Blank file",
        desc: "Empty script with a short comment",
        code: (fname) => `-- ${fname}\n`
    },
    gameloop: {
        name: "Basic game loop",
        desc: "_update + _draw skeleton",
        code: () => `-- Basic game loop\nfunction _update(dt)\n    -- put logic here\nend\n\nfunction _draw()\n    gfx.cls(\"#1a1c28\")\n    gfx.text(\"Hello LuaX\", 16, 40, \"#fff\", \"20px sans-serif\")\nend\n`
    },
    dirs: {
        name: "4-direction sprite sheet",
        desc: "2x2 sheet: Front / Right / Left / Back",
        code: () => `-- 2x2 sprite sheet demo\nlocal SHEET = \"player.png\"\nlocal dir = 0\nlocal names = { \"Front\", \"Right\", \"Left\", \"Back\" }\n\nfunction _update(dt)\n    local ax = -axis(0)\n    local ay = axis(1)\n    if btn(0) or ay < -0.4 then dir = 3 end\n    if btn(1) or ay >  0.4 then dir = 0 end\n    if btn(2) or ax < -0.4 then dir = 2 end\n    if btn(3) or ax >  0.4 then dir = 1 end\nend\n\nfunction _draw()\n    gfx.cls(\"#4a6a70\")\n    local size = 120\n    local cx = gfx.width() / 2 - size / 2\n    local cy = gfx.height() / 2 - size / 2\n    gfx.anim(SHEET, dir, cx, cy, 0, 0, size, size, 2, 2)\n    gfx.text(names[dir + 1], 12, 28, \"#fff\", \"18px sans-serif\")\nend\n`
    },
    walk: {
        name: "Walk cycle animation",
        desc: "Horizontal strip — auto frame from time",
        code: () => `-- Horizontal walk-cycle sheet\nlocal SHEET = \"walk.png\"\nlocal NFRAMES = 4\nlocal FPS = 8\nlocal t = 0\nlocal frame = 0\n\nfunction _update(dt)\n    t = t + dt\n    frame = math.floor(t * FPS) % NFRAMES\nend\n\nfunction _draw()\n    gfx.cls(\"#1a1c28\")\n    local size = 96\n    local cx = gfx.width() / 2 - size / 2\n    local cy = gfx.height() / 2 - size / 2\n    gfx.anim(SHEET, frame, cx, cy, 0, 0, size, size, NFRAMES, 1)\n    gfx.text(\"frame \" .. frame, 12, 28, \"#fff\", \"16px sans-serif\")\nend\n`
    },
    move: {
        name: "Move a sprite",
        desc: "Player image + stick movement",
        code: () => `-- Move an imported sprite\nlocal SHEET = \"player.png\"\nlocal x, y = 160, 200\nlocal speed = 120\n\nfunction _update(dt)\n    local ax, ay = axis(0), axis(1)\n    if btn(2) then ax = -1 end\n    if btn(3) then ax =  1 end\n    if btn(0) then ay = -1 end\n    if btn(1) then ay =  1 end\n    x = x + ax * speed * dt\n    y = y + ay * speed * dt\nend\n\nfunction _draw()\n    gfx.cls(\"#1a1c28\")\n    gfx.sprite(SHEET, x, y, 64, 64)\nend\n`
    },
    bounce: {
        name: "Bouncing ball",
        desc: "Simple physics demo, no assets needed",
        code: () => `-- Bouncing ball\nlocal x, y = 100, 80\nlocal vx, vy = 140, 0\nlocal r = 18\nlocal g = 500\n\nfunction _update(dt)\n    vy = vy + g * dt\n    x = x + vx * dt\n    y = y + vy * dt\n    local w, h = gfx.width(), gfx.height()\n    if x < r then x = r; vx = math.abs(vx) end\n    if x > w - r then x = w - r; vx = -math.abs(vx) end\n    if y > h - r then y = h - r; vy = -math.abs(vy) * 0.85 end\nend\n\nfunction _draw()\n    gfx.cls(\"#0d1118\")\n    gfx.circlefill(x, y, r, \"#6c5ce7\")\n    gfx.text(\"Bouncing ball\", 12, 28, \"#fff\", \"16px sans-serif\")\nend\n`
    },
    music: {
        name: "Music tracker demo",
        desc: "4-channel step sequencer background tune",
        code: () => `-- Chiptune demo\nlocal C4 = sfx.note(\"C4\")\nlocal E4 = sfx.note(\"E4\")\nlocal G4 = sfx.note(\"G4\")\nlocal started = false\n\nfunction _update(dt)\n    if not started then\n        started = true\n        sfx.music({ bpm = 110, loop = true, wave = \"square\", steps = 16,\n            { C4, 0, E4, 0, G4, 0, E4, 0, C4, 0, E4, 0, G4, 0, 0, 0 },\n            {}, {}, {} })\n    end\nend\n\nfunction _draw()\n    gfx.cls(\"#0d1118\")\n    gfx.text(\"Music tracker\", 16, 40, \"#fff\", \"20px sans-serif\")\nend\n`
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

window.addEventListener('pagehide', () => { saveState(); });
window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveState();
});
setInterval(() => { if (lastSaveAt) updateSaveIndicator(); }, 15000);

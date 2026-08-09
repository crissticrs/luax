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

// Full content continues in repo - this is a partial to test size; will complete in follow-up if needed.

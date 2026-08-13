// src/cloud-sync.js — Google Drive upload / download / merge

function lxProjects() {
    try { if (typeof window !== 'undefined' && window.projects) return window.projects; } catch (_) {}
    try { if (typeof projects !== 'undefined' && projects) return projects; } catch (_) {}
    try { window.projects = window.projects || {}; } catch (_) {}
    return (typeof window !== 'undefined' && window.projects) ? window.projects : {};
}
function lxSetProjects(p) {
    try { if (typeof projects !== 'undefined') projects = p; } catch (_) {}
    try { window.projects = p; } catch (_) {}
}

async function driveFetch(path, options = {}) {
    if (!googleToken) throw new Error('Not signed in');
    const res = await fetch('https://www.googleapis.com/drive/v3' + path, {
        ...options,
        headers: { Authorization: 'Bearer ' + googleToken, ...(options.headers || {}) },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err.error && err.error.message) || res.statusText || 'Drive API error';
        const insufficient = /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT|permission/i.test(msg) || (err.error && err.error.status === 'PERMISSION_DENIED');
        if (insufficient && !scopeReauthInFlight) {
            scopeReauthInFlight = true;
            setCloudStatus('Cloud: need Drive permission — approve when prompted', 'warn');
            try { localStorage.removeItem(SCOPE_VERSION_KEY); } catch (_) {}
            setTimeout(() => { scopeReauthInFlight = false; requestGoogleTokenWithScopes({ forceConsent: true, silent: true }); }, 400);
        }
        throw new Error(msg);
    }
    return res;
}

async function findCloudFile() {
    if (cloudFileId) return cloudFileId;
    const q = encodeURIComponent(`name='${CLOUD_FILE_NAME}' and 'appDataFolder' in parents and trashed=false`);
    const res = await driveFetch(`/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)`);
    const data = await res.json();
    if (data.files && data.files.length) { cloudFileId = data.files[0].id; return cloudFileId; }
    return null;
}

let lastCloudCreditAt = 0;
const CLOUD_CREDIT_COOLDOWN_MS = 60 * 60 * 1000;

async function cloudUpload(silent, opts) {
    if (!googleToken || cloudSyncing) return;
    const free = opts && opts.free;
    const now = Date.now();
    const needCredit = !free && (now - lastCloudCreditAt) >= CLOUD_CREDIT_COOLDOWN_MS;
    if (needCredit) {
        const st = loadCreditsState();
        const cost = CREDIT_COSTS.cloud_save || 0;
        if (st.left < cost) { if (!silent) setCloudStatus('Cloud: need credits to backup', 'warn'); return; }
    }
    cloudSyncing = true;
    if (!silent) setCloudStatus('Cloud: saving…');
    try {
        const payload = JSON.stringify({
            version: 2,
            savedAt: new Date().toISOString(),
            projects: lxProjects(),
            projectMeta: (typeof projectMeta !== 'undefined' ? projectMeta : (window.projectMeta || {})),
        });
        const boundary = 'luax_' + Date.now();
        const fileId = await findCloudFile();
        let body, url, method;
        if (fileId) {
            const updateMeta = { name: CLOUD_FILE_NAME, mimeType: 'application/json' };
            body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(updateMeta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`;
            url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
            method = 'PATCH';
        } else {
            const meta = { name: CLOUD_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
            body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`;
            url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&spaces=appDataFolder';
            method = 'POST';
        }
        const res = await fetch(url, { method, headers: { Authorization: 'Bearer ' + googleToken, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error((err.error && err.error.message) || err.error_description || ('Upload failed HTTP ' + res.status));
        }
        if (!fileId) { const data = await res.json(); cloudFileId = data.id; }
        if (needCredit) { if (await spendCredits('cloud_save', { silent: true })) lastCloudCreditAt = now; }
        setCloudStatus('Cloud: synced ✓', 'ok');
        updateProfileUI();
        try { if (typeof window.renderProjects === 'function') window.renderProjects(); } catch (_) {}
    } catch (err) {
        const msg = (err && err.message) ? String(err.message) : 'sync failed';
        const short = msg.length > 48 ? msg.slice(0, 45) + '…' : msg;
        setCloudStatus('Cloud: ' + short, 'warn');
        console.warn('Cloud save failed', err);
        if (/insufficient|scope|permission|ACCESS_TOKEN/i.test(msg) && !scopeReauthInFlight) {
            scopeReauthInFlight = true;
            setCloudStatus('Cloud: approve Drive access when prompted', 'warn');
            try { localStorage.removeItem(SCOPE_VERSION_KEY); } catch (_) {}
            setTimeout(() => { scopeReauthInFlight = false; requestGoogleTokenWithScopes({ forceConsent: true, silent: true }); }, 500);
        }
    } finally { cloudSyncing = false; }
}

function retryCloudSync() {
    if (!googleToken || !isGoogleTokenValid()) { setCloudStatus('Cloud: sign in required', 'warn'); return; }
    setCloudStatus('Cloud: retrying…');
    cloudSyncOnSignIn({ free: true }).catch(() => {});
}

function scheduleCloudSave() {
    if (!googleToken) return;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => cloudUpload(true), isPro() ? 1200 : 8000);
}

async function cloudSyncOnSignIn(opts) {
    try {
        const fileId = await findCloudFile();
        if (fileId) {
            setCloudStatus('Cloud: loading your saves…');
            const res = await driveFetch(`/files/${fileId}?alt=media`);
            const data = await res.json();
            if (data.projects && typeof data.projects === 'object') {
                const cloudProjects = data.projects;
                const cloudMeta = (data.projectMeta && typeof data.projectMeta === 'object') ? data.projectMeta : null;
                let changed = false;

                if (cloudMeta) {
                    const names = new Set([
                        ...Object.keys(cloudProjects),
                        ...Object.keys(lxProjects()),
                        ...Object.keys(cloudMeta),
                        ...Object.keys(projectMeta || {}),
                    ]);
                    names.forEach(name => {
                        const c = cloudMeta[name] || {};
                        const l = projectMeta[name] || {};
                        const cTime = Math.max(c.updatedAt || 0, c.deletedAt || 0);
                        const lTime = Math.max(l.updatedAt || 0, l.deletedAt || 0);
                        if (cTime > lTime + 500) {
                            const cloudIsDelete = (c.deletedAt || 0) >= (c.updatedAt || 0);
                            if (cloudIsDelete) {
                                var _p = lxProjects(); if (_p[name]) { delete _p[name]; changed = true; }
                            } else if (cloudProjects[name]) {
                                lxProjects()[name] = cloudProjects[name];
                                changed = true;
                            }
                            projectMeta[name] = c;
                        }
                    });
                } else {
                    if (Object.keys(lxProjects()).length === 0 && Object.keys(cloudProjects).length > 0) {
                        lxSetProjects(cloudProjects);
                        changed = true;
                    }
                }

                // Safety net: empty local + cloud has data → always restore
                if (Object.keys(lxProjects()).length === 0 && Object.keys(cloudProjects).length > 0) {
                    lxSetProjects(cloudProjects);
                    if (cloudMeta) {
                        try { Object.keys(cloudMeta).forEach(function (n) { projectMeta[n] = cloudMeta[n]; }); } catch (_) {}
                    }
                    changed = true;
                }

                if (changed) {
                    try {
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(lxProjects()));
                        localStorage.setItem(STORAGE_META, JSON.stringify({ savedAt: Date.now() }));
                        saveProjectMeta();
                    } catch (_) {}
                    lastSaveAt = Date.now();
                    const snap = {};
                    Object.keys(lxProjects()).forEach(name => {
                        try { snap[name] = JSON.stringify(lxProjects()[name]); } catch (_) { snap[name] = ''; }
                    });
                    _lastProjectsSnapshotStr = snap;
                }
                try { if (typeof window.renderProjects === 'function') window.renderProjects(); } catch (_) {}
            }
        }
        await cloudUpload(true, { free: true });
        setCloudStatus('Cloud: synced ✓', 'ok');
        updateProfileUI();
        try { if (typeof window.renderProjects === 'function') window.renderProjects(); } catch (_) {}
    } catch (err) {
        const msg = (err && err.message) ? String(err.message) : 'sync error';
        const short = msg.length > 48 ? msg.slice(0, 45) + '…' : msg;
        setCloudStatus('Cloud: ' + short, 'warn');
        console.warn('cloudSyncOnSignIn', err);
        if (/insufficient|scope|permission|ACCESS_TOKEN/i.test(msg) && !scopeReauthInFlight) {
            scopeReauthInFlight = true;
            setCloudStatus('Cloud: approve Drive access when prompted', 'warn');
            try { localStorage.removeItem(SCOPE_VERSION_KEY); } catch (_) {}
            setTimeout(() => { scopeReauthInFlight = false; requestGoogleTokenWithScopes({ forceConsent: true, silent: true }); }, 500);
        }
    }
}

const _saveStateOriginal = saveState;
saveState = function () {
    const ok = _saveStateOriginal();
    scheduleCloudSave();
    return ok;
};

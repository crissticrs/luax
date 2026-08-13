// src/cloud-sync.js — Google Drive upload / download / merge

async function driveFetch(path, options = {}) {
    if (!googleToken) throw new Error('Not signed in');
    const res = await fetch('https://www.googleapis.com/drive/v3' + path, {
        ...options,
        headers: {
            Authorization: 'Bearer ' + googleToken,
            ...(options.headers || {}),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err.error && err.error.message) || res.statusText || 'Drive API error';
        const insufficient =
            /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT|permission/i.test(msg) ||
            (err.error && err.error.status === 'PERMISSION_DENIED');
        if (insufficient && !scopeReauthInFlight) {
            // Do NOT clear the access token here — that was kicking users back
            // to the login page right after a successful Google sign-in.
            // Keep them signed in; only re-prompt for the missing Drive scope.
            scopeReauthInFlight = true;
            setCloudStatus('Cloud: need Drive permission — approve when prompted', 'warn');
            try { localStorage.removeItem(SCOPE_VERSION_KEY); } catch (_) {}
            setTimeout(() => {
                scopeReauthInFlight = false;
                requestGoogleTokenWithScopes({ forceConsent: true, silent: true });
            }, 400);
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
    if (data.files && data.files.length) {
        cloudFileId = data.files[0].id;
        return cloudFileId;
    }
    return null;
}

let lastCloudCreditAt = 0;
const CLOUD_CREDIT_COOLDOWN_MS = 60 * 60 * 1000; // charge cloud_save at most once per hour

async function cloudUpload(silent, opts) {
    if (!googleToken || cloudSyncing) return;
    const free = opts && opts.free;
    const now = Date.now();
    const needCredit = !free && (now - lastCloudCreditAt) >= CLOUD_CREDIT_COOLDOWN_MS;

    // Check balance first, but do NOT charge until upload succeeds
    if (needCredit) {
        const st = loadCreditsState();
        const cost = CREDIT_COSTS.cloud_save || 0;
        if (st.left < cost) {
            if (!silent) setCloudStatus('Cloud: need credits to backup', 'warn');
            return;
        }
    }

    cloudSyncing = true;
    if (!silent) setCloudStatus('Cloud: saving…');
    try {
        const payload = JSON.stringify({
            version: 2,
            savedAt: new Date().toISOString(),
            projects,
            projectMeta,
        });
        const boundary = 'luax_' + Date.now();
        const fileId = await findCloudFile();
        let body, url, method;
        if (fileId) {
            const updateMeta = { name: CLOUD_FILE_NAME, mimeType: 'application/json' };
            body =
                `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
                `${JSON.stringify(updateMeta)}\r\n` +
                `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
                `${payload}\r\n--${boundary}--`;
            url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
            method = 'PATCH';
        } else {
            const meta = { name: CLOUD_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
            body =
                `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
                `${JSON.stringify(meta)}\r\n` +
                `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
                `${payload}\r\n--${boundary}--`;
            url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&spaces=appDataFolder';
            method = 'POST';
        }
        const res = await fetch(url, {
            method,
            headers: {
                Authorization: 'Bearer ' + googleToken,
                'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const apiMsg = (err.error && err.error.message) || err.error_description || '';
            throw new Error(apiMsg || ('Upload failed HTTP ' + res.status));
        }
        if (!fileId) {
            const data = await res.json();
            cloudFileId = data.id;
        }

        // Charge only after a successful upload
        if (needCredit) {
            if (await spendCredits('cloud_save', { silent: true })) {
                lastCloudCreditAt = now;
            }
        }

        setCloudStatus('Cloud: synced ✓', 'ok');
        updateProfileUI();
    } catch (err) {
        // Failed sync → no credits spent
        const msg = (err && err.message) ? String(err.message) : 'sync failed';
        const short = msg.length > 48 ? msg.slice(0, 45) + '…' : msg;
        setCloudStatus('Cloud: ' + short, 'warn');
        console.warn('Cloud save failed', err);
        // If scope is the problem, keep status clear and re-prompt (token stays)
        if (/insufficient|scope|permission|ACCESS_TOKEN/i.test(msg) && !scopeReauthInFlight) {
            scopeReauthInFlight = true;
            setCloudStatus('Cloud: approve Drive access when prompted', 'warn');
            try { localStorage.removeItem(SCOPE_VERSION_KEY); } catch (_) {}
            setTimeout(() => {
                scopeReauthInFlight = false;
                requestGoogleTokenWithScopes({ forceConsent: true, silent: true });
            }, 500);
        }
    } finally {
        cloudSyncing = false;
    }
}

function retryCloudSync() {
    if (!googleToken || !isGoogleTokenValid()) {
        setCloudStatus('Cloud: sign in required', 'warn');
        return;
    }
    setCloudStatus('Cloud: retrying…');
    cloudSyncOnSignIn({ free: true }).catch(() => {});
}

function scheduleCloudSave() {
    if (!googleToken) return;
    clearTimeout(cloudSaveTimer);
    const delay = isPro() ? 1200 : 8000;
    cloudSaveTimer = setTimeout(() => cloudUpload(true), delay);
}

/**
 * Sync with Drive on sign-in / reload.
 *
 * Per-project merge (not whole-blob compare): each project has its own
 * updatedAt (last edit) and deletedAt (tombstone) in `projectMeta`. For every
 * project name seen on either side, whichever side has the newer timestamp
 * wins — independently. A local delete (tombstone) beats an older cloud copy
 * of that same project, but doesn't affect any other project's sync, and an
 * edit made on another device after this device deleted it will correctly
 * come back. This replaces the old approach of comparing one savedAt/count
 * for the entire projects blob, which meant one project's edit timing could
 * cause an unrelated project's local delete to be silently reverted (or vice
 * versa).
 */
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
                    // New format: merge project-by-project using timestamps.
                    const names = new Set([
                        ...Object.keys(cloudProjects),
                        ...Object.keys(projects || {}),
                        ...Object.keys(cloudMeta),
                        ...Object.keys(projectMeta || {}),
                    ]);
                    names.forEach(name => {
                        const c = cloudMeta[name] || {};
                        const l = projectMeta[name] || {};
                        const cTime = Math.max(c.updatedAt || 0, c.deletedAt || 0);
                        const lTime = Math.max(l.updatedAt || 0, l.deletedAt || 0);
                        // Only act when cloud is clearly newer for THIS project.
                        if (cTime > lTime + 500) {
                            const cloudIsDelete = (c.deletedAt || 0) >= (c.updatedAt || 0);
                            if (cloudIsDelete) {
                                if (projects[name]) { delete projects[name]; changed = true; }
                            } else if (cloudProjects[name]) {
                                projects[name] = cloudProjects[name];
                                changed = true;
                            }
                            projectMeta[name] = c;
                        }
                        // else: local is newer or equal for this project — keep local, push below.
                    });
                } else {
                    // Legacy cloud save with no per-project metadata (from before this
                    // update) — fall back to "cloud only wins on first restore".
                    const localCount = Object.keys(projects || {}).length;
                    const cloudCount = Object.keys(cloudProjects).length;
                    if (localCount === 0 && cloudCount > 0) {
                        projects = cloudProjects;
                        changed = true;
                    }
                }

                if (changed) {
                    try {
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
                        localStorage.setItem(STORAGE_META, JSON.stringify({ savedAt: Date.now() }));
                        saveProjectMeta();
                    } catch (_) {}
                    lastSaveAt = Date.now();
                    // Re-seed the diff snapshot so the merged-in projects aren't
                    // mistaken for local edits on the next saveState().
                    const snap = {};
                    Object.keys(projects).forEach(name => {
                        try { snap[name] = JSON.stringify(projects[name]); } catch (_) { snap[name] = ''; }
                    });
                    _lastProjectsSnapshotStr = snap;
                    try { if (typeof window.renderProjects === "function") window.renderProjects(); } catch (_) {}
                }
            }
        }
        // Always push local after merging so Drive matches this device.
        await cloudUpload(true, { free: true });
        setCloudStatus('Cloud: synced ✓', 'ok');
        updateProfileUI();
    } catch (err) {
        const msg = (err && err.message) ? String(err.message) : 'sync error';
        const short = msg.length > 48 ? msg.slice(0, 45) + '…' : msg;
        setCloudStatus('Cloud: ' + short, 'warn');
        console.warn('cloudSyncOnSignIn', err);
        if (/insufficient|scope|permission|ACCESS_TOKEN/i.test(msg) && !scopeReauthInFlight) {
            scopeReauthInFlight = true;
            setCloudStatus('Cloud: approve Drive access when prompted', 'warn');
            try { localStorage.removeItem(SCOPE_VERSION_KEY); } catch (_) {}
            setTimeout(() => {
                scopeReauthInFlight = false;
                requestGoogleTokenWithScopes({ forceConsent: true, silent: true });
            }, 500);
        }
    }
}

// Hook local saves → auto cloud sync when signed in
const _saveStateOriginal = saveState;
saveState = function () {
    const ok = _saveStateOriginal();
    scheduleCloudSave();
    return ok;
};


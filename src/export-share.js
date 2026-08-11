// src/export-share.js — Export / Share play link / Import
// UI already calls exportProject, sharePlayLink, importProject, handleImport, tryLoadSharedPlay.

(function () {
    'use strict';

    const LUAX_FORMAT = 'luax-project';
    const LUAX_VERSION = 1;
    // Soft limit for share URLs (browsers vary; keep under ~8k to be safe)
    const SHARE_URL_SOFT_MAX = 7000;

    function bytesToBase64url(bytes) {
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function base64urlToBytes(s) {
        s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        const bin = atob(s);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function utf8ToBytes(str) {
        return new TextEncoder().encode(str);
    }

    function bytesToUtf8(bytes) {
        return new TextDecoder().decode(bytes);
    }

    async function gzipCompress(str) {
        if (typeof CompressionStream === 'undefined') return null;
        try {
            const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
            const buf = await new Response(stream).arrayBuffer();
            return new Uint8Array(buf);
        } catch (_) {
            return null;
        }
    }

    async function gzipDecompress(bytes) {
        if (typeof DecompressionStream === 'undefined') return null;
        try {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
            const buf = await new Response(stream).arrayBuffer();
            return bytesToUtf8(new Uint8Array(buf));
        } catch (_) {
            return null;
        }
    }

    /** Snapshot current open project (or named one) into a portable object. */
    function buildProjectPayload(name, opts) {
        opts = opts || {};
        name = name || (typeof currentProjectName !== 'undefined' ? currentProjectName : null);
        if (!name || typeof projects === 'undefined' || !projects[name]) return null;

        const files = {};
        const src = projects[name];
        Object.keys(src).forEach(function (k) {
            files[k] = src[k];
        });

        let assets = {};
        if (!opts.omitAssets && typeof getProjectAssetMap === 'function') {
            const map = getProjectAssetMap(name);
            Object.keys(map).forEach(function (k) {
                assets[k] = map[k];
            });
        }

        let music = {};
        if (!opts.omitMusic && typeof getProjectMusicMap === 'function') {
            const map = getProjectMusicMap(name);
            Object.keys(map).forEach(function (k) {
                music[k] = map[k];
            });
        }

        let settings = null;
        try {
            if (typeof projectSettings !== 'undefined' && projectSettings[name]) {
                settings = Object.assign({}, projectSettings[name]);
            }
        } catch (_) {}

        return {
            format: LUAX_FORMAT,
            version: LUAX_VERSION,
            name: name,
            files: files,
            assets: assets,
            music: music,
            settings: settings,
            exportedAt: new Date().toISOString()
        };
    }

    function downloadText(filename, text, mime) {
        const blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            try { document.body.removeChild(a); } catch (_) {}
            URL.revokeObjectURL(url);
        }, 0);
    }

    function safeFilename(name) {
        return String(name || 'project')
            .replace(/[^\w.\-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 60) || 'project';
    }

    /**
     * Export open project as .luax.json (costs credits).
     */
    async function exportProject() {
        if (typeof currentProjectName === 'undefined' || !currentProjectName) {
            alert('Open a project first.');
            return;
        }
        const payload = buildProjectPayload(currentProjectName);
        if (!payload) {
            alert('Nothing to export.');
            return;
        }

        // Credits gate (same as cloud backup)
        if (typeof spendCredits === 'function') {
            const ok = await spendCredits('export');
            if (!ok) return;
        }

        const json = JSON.stringify(payload, null, 2);
        const fname = safeFilename(currentProjectName) + '.luax.json';
        downloadText(fname, json, 'application/json;charset=utf-8');

        const nFiles = Object.keys(payload.files || {}).length;
        const nAssets = Object.keys(payload.assets || {}).length;
        const nMusic = Object.keys(payload.music || {}).length;
        alert(
            'Exported "' + currentProjectName + '"\n\n' +
            nFiles + ' Lua file(s) · ' + nAssets + ' image(s) · ' + nMusic + ' music pattern(s)\n\n' +
            'Saved as ' + fname
        );
    }

    async function encodeSharePayload(payload) {
        const json = JSON.stringify(payload);
        const gz = await gzipCompress(json);
        if (gz) {
            return 'gz1.' + bytesToBase64url(gz);
        }
        // Fallback: raw utf8 → base64url (larger)
        return 'raw1.' + bytesToBase64url(utf8ToBytes(json));
    }

    async function decodeSharePayload(token) {
        if (!token || typeof token !== 'string') return null;
        const dot = token.indexOf('.');
        if (dot < 1) return null;
        const kind = token.slice(0, dot);
        const data = token.slice(dot + 1);
        let json = null;
        try {
            if (kind === 'gz1') {
                const bytes = base64urlToBytes(data);
                json = await gzipDecompress(bytes);
            } else if (kind === 'raw1') {
                json = bytesToUtf8(base64urlToBytes(data));
            } else {
                return null;
            }
        } catch (_) {
            return null;
        }
        if (!json) return null;
        try {
            const obj = JSON.parse(json);
            if (!obj || obj.format !== LUAX_FORMAT) return null;
            return obj;
        } catch (_) {
            return null;
        }
    }

    /**
     * Build a playable share URL and copy it.
     * Free (no credits) — code + small assets only when URL stays short.
     */
    async function sharePlayLink() {
        if (typeof currentProjectName === 'undefined' || !currentProjectName) {
            alert('Open a project first.');
            return;
        }

        // Prefer full package; if URL too long, retry without assets
        let payload = buildProjectPayload(currentProjectName, { omitAssets: false });
        if (!payload) {
            alert('Nothing to share.');
            return;
        }

        let token = await encodeSharePayload(payload);
        let base = location.origin + location.pathname;
        // normalize trailing path for GH Pages
        if (!base.endsWith('/') && base.indexOf('.html') < 0) base += '/';
        let url = base + '#play=' + token;
        let strippedAssets = false;

        if (url.length > SHARE_URL_SOFT_MAX) {
            payload = buildProjectPayload(currentProjectName, { omitAssets: true });
            token = await encodeSharePayload(payload);
            url = base + '#play=' + token;
            strippedAssets = true;
        }

        if (url.length > SHARE_URL_SOFT_MAX * 1.4) {
            alert(
                'This project is too large for a share link (code/music alone is still big).\n\n' +
                'Use Export instead to download a .luax.json file.'
            );
            return;
        }

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
            } else {
                throw new Error('no clipboard');
            }
            alert(
                'Share link copied!\n\n' +
                (strippedAssets
                    ? 'Images were left out so the URL stays short.\nRecipients get code + music only.\n\n'
                    : '') +
                'Anyone with the link can play in the browser.\n\n' +
                url.slice(0, 80) + (url.length > 80 ? '…' : '')
            );
        } catch (_) {
            // Fallback: show URL for manual copy
            openModal(
                'Share link',
                '<p style="margin:0 0 8px;font-size:0.9rem;opacity:0.85">Copy this URL:</p>' +
                '<textarea id="share-url-box" readonly style="width:100%;min-height:90px;font-size:12px;font-family:monospace">' +
                String(url).replace(/</g, '&lt;') +
                '</textarea>',
                'Done',
                function () {}
            );
            setTimeout(function () {
                const box = document.getElementById('share-url-box');
                if (box) {
                    box.focus();
                    box.select();
                }
            }, 50);
        }
    }

    /**
     * Install a payload into local projects. Returns the final project name.
     */
    function installProjectPayload(payload, preferredName) {
        if (!payload || !payload.files || typeof projects === 'undefined') return null;

        let name = preferredName || payload.name || 'Shared game';
        if (typeof sanitizeName === 'function') {
            name = sanitizeName(name, 'Shared game');
        } else {
            name = String(name).trim().slice(0, 80) || 'Shared game';
        }

        // Avoid clobbering an existing project unless user confirms
        if (projects[name]) {
            const alt = name + ' (shared)';
            if (projects[alt]) {
                let i = 2;
                while (projects[name + ' (' + i + ')']) i++;
                name = name + ' (' + i + ')';
            } else {
                name = alt;
            }
        }

        projects[name] = {};
        Object.keys(payload.files).forEach(function (k) {
            projects[name][k] = payload.files[k];
        });

        if (payload.assets && typeof getProjectAssetMap === 'function') {
            const map = getProjectAssetMap(name);
            Object.keys(payload.assets).forEach(function (k) {
                map[k] = payload.assets[k];
            });
            if (typeof saveProjectAssets === 'function') saveProjectAssets();
        }

        if (payload.music && typeof getProjectMusicMap === 'function') {
            const map = getProjectMusicMap(name);
            Object.keys(payload.music).forEach(function (k) {
                map[k] = payload.music[k];
            });
            if (typeof saveProjectMusic === 'function') saveProjectMusic();
        }

        if (payload.settings && typeof projectSettings !== 'undefined') {
            projectSettings[name] = Object.assign({}, payload.settings);
            try {
                if (typeof SETTINGS_KEY !== 'undefined') {
                    localStorage.setItem(SETTINGS_KEY, JSON.stringify(projectSettings));
                }
            } catch (_) {}
        }

        if (typeof saveState === 'function') saveState();
        return name;
    }

    /**
     * Called on boot from app.js. If URL has #play=..., install and return name.
     */
    function tryLoadSharedPlay() {
        try {
            const hash = location.hash || '';
            const m = hash.match(/^#play=(.+)$/);
            if (!m) return null;

            // Decode is async — kick off and return null for sync call sites;
            // we also expose an async path that auto-opens.
            const token = decodeURIComponent(m[1]);
            decodeSharePayload(token).then(function (payload) {
                if (!payload) {
                    alert('Could not read this share link (invalid or too old).');
                    try {
                        history.replaceState(null, '', location.pathname + location.search);
                    } catch (_) {}
                    return;
                }
                const name = installProjectPayload(payload);
                if (!name) {
                    alert('Could not import shared project.');
                    return;
                }
                // Clear hash so refresh doesn't re-import
                try {
                    history.replaceState(null, '', location.pathname + location.search);
                } catch (_) {}
                try {
                    if (typeof openProject === 'function') openProject(name);
                    // Auto-play after a short tick so canvas / views are ready
                    setTimeout(function () {
                        try {
                            if (typeof startPlayMode === 'function') startPlayMode();
                        } catch (err) {
                            console.warn('auto-play failed', err);
                        }
                    }, 120);
                } catch (err) {
                    console.warn('open shared project failed', err);
                    alert('Imported "' + name + '". Open it from Projects.');
                    if (typeof switchView === 'function') switchView('projects-view');
                    if (typeof renderProjects === 'function') renderProjects();
                }
            }).catch(function (err) {
                console.warn('share decode failed', err);
                alert('Could not load share link.');
            });

            // Sync callers get null; async path handles open+play
            return null;
        } catch (err) {
            console.warn('tryLoadSharedPlay', err);
            return null;
        }
    }

    function importProject() {
        const input = document.getElementById('import-input');
        if (!input) {
            alert('Import input missing.');
            return;
        }
        input.value = '';
        input.click();
    }

    function handleImport(ev) {
        const file = ev.target && ev.target.files && ev.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onerror = function () {
            alert('Could not read file.');
            ev.target.value = '';
        };
        reader.onload = function () {
            try {
                const text = String(reader.result || '');
                const data = JSON.parse(text);

                // Accept our format, or a bare { files: {...} } / flat lua map
                let payload = null;
                if (data && data.format === LUAX_FORMAT && data.files) {
                    payload = data;
                } else if (data && data.files && typeof data.files === 'object') {
                    payload = {
                        format: LUAX_FORMAT,
                        version: LUAX_VERSION,
                        name: data.name || (file.name || 'Imported').replace(/\.json$/i, ''),
                        files: data.files,
                        assets: data.assets || {},
                        music: data.music || {},
                        settings: data.settings || null
                    };
                } else if (data && typeof data === 'object' && data['main.lua']) {
                    // Flat map of lua files
                    payload = {
                        format: LUAX_FORMAT,
                        version: LUAX_VERSION,
                        name: (file.name || 'Imported').replace(/\.json$/i, ''),
                        files: data,
                        assets: {},
                        music: {},
                        settings: null
                    };
                } else {
                    alert('Not a LuaX project file.\n\nExpect a .luax.json export.');
                    ev.target.value = '';
                    return;
                }

                const name = installProjectPayload(payload);
                if (!name) {
                    alert('Import failed.');
                    ev.target.value = '';
                    return;
                }

                if (typeof renderProjects === 'function') renderProjects();
                if (typeof switchView === 'function') switchView('projects-view');
                alert('Imported "' + name + '".');
            } catch (err) {
                console.warn('import failed', err);
                alert('Import failed: ' + (err && err.message ? err.message : err));
            }
            ev.target.value = '';
        };
        reader.readAsText(file);
    }

    // Public API
    window.exportProject = exportProject;
    window.sharePlayLink = sharePlayLink;
    window.tryLoadSharedPlay = tryLoadSharedPlay;
    window.importProject = importProject;
    window.handleImport = handleImport;
    window.buildProjectPayload = buildProjectPayload;
    window.installProjectPayload = installProjectPayload;
})();

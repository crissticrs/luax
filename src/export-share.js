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
            // Use Array.from so apply never hits call-stack limits on huge buffers
            const slice = bytes.subarray(i, i + chunk);
            bin += String.fromCharCode.apply(null, Array.from(slice));
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
        if (!name) return null;
        // Classic scripts share the same global env; prefer bare name, fall back to window
        const projMap = (typeof projects !== 'undefined' ? projects : (window.projects || null));
        if (!projMap || !projMap[name]) return null;

        const files = {};
        const src = projMap[name];
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
        try {
            if (typeof currentProjectName === 'undefined' || !currentProjectName) {
                alert('Open a project first.');
                return;
            }
            const payload = buildProjectPayload(currentProjectName);
            if (!payload) {
                alert('Nothing to export.');
                return;
            }

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
        } catch (err) {
            console.error('exportProject', err);
            alert('Export failed: ' + (err && err.message ? err.message : err));
        }
    }

    async function encodeSharePayload(payload) {
        const json = JSON.stringify(payload);
        const gz = await gzipCompress(json);
        if (gz) {
            return 'gz1.' + bytesToBase64url(gz);
        }
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

    function shareBaseUrl() {
        let base = location.origin + location.pathname;
        // GitHub Pages directory index often has no trailing slash
        if (!base.endsWith('/') && base.indexOf('.html') < 0) base += '/';
        return base;
    }

    function showShareUrlModal(url, note) {
        // Standalone overlay — does not depend on openModal layout/CSS
        try {
            const old = document.getElementById('luax-share-overlay');
            if (old) old.remove();
        } catch (_) {}

        const noteText = note ? String(note) : '';
        const overlay = document.createElement('div');
        overlay.id = 'luax-share-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:100001',
            'background:rgba(0,0,0,0.65)', 'display:flex',
            'align-items:center', 'justify-content:center',
            'padding:16px', 'box-sizing:border-box'
        ].join(';');

        const card = document.createElement('div');
        card.style.cssText = [
            'width:min(520px,100%)', 'max-height:90vh', 'overflow:auto',
            'background:var(--panel-color,#1a1625)', 'color:var(--text-color,#e8e6f0)',
            'border-radius:14px', 'padding:18px 18px 14px',
            'border:1px solid rgba(255,255,255,0.12)',
            'box-shadow:0 16px 48px rgba(0,0,0,0.5)'
        ].join(';');

        const title = document.createElement('h2');
        title.textContent = 'Share link';
        title.style.cssText = 'margin:0 0 10px;font-size:1.15rem';
        card.appendChild(title);

        if (noteText) {
            const p = document.createElement('p');
            p.textContent = noteText;
            p.style.cssText = 'margin:0 0 10px;font-size:0.85rem;opacity:0.9';
            card.appendChild(p);
        }

        const hint = document.createElement('p');
        hint.textContent = 'Anyone with this link can play — no login needed.';
        hint.style.cssText = 'margin:0 0 8px;font-size:0.9rem;opacity:0.85';
        card.appendChild(hint);

        const box = document.createElement('input');
        box.id = 'share-url-box';
        box.type = 'text';
        box.readOnly = true;
        box.value = url;
        box.style.cssText = [
            'width:100%', 'font-size:12px', 'font-family:monospace',
            'box-sizing:border-box', 'padding:10px 12px', 'border-radius:8px',
            'border:1px solid rgba(255,255,255,0.18)', 'background:rgba(0,0,0,0.4)',
            'color:inherit', 'margin-bottom:12px'
        ].join(';');
        card.appendChild(box);

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.id = 'share-copy-btn';
        copyBtn.textContent = 'Copy link';
        copyBtn.className = 'btn btn-primary';
        copyBtn.style.cssText = 'flex:1;min-width:120px;font-weight:600;padding:10px 14px;cursor:pointer';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = 'Close';
        closeBtn.className = 'btn';
        closeBtn.style.cssText = 'flex:0 0 auto;padding:10px 14px;cursor:pointer';

        function close() {
            try { overlay.remove(); } catch (_) {}
        }

        function copyShareUrl() {
            const text = box.value || url;
            function ok() {
                copyBtn.textContent = 'Copied!';
                copyBtn.style.background = 'rgba(46, 204, 113, 0.45)';
                if (typeof lxToast === 'function') lxToast('Link copied!', 'ok');
                setTimeout(function () {
                    copyBtn.textContent = 'Copy link';
                    copyBtn.style.background = '';
                }, 1600);
            }
            function fail() {
                box.focus();
                box.select();
                alert('Select the text and press Ctrl/Cmd+C to copy.');
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(ok).catch(function () {
                    try {
                        box.focus(); box.select();
                        if (document.execCommand('copy')) ok();
                        else fail();
                    } catch (_) { fail(); }
                });
            } else {
                try {
                    box.focus(); box.select();
                    if (document.execCommand('copy')) ok();
                    else fail();
                } catch (_) { fail(); }
            }
        }

        copyBtn.onclick = function (e) {
            e.preventDefault();
            e.stopPropagation();
            copyShareUrl();
        };
        closeBtn.onclick = function (e) {
            e.preventDefault();
            close();
        };
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });

        row.appendChild(copyBtn);
        row.appendChild(closeBtn);
        card.appendChild(row);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        setTimeout(function () {
            try { box.focus(); box.select(); } catch (_) {}
        }, 50);
    }

    /**
     * Build a playable share URL and show it (clipboard after await often fails).
     * Free (no credits) — code + small assets only when URL stays short.
     */
    async function sharePlayLink() {
        try {
            if (typeof currentProjectName === 'undefined' || !currentProjectName) {
                alert('Open a project first.');
                return;
            }

            // Prefer full package; if URL too long, retry without assets
            let payload = buildProjectPayload(currentProjectName, { omitAssets: false });
            if (!payload) {
                alert('Nothing to share. Open a project that has files.');
                return;
            }

            let token = await encodeSharePayload(payload);
            let url = shareBaseUrl() + '#play=' + token;
            let strippedAssets = false;

            if (url.length > SHARE_URL_SOFT_MAX) {
                payload = buildProjectPayload(currentProjectName, { omitAssets: true });
                token = await encodeSharePayload(payload);
                url = shareBaseUrl() + '#play=' + token;
                strippedAssets = true;
            }

            if (url.length > SHARE_URL_SOFT_MAX * 1.5) {
                alert(
                    'This project is too large for a share link (even without images).\n\n' +
                    'Use Export instead to download a .luax.json file.'
                );
                return;
            }

            // Try clipboard, but always show the modal — async work breaks the
            // user-gesture chain on Safari/Chrome so clipboard often fails silently.
            let copied = false;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(url);
                    copied = true;
                }
            } catch (_) {
                copied = false;
            }

            const note = (copied ? 'Link was also copied to the clipboard. ' : 'Use the Copy link button below. ') +
                (strippedAssets
                    ? 'Images were left out so the URL stays short — recipients get code + music only.'
                    : '');

            showShareUrlModal(url, note);
        } catch (err) {
            console.error('sharePlayLink', err);
            alert('Share failed: ' + (err && err.message ? err.message : err));
        }
    }

    /**
     * Install a payload into local projects. Returns the final project name.
     */
    function installProjectPayload(payload, preferredName) {
        if (!payload || !payload.files) return null;
        const projMap = (typeof projects !== 'undefined' ? projects : (window.projects || null));
        if (!projMap) return null;

        let name = preferredName || payload.name || 'Shared game';
        if (typeof sanitizeName === 'function') {
            name = sanitizeName(name, 'Shared game');
        } else {
            name = String(name).trim().slice(0, 80) || 'Shared game';
        }

        if (projMap[name]) {
            const alt = name + ' (shared)';
            if (projMap[alt]) {
                let i = 2;
                while (projMap[name + ' (' + i + ')']) i++;
                name = name + ' (' + i + ')';
            } else {
                name = alt;
            }
        }

        projMap[name] = {};
        Object.keys(payload.files).forEach(function (k) {
            projMap[name][k] = payload.files[k];
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
     * Called on boot from app.js. If URL has #play=..., install and open.
     */
    function tryLoadSharedPlay() {
        try {
            const hash = location.hash || '';
            const m = hash.match(/^#play=(.+)$/);
            if (!m) return null;

            // Enable guest play immediately so auth gate does not block
            window.luaxGuestPlay = true;
            window.luaxSharePending = true;
            if (typeof setGuestPlay === 'function') setGuestPlay(true);

            const token = decodeURIComponent(m[1]);
            decodeSharePayload(token).then(function (payload) {
                if (!payload) {
                    window.luaxGuestPlay = false;
                    window.luaxSharePending = false;
                    alert('Could not read this share link (invalid or corrupted).');
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
                try {
                    history.replaceState(null, '', location.pathname + location.search);
                } catch (_) {}
                try {
                    currentProjectName = name;
                    const title = document.getElementById('current-project-title');
                    if (title) title.textContent = name;
                } catch (_) {}
                window.luaxSharePending = false;
                setTimeout(function () {
                    try {
                        if (typeof startPlayMode === 'function') startPlayMode();
                        else alert('Game engine still loading — refresh in a moment.');
                    } catch (err) {
                        console.warn('auto-play failed', err);
                        alert('Could not start the shared game: ' + (err && err.message ? err.message : err));
                    }
                }, 80);
            }).catch(function (err) {
                console.warn('share decode failed', err);
                window.luaxGuestPlay = false;
                window.luaxSharePending = false;
                alert('Could not load share link.');
                if (typeof applyAuthGate === 'function') applyAuthGate();
            });

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


    // If opened with #play=..., mark guest mode before auth runs
    try {
        if (/^#play=/.test(location.hash || '')) {
            window.luaxGuestPlay = true;
            window.luaxSharePending = true;
        }
    } catch (_) {}


    function wrapPlayForGuest() {
        try {
            if (typeof window.startPlayMode === 'function' && !window.startPlayMode.__luaxGuestWrap) {
                var origStart = window.startPlayMode;
                var wrappedStart = async function () {
                    if (!(typeof isAuthed === 'function' && isAuthed()) && !window.luaxGuestPlay) {
                        if (typeof applyAuthGate === 'function') applyAuthGate();
                        return;
                    }
                    var realIsAuthed = isAuthed;
                    isAuthed = function () { return true; };
                    try { return await origStart.apply(this, arguments); }
                    finally { isAuthed = realIsAuthed; }
                };
                wrappedStart.__luaxGuestWrap = true;
                window.startPlayMode = wrappedStart;
            }
            if (typeof stopPlayMode === 'function' && !stopPlayMode.__luaxGuestWrap) {
                var origStop = stopPlayMode;
                var wrappedStop = function () {
                    var guest = !!window.luaxGuestPlay;
                    try { origStop.apply(this, arguments); }
                    finally {
                        if (guest) {
                            window.luaxGuestPlay = false;
                            window.luaxSharePending = false;
                            try { if (typeof applyAuthGate === 'function') applyAuthGate(); } catch (_) {}
                        }
                    }
                };
                wrappedStop.__luaxGuestWrap = true;
                try { stopPlayMode = wrappedStop; } catch (_) {}
                window.stopPlayMode = wrappedStop;
            }
        } catch (err) { console.warn('guest play wrap failed', err); }
    }
    wrapPlayForGuest();
    setTimeout(wrapPlayForGuest, 0);
    setTimeout(wrapPlayForGuest, 300);

    // Public API — always on window so inline onclick works
    window.exportProject = exportProject;
    window.sharePlayLink = sharePlayLink;
    window.tryLoadSharedPlay = tryLoadSharedPlay;
    window.importProject = importProject;
    window.handleImport = handleImport;
    window.buildProjectPayload = buildProjectPayload;
    window.installProjectPayload = installProjectPayload;
})();

// src/app.js — app shell: navigation, projects UI, themes, file list, boot
// Extracted from index.html so the page stays markup-only.
// Modal helpers (openModal / closeModal / confirmModal) live in src/modal.js.

// PLAY / RUN GAME — capture-phase so it always works, even if later code fails
document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-action="run-game"]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof window.startPlayMode === 'function') {
        try { window.startPlayMode(); }
        catch (err) { alert('PLAY error: ' + (err && err.message ? err.message : err)); }
    } else {
        alert('Game engine is still loading. Wait 1 second and try RUN GAME again.');
    }
}, true);


// ============================================================
// NAV
// ============================================================
function switchView(id) {
    if (!isAuthed() && id !== 'login-view') {
        applyAuthGate();
        return;
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ============================================================
// PROJECTS UI
// ============================================================
function renderProjects() {
    const list = document.getElementById('projects-list');
    if (!list) return;
    list.innerHTML = '';
    const q = ((document.getElementById('project-search') || {}).value || '').trim().toLowerCase();
    let names = Object.keys(projects).sort();
    if (q) names = names.filter(n => n.toLowerCase().includes(q));

    if (!names.length) {
        list.innerHTML = `
            <div class="lx-empty">
                <div class="item-icon-svg" style="width:80px;height:80px;margin-bottom:12px">${LX_SVG.folderLg}</div>
                <h3>${q ? 'No matches' : 'Your projects will appear here'}</h3>
                <p>${q ? 'Try a different search.' : 'Create or import your first project to get started.'}</p>
                ${!q ? '<button class="btn btn-primary" onclick="promptNewProject()">+ New Project</button>' : ''}
            </div>`;
        return;
    }
    names.forEach(name => {
        const div = document.createElement('div');
        div.className = 'list-item';
        const gpOn = getProjectGamepad(name);
        div.innerHTML = `
            <div class="item-title" onclick="openProject('${esc(name)}')">
                <span class="item-icon-svg">${LX_SVG.folder}</span>
                <span>${escapeHtml(name)}</span>
                <span class="item-badge">Lua</span>
            </div>
            <div class="item-actions">
                <button type="button" class="btn-gamepad-emoji${gpOn ? '' : ' off'}" title="${gpOn ? 'Gamepad ON' : 'Gamepad OFF'}" aria-label="${gpOn ? 'Gamepad ON' : 'Gamepad OFF'}, ${escapeHtml(name)}"
                    onclick="event.stopPropagation();toggleProjectGamepadFor('${esc(name)}')">🎮</button>
                <button class="btn-icon-sm" title="Rename" aria-label="Rename ${escapeHtml(name)}" onclick="event.stopPropagation();promptRenameProject('${esc(name)}')">✎</button>
                <button class="btn-icon-sm" title="Duplicate" aria-label="Duplicate ${escapeHtml(name)}" onclick="event.stopPropagation();duplicateProject('${esc(name)}')">⧉</button>
                <span class="item-chevron" aria-hidden="true" onclick="openProject('${esc(name)}')">${LX_SVG.chevron}</span>
                <button class="btn btn-delete" aria-label="Delete ${escapeHtml(name)}" onclick="deleteProject(event,'${esc(name)}')">${LX_SVG.trash}</button>
            </div>`;
        list.appendChild(div);
    });
}

function promptRenameProject(oldName) {
    openModal('Rename project',
        `<input type="text" id="modal-input" value="${escapeHtml(oldName)}" autocomplete="off">`,
        'Rename',
        () => {
            const name = (document.getElementById('modal-input').value || '').trim();
            if (!name || name === oldName) return;
            if (projects[name]) return alert('A project with that name already exists');
            projects[name] = projects[oldName];
            delete projects[oldName];
            if (projectSettings[oldName]) {
                projectSettings[name] = projectSettings[oldName];
                delete projectSettings[oldName];
                try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(projectSettings)); } catch (_) {}
            }
            if (projectAssets[oldName]) {
                projectAssets[name] = projectAssets[oldName];
                delete projectAssets[oldName];
                saveProjectAssets();
            }
            if (currentProjectName === oldName) {
                currentProjectName = name;
                const t = document.getElementById('current-project-title');
                if (t) t.textContent = name;
            }
            saveState();
            renderProjects();
        }
    );
}

function duplicateProject(name) {
    if (!projects[name]) return;
    let n = name + ' copy';
    let i = 2;
    while (projects[n]) { n = name + ' copy ' + i; i++; }
    projects[n] = JSON.parse(JSON.stringify(projects[name]));
    setProjectGamepad(n, getProjectGamepad(name));
    if (projectAssets[name]) {
        projectAssets[n] = JSON.parse(JSON.stringify(projectAssets[name]));
        saveProjectAssets();
    }
    saveState();
    renderProjects();
}

function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

const THEMES = [
    { id: 'purple', name: 'Purple', colors: ['#8b5cf6', '#16131f', '#0c0a12'] },
    { id: 'blue', name: 'Blue Ocean', colors: ['#3b82f6', '#0d1520', '#070d14'] },
    { id: 'green', name: 'Green Forest', colors: ['#22c55e', '#0d1810', '#070f0a'] },
    { id: 'amber', name: 'Amber Sunset', colors: ['#f59e0b', '#1a140e', '#100c08'] },
    { id: 'teal', name: 'Teal Cyber', colors: ['#14b8a6', '#0c1a1c', '#061012'] },
    { id: 'rose', name: 'Rose Soft', colors: ['#f43f5e', '#ffffff', '#fdf8f9'] },
];

function applyTheme(id) {
    const t = THEMES.find(x => x.id === id) || THEMES[0];
    document.documentElement.setAttribute('data-theme', t.id);
    try { localStorage.setItem('luax_theme', t.id); } catch (_) {}
    renderThemeGrid();
}

function renderThemeGrid() {
    const grid = document.getElementById('theme-grid');
    if (!grid) return;
    const cur = document.documentElement.getAttribute('data-theme') || 'purple';
    grid.innerHTML = THEMES.map(t => `
        <button type="button" class="theme-card${t.id === cur ? ' active' : ''}" onclick="applyTheme('${t.id}')">
            <div class="theme-swatch">${t.colors.map(c => `<i style="background:${c}"></i>`).join('')}</div>
            ${t.name}
        </button>`).join('');
}

function renderTemplatesPanel() {
    const el = document.getElementById('templates-list');
    if (!el) return;
    el.innerHTML = '<h2 class="lx-section-title">Start from a template</h2>' +
        Object.keys(TEMPLATES).map(k => `
            <div class="tpl-card" onclick="selectedTemplate='${k}'; promptNewProjectFromTemplate('${k}')">
                <h3>${TEMPLATES[k].name}</h3>
                <p>Tap to create a new project with this template</p>
            </div>`).join('');
}

function promptNewProjectFromTemplate(k) {
    selectedTemplate = k;
    promptNewProject();
    // pre-select template after modal opens
    setTimeout(() => selectTemplate(k), 50);
}

function lxNav(name) {
    document.querySelectorAll('.lx-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('panel-' + name);
    if (panel) panel.classList.add('active');
    document.querySelectorAll('.lx-tab, .lx-side-item').forEach(b => {
        b.classList.toggle('active', b.dataset.nav === name);
    });
    if (name === 'templates') renderTemplatesPanel();
    if (name === 'settings') {
        renderThemeGrid();
        renderBillingPanel();
    }
    // hide search on non-projects
    const sr = document.querySelector('.lx-search-row');
    if (sr) sr.style.display = name === 'projects' ? '' : 'none';
}

function promptNewProject() {
    if (!TEMPLATES[selectedTemplate]) selectedTemplate = 'empty';
    const tplHtml = Object.keys(TEMPLATES).map(k =>
        `<button type="button" class="template-btn${k===selectedTemplate?' selected':''}" data-tpl="${k}" onclick="selectTemplate('${k}')">${TEMPLATES[k].name}</button>`
    ).join('');
    // Gamepad option only on mobile — desktop uses keyboard/mouse only
    const mobile = typeof isMobileDevice !== 'undefined' ? isMobileDevice : false;
    const gpHtml = mobile
        ? `<label style="display:flex;align-items:center;gap:8px;font-size:0.9rem;cursor:pointer;user-select:none;margin-top:4px">
             <input type="checkbox" id="modal-gamepad" checked style="width:18px;height:18px;accent-color:var(--accent-color)">
             On-screen gamepad (joystick + buttons)
           </label>
           <div style="font-size:0.75rem;color:#666;margin-top:4px">Touch controls for phones / tablets</div>`
        : `<div style="font-size:0.75rem;color:#666;margin-top:8px">Desktop: keyboard (WASD) + mouse look — no on-screen gamepad</div>`;
    openModal('New Project',
        `<input type="text" id="modal-input" placeholder="Project name" autocomplete="off">
         <div style="font-size:0.85rem;color:#888;margin-bottom:6px">Template</div>
         <div class="template-list">${tplHtml}</div>
         ${gpHtml}`,
        'Create',
        () => {
            const name = (document.getElementById('modal-input').value || '').trim();
            if (!name) return alert('Enter a name');
            if (projects[name]) return alert('Already exists');
            projects[name] = JSON.parse(JSON.stringify(TEMPLATES[selectedTemplate].files));
            if (mobile) {
                const gp = document.getElementById('modal-gamepad');
                setProjectGamepad(name, gp ? gp.checked : true);
            } else {
                setProjectGamepad(name, false);
            }
            saveState();
            renderProjects();
            openProject(name);
        }
    );
}

function selectTemplate(k) {
    selectedTemplate = k;
    document.querySelectorAll('.template-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.tpl === k);
    });
}

function deleteProject(e, name) {
    e.stopPropagation();
    if (confirm(`Delete "${name}" and all files?`)) {
        delete projects[name];
        delete projectSettings[name];
        delete projectAssets[name];
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(projectSettings)); } catch (_) {}
        saveProjectAssets();
        saveState();
        renderProjects();
        // Push deletion to Drive immediately so reload does not restore the project
        if (googleToken) {
            clearTimeout(cloudSaveTimer);
            cloudUpload(true).catch(() => {});
        }
    }
}

function openProject(name) {
    if (!isAuthed()) { applyAuthGate(); return; }
    currentProjectName = name;
    document.getElementById('current-project-title').textContent = name;
    renderFiles();
    updateGamepadToggleUI();
    switchView('files-view');
}

function renderFiles() {
    const list = document.getElementById('files-list');
    list.innerHTML = '';
    const files = projects[currentProjectName] || {};
    Object.keys(files).sort().forEach(fn => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="item-title" onclick="openFile('${esc(fn)}')">
                <span class="item-icon-svg">${LX_SVG.file}</span>
                <span>${escapeHtml(fn)}</span>
            </div>
            <div class="item-actions">
                <button class="btn-icon-sm" title="Rename" aria-label="Rename ${escapeHtml(fn)}" onclick="event.stopPropagation();promptRenameFile('${esc(fn)}')">✎</button>
                ${fn !== 'main.lua' ? `<button class="btn btn-delete" aria-label="Delete ${escapeHtml(fn)}" onclick="deleteFile(event,'${esc(fn)}')">${LX_SVG.trash}</button>` : ''}
            </div>`;
        list.appendChild(div);
    });
    // Sprites / images — tap to open in pixel editor
    const assets = getProjectAssetMap(currentProjectName);
    Object.keys(assets).sort().forEach(fn => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="item-title" onclick="openSpriteEditor('${esc(fn)}')" title="Edit sprite">
                <img src="${assets[fn]}" alt="" style="width:28px;height:28px;object-fit:contain;image-rendering:pixelated;border-radius:4px;background:#111">
                <span>${escapeHtml(fn)}</span>
                <span class="item-badge">IMG</span>
            </div>
            <div class="item-actions">
                <button class="btn-icon-sm" title="Edit" aria-label="Edit sprite ${escapeHtml(fn)}" onclick="event.stopPropagation();openSpriteEditor('${esc(fn)}')">✎</button>
                <button class="btn btn-delete" aria-label="Delete sprite ${escapeHtml(fn)}" onclick="deleteAsset(event,'${esc(fn)}')">${LX_SVG.trash}</button>
            </div>`;
        list.appendChild(div);
    });
    // Music patterns
    const musicMap = getProjectMusicMap(currentProjectName);
    Object.keys(musicMap).sort().forEach(fn => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="item-title" onclick="openMusicEditor('${esc(fn)}')" title="Edit music">
                <span style="font-size:1.1rem">♪</span>
                <span>${escapeHtml(fn)}</span>
                <span class="item-badge">MUSIC</span>
            </div>
            <div class="item-actions">
                <button class="btn-icon-sm" title="Edit" aria-label="Edit music pattern ${escapeHtml(fn)}" onclick="event.stopPropagation();openMusicEditor('${esc(fn)}')">✎</button>
                <button class="btn btn-delete" aria-label="Delete music pattern ${escapeHtml(fn)}" onclick="deleteMusicPattern(event,'${esc(fn)}')">${LX_SVG.trash}</button>
            </div>`;
        list.appendChild(div);
    });
}

function deleteMusicPattern(e, name) {
    e.stopPropagation();
    if (!confirm('Delete music pattern "' + name + '"?')) return;
    const map = getProjectMusicMap(currentProjectName);
    delete map[name];
    saveProjectMusic();
    renderFiles();
}


function promptRenameFile(oldName) {
    openModal('Rename file',
        `<input type="text" id="modal-input" value="${escapeHtml(oldName)}" autocomplete="off">`,
        'Rename',
        () => {
            let name = (document.getElementById('modal-input').value || '').trim();
            if (!name || name === oldName) return;
            if (!name.endsWith('.lua')) name += '.lua';
            if (projects[currentProjectName][name]) return alert('File exists');
            projects[currentProjectName][name] = projects[currentProjectName][oldName];
            delete projects[currentProjectName][oldName];
            if (currentFileName === oldName) currentFileName = name;
            saveState();
            renderFiles();
            renderTabs();
            updateDirtyUI();
        }
    );
}

function deleteAsset(e, name) {
    e.stopPropagation();
    if (!confirm('Delete image "' + name + '"?')) return;
    const map = getProjectAssetMap(currentProjectName);
    delete map[name];
    delete spriteImageCache[currentProjectName + '::' + name];
    saveProjectAssets();
    renderFiles();
}

function importSpriteFile() {
    if (!currentProjectName) return alert('Open a project first');
    document.getElementById('import-sprite-input').click();
}

function handleSpriteImport(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file || !currentProjectName) return;
    if (file.size > 1.5 * 1024 * 1024) {
        alert('Image too large (max ~1.5 MB). Compress it first.');
        ev.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        let name = file.name || 'sprite.png';
        name = name.replace(/[^\w.\-]+/g, '_');
        const map = getProjectAssetMap(currentProjectName);
        if (map[name] && !confirm('Replace existing "' + name + '"?')) {
            ev.target.value = '';
            return;
        }
        map[name] = reader.result;
        delete spriteImageCache[currentProjectName + '::' + name];
        saveProjectAssets();
        renderFiles();
        alert('Imported "' + name + '". In Lua: gfx.sprite("' + name + '", x, y)');
        ev.target.value = '';
    };
    reader.readAsDataURL(file);
}

// (editor → src/editor.js, play → src/play-mode.js)
// Modules: src/auth.js · src/billing.js · src/cloud-sync.js · src/modal.js

// boot
try {
    applyTheme(localStorage.getItem('luax_theme') || 'purple');
} catch (_) {
    applyTheme('purple');
}
hydrateIcons(document);
// Restore remembered Google profile first so Stripe return can bind email
try {
    const pr = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (pr) googleProfile = JSON.parse(pr);
} catch (_) {}
loadPersistedGoogleToken();
handleStripeReturn();
tryRestoreGoogleSession();
applyAuthGate();
tryFinishPendingProActivation();
// After profile/token settle: finish pending Pro, bind email, verify plan
setTimeout(() => {
    tryFinishPendingProActivation();
    if (isPro() && currentAccountEmail()) {
        const st = loadProStatus();
        if (st && st.active && (!st.email || st.email !== currentAccountEmail())) {
            setPro(true, { source: st.source || 'stripe', email: currentAccountEmail(), since: st.since, activeUntil: st.activeUntil });
        }
    }
    verifySubscriptionOnAccess().catch(() => {});
    updateProfileUI();
    if (isAuthed()) {
        const shared = tryLoadSharedPlay();
        if (shared) {
            renderProjects();
            openProject(shared);
            setTimeout(() => startPlayMode(), 200);
        }
    }
}, 800);
// One more retry after slower token refresh
setTimeout(() => { tryFinishPendingProActivation(); }, 2500);

// Mark initial load as saved if we have data
try {
    const meta = JSON.parse(localStorage.getItem(STORAGE_META) || 'null');
    if (meta && meta.savedAt) lastSaveAt = meta.savedAt;
} catch (_) {}
if (!lastSaveAt) saveState();
updateSaveIndicator();

// Always expose PLAY — must work even if the code editor failed to load
window.startPlayMode = startPlayMode;
(function bindPlayButton() {
    const btn = document.getElementById('btn-start-play');
    if (!btn) return;
    btn.onclick = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        try {
            startPlayMode();
        } catch (err) {
            console.error(err);
            alert('PLAY failed: ' + (err && err.message ? err.message : err));
        }
    };
})();

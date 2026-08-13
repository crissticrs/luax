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

// + New Project — capture-phase so it always works even if later code fails
document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-action="new-project"]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    try {
        if (typeof window.promptNewProject === 'function') window.promptNewProject();
        else if (typeof promptNewProject === 'function') promptNewProject();
        else alert('App still loading — try again in a second.');
    } catch (err) {
        console.error(err);
        alert('New Project failed: ' + (err && err.message ? err.message : err));
    }
}, true);


// ============================================================
// NAV
// ============================================================
function switchView(id) {
    const guestOk = (typeof isGuestPlay === 'function' && isGuestPlay()) &&
        (id === 'play-view' || id === 'files-view' || id === 'login-view');
    if (!isAuthed() && !guestOk && id !== 'login-view') {
        applyAuthGate();
        return;
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ============================================================
// PROJECTS UI
// ============================================================
let selectedTemplate = 'empty';
function renderProjects() {
    try {
        const list = document.getElementById('projects-list');
        if (!list) return;
        list.innerHTML = '';
        const q = ((document.getElementById('project-search') || {}).value || '').trim().toLowerCase();
        let proj = (typeof projects !== 'undefined' && projects) ? projects : (window.projects || {});
        let names = [];
        try { names = Object.keys(proj).sort(); } catch (_) { names = []; }
        if (q) names = names.filter(function (n) { return n.toLowerCase().indexOf(q) >= 0; });

        if (!names.length) {
            const icon = (typeof LX_SVG !== 'undefined' && LX_SVG && LX_SVG.folderLg) ? LX_SVG.folderLg : '📁';
            list.innerHTML =
                '<div class="lx-empty" style="min-height:240px;padding:32px 20px">' +
                '<div class="item-icon-svg" style="width:80px;height:80px;margin-bottom:12px">' + icon + '</div>' +
                '<h3 style="color:var(--text-color,#e8e6f0)">' + (q ? 'No matches' : 'Your projects will appear here') + '</h3>' +
                '<p>' + (q ? 'Try a different search.' : 'Create or import your first project to get started.') + '</p>' +
                (!q
                    ? '<button type="button" class="btn btn-primary" data-action="new-project" id="lx-empty-new-btn">+ New Project</button>'
                    : '') +
                '</div>';
            const btn = document.getElementById('lx-empty-new-btn');
            if (btn) {
                btn.onclick = function (e) {
                    e.preventDefault();
                    try { promptNewProject(); } catch (err) { alert(String(err && err.message || err)); }
                };
            }
            return;
        }

        const folderIcon = (typeof LX_SVG !== 'undefined' && LX_SVG && LX_SVG.folder) ? LX_SVG.folder : '📁';
        const chevron = (typeof LX_SVG !== 'undefined' && LX_SVG && LX_SVG.chevron) ? LX_SVG.chevron : '›';
        const trash = (typeof LX_SVG !== 'undefined' && LX_SVG && LX_SVG.trash) ? LX_SVG.trash : '🗑';

        names.forEach(function (name) {
            const div = document.createElement('div');
            div.className = 'list-item';
            let gpOn = true;
            try { gpOn = getProjectGamepad(name); } catch (_) {}
            const safeName = (typeof escapeHtml === 'function') ? escapeHtml(name) : String(name).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
            const escName = (typeof esc === 'function') ? esc(name) : String(name).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            div.innerHTML =
                '<div class="item-title" data-open-project="' + safeName + '">' +
                '<span class="item-icon-svg">' + folderIcon + '</span>' +
                '<span>' + safeName + '</span>' +
                '<span class="item-badge">Lua</span></div>' +
                '<div class="item-actions">' +
                '<button type="button" class="btn-gamepad-emoji' + (gpOn ? '' : ' off') + '" data-gp="' + escName + '">🎮</button>' +
                '<button type="button" class="btn-icon-sm" data-rename="' + escName + '">✎</button>' +
                '<button type="button" class="btn-icon-sm" data-dup="' + escName + '">⧉</button>' +
                '<span class="item-chevron" data-open-project="' + safeName + '">' + chevron + '</span>' +
                '<button type="button" class="btn btn-delete" data-del="' + escName + '">' + trash + '</button>' +
                '</div>';
            // wire events without inline handlers (more reliable on mobile)
            div.querySelectorAll('[data-open-project]').forEach(function (el) {
                el.onclick = function () { openProject(name); };
            });
            const gpBtn = div.querySelector('[data-gp]');
            if (gpBtn) gpBtn.onclick = function (e) { e.stopPropagation(); try { toggleProjectGamepadFor(name); } catch (_) {} };
            const ren = div.querySelector('[data-rename]');
            if (ren) ren.onclick = function (e) { e.stopPropagation(); try { promptRenameProject(name); } catch (_) {} };
            const dup = div.querySelector('[data-dup]');
            if (dup) dup.onclick = function (e) { e.stopPropagation(); try { duplicateProject(name); } catch (_) {} };
            const del = div.querySelector('[data-del]');
            if (del) del.onclick = function (e) { e.stopPropagation(); try { deleteProject(e, name); } catch (_) {} };
            list.appendChild(div);
        });
    } catch (err) {
        console.error('renderProjects', err);
        const list = document.getElementById('projects-list');
        if (list) {
            list.innerHTML = '<div class="lx-empty" style="min-height:200px;padding:24px">' +
                '<h3 style="color:#fff">Could not load project list</h3>' +
                '<p style="opacity:0.8">' + String(err && err.message || err) + '</p>' +
                '<button type="button" class="btn btn-primary" id="lx-empty-new-btn">+ New Project</button></div>';
            const btn = document.getElementById('lx-empty-new-btn');
            if (btn) btn.onclick = function () { try { promptNewProject(); } catch (e2) { alert(String(e2)); } };
        }
    }
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
    try {
        // Remove prior overlay if any
        try {
            var old = document.getElementById('luax-new-project-overlay');
            if (old) old.remove();
        } catch (_) {}

        if (typeof TEMPLATES === 'undefined' || !TEMPLATES) {
            alert('Templates still loading. Wait a second and try again.');
            return;
        }
        if (typeof selectedTemplate === 'undefined' || !TEMPLATES[selectedTemplate]) {
            selectedTemplate = 'empty';
        }
        var keys = Object.keys(TEMPLATES);
        if (!keys.length) {
            alert('No templates available.');
            return;
        }

        var overlay = document.createElement('div');
        overlay.id = 'luax-new-project-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';

        var card = document.createElement('div');
        card.style.cssText = 'width:min(400px,100%);max-height:90vh;overflow:auto;background:var(--panel-color,#1a1625);color:var(--text-color,#e8e6f0);border-radius:16px;padding:20px;border:1px solid rgba(255,255,255,0.12);box-shadow:0 16px 48px rgba(0,0,0,0.5)';

        var h = document.createElement('h2');
        h.textContent = 'New Project';
        h.style.cssText = 'margin:0 0 12px;font-size:1.15rem';
        card.appendChild(h);

        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'lx-new-project-name';
        input.placeholder = 'Project name';
        input.autocomplete = 'off';
        input.style.cssText = 'width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#0f1115;color:#fff;font-size:1rem;margin-bottom:12px;box-sizing:border-box;outline:none';
        card.appendChild(input);

        var lab = document.createElement('div');
        lab.textContent = 'Template';
        lab.style.cssText = 'font-size:0.85rem;color:#888;margin-bottom:6px';
        card.appendChild(lab);

        var tplWrap = document.createElement('div');
        tplWrap.className = 'template-list';
        tplWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px';

        function markSelected() {
            Array.prototype.forEach.call(tplWrap.querySelectorAll('button'), function (b) {
                var on = b.getAttribute('data-tpl') === selectedTemplate;
                b.style.outline = on ? '2px solid var(--accent-color,#8b5cf6)' : 'none';
                b.style.opacity = on ? '1' : '0.75';
            });
        }

        keys.forEach(function (k) {
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-tpl', k);
            b.textContent = TEMPLATES[k].name || k;
            b.style.cssText = 'padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:inherit;cursor:pointer;font-size:0.85rem';
            b.onclick = function () {
                selectedTemplate = k;
                markSelected();
            };
            tplWrap.appendChild(b);
        });
        card.appendChild(tplWrap);
        markSelected();

        var mobile = (typeof isMobileDevice !== 'undefined') ? !!isMobileDevice : /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
        var gpCheck = null;
        if (mobile) {
            var gpLabel = document.createElement('label');
            gpLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:0.9rem;margin:8px 0;cursor:pointer';
            gpCheck = document.createElement('input');
            gpCheck.type = 'checkbox';
            gpCheck.checked = true;
            gpCheck.style.cssText = 'width:18px;height:18px';
            gpLabel.appendChild(gpCheck);
            gpLabel.appendChild(document.createTextNode('On-screen gamepad'));
            card.appendChild(gpLabel);
        } else {
            var d = document.createElement('div');
            d.textContent = 'Desktop: keyboard (WASD) + mouse';
            d.style.cssText = 'font-size:0.75rem;color:#666;margin:8px 0';
            card.appendChild(d);
        }

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;margin-top:14px';

        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.className = 'btn';
        cancel.style.cssText = 'flex:1;padding:12px;cursor:pointer';
        cancel.onclick = function () { try { overlay.remove(); } catch (_) {} };

        var create = document.createElement('button');
        create.type = 'button';
        create.textContent = 'Create';
        create.className = 'btn btn-primary';
        create.style.cssText = 'flex:1;padding:12px;cursor:pointer;font-weight:600;background:var(--accent-color,#8b5cf6);border:none;border-radius:8px;color:#fff';
        create.onclick = function () {
            try {
                var name = (input.value || '').trim();
                if (!name) { alert('Enter a name'); return; }
                var proj = (typeof projects !== 'undefined' && projects) ? projects : window.projects;
                if (!proj) { alert('Projects storage not ready'); return; }
                if (proj[name]) { alert('Already exists'); return; }
                var tpl = TEMPLATES[selectedTemplate] || TEMPLATES.empty || TEMPLATES[keys[0]];
                proj[name] = JSON.parse(JSON.stringify(tpl.files));
                if (typeof projects === 'undefined') window.projects = proj;
                if (typeof setProjectGamepad === 'function') {
                    setProjectGamepad(name, mobile ? !!(gpCheck && gpCheck.checked) : false);
                }
                if (typeof saveState === 'function') saveState();
                try { overlay.remove(); } catch (_) {}
                if (typeof renderProjects === 'function') renderProjects();
                if (typeof openProject === 'function') openProject(name);
            } catch (err) {
                console.error(err);
                alert('Create failed: ' + (err && err.message ? err.message : err));
            }
        };

        row.appendChild(cancel);
        row.appendChild(create);
        card.appendChild(row);
        overlay.appendChild(card);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) { try { overlay.remove(); } catch (_) {} }
        });
        document.body.appendChild(overlay);
        setTimeout(function () { try { input.focus(); } catch (_) {} }, 50);
    } catch (err) {
        console.error('promptNewProject', err);
        var name = window.prompt('New project name:');
        if (!name || !name.trim()) return;
        try {
            name = name.trim();
            if (projects[name]) return alert('Already exists');
            var tpl = TEMPLATES.empty || TEMPLATES[Object.keys(TEMPLATES)[0]];
            projects[name] = JSON.parse(JSON.stringify(tpl.files));
            if (typeof saveState === 'function') saveState();
            if (typeof renderProjects === 'function') renderProjects();
            if (typeof openProject === 'function') openProject(name);
        } catch (err2) {
            alert('Could not create project: ' + (err2 && err2.message ? err2.message : err2));
        }
    }
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
    const guest = (typeof isGuestPlay === 'function' && isGuestPlay());
    if (!isAuthed() && !guest) { applyAuthGate(); return; }
    currentProjectName = name;
    const title = document.getElementById('current-project-title');
    if (title) title.textContent = name;
    try { renderFiles(); } catch (_) {}
    try { updateGamepadToggleUI(); } catch (_) {}
    if (guest && window.luaxSharePending) {
        return;
    }
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

    // Accept larger source files — we compress before storing
    if (file.size > 8 * 1024 * 1024) {
        alert('Image too large (max 8 MB source file).');
        ev.target.value = '';
        return;
    }

    let name = file.name || 'sprite.png';
    name = name.replace(/[^\w.\-]+/g, '_');
    // Normalize extension after possible WebP re-encode
    const map = getProjectAssetMap(currentProjectName);
    if (map[name] && !confirm('Replace existing "' + name + '"?')) {
        ev.target.value = '';
        return;
    }

    const inputEl = ev.target;
    compressImageFile(file, { maxDim: 512, pixelArt: true })
        .then((result) => {
            // If we switched to WebP and the filename still says .png, keep the name
            // (gfx.sprite looks up by the stored key, not by MIME).
            map[name] = result.dataUrl;
            delete spriteImageCache[currentProjectName + '::' + name];
            if (!saveProjectAssets()) {
                delete map[name];
                inputEl.value = '';
                return;
            }
            renderFiles();
            const sizeKb = Math.max(1, Math.round((result.bytesApprox || 0) / 1024));
            let msg = 'Imported "' + name + '" (' + result.width + '×' + result.height +
                ', ~' + sizeKb + ' KB' + (result.format === 'webp' ? ', WebP' : '') + ').';
            if (result.scaled) {
                msg += '\n\nResized from ' + result.origWidth + '×' + result.origHeight +
                    ' (max side 512 for game sprites).';
            }
            msg += '\n\nIn Lua: gfx.sprite("' + name + '", x, y)';
            alert(msg);
            inputEl.value = '';
        })
        .catch((err) => {
            console.warn('sprite import failed', err);
            alert('Import failed: ' + (err && err.message ? err.message : err));
            inputEl.value = '';
        });
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
    try {
        if (typeof tryLoadSharedPlay === 'function') tryLoadSharedPlay();
    } catch (err) {
        console.warn('share boot', err);
    }
}, 200);
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

// Retry project list after storage/auth settle (mobile often races)
setTimeout(function () {
    try {
        if (typeof isAuthed === 'function' && isAuthed() && typeof renderProjects === 'function') {
            renderProjects();
        }
    } catch (e) { console.warn('boot renderProjects', e); }
}, 500);
setTimeout(function () {
    try {
        if (typeof isAuthed === 'function' && isAuthed() && typeof renderProjects === 'function') {
            renderProjects();
        }
    } catch (e) {}
}, 1500);


// Early global bindings (Safari: free vars from other files need window.*)
window.renderProjects = window.renderProjects || function () {};
window.promptNewProject = window.promptNewProject || function () {
    alert('App still loading — try again in a second.');
};

// src/app-shell.js — app shell: navigation, projects UI, themes, file list, boot
// Self-hosted on Cloudflare Pages (luax.pages.dev). Do not load from GitHub CDN.

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

function switchView(id) {
    const guestOk = (typeof isGuestPlay === 'function' && isGuestPlay()) &&
        (id === 'play-view' || id === 'files-view' || id === 'login-view');
    if (!isAuthed() && !guestOk && id !== 'login-view') {
        applyAuthGate();
        return;
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

let selectedTemplate = 'empty';

function countProjectFiles(projectName) {
    if (!projectName) return 0;
    let n = 0;
    try {
        const proj = (typeof projects !== 'undefined' && projects) ? projects : (window.projects || {});
        const files = proj[projectName];
        if (files && typeof files === 'object') n += Object.keys(files).length;
    } catch (_) {}
    try {
        let amap = {};
        if (typeof getProjectAssetMap === 'function') amap = getProjectAssetMap(projectName) || {};
        else {
            const raw = localStorage.getItem('luadeck_project_assets');
            const all = raw ? JSON.parse(raw) : {};
            amap = (all && all[projectName]) || {};
        }
        n += Object.keys(amap || {}).length;
    } catch (_) {}
    try {
        let mmap = {};
        if (typeof getProjectMusicMap === 'function') mmap = getProjectMusicMap(projectName) || {};
        else {
            const raw = localStorage.getItem('luadeck_project_music');
            const all = raw ? JSON.parse(raw) : {};
            mmap = (all && all[projectName]) || {};
        }
        n += Object.keys(mmap || {}).length;
    } catch (_) {}
    try {
        if (typeof getProjectSceneMap === 'function') {
            n += Object.keys(getProjectSceneMap(projectName) || {}).length;
        } else {
            const raw = localStorage.getItem('luax_project_scenes');
            const all = raw ? JSON.parse(raw) : {};
            n += Object.keys((all && all[projectName]) || {}).length;
        }
    } catch (_) {}
    return n;
}
window.countProjectFiles = countProjectFiles;

function renderProjects() {
    window.renderProjects = renderProjects;
    try {
        const list = document.getElementById('projects-list');
        if (!list) return;
        list.innerHTML = '';
        const q = ((document.getElementById('project-search') || {}).value || '').trim().toLowerCase();
        let proj = (typeof projects !== 'undefined' && projects) ? projects : (window.projects || {});
        let names = [];
        try { names = Object.keys(proj).sort(); } catch (_) { names = []; }
        if (q) names = names.filter(function (n) { return n.toLowerCase().indexOf(q) >= 0; });

        // Keep pinned projects first when available
        try {
            const pinned = (typeof loadPinnedProjects === 'function')
                ? loadPinnedProjects()
                : (JSON.parse(localStorage.getItem('luax_pinned_projects') || '[]') || []);
            if (Array.isArray(pinned) && pinned.length) {
                const set = {};
                pinned.forEach(function (n) { set[n] = true; });
                const top = pinned.filter(function (n) { return names.indexOf(n) >= 0; });
                const rest = names.filter(function (n) { return !set[n]; });
                names = top.concat(rest);
            }
        } catch (_) {}

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
        const chevronIcon = (typeof LX_SVG !== 'undefined' && LX_SVG && LX_SVG.chevronRight) ? LX_SVG.chevronRight : '›';
        names.forEach(function (name) {
            const fileCount = countProjectFiles(name);
            let pinned = false;
            try {
                pinned = (typeof isProjectPinned === 'function')
                    ? isProjectPinned(name)
                    : ((JSON.parse(localStorage.getItem('luax_pinned_projects') || '[]') || []).indexOf(name) >= 0);
            } catch (_) {}
            let gpOn = true;
            try {
                if (typeof getProjectGamepad === 'function') gpOn = getProjectGamepad(name);
            } catch (_) {}

            const div = document.createElement('div');
            div.className = 'list-item';
            div.setAttribute('data-name', name);
            div.setAttribute('data-rename', name);
            div.setAttribute('data-gp', name);
            // Structure expected by swipe-list enhancer
            // Pin once, right after the name (before the file-count badge)
            div.innerHTML =
                '<div class="item-title">' +
                    '<span class="item-icon-svg">' + folderIcon + '</span>' +
                    '<span class="item-name">' + escapeHtml(name) + '</span>' +
                    (pinned ? '<span class="item-pin-badge" title="Pinned">📌</span>' : '') +
                    (fileCount ? '<span class="item-badge" title="Files">' + fileCount + '</span>' : '') +
                '</div>' +
                '<span class="item-chevron">' + chevronIcon + '</span>';
            // Hidden data hooks for swipe / context menu (not visible)
            div.setAttribute('data-gp-on', gpOn ? '1' : '0');
            div.addEventListener('click', function (e) {
                if (e.target.closest && e.target.closest('.item-actions, button, .swipe-action, .lx-ctx-menu')) return;
                try { openProject(name); } catch (_) {}
            });
            list.appendChild(div);
        });
    } catch (err) {
        console.error('renderProjects', err);
    }
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// NOTE: esc() lives in storage.js (full JS-string + HTML-attribute escaping).
// A weaker duplicate used to be declared here and overwrote it at load time.

function lxNav(name) {
    document.querySelectorAll('.lx-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('panel-' + name);
    if (panel) panel.classList.add('active');
    document.querySelectorAll('.lx-tab, .lx-side-item').forEach(b => {
        b.classList.toggle('active', b.dataset.nav === name);
    });
    if (name === 'templates') renderTemplatesPanel();
    if (name === 'settings') {
        try { renderThemeGrid(); } catch (_) {}
        try { renderBillingPanel(); } catch (_) {}
    }
    const sr = document.querySelector('.lx-search-row');
    if (sr) sr.style.display = name === 'projects' ? '' : 'none';
}

/** Desktop sidebar create shortcuts (Music / Scene / Draw / Import). Mobile unchanged. */
async function lxDesktopCreate(kind) {
    try {
        window._luaxForcePickProject = true;
        window._luaxCreateTargetProject = null;

        if (kind === 'import') {
            window._luaxForcePickProject = false;
            if (typeof importProject === 'function') importProject();
            return;
        }

        // Ask for project first so save always has a clear destination
        const proj = (typeof lxResolveSaveProject === 'function')
            ? await lxResolveSaveProject(
                kind === 'music' ? 'New music' : kind === 'draw' ? 'New image' : 'New scene',
                'Choose which project this will belong to:'
            )
            : currentProjectName;
        if (!proj) return;
        currentProjectName = proj;
        window.currentProjectName = proj;
        window._luaxForcePickProject = false; // already chosen
        window._luaxCreateTargetProject = proj;

        if (kind === 'music') {
            if (typeof openMusicEditor === 'function') openMusicEditor();
            else if (typeof lxAlert === 'function') lxAlert('Music editor is still loading…');
            return;
        }
        if (kind === 'draw') {
            if (typeof openSpriteEditor === 'function') openSpriteEditor();
            else if (typeof lxAlert === 'function') lxAlert('Image editor is still loading…');
            return;
        }
        if (kind === 'scene') {
            if (typeof window.promptNewScene === 'function') window.promptNewScene();
            else if (typeof openSceneEditor === 'function') openSceneEditor('', true);
            else if (typeof lxAlert === 'function') lxAlert('Scene editor is still loading…');
            return;
        }
    } catch (err) {
        console.warn('lxDesktopCreate', err);
        if (typeof lxAlert === 'function') lxAlert(String(err && err.message || err));
    }
}
window.lxDesktopCreate = lxDesktopCreate;

/** Resolve target project for a standalone create (always pick when forced or multiple projects). */
async function lxResolveSaveProject(title, message) {
    const force = !!window._luaxForcePickProject;
    const names = Object.keys(
        (typeof projects !== 'undefined' && projects) ? projects : (window.projects || {})
    );
    if (!names.length) {
        if (typeof lxAlert === 'function') {
            await lxAlert('You have no projects yet. Create a project first, then save again.', 'No projects');
        } else {
            alert('Create a project first');
        }
        return null;
    }
    // Sidebar create always forces a pick. From inside a project with one target, skip.
    const needPick = force || !currentProjectName || (names.length > 1 && force !== false && window._luaxForcePickProject);
    if (!force && currentProjectName && names.length === 1) return currentProjectName;
    if (!force && currentProjectName && names.length > 1 && !window._luaxForcePickProject) {
        // Editing inside an open project — save there
        return currentProjectName;
    }

    if (typeof lxPickProject === 'function') {
        const proj = await lxPickProject(title || 'Save to project', message || 'Choose which project to save into:');
        if (proj) {
            window._luaxForcePickProject = false;
            return proj;
        }
        return null;
    }
    return currentProjectName || names[0] || null;
}
window.lxResolveSaveProject = lxResolveSaveProject;

const FREE_PROJECT_LIMIT = 5;

function countProjects() {
    try {
        const proj = (typeof projects !== 'undefined' && projects) ? projects : (window.projects || {});
        return Object.keys(proj || {}).length;
    } catch (_) { return 0; }
}

function canCreateProject() {
    try {
        if (typeof isPro === 'function' && isPro()) return true;
    } catch (_) {}
    return countProjects() < FREE_PROJECT_LIMIT;
}

function promptNewProject() {
    window.promptNewProject = promptNewProject;
    try {
        if (!canCreateProject()) {
            alert(
                'Free plan is limited to ' + FREE_PROJECT_LIMIT + ' projects.\n\n' +
                'Upgrade to Pro for unlimited projects (and more weekly credits).'
            );
            try {
                if (typeof lxNav === 'function') lxNav('settings');
                else if (typeof switchView === 'function') switchView('projects-view');
            } catch (_) {}
            return;
        }
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
        var name = prompt('Project name:', 'My Game');
        if (!name) return;
        name = String(name).trim();
        if (!name) return;
        if (typeof projects === 'undefined') window.projects = window.projects || {};
        if (projects[name]) {
            alert('A project with that name already exists');
            return;
        }
        var tpl = TEMPLATES[selectedTemplate] || TEMPLATES.empty || { files: { 'main.lua': '-- main.lua\n' } };
        projects[name] = JSON.parse(JSON.stringify(tpl.files || { 'main.lua': '-- main.lua\n' }));
        try { if (typeof saveState === 'function') saveState(); } catch (_) {}
        renderProjects();
        openProject(name);
    } catch (err) {
        console.error(err);
        alert('Could not create project: ' + (err && err.message ? err.message : err));
    }
}

function promptNewProjectFromTemplate(k) {
    selectedTemplate = k;
    promptNewProject();
}

function selectTemplate(k) { selectedTemplate = k; }

function openProject(name) {
    const guest = (typeof isGuestPlay === 'function' && isGuestPlay());
    if (!isAuthed() && !guest) { applyAuthGate(); return; }
    try {
        currentProjectName = name;
        window.currentProjectName = name;
        const t = document.getElementById('current-project-title');
        if (t) t.textContent = name;
        if (typeof renderFiles === 'function') renderFiles();
        switchView('files-view');
    } catch (err) {
        console.error(err);
        alert('Could not open project');
    }
}

function renderTemplatesPanel() {
    const el = document.getElementById('templates-list');
    if (!el || typeof TEMPLATES === 'undefined') return;
    el.innerHTML = '<h2 class="lx-section-title">Start from a template</h2>' +
        Object.keys(TEMPLATES).map(k =>
            '<div class="tpl-card" onclick="selectedTemplate=\'' + k + '\'; promptNewProjectFromTemplate(\'' + k + '\')">' +
            '<h3>' + (TEMPLATES[k].name || k) + '</h3>' +
            '<p>Tap to create a new project with this template</p></div>'
        ).join('');
}


function refreshProjectFileBadge(projectName) {
    try {
        const name = projectName || currentProjectName || window.currentProjectName;
        if (!name) return;
        const count = countProjectFiles(name);
        const list = document.getElementById('projects-list');
        if (!list) return;
        const items = list.querySelectorAll('.list-item, .swipe-row');
        items.forEach(function (el) {
            const n = el.getAttribute('data-name') || (el.dataset && el.dataset.name) || '';
            if (n !== name) return;
            let badge = el.querySelector('.item-badge');
            const title = el.querySelector('.item-title');
            if (count <= 0) {
                if (badge) badge.remove();
                return;
            }
            if (badge) {
                badge.textContent = String(count);
                badge.title = 'Files';
            } else if (title) {
                const span = document.createElement('span');
                span.className = 'item-badge';
                span.title = 'Files';
                span.textContent = String(count);
                title.appendChild(span);
            }
        });
    } catch (_) {}
}
window.refreshProjectFileBadge = refreshProjectFileBadge;

function renderFiles() {
    const list = document.getElementById('files-list');
    if (!list || !currentProjectName) return;
    let proj = (typeof projects !== 'undefined' && projects) ? projects : (window.projects || {});
    const fileMap = proj[currentProjectName] || {};
    let luaFiles = Object.keys(fileMap).sort();

    // Sprites / images (merge memory + localStorage so saves always show up)
    let spriteNames = [];
    try {
        let amap = {};
        try {
            if (typeof getProjectAssetMap === 'function') amap = getProjectAssetMap(currentProjectName) || {};
            else if (typeof projectAssets !== 'undefined' && projectAssets[currentProjectName]) amap = projectAssets[currentProjectName];
        } catch (_) {}
        try {
            const raw = localStorage.getItem('luadeck_project_assets');
            const all = raw ? JSON.parse(raw) : {};
            const fromDisk = (all && all[currentProjectName]) || {};
            amap = Object.assign({}, fromDisk, amap || {});
            // Keep in-memory map in sync
            if (typeof projectAssets === 'undefined' || !projectAssets) {
                try { projectAssets = all || {}; } catch (__) {}
            }
            if (typeof projectAssets !== 'undefined') {
                projectAssets[currentProjectName] = amap;
                window.projectAssets = projectAssets;
            }
        } catch (_) {}
        spriteNames = Object.keys(amap || {}).sort();
    } catch (_) {}

    // Music patterns (same merge)
    let musicNames = [];
    try {
        let mmap = {};
        try {
            if (typeof getProjectMusicMap === 'function') mmap = getProjectMusicMap(currentProjectName) || {};
            else if (typeof projectMusic !== 'undefined' && projectMusic[currentProjectName]) mmap = projectMusic[currentProjectName];
        } catch (_) {}
        try {
            const raw = localStorage.getItem('luadeck_project_music');
            const all = raw ? JSON.parse(raw) : {};
            const fromDisk = (all && all[currentProjectName]) || {};
            mmap = Object.assign({}, fromDisk, mmap || {});
            if (typeof projectMusic !== 'undefined') {
                projectMusic[currentProjectName] = mmap;
                window.projectMusic = projectMusic;
            }
        } catch (_) {}
        musicNames = Object.keys(mmap || {}).sort();
    } catch (_) {}

    // Scenes
    let sceneNames = [];
    try {
        if (typeof getProjectSceneMap === 'function') {
            sceneNames = Object.keys(getProjectSceneMap(currentProjectName) || {}).sort();
        } else {
            const raw = localStorage.getItem('luax_project_scenes');
            const all = raw ? JSON.parse(raw) : {};
            sceneNames = Object.keys((all && all[currentProjectName]) || {}).sort();
        }
    } catch (_) {}

    // Prefer pinned order for lua files
    try {
        const map = JSON.parse(localStorage.getItem('luax_pinned_files') || '{}') || {};
        const pinned = Array.isArray(map[currentProjectName]) ? map[currentProjectName] : [];
        if (pinned.length) {
            const set = {};
            pinned.forEach(function (n) { set[n] = true; });
            const top = pinned.filter(function (n) { return luaFiles.indexOf(n) >= 0; });
            const rest = luaFiles.filter(function (n) { return !set[n]; });
            luaFiles = top.concat(rest);
        }
    } catch (_) {}

    const total = luaFiles.length + spriteNames.length + musicNames.length + sceneNames.length;
    if (!total) {
        list.innerHTML =
            '<div class="lx-empty" style="min-height:160px;padding:24px 16px">' +
            '<h3 style="color:var(--text-color,#e8e6f0)">No files yet</h3>' +
            '<p>Create a Lua file, draw a sprite, or compose music.</p>' +
            '</div>';
        return;
    }

    const luaIcon = (typeof LX_SVG !== 'undefined' && LX_SVG && LX_SVG.file) ? LX_SVG.file : '📄';
    const imgIcon = (typeof LX_SVG !== 'undefined' && LX_SVG && LX_SVG.image) ? LX_SVG.image : '🖼';
    const musIcon = (typeof LX_SVG !== 'undefined' && LX_SVG && LX_SVG.music) ? LX_SVG.music : '🎵';
    const scnIcon = (typeof LX_SVG !== 'undefined' && LX_SVG && LX_SVG.scene) ? LX_SVG.scene : '🗺';

    let html = '';

    luaFiles.forEach(function (fn) {
        const isMain = fn === 'main.lua';
        html +=
            '<div class="list-item" data-name="' + escapeHtml(fn) + '" data-kind="file" onclick="openFile(\'' + esc(fn) + '\')">' +
            '<div class="item-title">' +
                '<span class="item-icon-svg">' + luaIcon + '</span>' +
                '<span class="item-name">' + escapeHtml(fn) + '</span>' +
                (isMain ? '<span class="item-badge">MAIN</span>' : '<span class="item-badge">LUA</span>') +
            '</div></div>';
    });

    spriteNames.forEach(function (fn) {
        html +=
            '<div class="list-item" data-name="' + escapeHtml(fn) + '" data-kind="sprite" onclick="openSpriteEditor(\'' + esc(fn) + '\')">' +
            '<div class="item-title">' +
                '<span class="item-icon-svg">' + imgIcon + '</span>' +
                '<span class="item-name">' + escapeHtml(fn) + '</span>' +
                '<span class="item-badge">IMG</span>' +
            '</div></div>';
    });

    musicNames.forEach(function (fn) {
        html +=
            '<div class="list-item" data-name="' + escapeHtml(fn) + '" data-kind="music" onclick="openMusicEditor(\'' + esc(fn) + '\')">' +
            '<div class="item-title">' +
                '<span class="item-icon-svg">' + musIcon + '</span>' +
                '<span class="item-name">' + escapeHtml(fn) + '</span>' +
                '<span class="item-badge">MUSIC</span>' +
            '</div></div>';
    });

    sceneNames.forEach(function (fn) {
        html +=
            '<div class="list-item" data-name="' + escapeHtml(fn) + '" data-kind="scene" data-scene="' + escapeHtml(fn) + '" onclick="openSceneEditor(\'' + esc(fn) + '\', false)">' +
            '<div class="item-title">' +
                '<span class="item-icon-svg">' + scnIcon + '</span>' +
                '<span class="item-name">' + escapeHtml(fn) + '</span>' +
                '<span class="item-badge">SCENE</span>' +
            '</div></div>';
    });

    list.innerHTML = html;
    try { refreshProjectFileBadge(currentProjectName); } catch (_) {}
}

/* ---- Project / file management (used by swipe actions & desktop buttons) ---- */
async function deleteProject(e, name) {
    if (e && e.stopPropagation) e.stopPropagation();
    name = name || (e && e.currentTarget && e.currentTarget.getAttribute('data-name'));
    if (!name) return;
    const ok = (typeof lxConfirm === 'function')
        ? await lxConfirm(
            'Delete project "' + name + '"? This cannot be undone.',
            'Delete project',
            { confirmLabel: 'Delete', danger: true }
        )
        : confirm('Delete project "' + name + '"? This cannot be undone.');
    if (!ok) return;
    try {
        let proj = (typeof projects !== 'undefined' && projects) ? projects : (window.projects || {});
        delete proj[name];
        if (typeof projects !== 'undefined') projects = proj;
        window.projects = proj;
        try {
            const pinned = JSON.parse(localStorage.getItem('luax_pinned_projects') || '[]') || [];
            const i = pinned.indexOf(name);
            if (i >= 0) {
                pinned.splice(i, 1);
                localStorage.setItem('luax_pinned_projects', JSON.stringify(pinned));
            }
        } catch (_) {}
        if (typeof currentProjectName !== 'undefined' && currentProjectName === name) {
            currentProjectName = null;
            window.currentProjectName = null;
        }
        // Purge sprites / music / scenes keyed by this project name
        try {
            if (typeof projectAssets === 'undefined' || !projectAssets) {
                projectAssets = JSON.parse(localStorage.getItem('luadeck_project_assets') || '{}') || {};
            }
            if (projectAssets[name]) {
                delete projectAssets[name];
                window.projectAssets = projectAssets;
                localStorage.setItem('luadeck_project_assets', JSON.stringify(projectAssets));
            }
        } catch (e) { console.warn('purge assets', e); }
        try {
            if (typeof projectMusic === 'undefined' || !projectMusic) {
                projectMusic = JSON.parse(localStorage.getItem('luadeck_project_music') || '{}') || {};
            }
            if (projectMusic[name]) {
                delete projectMusic[name];
                window.projectMusic = projectMusic;
                localStorage.setItem('luadeck_project_music', JSON.stringify(projectMusic));
            }
        } catch (e) { console.warn('purge music', e); }
        try {
            const raw = localStorage.getItem('luax_project_scenes');
            const all = raw ? JSON.parse(raw) : {};
            if (all && all[name]) {
                delete all[name];
                localStorage.setItem('luax_project_scenes', JSON.stringify(all));
            }
        } catch (e) { console.warn('purge scenes', e); }
        try {
            const meta = JSON.parse(localStorage.getItem('luax_project_meta') || '{}') || {};
            if (meta[name]) {
                delete meta[name];
                localStorage.setItem('luax_project_meta', JSON.stringify(meta));
            }
        } catch (_) {}
        if (typeof saveState === 'function') saveState();
        if (typeof renderProjects === 'function') renderProjects();
        try { switchView('projects-view'); } catch (_) {}
    } catch (err) {
        console.error('deleteProject', err);
        if (typeof lxAlert === 'function') lxAlert('Could not delete project');
        else alert('Could not delete project');
    }
}

async function promptRenameProject(name) {
    if (!name) return;
    const next = (typeof lxPrompt === 'function')
        ? await lxPrompt('New name for this project:', name, 'Rename project', { confirmLabel: 'Rename' })
        : prompt('Rename project:', name);
    if (next == null) return;
    const newName = String(next).trim();
    if (!newName || newName === name) return;
    try {
        let proj = (typeof projects !== 'undefined' && projects) ? projects : (window.projects || {});
        if (proj[newName]) {
            if (typeof lxAlert === 'function') lxAlert('A project named "' + newName + '" already exists.');
            else alert('A project named "' + newName + '" already exists.');
            return;
        }
        proj[newName] = proj[name];
        delete proj[name];
        if (typeof projects !== 'undefined') projects = proj;
        window.projects = proj;
        try {
            const pinned = JSON.parse(localStorage.getItem('luax_pinned_projects') || '[]') || [];
            const i = pinned.indexOf(name);
            if (i >= 0) {
                pinned[i] = newName;
                localStorage.setItem('luax_pinned_projects', JSON.stringify(pinned));
            }
        } catch (_) {}
        try {
            if (typeof getProjectGamepad === 'function' && typeof setProjectGamepad === 'function') {
                setProjectGamepad(newName, getProjectGamepad(name));
            }
        } catch (_) {}
        if (typeof currentProjectName !== 'undefined' && currentProjectName === name) {
            currentProjectName = newName;
            window.currentProjectName = newName;
            const t = document.getElementById('current-project-title');
            if (t) t.textContent = newName;
        }
        if (typeof saveState === 'function') saveState();
        if (typeof renderProjects === 'function') renderProjects();
    } catch (err) {
        console.error('promptRenameProject', err);
        if (typeof lxAlert === 'function') lxAlert('Could not rename project');
        else alert('Could not rename project');
    }
}

function duplicateProject(name) {
    if (!name) return;
    try {
        if (!canCreateProject()) {
            alert(
                'Free plan is limited to ' + FREE_PROJECT_LIMIT + ' projects.\n\n' +
                'Delete a project or upgrade to Pro for unlimited projects.'
            );
            return;
        }
        let proj = (typeof projects !== 'undefined' && projects) ? projects : (window.projects || {});
        if (!proj[name]) return;
        let base = name + ' copy';
        let newName = base;
        let n = 2;
        while (proj[newName]) {
            newName = base + ' ' + n;
            n++;
        }
        proj[newName] = JSON.parse(JSON.stringify(proj[name]));
        if (typeof projects !== 'undefined') projects = proj;
        window.projects = proj;
        try {
            if (typeof getProjectGamepad === 'function' && typeof setProjectGamepad === 'function') {
                setProjectGamepad(newName, getProjectGamepad(name));
            }
        } catch (_) {}
        if (typeof saveState === 'function') saveState();
        if (typeof renderProjects === 'function') renderProjects();
    } catch (err) {
        console.error('duplicateProject', err);
        alert('Could not duplicate project');
    }
}

async function promptRenameFile(name) {
    if (!name || !currentProjectName) return;
    if (name === 'main.lua') {
        if (typeof lxAlert === 'function') lxAlert('main.lua cannot be renamed.');
        else alert('main.lua cannot be renamed.');
        return;
    }
    const next = (typeof lxPrompt === 'function')
        ? await lxPrompt('New filename:', name, 'Rename file', { confirmLabel: 'Rename' })
        : prompt('Rename file:', name);
    if (next == null) return;
    let newName = String(next).trim();
    if (!newName || newName === name) return;
    if (!/\.lua$/i.test(newName)) newName += '.lua';
    try {
        const files = projects[currentProjectName];
        if (!files) return;
        if (files[newName]) {
            alert('A file named "' + newName + '" already exists.');
            return;
        }
        files[newName] = files[name];
        delete files[name];
        if (typeof saveState === 'function') saveState();
        if (typeof renderFiles === 'function') renderFiles();
    } catch (err) {
        console.error('promptRenameFile', err);
        alert('Could not rename file');
    }
}

window.deleteProject = deleteProject;
window.promptRenameProject = promptRenameProject;
window.duplicateProject = duplicateProject;
window.promptRenameFile = promptRenameFile;

const THEMES = [
    { id: 'purple', name: 'Purple', colors: ['#8b5cf6', '#16131f', '#0c0a12'] },
    { id: 'blue', name: 'Blue Ocean', colors: ['#3b82f6', '#0d1520', '#070d14'] },
    { id: 'green', name: 'Green Forest', colors: ['#22c55e', '#0d1810', '#070f0a'] },
    { id: 'amber', name: 'Amber Sunset', colors: ['#f59e0b', '#1a140e', '#100c08'] },
    { id: 'teal', name: 'Teal Cyber', colors: ['#14b8a6', '#0c1a1c', '#061012'] },
    { id: 'rose', name: 'Rose Soft', colors: ['#f43f5e', '#1a1014', '#10080c'] },
];

function applyTheme(id) {
    const t = THEMES.find(x => x.id === id) || THEMES[0];
    document.documentElement.setAttribute('data-theme', t.id);
    try { localStorage.setItem('luax_theme', t.id); } catch (_) {}
}

function renderThemeGrid() {
    const el = document.getElementById('theme-grid');
    if (!el) return;
    let cur = 'purple';
    try { cur = localStorage.getItem('luax_theme') || 'purple'; } catch (_) {}
    el.innerHTML = THEMES.map(function (t) {
        const c0 = t.colors[0] || '#8b5cf6';
        const c1 = t.colors[1] || '#16131f';
        const c2 = t.colors[2] || '#0c0a12';
        return (
            '<button type="button" class="theme-card' + (t.id === cur ? ' active' : '') + '" ' +
            'onclick="applyTheme(\'' + t.id + '\'); renderThemeGrid()" aria-pressed="' + (t.id === cur ? 'true' : 'false') + '">' +
            '<span class="theme-swatch" aria-hidden="true">' +
            '<i style="background:' + c0 + '"></i>' +
            '<i style="background:' + c1 + '"></i>' +
            '<i style="background:' + c2 + '"></i>' +
            '</span>' +
            '<span class="theme-card-name">' + t.name + '</span>' +
            '</button>'
        );
    }).join('');
}

function hydrateIcons(root) {
    try {
        if (typeof LX_SVG === 'undefined') return;
        (root || document).querySelectorAll('[data-ico]').forEach(el => {
            const k = el.getAttribute('data-ico');
            if (k && LX_SVG[k]) el.innerHTML = LX_SVG[k];
        });
    } catch (_) {}
}

// boot
try {
    applyTheme(localStorage.getItem('luax_theme') || 'purple');
} catch (_) {
    applyTheme('purple');
}
hydrateIcons(document);
try {
    const pr = localStorage.getItem(typeof PROFILE_STORAGE_KEY !== 'undefined' ? PROFILE_STORAGE_KEY : 'luadeck_google_profile');
    if (pr && typeof googleProfile !== 'undefined') googleProfile = JSON.parse(pr);
} catch (_) {}
try { if (typeof loadPersistedGoogleToken === 'function') loadPersistedGoogleToken(); } catch (_) {}
try { if (typeof handleStripeReturn === 'function') handleStripeReturn(); } catch (_) {}
try { if (typeof tryRestoreGoogleSession === 'function') tryRestoreGoogleSession(); } catch (_) {}
try { if (typeof applyAuthGate === 'function') applyAuthGate(); } catch (_) {}
try { if (typeof tryFinishPendingProActivation === 'function') tryFinishPendingProActivation(); } catch (_) {}
setTimeout(() => {
    try { if (typeof tryFinishPendingProActivation === 'function') tryFinishPendingProActivation(); } catch (_) {}
    try { if (typeof verifySubscriptionOnAccess === 'function') verifySubscriptionOnAccess().catch(() => {}); } catch (_) {}
    try { if (typeof updateProfileUI === 'function') updateProfileUI(); } catch (_) {}
    try { if (typeof tryLoadSharedPlay === 'function') tryLoadSharedPlay(); } catch (_) {}
}, 200);
setTimeout(() => { try { if (typeof tryFinishPendingProActivation === 'function') tryFinishPendingProActivation(); } catch (_) {} }, 2500);

try {
    const meta = JSON.parse(localStorage.getItem(typeof STORAGE_META !== 'undefined' ? STORAGE_META : 'luadeck_meta') || 'null');
    if (meta && meta.savedAt && typeof lastSaveAt !== 'undefined') lastSaveAt = meta.savedAt;
} catch (_) {}
try { if (typeof lastSaveAt !== 'undefined' && !lastSaveAt && typeof saveState === 'function') saveState(); } catch (_) {}

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

window.renderProjects = renderProjects;
window.promptNewProject = promptNewProject;
window.promptNewProjectFromTemplate = promptNewProjectFromTemplate;
window.selectTemplate = selectTemplate;
window.openProject = openProject;
window.switchView = switchView;
window.lxNav = lxNav;
window.applyTheme = applyTheme;
window.renderThemeGrid = renderThemeGrid;
window.renderFiles = renderFiles;

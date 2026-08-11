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

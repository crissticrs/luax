// src/swipe-list.js — WhatsApp-style swipe on project/file rows
// Swipe right → pin / gamepad · Swipe left → rename / delete

const SWIPE_THRESHOLD = 36;
const SWIPE_OPEN_PX = 72;
const SWIPE_MAX_LEFT = 220;
const SWIPE_MAX_RIGHT = 160;
const PINNED_PROJECTS_KEY = 'luax_pinned_projects';
const PINNED_FILES_KEY = 'luax_pinned_files';

let swipeActiveRow = null;
let swipeStartX = 0, swipeStartY = 0, swipeStartTx = 0;
let swipeTracking = false, swipeAxis = null, swipeMoved = false;
let swipeLastX = 0, swipeLastT = 0, swipeVelocity = 0;
let swipeIsTouch = false;

function loadPinnedProjects() {
    try {
        const arr = JSON.parse(localStorage.getItem(PINNED_PROJECTS_KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
}
function savePinnedProjects(list) {
    try { localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify(list)); } catch (_) {}
}
function isProjectPinned(name) {
    return loadPinnedProjects().indexOf(name) >= 0;
}
function toggleProjectPin(name) {
    const list = loadPinnedProjects();
    const i = list.indexOf(name);
    if (i >= 0) list.splice(i, 1);
    else list.unshift(name);
    savePinnedProjects(list);
    try { if (typeof renderProjects === 'function') renderProjects(); } catch (_) {}
}

function loadPinnedFilesMap() {
    try {
        const o = JSON.parse(localStorage.getItem(PINNED_FILES_KEY) || '{}');
        return o && typeof o === 'object' ? o : {};
    } catch (_) { return {}; }
}
function savePinnedFilesMap(map) {
    try { localStorage.setItem(PINNED_FILES_KEY, JSON.stringify(map)); } catch (_) {}
}
function currentProjectName() {
    try {
        if (typeof currentProject !== 'undefined' && currentProject) return currentProject;
        if (window.currentProject) return window.currentProject;
    } catch (_) {}
    return '';
}
function isFilePinned(fileName) {
    const proj = currentProjectName();
    if (!proj) return false;
    const map = loadPinnedFilesMap();
    const arr = map[proj];
    return Array.isArray(arr) && arr.indexOf(fileName) >= 0;
}
function toggleFilePin(fileName) {
    const proj = currentProjectName();
    if (!proj || !fileName) return;
    const map = loadPinnedFilesMap();
    const arr = Array.isArray(map[proj]) ? map[proj].slice() : [];
    const i = arr.indexOf(fileName);
    if (i >= 0) arr.splice(i, 1);
    else arr.unshift(fileName);
    map[proj] = arr;
    savePinnedFilesMap(map);
    try { if (typeof renderFiles === 'function') renderFiles(); } catch (_) {}
}

function closeAllSwipeRows(except) {
    document.querySelectorAll('.swipe-row').forEach(row => {
        if (except && row === except) return;
        if (!(row._swipeTx) && !row.classList.contains('open')) return;
        setSwipeOffset(row, 0, true);
        row.classList.remove('open', 'open-left', 'open-right');
    });
    if (!except) swipeActiveRow = null;
}

function measureActionWidths(row) {
    const left = row.querySelector('.swipe-actions-left');
    const right = row.querySelector('.swipe-actions-right');
    let maxR = SWIPE_OPEN_PX, maxL = SWIPE_OPEN_PX;
    if (left) {
        let w = 0;
        left.querySelectorAll('.swipe-action').forEach(b => { w += b.offsetWidth || 72; });
        maxR = Math.max(SWIPE_OPEN_PX, w || left.scrollWidth || SWIPE_MAX_RIGHT);
    }
    if (right) {
        let w = 0;
        right.querySelectorAll('.swipe-action').forEach(b => { w += b.offsetWidth || 72; });
        maxL = Math.max(SWIPE_OPEN_PX, w || right.scrollWidth || SWIPE_MAX_LEFT);
    }
    row._swipeMaxRight = Math.min(SWIPE_MAX_RIGHT, maxR);
    row._swipeMaxLeft = Math.min(SWIPE_MAX_LEFT, maxL);
}

function setSwipeOffset(row, tx, animate) {
    const content = row.querySelector('.swipe-content');
    if (!content) return;
    content.style.transition = animate
        ? 'transform 0.25s cubic-bezier(0.2, 0.85, 0.25, 1)'
        : 'none';
    content.style.transform = 'translate3d(' + tx + 'px,0,0)';
    row._swipeTx = tx;
    const left = row.querySelector('.swipe-actions-left');
    const right = row.querySelector('.swipe-actions-right');
    if (left) {
        left.style.opacity = tx > 2 ? '1' : '0';
        left.style.pointerEvents = tx > 20 ? 'auto' : 'none';
    }
    if (right) {
        right.style.opacity = tx < -2 ? '1' : '0';
        right.style.pointerEvents = tx < -20 ? 'auto' : 'none';
    }
}

function snapSwipeRow(row) {
    if (!row._swipeMaxRight || !row._swipeMaxLeft) measureActionWidths(row);
    const tx = row._swipeTx || 0;
    const wasOpen = row.classList.contains('open');
    const wasOpenRight = row.classList.contains('open-right');
    const wasOpenLeft = row.classList.contains('open-left');
    let target = 0, side = null;
    const v = swipeVelocity;

    if (wasOpen && wasOpenRight) {
        if (tx < (row._swipeMaxRight * 0.55) || v < -0.35) target = 0;
        else { target = row._swipeMaxRight; side = 'right'; }
    } else if (wasOpen && wasOpenLeft) {
        if (tx > -(row._swipeMaxLeft * 0.55) || v > 0.35) target = 0;
        else { target = -row._swipeMaxLeft; side = 'left'; }
    } else {
        if (tx > SWIPE_THRESHOLD || (v > 0.45 && tx > 12)) {
            target = row._swipeMaxRight || SWIPE_OPEN_PX;
            side = 'right';
        } else if (tx < -SWIPE_THRESHOLD || (v < -0.45 && tx < -12)) {
            target = -(row._swipeMaxLeft || SWIPE_OPEN_PX);
            side = 'left';
        } else {
            target = 0;
        }
    }

    setSwipeOffset(row, target, true);
    row.classList.toggle('open', target !== 0);
    row.classList.toggle('open-right', side === 'right');
    row.classList.toggle('open-left', side === 'left');
    if (target !== 0) { closeAllSwipeRows(row); swipeActiveRow = row; }
    else if (swipeActiveRow === row) swipeActiveRow = null;
}

function buildSwipeRow(opts) {
    const row = document.createElement('div');
    row.className = 'swipe-row';
    row.dataset.kind = opts.kind || '';
    row.dataset.name = opts.name || '';
    row.dataset.enhanced = '1';

    const left = document.createElement('div');
    left.className = 'swipe-actions swipe-actions-left';
    (opts.leftActions || []).forEach(a => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swipe-action ' + (a.cls || '');
        btn.innerHTML = '<span class="swipe-action-ico">' + (a.icon || '') + '</span>' +
            (a.label ? '<span class="swipe-action-lbl">' + a.label + '</span>' : '');
        btn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            closeAllSwipeRows();
            try { a.onClick && a.onClick(e); } catch (err) { console.warn(err); }
        });
        left.appendChild(btn);
    });

    const right = document.createElement('div');
    right.className = 'swipe-actions swipe-actions-right';
    (opts.rightActions || []).forEach(a => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swipe-action ' + (a.cls || '');
        btn.innerHTML = '<span class="swipe-action-ico">' + (a.icon || '') + '</span>' +
            (a.label ? '<span class="swipe-action-lbl">' + a.label + '</span>' : '');
        btn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            closeAllSwipeRows();
            try { a.onClick && a.onClick(e); } catch (err) { console.warn(err); }
        });
        right.appendChild(btn);
    });

    const content = document.createElement('div');
    content.className = 'swipe-content list-item';
    content.innerHTML = opts.innerHtml || '';
    row.appendChild(left);
    row.appendChild(right);
    row.appendChild(content);
    requestAnimationFrame(() => measureActionWidths(row));
    return row;
}

function getClientXY(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}

function onSwipePointerDown(e) {
    const isTouch = !!(e.touches || e.type === 'touchstart');
    if (!isTouch && swipeIsTouch) return;
    if (!isTouch && window.matchMedia && window.matchMedia('(hover: none)').matches) return;

    const row = e.target.closest && e.target.closest('.swipe-row');
    if (!row) {
        if (!(e.target.closest && e.target.closest('.swipe-action'))) closeAllSwipeRows();
        return;
    }
    if (e.target.closest && e.target.closest('.swipe-action')) return;

    const p = getClientXY(e);
    swipeIsTouch = isTouch;
    swipeActiveRow = row;
    swipeStartX = p.x; swipeStartY = p.y;
    swipeStartTx = row._swipeTx || 0;
    swipeLastX = p.x; swipeLastT = performance.now();
    swipeVelocity = 0;
    swipeTracking = true; swipeAxis = null; swipeMoved = false;
    if (!row._swipeMaxRight) measureActionWidths(row);
    setSwipeOffset(row, swipeStartTx, false);
}

function onSwipePointerMove(e) {
    if (!swipeTracking || !swipeActiveRow) return;
    const isTouch = !!(e.touches || e.type === 'touchmove');
    if (isTouch !== swipeIsTouch) return;

    const p = getClientXY(e);
    const dx = p.x - swipeStartX;
    const dy = p.y - swipeStartY;
    const now = performance.now();
    const dt = Math.max(1, now - swipeLastT);
    swipeVelocity = (p.x - swipeLastX) / dt;
    swipeLastX = p.x; swipeLastT = now;

    if (!swipeAxis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.15) {
            swipeAxis = 'x';
            closeAllSwipeRows(swipeActiveRow);
        } else {
            swipeAxis = 'y';
            swipeTracking = false;
            return;
        }
    }
    if (swipeAxis !== 'x') return;
    if (e.cancelable) e.preventDefault();
    swipeMoved = true;

    const maxR = swipeActiveRow._swipeMaxRight || SWIPE_MAX_RIGHT;
    const maxL = swipeActiveRow._swipeMaxLeft || SWIPE_MAX_LEFT;
    let tx = swipeStartTx + dx;
    if (tx > maxR) tx = maxR + (tx - maxR) * 0.18;
    if (tx < -maxL) tx = -maxL + (tx + maxL) * 0.18;
    setSwipeOffset(swipeActiveRow, tx, false);
}

function onSwipePointerUp(e) {
    if (!swipeTracking) { swipeIsTouch = false; return; }
    const isTouch = !!(e.changedTouches || e.type === 'touchend' || e.type === 'touchcancel');
    if (isTouch !== swipeIsTouch && e.type === 'mouseup') return;

    const row = swipeActiveRow;
    const wasMoved = swipeMoved;
    const axis = swipeAxis;
    swipeTracking = false; swipeAxis = null;

    if (!row) { swipeIsTouch = false; return; }

    if (axis === 'x' && wasMoved) {
        snapSwipeRow(row);
    } else if ((row._swipeTx || 0) !== 0 && !wasMoved) {
        setSwipeOffset(row, 0, true);
        row.classList.remove('open', 'open-left', 'open-right');
        swipeActiveRow = null;
    }
    swipeMoved = false;
    swipeIsTouch = false;
    swipeVelocity = 0;
}

function wireSwipeListeners() {
    if (window._luaxSwipeWired) return;
    window._luaxSwipeWired = true;
    document.addEventListener('touchstart', onSwipePointerDown, { passive: true, capture: true });
    document.addEventListener('touchmove', onSwipePointerMove, { passive: false, capture: true });
    document.addEventListener('touchend', onSwipePointerUp, { passive: true, capture: true });
    document.addEventListener('touchcancel', onSwipePointerUp, { passive: true, capture: true });
    document.addEventListener('mousedown', onSwipePointerDown, true);
    document.addEventListener('mousemove', onSwipePointerMove, true);
    document.addEventListener('mouseup', onSwipePointerUp, true);
}

function enhanceProjectsListSwipe() {
    const list = document.getElementById('projects-list');
    if (!list || list.querySelector('.lx-empty')) return;
    const items = Array.from(list.querySelectorAll(':scope > .list-item, :scope > .swipe-row'));
    if (!items.length) return;
    const rows = [];

    items.forEach(el => {
        if (el.classList.contains('swipe-row') && el.dataset.enhanced === '1') {
            rows.push(el); return;
        }
        const gpBtn = el.querySelector('[data-gp]');
        const renBtn = el.querySelector('[data-rename]');
        const name = (gpBtn && gpBtn.getAttribute('data-gp')) ||
            (renBtn && renBtn.getAttribute('data-rename')) || '';
        if (!name) { rows.push(el); return; }

        let gpOn = true;
        try { gpOn = getProjectGamepad(name); } catch (_) {}
        const pinnedOn = isProjectPinned(name);
        const title = el.querySelector('.item-title');
        const chevron = el.querySelector('.item-chevron');
        let inner = title ? title.outerHTML : el.innerHTML;
        if (title && chevron) inner += '<span class="item-chevron-static">' + chevron.innerHTML + '</span>';
        if (pinnedOn && title) inner = inner.replace('</div>', '<span class="item-pin-badge" title="Pinned">📌</span></div>');

        const row = buildSwipeRow({
            kind: 'project', name: name, innerHtml: inner,
            leftActions: [
                { icon: pinnedOn ? '📌' : '📍', label: pinnedOn ? 'Unpin' : 'Pin',
                  cls: 'swipe-pin' + (pinnedOn ? ' on' : ''), onClick: () => toggleProjectPin(name) },
                { icon: '🎮', label: gpOn ? 'Pad on' : 'Pad off',
                  cls: 'swipe-gamepad' + (gpOn ? '' : ' off'),
                  onClick: () => {
                      try { toggleProjectGamepadFor(name); } catch (_) {}
                      try { if (typeof renderProjects === 'function') renderProjects(); } catch (_) {}
                  } }
            ],
            rightActions: [
                { icon: '✎', label: 'Rename', cls: 'swipe-rename',
                  onClick: () => { try { promptRenameProject(name); } catch (_) {} } },
                { icon: '⧉', label: 'Copy', cls: 'swipe-dup',
                  onClick: () => { try { duplicateProject(name); } catch (_) {} } },
                { icon: '🗑', label: 'Delete', cls: 'swipe-delete',
                  onClick: () => { try { deleteProject({ stopPropagation: function () {} }, name); } catch (_) {} } }
            ]
        });

        row.querySelector('.swipe-content').addEventListener('click', (e) => {
            if ((row._swipeTx || 0) !== 0) {
                e.preventDefault(); e.stopPropagation();
                setSwipeOffset(row, 0, true);
                row.classList.remove('open', 'open-left', 'open-right');
                return;
            }
            try { openProject(name); } catch (_) {}
        });
        el.replaceWith(row);
        rows.push(row);
    });

    if (swipeTracking) return;
    const pinnedSet = {};
    loadPinnedProjects().forEach(n => { pinnedSet[n] = true; });
    const pinnedRows = [], otherRows = [];
    rows.forEach(r => {
        const n = r.dataset && r.dataset.name;
        if (n && pinnedSet[n]) pinnedRows.push(r); else otherRows.push(r);
    });
    pinnedRows.concat(otherRows).forEach(r => list.appendChild(r));
}

function enhanceFilesListSwipe() {
    const list = document.getElementById('files-list');
    if (!list) return;
    const items = Array.from(list.querySelectorAll(':scope > .list-item'));
    if (!items.length) return;

    items.forEach(el => {
        const title = el.querySelector('.item-title');
        const html = el.innerHTML;
        const mOpen = html.match(/openFile\('([^']+)'\)/) ||
            html.match(/openSpriteEditor\('([^']+)'\)/) ||
            html.match(/openMusicEditor\('([^']+)'\)/);
        let name = mOpen ? mOpen[1].replace(/\\'/g, "'") : '';
        if (!name) {
            const ns = title && title.querySelector('span:not(.item-badge):not(.item-icon-svg)');
            name = ns ? ns.textContent.trim() : '';
        }
        if (!name) return;

        let kind = 'file';
        if (html.indexOf('deleteAsset') >= 0 || html.indexOf('IMG') >= 0) kind = 'sprite';
        else if (html.indexOf('deleteMusic') >= 0 || html.indexOf('MUSIC') >= 0) kind = 'music';

        const pinnedOn = isFilePinned(name);
        let inner = title ? title.outerHTML : el.innerHTML;
        if (pinnedOn && title) {
            inner = inner.replace('</div>', '<span class="item-pin-badge" title="Pinned">📌</span></div>');
        }

        const leftActions = [{
            icon: pinnedOn ? '📌' : '📍',
            label: pinnedOn ? 'Unpin' : 'Pin',
            cls: 'swipe-pin' + (pinnedOn ? ' on' : ''),
            onClick: () => toggleFilePin(name)
        }];
        const rightActions = [];

        if (kind === 'file') {
            rightActions.push({
                icon: '✎', label: 'Rename', cls: 'swipe-rename',
                onClick: () => { try { promptRenameFile(name); } catch (_) {} }
            });
            if (name !== 'main.lua') {
                rightActions.push({
                    icon: '🗑', label: 'Delete', cls: 'swipe-delete',
                    onClick: () => { try { deleteFile({ stopPropagation: function () {} }, name); } catch (_) {} }
                });
            }
        } else if (kind === 'sprite') {
            rightActions.push({
                icon: '🗑', label: 'Delete', cls: 'swipe-delete',
                onClick: () => { try { deleteAsset({ stopPropagation: function () {} }, name); } catch (_) {} }
            });
        } else if (kind === 'music') {
            rightActions.push({
                icon: '🗑', label: 'Delete', cls: 'swipe-delete',
                onClick: () => { try { deleteMusicPattern({ stopPropagation: function () {} }, name); } catch (_) {} }
            });
        }

        const row = buildSwipeRow({
            kind: kind, name: name, innerHtml: inner,
            leftActions: leftActions, rightActions: rightActions
        });

        row.querySelector('.swipe-content').addEventListener('click', (e) => {
            if ((row._swipeTx || 0) !== 0) {
                e.preventDefault(); e.stopPropagation();
                setSwipeOffset(row, 0, true);
                row.classList.remove('open', 'open-left', 'open-right');
                return;
            }
            try {
                if (kind === 'file') openFile(name);
                else if (kind === 'sprite') openSpriteEditor(name);
                else if (kind === 'music') openMusicEditor(name);
            } catch (_) {}
        });
        el.replaceWith(row);
    });

    if (swipeTracking) return;
    const map = loadPinnedFilesMap();
    const proj = currentProjectName();
    const pinned = (proj && Array.isArray(map[proj])) ? map[proj] : [];
    if (!pinned.length) return;
    const pinnedSet = {};
    pinned.forEach(n => { pinnedSet[n] = true; });
    const all = Array.from(list.querySelectorAll(':scope > .swipe-row'));
    const top = [], rest = [];
    all.forEach(r => {
        const n = r.dataset && r.dataset.name;
        if (n && pinnedSet[n]) top.push(r); else rest.push(r);
    });
    top.sort((a, b) => pinned.indexOf(a.dataset.name) - pinned.indexOf(b.dataset.name));
    top.concat(rest).forEach(r => list.appendChild(r));
}

function enhanceAllSwipeLists() {
    try { enhanceProjectsListSwipe(); } catch (e) { console.warn('swipe projects', e); }
    try { enhanceFilesListSwipe(); } catch (e) { console.warn('swipe files', e); }
}

function hookSwipeIntoRenders() {
    try {
        if (typeof renderProjects === 'function' && !renderProjects._luaxSwipe) {
            const _rp = renderProjects;
            renderProjects = function () {
                const r = _rp.apply(this, arguments);
                setTimeout(enhanceProjectsListSwipe, 0);
                return r;
            };
            renderProjects._luaxSwipe = true;
            window.renderProjects = renderProjects;
        }
    } catch (_) {}
    try {
        if (typeof renderFiles === 'function' && !renderFiles._luaxSwipe) {
            const _rf = renderFiles;
            renderFiles = function () {
                const r = _rf.apply(this, arguments);
                setTimeout(enhanceFilesListSwipe, 0);
                return r;
            };
            renderFiles._luaxSwipe = true;
        }
    } catch (_) {}
}

function initSwipeList() {
    if (!document.getElementById('luax-swipe-list-css')) {
        const l = document.createElement('link');
        l.id = 'luax-swipe-list-css';
        l.rel = 'stylesheet';
        l.href = 'styles/swipe-list.css';
        document.head.appendChild(l);
    }
    wireSwipeListeners();
    hookSwipeIntoRenders();
    enhanceAllSwipeLists();
    let tries = 0;
    const t = setInterval(() => {
        tries++;
        hookSwipeIntoRenders();
        if (tries === 1 || tries === 5 || tries === 12) enhanceAllSwipeLists();
        if (tries > 20) clearInterval(t);
    }, 400);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initSwipeList, 100));
} else {
    setTimeout(initSwipeList, 100);
}

try {
    window.enhanceProjectsListSwipe = enhanceProjectsListSwipe;
    window.enhanceFilesListSwipe = enhanceFilesListSwipe;
    window.toggleProjectPin = toggleProjectPin;
    window.toggleFilePin = toggleFilePin;
    window.closeAllSwipeRows = closeAllSwipeRows;
} catch (_) {}

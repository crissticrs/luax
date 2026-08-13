// src/swipe-list.js — WhatsApp-style swipe on project/file rows
// Swipe right → pin / gamepad · Swipe left → rename / delete

const SWIPE_OPEN_PX = 72;
const SWIPE_THRESHOLD = 48;
const SWIPE_MAX_LEFT = 156;
const SWIPE_MAX_RIGHT = 144;
const PINNED_KEY = 'luax_pinned_projects';

let swipeActiveRow = null;
let swipeStartX = 0, swipeStartY = 0, swipeStartTx = 0;
let swipeTracking = false, swipeAxis = null, swipeMoved = false;

function loadPinnedProjects() {
    try {
        const raw = localStorage.getItem(PINNED_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
}
function savePinnedProjects(list) {
    try { localStorage.setItem(PINNED_KEY, JSON.stringify(list)); } catch (_) {}
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

function closeAllSwipeRows(except) {
    document.querySelectorAll('.swipe-row.open').forEach(row => {
        if (except && row === except) return;
        setSwipeOffset(row, 0, true);
        row.classList.remove('open', 'open-left', 'open-right');
    });
    if (!except) swipeActiveRow = null;
}

function setSwipeOffset(row, tx, animate) {
    const content = row.querySelector('.swipe-content');
    if (!content) return;
    content.style.transition = animate ? 'transform 0.22s cubic-bezier(0.2, 0.9, 0.2, 1)' : 'none';
    content.style.transform = 'translate3d(' + tx + 'px,0,0)';
    row._swipeTx = tx;
    const left = row.querySelector('.swipe-actions-left');
    const right = row.querySelector('.swipe-actions-right');
    if (left) left.style.opacity = tx > 8 ? '1' : (tx > 0 ? String(tx / 40) : '0');
    if (right) right.style.opacity = tx < -8 ? '1' : (tx < 0 ? String((-tx) / 40) : '0');
}

function snapSwipeRow(row) {
    const tx = row._swipeTx || 0;
    let target = 0, side = null;
    if (tx > SWIPE_THRESHOLD) {
        const left = row.querySelector('.swipe-actions-left');
        const maxR = row._swipeMaxRight || SWIPE_MAX_RIGHT;
        target = left ? Math.min(maxR, left.scrollWidth || maxR) : SWIPE_OPEN_PX;
        side = 'right';
    } else if (tx < -SWIPE_THRESHOLD) {
        const right = row.querySelector('.swipe-actions-right');
        const maxL = row._swipeMaxLeft || SWIPE_MAX_LEFT;
        target = right ? -Math.min(maxL, right.scrollWidth || maxL) : -SWIPE_OPEN_PX;
        side = 'left';
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

    requestAnimationFrame(() => {
        row._swipeMaxRight = Math.max(SWIPE_OPEN_PX, left.scrollWidth || SWIPE_MAX_RIGHT);
        row._swipeMaxLeft = Math.max(SWIPE_OPEN_PX, right.scrollWidth || SWIPE_MAX_LEFT);
    });
    return row;
}

function onSwipePointerDown(e) {
    const row = e.target.closest && e.target.closest('.swipe-row');
    if (!row) {
        if (!(e.target.closest && e.target.closest('.swipe-action'))) closeAllSwipeRows();
        return;
    }
    if (e.target.closest && e.target.closest('.swipe-action')) return;
    const t = e.touches ? e.touches[0] : e;
    swipeActiveRow = row;
    swipeStartX = t.clientX; swipeStartY = t.clientY;
    swipeStartTx = row._swipeTx || 0;
    swipeTracking = true; swipeAxis = null; swipeMoved = false;
    setSwipeOffset(row, swipeStartTx, false);
}

function onSwipePointerMove(e) {
    if (!swipeTracking || !swipeActiveRow) return;
    const t = e.touches ? e.touches[0] : e;
    const dx = t.clientX - swipeStartX;
    const dy = t.clientY - swipeStartY;
    if (!swipeAxis) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        swipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (swipeAxis === 'y') { swipeTracking = false; return; }
        closeAllSwipeRows(swipeActiveRow);
    }
    if (swipeAxis !== 'x') return;
    e.preventDefault();
    swipeMoved = true;
    const maxR = swipeActiveRow._swipeMaxRight || SWIPE_MAX_RIGHT;
    const maxL = swipeActiveRow._swipeMaxLeft || SWIPE_MAX_LEFT;
    let tx = swipeStartTx + dx;
    if (tx > maxR) tx = maxR + (tx - maxR) * 0.2;
    if (tx < -maxL) tx = -maxL + (tx + maxL) * 0.2;
    setSwipeOffset(swipeActiveRow, tx, false);
}

function onSwipePointerUp() {
    if (!swipeTracking) return;
    const row = swipeActiveRow;
    const wasMoved = swipeMoved;
    const axis = swipeAxis;
    swipeTracking = false; swipeAxis = null;
    if (!row) return;
    if (axis === 'x' && wasMoved) snapSwipeRow(row);
    else if ((row._swipeTx || 0) !== 0 && !wasMoved) {
        setSwipeOffset(row, 0, true);
        row.classList.remove('open', 'open-left', 'open-right');
    }
    swipeMoved = false;
}

function wireSwipeListeners() {
    if (window._luaxSwipeWired) return;
    window._luaxSwipeWired = true;
    document.addEventListener('touchstart', onSwipePointerDown, { passive: true, capture: true });
    document.addEventListener('touchmove', onSwipePointerMove, { passive: false });
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
        if (el.classList.contains('swipe-row')) { rows.push(el); return; }
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
                { icon: pinnedOn ? '📌' : '📍', label: pinnedOn ? 'Unpin' : 'Pin', cls: 'swipe-pin' + (pinnedOn ? ' on' : ''),
                  onClick: () => toggleProjectPin(name) },
                { icon: '🎮', label: gpOn ? 'Pad on' : 'Pad off', cls: 'swipe-gamepad' + (gpOn ? '' : ' off'),
                  onClick: () => { try { toggleProjectGamepadFor(name); } catch (_) {} try { enhanceProjectsListSwipe(); } catch (_) {} } }
            ],
            rightActions: [
                { icon: '✎', label: 'Rename', cls: 'swipe-rename', onClick: () => { try { promptRenameProject(name); } catch (_) {} } },
                { icon: '⧉', label: 'Copy', cls: 'swipe-dup', onClick: () => { try { duplicateProject(name); } catch (_) {} } },
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

        const inner = title ? title.outerHTML : el.innerHTML;
        const leftActions = [], rightActions = [];

        if (kind === 'file') {
            leftActions.push({ icon: '📄', label: 'Open', cls: 'swipe-open', onClick: () => { try { openFile(name); } catch (_) {} } });
            rightActions.push({ icon: '✎', label: 'Rename', cls: 'swipe-rename', onClick: () => { try { promptRenameFile(name); } catch (_) {} } });
            if (name !== 'main.lua') {
                rightActions.push({ icon: '🗑', label: 'Delete', cls: 'swipe-delete',
                    onClick: () => { try { deleteFile({ stopPropagation: function () {} }, name); } catch (_) {} } });
            }
        } else if (kind === 'sprite') {
            leftActions.push({ icon: '✎', label: 'Edit', cls: 'swipe-open', onClick: () => { try { openSpriteEditor(name); } catch (_) {} } });
            rightActions.push({ icon: '🗑', label: 'Delete', cls: 'swipe-delete',
                onClick: () => { try { deleteAsset({ stopPropagation: function () {} }, name); } catch (_) {} } });
        } else if (kind === 'music') {
            leftActions.push({ icon: '♪', label: 'Edit', cls: 'swipe-open', onClick: () => { try { openMusicEditor(name); } catch (_) {} } });
            rightActions.push({ icon: '🗑', label: 'Delete', cls: 'swipe-delete',
                onClick: () => { try { deleteMusicPattern({ stopPropagation: function () {} }, name); } catch (_) {} } });
        }

        const row = buildSwipeRow({ kind: kind, name: name, innerHtml: inner, leftActions: leftActions, rightActions: rightActions });
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
    // CSS
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
        enhanceAllSwipeLists();
        if (tries > 25) clearInterval(t);
    }, 300);
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
    window.closeAllSwipeRows = closeAllSwipeRows;
} catch (_) {}

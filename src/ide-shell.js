// src/ide-shell.js — IDE layer on top of existing LuaX editor
(function () {
    'use strict';

    const OPEN_TABS_KEY = 'luax_open_tabs';
    let openTabs = [];
    let dirtyMap = {};
    let autosaveTimer = null;
    let lastErrorLine = null;
    let explorerCollapsed = false;
    try { explorerCollapsed = localStorage.getItem('luax_ide_explorer') === '0'; } catch (_) {}

    function $(id) { return document.getElementById(id); }

    function getProjectName() {
        try {
            if (typeof window.currentProjectName === 'string' && window.currentProjectName) return window.currentProjectName;
            if (typeof currentProjectName === 'string' && currentProjectName) return currentProjectName;
        } catch (_) {}
        return '';
    }
    function getProjects() {
        try {
            if (window.projects) return window.projects;
            if (typeof projects !== 'undefined') return projects;
        } catch (_) {}
        return {};
    }
    function loadOpenTabs(proj) {
        try {
            const all = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) || '{}');
            const list = all[proj];
            return Array.isArray(list) ? list.filter(Boolean) : [];
        } catch (_) { return []; }
    }
    function saveOpenTabs(proj, tabs) {
        try {
            const all = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) || '{}');
            all[proj] = tabs;
            localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(all));
        } catch (_) {}
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }
    function escapeAttr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function ensureIdeDom() {
        const view = $('editor-view');
        if (!view || view.dataset.ideReady === '1') return !!view;
        view.classList.add('ide-ready');
        view.dataset.ideReady = '1';

        if (!$('luax-ide-shell-css')) {
            const l = document.createElement('link');
            l.id = 'luax-ide-shell-css';
            l.rel = 'stylesheet';
            l.href = 'styles/ide-shell.css';
            document.head.appendChild(l);
        }

        const headerActions = view.querySelector('.header-actions');
        if (headerActions && !$('ide-header-tools')) {
            const tools = document.createElement('div');
            tools.id = 'ide-header-tools';
            tools.className = 'ide-header-tools';
            tools.innerHTML =
                '<button type="button" class="btn btn-sm" id="ide-btn-explorer" title="Toggle explorer">☰ Files</button>' +
                '<button type="button" class="btn btn-sm" id="ide-btn-quick" title="Quick Open (Ctrl+P)">Quick Open</button>' +
                '<button type="button" class="btn btn-sm" id="ide-btn-cmd" title="Command Palette (Ctrl+Shift+P)">Commands</button>' +
                '<button type="button" class="btn btn-sm" id="ide-btn-goto" title="Go to Line (Ctrl+G)">Go to Line</button>' +
                '<button type="button" class="btn btn-sm btn-play" id="ide-btn-play" title="Play">▶ Play</button>';
            const saveBtn = $('save-btn');
            if (saveBtn && saveBtn.parentNode === headerActions) headerActions.insertBefore(tools, saveBtn);
            else headerActions.appendChild(tools);
            $('ide-btn-explorer').onclick = () => toggleExplorer();
            $('ide-btn-quick').onclick = () => openQuickOpen();
            $('ide-btn-cmd').onclick = () => openCommandPalette();
            $('ide-btn-goto').onclick = () => openGoToLine();
            $('ide-btn-play').onclick = () => {
                try { if (typeof saveCurrentFile === 'function') saveCurrentFile(); } catch (_) {}
                try {
                    const btn = $('btn-start-play');
                    if (btn) btn.click();
                    else if (typeof startPlayMode === 'function') startPlayMode();
                } catch (_) {}
            };
        }

        const toolbar = $('editor-toolbar');
        const tabsBar = $('tabs-bar');
        const editorEl = $('editor');
        const suggest = $('luax-suggest-bar');
        const status = $('status-bar');
        if (!editorEl || !tabsBar) return false;

        if (!$('ide-workspace')) {
            const workspace = document.createElement('div');
            workspace.className = 'ide-workspace';
            workspace.id = 'ide-workspace';

            const backdrop = document.createElement('div');
            backdrop.className = 'ide-explorer-backdrop';
            backdrop.id = 'ide-explorer-backdrop';
            backdrop.onclick = () => setExplorerOpen(false);

            const explorer = document.createElement('aside');
            explorer.className = 'ide-explorer' + (explorerCollapsed ? ' collapsed' : '');
            explorer.id = 'ide-explorer';
            explorer.innerHTML =
                '<div class="ide-explorer-header"><span>Project</span>' +
                '<button type="button" id="ide-explorer-close" title="Collapse">✕</button></div>' +
                '<div class="ide-tree-actions">' +
                '<button type="button" id="ide-new-file">+ Lua</button>' +
                '<button type="button" id="ide-search-files">Search</button></div>' +
                '<div class="ide-explorer-body" id="ide-explorer-body"></div>';

            const main = document.createElement('div');
            main.className = 'ide-main';
            main.id = 'ide-main';

            const parent = editorEl.parentNode;
            parent.insertBefore(workspace, toolbar || tabsBar || editorEl);
            if (toolbar) main.appendChild(toolbar);
            main.appendChild(tabsBar);
            main.appendChild(editorEl);
            if (suggest) main.appendChild(suggest);

            const ideStatus = document.createElement('div');
            ideStatus.className = 'ide-status-bar';
            ideStatus.id = 'ide-status-bar';
            ideStatus.innerHTML =
                '<span class="ide-st-item ide-st-file" id="ide-st-file">—</span>' +
                '<span class="ide-st-item" id="ide-st-pos">Ln —, Col —</span>' +
                '<span class="ide-st-item" id="ide-st-dirty"></span>' +
                '<span class="ide-st-item ide-st-spacer"></span>' +
                '<span class="ide-st-item" id="ide-st-msg"></span>' +
                '<span class="ide-st-item" id="ide-st-lang">LuaX</span>';
            main.appendChild(ideStatus);

            if (status) {
                status.style.display = 'none';
                status.id = 'status-bar-legacy';
                main.appendChild(status);
            }

            const cons = document.createElement('div');
            cons.className = 'ide-console collapsed';
            cons.id = 'ide-console';
            cons.innerHTML =
                '<div class="ide-console-header"><span>Console</span>' +
                '<button type="button" id="ide-console-clear">Clear</button>' +
                '<button type="button" id="ide-console-toggle">Hide</button></div>' +
                '<div class="ide-console-body" id="ide-console-body"></div>';
            main.appendChild(cons);

            workspace.appendChild(backdrop);
            workspace.appendChild(explorer);
            workspace.appendChild(main);

            $('ide-explorer-close').onclick = () => setExplorerOpen(false);
            $('ide-new-file').onclick = () => ideNewFile();
            $('ide-search-files').onclick = () => openQuickOpen();
            $('ide-console-clear').onclick = () => { const b = $('ide-console-body'); if (b) b.innerHTML = ''; };
            $('ide-console-toggle').onclick = () => {
                const c = $('ide-console');
                if (!c) return;
                c.classList.toggle('collapsed');
                $('ide-console-toggle').textContent = c.classList.contains('collapsed') ? 'Show' : 'Hide';
            };
        }

        if (!$('ide-overlay')) {
            const ov = document.createElement('div');
            ov.id = 'ide-overlay';
            ov.className = 'ide-overlay';
            ov.innerHTML =
                '<div class="ide-palette" role="dialog" aria-modal="true">' +
                '<input type="text" id="ide-palette-input" autocomplete="off" spellcheck="false" placeholder="">' +
                '<div class="ide-palette-list" id="ide-palette-list"></div></div>';
            document.body.appendChild(ov);
            ov.addEventListener('click', (e) => { if (e.target === ov) closePalette(); });
            const inp = $('ide-palette-input');
            if (inp) {
                inp.addEventListener('keydown', onPaletteKey);
                inp.addEventListener('input', onPaletteInput);
            }
        }

        if (toolbar && !toolbar.dataset.ideExt) {
            toolbar.dataset.ideExt = '1';
            const extra = document.createElement('span');
            extra.style.cssText = 'display:inline-flex;gap:4px;margin-left:4px';
            extra.innerHTML =
                '<button type="button" class="btn btn-sm" id="ide-tb-save" title="Save (Ctrl+S)">Save</button>';
            toolbar.appendChild(extra);
            $('ide-tb-save').onclick = () => { try { saveCurrentFile(); } catch (_) {} refreshIdeChrome(); };
        }
        return true;
    }

    function setExplorerOpen(open) {
        const ex = $('ide-explorer');
        const bd = $('ide-explorer-backdrop');
        if (!ex) return;
        explorerCollapsed = !open;
        ex.classList.toggle('collapsed', !open);
        if (bd) bd.classList.toggle('show', open && window.matchMedia('(max-width: 720px)').matches);
        try { localStorage.setItem('luax_ide_explorer', open ? '1' : '0'); } catch (_) {}
    }
    function toggleExplorer() {
        const ex = $('ide-explorer');
        if (!ex) return;
        setExplorerOpen(ex.classList.contains('collapsed'));
    }

    function refreshExplorer() {
        const body = $('ide-explorer-body');
        if (!body) return;
        const proj = getProjectName();
        const projs = getProjects();
        if (!proj || !projs[proj]) {
            body.innerHTML = '<div class="ide-palette-empty">No project open</div>';
            return;
        }
        const files = Object.keys(projs[proj] || {}).sort();
        let assets = {}, music = {};
        try { if (typeof getProjectAssetMap === 'function') assets = getProjectAssetMap(proj) || {}; } catch (_) {}
        try { if (typeof getProjectMusicMap === 'function') music = getProjectMusicMap(proj) || {}; } catch (_) {}
        const cur = (typeof currentFileName !== 'undefined' && currentFileName) ? currentFileName : (window.currentFileName || '');

        let html = '<div class="ide-tree-section"><div class="ide-tree-label">Lua</div>';
        files.forEach(fn => {
            const active = fn === cur ? ' active' : '';
            const dirty = (fn === cur && window.isDirty) || dirtyMap[fn] ? '<span class="ide-tree-dirty">•</span>' : '';
            html += '<button type="button" class="ide-tree-item' + active + '" data-ide-open="' + escapeAttr(fn) + '">' +
                '<span class="ide-tree-ico">📄</span><span class="ide-tree-name">' + escapeHtml(fn) + '</span>' + dirty + '</button>';
        });
        html += '</div>';
        const assetKeys = Object.keys(assets).sort();
        if (assetKeys.length) {
            html += '<div class="ide-tree-section"><div class="ide-tree-label">Sprites</div>';
            assetKeys.forEach(fn => {
                html += '<button type="button" class="ide-tree-item" data-ide-sprite="' + escapeAttr(fn) + '">' +
                    '<span class="ide-tree-ico">🖼</span><span class="ide-tree-name">' + escapeHtml(fn) + '</span></button>';
            });
            html += '</div>';
        }
        const musicKeys = Object.keys(music).sort();
        if (musicKeys.length) {
            html += '<div class="ide-tree-section"><div class="ide-tree-label">Music</div>';
            musicKeys.forEach(fn => {
                html += '<button type="button" class="ide-tree-item" data-ide-music="' + escapeAttr(fn) + '">' +
                    '<span class="ide-tree-ico">♪</span><span class="ide-tree-name">' + escapeHtml(fn) + '</span></button>';
            });
            html += '</div>';
        }
        body.innerHTML = html;
        body.querySelectorAll('[data-ide-open]').forEach(btn => {
            btn.onclick = () => ideOpenFile(btn.getAttribute('data-ide-open'));
        });
        body.querySelectorAll('[data-ide-sprite]').forEach(btn => {
            btn.onclick = () => { try { openSpriteEditor(btn.getAttribute('data-ide-sprite')); } catch (_) {} };
        });
        body.querySelectorAll('[data-ide-music]').forEach(btn => {
            btn.onclick = () => { try { openMusicEditor(btn.getAttribute('data-ide-music')); } catch (_) {} };
        });
    }

    function ensureTabOpen(fn) {
        if (!fn) return;
        if (openTabs.indexOf(fn) < 0) openTabs.push(fn);
        const proj = getProjectName();
        if (proj) saveOpenTabs(proj, openTabs);
    }

    function renderIdeTabs() {
        const bar = $('tabs-bar');
        if (!bar) return;
        const cur = (typeof currentFileName !== 'undefined' && currentFileName) ? currentFileName : '';
        if (!openTabs.length && cur) openTabs = [cur];
        const proj = getProjectName();
        const projs = getProjects();
        const files = (proj && projs[proj]) ? projs[proj] : {};
        openTabs = openTabs.filter(fn => fn in files || fn === cur);

        let html = openTabs.map(fn => {
            const active = fn === cur ? ' active' : '';
            const dirty = ((fn === cur && window.isDirty) || dirtyMap[fn]) ? '<span class="ide-tab-dirty">•</span>' : '';
            return '<div class="ide-tab' + active + '" data-tab="' + escapeAttr(fn) + '">' +
                dirty + '<span class="ide-tab-name">' + escapeHtml(fn) + '</span>' +
                '<button type="button" class="ide-tab-close" data-close="' + escapeAttr(fn) + '" title="Close">×</button></div>';
        }).join('');
        html += '<button type="button" class="ide-tab-add" id="ide-tab-add" title="New file">+</button>';
        bar.innerHTML = html;

        bar.querySelectorAll('.ide-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                if (e.target.closest && e.target.closest('.ide-tab-close')) return;
                const fn = tab.getAttribute('data-tab');
                if (fn) ideOpenFile(fn);
            });
        });
        bar.querySelectorAll('.ide-tab-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                ideCloseTab(btn.getAttribute('data-close'));
            });
        });
        const add = $('ide-tab-add');
        if (add) add.onclick = () => ideNewFile();
    }

    function ideOpenFile(fn) {
        if (!fn) return;
        ensureTabOpen(fn);
        try {
            if (typeof openFile === 'function') openFile(fn);
            else if (typeof window.openFile === 'function') window.openFile(fn);
        } catch (e) { console.warn(e); }
        refreshIdeChrome();
    }

    function ideCloseTab(fn) {
        if (!fn) return;
        const cur = (typeof currentFileName !== 'undefined' && currentFileName) ? currentFileName : '';
        if (fn === cur && window.isDirty) {
            const stay = !confirm('Unsaved changes in ' + fn + '.\n\nOK = discard and close\nCancel = keep');
            if (stay) return;
            try { window.isDirty = false; } catch (_) {}
        }
        openTabs = openTabs.filter(t => t !== fn);
        delete dirtyMap[fn];
        const proj = getProjectName();
        if (proj) saveOpenTabs(proj, openTabs);
        if (fn === cur) {
            const next = openTabs[openTabs.length - 1];
            if (next) ideOpenFile(next);
            else {
                const projs = getProjects();
                const files = Object.keys((projs[proj] || {}));
                if (files.indexOf('main.lua') >= 0) ideOpenFile('main.lua');
                else if (files[0]) ideOpenFile(files[0]);
                else renderIdeTabs();
            }
        } else renderIdeTabs();
        refreshExplorer();
    }

    function ideNewFile() {
        try { if (typeof promptNewFile === 'function') { promptNewFile(); return; } } catch (_) {}
        const name = prompt('New Lua file name:', 'script.lua');
        if (!name) return;
        let fn = name.trim();
        if (!fn) return;
        if (!fn.endsWith('.lua')) fn += '.lua';
        const proj = getProjectName();
        const projs = getProjects();
        if (!proj || !projs[proj]) return alert('Open a project first');
        if (projs[proj][fn]) return alert('File exists');
        projs[proj][fn] = '-- ' + fn + '\n\n';
        try { if (typeof saveState === 'function') saveState(); } catch (_) {}
        ensureTabOpen(fn);
        ideOpenFile(fn);
        refreshExplorer();
    }

    function refreshStatusBar(msg, type) {
        const fileEl = $('ide-st-file');
        const posEl = $('ide-st-pos');
        const dirtyEl = $('ide-st-dirty');
        const msgEl = $('ide-st-msg');
        if (!fileEl) return;
        const cur = (typeof currentFileName !== 'undefined' && currentFileName) ? currentFileName : '—';
        fileEl.textContent = cur;
        let line = 1, col = 1;
        try {
            if (window.editor) {
                const curPos = window.editor.getCursor();
                line = curPos.line + 1;
                col = curPos.ch + 1;
            }
        } catch (_) {}
        if (posEl) posEl.textContent = 'Ln ' + line + ', Col ' + col;
        if (dirtyEl) {
            if (window.isDirty) {
                dirtyEl.textContent = '● Unsaved';
                dirtyEl.className = 'ide-st-item ide-st-dirty';
            } else {
                dirtyEl.textContent = '✓ Saved';
                dirtyEl.className = 'ide-st-item ide-st-ok';
            }
        }
        if (msgEl && msg !== undefined) {
            msgEl.textContent = msg || '';
            msgEl.className = 'ide-st-item' + (type === 'error' ? ' ide-st-err' : type === 'ok' ? ' ide-st-ok' : '');
            if (type === 'error' && lastErrorLine) msgEl.onclick = () => jumpToLine(lastErrorLine);
            else msgEl.onclick = null;
        }
    }

    function jumpToLine(line) {
        try {
            if (!window.editor || !line) return;
            const n = Math.max(0, (parseInt(line, 10) || 1) - 1);
            window.editor.setCursor({ line: n, ch: 0 });
            window.editor.focus();
            window.editor.scrollIntoView({ line: n, ch: 0 }, 80);
        } catch (_) {}
    }

    function refreshIdeChrome() {
        renderIdeTabs();
        refreshExplorer();
        refreshStatusBar();
    }

    function scheduleAutosave() {
        if (autosaveTimer) clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
            autosaveTimer = null;
            try {
                if (!window.isDirty) return;
                if (typeof saveCurrentFile === 'function') {
                    saveCurrentFile();
                    ideLog('Autosaved ' + (currentFileName || ''), 'ok');
                    refreshStatusBar('Autosaved', 'ok');
                }
            } catch (e) { console.warn('autosave', e); }
        }, 1800);
    }

    function ideLog(text, kind) {
        const body = $('ide-console-body');
        const cons = $('ide-console');
        if (!body) return;
        if (cons) cons.classList.remove('collapsed');
        const line = document.createElement('div');
        line.className = 'ide-console-line ' + (kind || 'info');
        line.textContent = text;
        if (kind === 'err') {
            const m = String(text).match(/:(\d+)\b/) || String(text).match(/line\s+(\d+)/i);
            if (m) {
                const ln = parseInt(m[1], 10);
                line.onclick = () => jumpToLine(ln);
            }
        }
        body.appendChild(line);
        body.scrollTop = body.scrollHeight;
    }

    let paletteMode = 'cmd';
    let paletteItems = [];
    let paletteIndex = 0;

    function openPalette(mode, placeholder) {
        ensureIdeDom();
        paletteMode = mode;
        const ov = $('ide-overlay');
        const inp = $('ide-palette-input');
        if (!ov || !inp) return;
        ov.classList.add('open');
        inp.placeholder = placeholder || '';
        inp.value = '';
        paletteIndex = 0;
        buildPaletteList('');
        setTimeout(() => inp.focus(), 30);
    }
    function closePalette() {
        const ov = $('ide-overlay');
        if (ov) ov.classList.remove('open');
    }
    function openCommandPalette() { openPalette('cmd', 'Type a command…'); }
    function openQuickOpen() { openPalette('open', 'Search files in project…'); }
    function openGoToLine() { openPalette('goto', 'Line number…'); buildPaletteList(''); }

    function getCommands() {
        return [
            { id: 'save', label: 'Save File', hint: 'Ctrl+S', run: () => { try { saveCurrentFile(); } catch (_) {} } },
            { id: 'quick', label: 'Quick Open File…', hint: 'Ctrl+P', run: () => openQuickOpen() },
            { id: 'goto', label: 'Go to Line…', hint: 'Ctrl+G', run: () => openGoToLine() },
            { id: 'new', label: 'New Lua File…', hint: '', run: () => ideNewFile() },
            { id: 'explorer', label: 'Toggle File Explorer', hint: 'Ctrl+B', run: () => toggleExplorer() },
            { id: 'play', label: 'Play Game', hint: '', run: () => {
                try { if (typeof saveCurrentFile === 'function') saveCurrentFile(); } catch (_) {}
                try { const btn = $('btn-start-play'); if (btn) btn.click(); } catch (_) {}
            } },
            { id: 'undo', label: 'Undo', hint: 'Ctrl+Z', run: () => { try { if (window.editor) window.editor.undo(); } catch (_) {} } },
            { id: 'redo', label: 'Redo', hint: 'Ctrl+Y', run: () => { try { if (window.editor) window.editor.redo(); } catch (_) {} } },
            { id: 'console', label: 'Toggle Console', hint: '', run: () => {
                const c = $('ide-console'); if (c) c.classList.toggle('collapsed');
            } },
            { id: 'back', label: 'Back to Project Files', hint: '', run: () => { try { closeEditor(); } catch (_) {} } }
        ];
    }

    function buildPaletteList(query) {
        const list = $('ide-palette-list');
        if (!list) return;
        const q = (query || '').trim().toLowerCase();
        paletteItems = [];
        if (paletteMode === 'goto') {
            list.innerHTML = '<div class="ide-palette-empty">Type a line number and press Enter</div>';
            return;
        }
        if (paletteMode === 'open') {
            const proj = getProjectName();
            const projs = getProjects();
            const files = Object.keys((projs[proj] || {})).sort();
            let assets = {}, music = {};
            try { if (typeof getProjectAssetMap === 'function') assets = getProjectAssetMap(proj) || {}; } catch (_) {}
            try { if (typeof getProjectMusicMap === 'function') music = getProjectMusicMap(proj) || {}; } catch (_) {}
            files.forEach(fn => {
                if (!q || fn.toLowerCase().indexOf(q) >= 0)
                    paletteItems.push({ label: fn, hint: 'Lua', run: () => ideOpenFile(fn) });
            });
            Object.keys(assets).forEach(fn => {
                if (!q || fn.toLowerCase().indexOf(q) >= 0)
                    paletteItems.push({ label: fn, hint: 'Sprite', run: () => { try { openSpriteEditor(fn); } catch (_) {} } });
            });
            Object.keys(music).forEach(fn => {
                if (!q || fn.toLowerCase().indexOf(q) >= 0)
                    paletteItems.push({ label: fn, hint: 'Music', run: () => { try { openMusicEditor(fn); } catch (_) {} } });
            });
        } else {
            getCommands().forEach(c => {
                if (!q || c.label.toLowerCase().indexOf(q) >= 0 || c.id.indexOf(q) >= 0) paletteItems.push(c);
            });
        }
        if (!paletteItems.length) {
            list.innerHTML = '<div class="ide-palette-empty">No matches</div>';
            return;
        }
        if (paletteIndex >= paletteItems.length) paletteIndex = 0;
        list.innerHTML = paletteItems.map((it, i) => {
            const active = i === paletteIndex ? ' active' : '';
            return '<div class="ide-palette-item' + active + '" data-idx="' + i + '">' +
                '<span>' + escapeHtml(it.label) + '</span>' +
                (it.hint ? '<span class="ide-pal-hint">' + escapeHtml(it.hint) + '</span>' : '') + '</div>';
        }).join('');
        list.querySelectorAll('.ide-palette-item').forEach(el => {
            el.onmouseenter = () => { paletteIndex = parseInt(el.getAttribute('data-idx'), 10) || 0; buildPaletteList(query); };
            el.onclick = () => runPaletteItem(parseInt(el.getAttribute('data-idx'), 10));
        });
    }

    function runPaletteItem(idx) {
        const it = paletteItems[idx];
        closePalette();
        if (it && typeof it.run === 'function') { try { it.run(); } catch (e) { console.warn(e); } }
        refreshIdeChrome();
    }
    function onPaletteInput() {
        const inp = $('ide-palette-input');
        buildPaletteList(inp ? inp.value : '');
    }
    function onPaletteKey(e) {
        const inp = $('ide-palette-input');
        if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
        if (paletteMode === 'goto') {
            if (e.key === 'Enter') {
                e.preventDefault();
                const n = parseInt((inp && inp.value) || '', 10);
                closePalette();
                if (n > 0) jumpToLine(n);
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1);
            buildPaletteList(inp ? inp.value : '');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            paletteIndex = Math.max(0, paletteIndex - 1);
            buildPaletteList(inp ? inp.value : '');
        } else if (e.key === 'Enter') {
            e.preventDefault();
            runPaletteItem(paletteIndex);
        }
    }

    function patchSetStatus() {
        if (typeof window.setStatus !== 'function' || window.setStatus._ide) return;
        const _set = window.setStatus;
        window.setStatus = function (msg, type) {
            try { _set.apply(this, arguments); } catch (_) {}
            if (type === 'error' && msg) {
                const m = String(msg).match(/line\s+(\d+)/i) || String(msg).match(/:(\d+)/);
                lastErrorLine = m ? parseInt(m[1], 10) : null;
                ideLog(String(msg), 'err');
            } else if (type === 'ok') lastErrorLine = null;
            refreshStatusBar(msg, type);
        };
        window.setStatus._ide = true;
        try { setStatus = window.setStatus; } catch (_) {}
    }

    function patchOpenFile() {
        const of = typeof window.openFile === 'function' ? window.openFile
            : (typeof openFile === 'function' ? openFile : null);
        if (!of || of._ide) return;
        const wrapped = function (name) {
            ensureIdeDom();
            ensureTabOpen(name);
            const r = of.apply(this, arguments);
            const proj = getProjectName();
            if (proj && openTabs.length <= 1) {
                const saved = loadOpenTabs(proj);
                if (saved.length) {
                    openTabs = saved;
                    ensureTabOpen(name);
                }
            }
            setTimeout(() => { refreshIdeChrome(); wireEditorEvents(); }, 0);
            return r;
        };
        wrapped._ide = true;
        window.openFile = wrapped;
        try { openFile = wrapped; } catch (_) {}
    }

    function patchRenderTabs() {
        const rt = typeof window.renderTabs === 'function' ? window.renderTabs
            : (typeof renderTabs === 'function' ? renderTabs : null);
        if (rt && rt._ide) return;
        const wrapped = function () { renderIdeTabs(); refreshExplorer(); refreshStatusBar(); };
        wrapped._ide = true;
        window.renderTabs = wrapped;
        try { renderTabs = wrapped; } catch (_) {}
    }

    function patchUpdateDirtyUI() {
        const ud = typeof window.updateDirtyUI === 'function' ? window.updateDirtyUI
            : (typeof updateDirtyUI === 'function' ? updateDirtyUI : null);
        if (!ud || ud._ide) return;
        const wrapped = function () {
            try { ud.apply(this, arguments); } catch (_) {}
            refreshIdeChrome();
            if (window.isDirty) scheduleAutosave();
        };
        wrapped._ide = true;
        window.updateDirtyUI = wrapped;
        try { updateDirtyUI = wrapped; } catch (_) {}
    }

    function patchSaveCurrentFile() {
        const sf = typeof window.saveCurrentFile === 'function' ? window.saveCurrentFile
            : (typeof saveCurrentFile === 'function' ? saveCurrentFile : null);
        if (!sf || sf._ide) return;
        const wrapped = function () {
            const r = sf.apply(this, arguments);
            if (typeof currentFileName === 'string') delete dirtyMap[currentFileName];
            refreshIdeChrome();
            return r;
        };
        wrapped._ide = true;
        window.saveCurrentFile = wrapped;
        try { saveCurrentFile = wrapped; } catch (_) {}
    }

    function wireEditorEvents() {
        try {
            if (!window.editor || window.editor._ideWired) return;
            window.editor._ideWired = true;
            window.editor.on('cursorActivity', () => refreshStatusBar());
            window.editor.on('change', () => {
                if (window.isDirty) scheduleAutosave();
                refreshStatusBar();
            });
        } catch (_) {}
    }

    function wireKeyboard() {
        if (window._ideKeysWired) return;
        window._ideKeysWired = true;
        document.addEventListener('keydown', (e) => {
            const view = $('editor-view');
            const inEditor = view && (view.classList.contains('active') ||
                (view.style.display && view.style.display !== 'none'));
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            const key = (e.key || '').toLowerCase();
            if (key === 's' && inEditor) {
                e.preventDefault();
                try { saveCurrentFile(); } catch (_) {}
                refreshIdeChrome();
                return;
            }
            if (key === 'p') {
                e.preventDefault();
                if (e.shiftKey) openCommandPalette();
                else openQuickOpen();
                return;
            }
            if (key === 'g' && inEditor) {
                e.preventDefault();
                openGoToLine();
                return;
            }
            if (key === 'b' && inEditor) {
                e.preventDefault();
                toggleExplorer();
            }
        }, true);
    }

    function onViewMaybeEditor() {
        const view = $('editor-view');
        if (!view) return;
        ensureIdeDom();
        const proj = getProjectName();
        if (proj) {
            const saved = loadOpenTabs(proj);
            if (saved.length) openTabs = saved;
        }
        if (typeof currentFileName === 'string' && currentFileName) ensureTabOpen(currentFileName);
        wireEditorEvents();
        refreshIdeChrome();
    }

    function patchSwitchView() {
        const sv = typeof window.switchView === 'function' ? window.switchView
            : (typeof switchView === 'function' ? switchView : null);
        if (!sv || sv._ide) return;
        const wrapped = function (id) {
            const r = sv.apply(this, arguments);
            if (id === 'editor-view') setTimeout(onViewMaybeEditor, 0);
            return r;
        };
        wrapped._ide = true;
        window.switchView = wrapped;
        try { switchView = wrapped; } catch (_) {}
    }

    function initIdeShell() {
        ensureIdeDom();
        patchSetStatus();
        patchOpenFile();
        patchRenderTabs();
        patchUpdateDirtyUI();
        patchSaveCurrentFile();
        patchSwitchView();
        wireKeyboard();
        wireEditorEvents();
        onViewMaybeEditor();
        let tries = 0;
        const t = setInterval(() => {
            tries++;
            patchSetStatus(); patchOpenFile(); patchRenderTabs();
            patchUpdateDirtyUI(); patchSaveCurrentFile(); patchSwitchView();
            wireEditorEvents();
            if (tries > 30) clearInterval(t);
        }, 400);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initIdeShell, 150));
    } else {
        setTimeout(initIdeShell, 150);
    }

    try {
        window.refreshIdeChrome = refreshIdeChrome;
        window.ideOpenFile = ideOpenFile;
        window.ideLog = ideLog;
        window.openCommandPalette = openCommandPalette;
        window.openQuickOpen = openQuickOpen;
        window.openGoToLine = openGoToLine;
    } catch (_) {}
})();

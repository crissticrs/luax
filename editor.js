// src/editor.js — CodeMirror Lua editor, hints, tabs, save

// ============================================================
// EDITOR — autocomplete + hover docs for LuaX API
// ============================================================
/** Full engine API reference used by hints and hover tooltips */
const LUAX_API_DOCS = [
    // Graphics
    { name: 'gfx.cls', insert: 'gfx.cls(', detail: 'color?', doc: 'Clear the screen.\ngfx.cls("#000")' },
    { name: 'gfx.rect', insert: 'gfx.rect(', detail: 'x,y,w,h,c?', doc: 'Draw rectangle outline.\ngfx.rect(10, 10, 40, 20, "#fff")' },
    { name: 'gfx.rectfill', insert: 'gfx.rectfill(', detail: 'x,y,w,h,c?', doc: 'Draw filled rectangle.\ngfx.rectfill(10, 10, 40, 20, "#0f0")' },
    { name: 'gfx.circle', insert: 'gfx.circle(', detail: 'x,y,r,c?', doc: 'Draw circle outline.\ngfx.circle(100, 100, 20, "#fff")' },
    { name: 'gfx.circlefill', insert: 'gfx.circlefill(', detail: 'x,y,r,c?', doc: 'Draw filled circle.\ngfx.circlefill(100, 100, 20, "#f00")' },
    { name: 'gfx.line', insert: 'gfx.line(', detail: 'x1,y1,x2,y2,c?', doc: 'Draw a line.\ngfx.line(0, 0, 100, 50, "#fff")' },
    { name: 'gfx.pixel', insert: 'gfx.pixel(', detail: 'x,y,c?', doc: 'Draw a single pixel.\ngfx.pixel(50, 50, "#fff")' },
    { name: 'gfx.text', insert: 'gfx.text(', detail: 'str,x,y,c?,font?', doc: 'Draw text.\ngfx.text("Hi", 16, 30, "#fff", "16px sans-serif")' },
    { name: 'gfx.cam', insert: 'gfx.cam(', detail: 'x,y', doc: 'Set 2D camera offset.\ngfx.cam(player.x - 100, 0)' },
    { name: 'gfx.sprite', insert: 'gfx.sprite(', detail: 'name,x,y,w?,h?', doc: 'Draw an imported PNG asset.\ngfx.sprite("player.png", x, y)\ngfx.sprite("player.png", x, y, 32, 32)' },
    { name: 'gfx.anim', insert: 'gfx.anim(', detail: 'sheet,frame,x,y,fw?,fh?,dw?,dh?,cols?,rows?', doc: 'Draw a frame from a sprite sheet (0-based).\nBest for N×M grids:\ngfx.anim("hero.png", frame, x, y, 0, 0, 96, 96, 2, 2)\n-- cols=2 rows=2 auto-splits the image\nOr pixel cells: gfx.anim("walk.png", frame, x, y, 32, 32)\nframe = math.floor(t * 8) % 4' },
    { name: 'gfx.sprites', insert: 'gfx.sprites()', detail: '→ list', doc: 'Return table of asset filenames in this project.' },
    { name: 'gfx.raycast', insert: 'gfx.raycast(', detail: 'opts', doc: 'Wolfenstein-style 3D raycast.\ngfx.raycast({\n  map=map, x=px, y=py,\n  angle=yaw, pitch=pitch,\n  fov=math.pi/3, colors=colors,\n  ceil="#111", floor="#222", fog=14\n})' },
    { name: 'gfx.width', insert: 'gfx.width()', detail: '→ number', doc: 'Logical screen width (CSS pixels).' },
    { name: 'gfx.height', insert: 'gfx.height()', detail: '→ number', doc: 'Logical screen height (CSS pixels).' },
    // Input
    { name: 'btn', insert: 'btn(', detail: 'i → bool', doc: 'Button held.\n0 Up · 1 Down · 2 Left · 3 Right\n4 A · 5 B · 6 X · 7 Y' },
    { name: 'btnp', insert: 'btnp(', detail: 'i → bool', doc: 'Button pressed this frame (edge).\nSame indices as btn().' },
    { name: 'btnr', insert: 'btnr(', detail: 'i → bool', doc: 'Button released this frame.\nSame indices as btn().' },
    { name: 'axis', insert: 'axis(', detail: 'i → number', doc: 'Analog stick: axis(0)=X, axis(1)=Y.\nRange about -1 … 1.' },
    { name: 'look', insert: 'look()', detail: '→ yaw, pitch', doc: 'Camera look deltas this frame.\nlocal dx, dy = look()\nangle = angle + dx\npitch = pitch - dy' },
    { name: 'lookx', insert: 'lookx()', detail: '→ number', doc: 'Horizontal look delta (yaw) this frame.' },
    { name: 'looky', insert: 'looky()', detail: '→ number', doc: 'Vertical look delta (pitch) this frame.' },
    { name: 'mouse.x', insert: 'mouse.x', detail: 'number', doc: 'Pointer X in canvas coordinates.' },
    { name: 'mouse.y', insert: 'mouse.y', detail: 'number', doc: 'Pointer Y in canvas coordinates.' },
    { name: 'mouse.btn', insert: 'mouse.btn', detail: 'bool', doc: 'True while primary pointer is down.' },
    // Audio / system
    { name: 'sfx.beep', insert: 'sfx.beep(', detail: 'freq,dur?,type?', doc: 'Play a short beep.\nsfx.beep(440, 0.1)\nsfx.beep(880, 0.05, "square")\nTypes: square, sine, sawtooth, triangle' },
    { name: 'sfx.music', insert: 'sfx.music({', detail: 'bpm,loop,wave,ch…', doc: '4-channel step sequencer (8–32 steps).\nsfx.music({ bpm=120, loop=true, wave=\"square\",\n  { 523,0,587,0,659,0,523,0,440,0,523,0,0,0,0,0 },\n  { 262,262,294,294,330,330,262,262,220,220,262,262,0,0,0,0 },\n})\n0 = rest. sfx.note(\"C4\") for Hz.' },
    { name: 'sfx.stop', insert: 'sfx.stop(', detail: '', doc: 'Stop music pattern.' },
    { name: 'sfx.playing', insert: 'sfx.playing(', detail: '', doc: 'true while music plays.' },
    { name: 'sfx.note', insert: 'sfx.note(', detail: 'name', doc: 'Note name to Hz. sfx.note(\"C4\")' },
    { name: 'dt', insert: 'dt', detail: 'number', doc: 'Delta time in seconds for this frame (use in _update).' },
    { name: 'print', insert: 'print(', detail: '...', doc: 'Log to the in-game console (☰ Log).' },
    { name: 'require', insert: 'require(', detail: 'mod', doc: 'Load another .lua file in this project.\nlocal p = require("player")' },
    { name: 'is_mobile', insert: 'is_mobile()', detail: '→ bool', doc: 'True when running on a phone/tablet.' },
    { name: 'set_controls_visible', insert: 'set_controls_visible(', detail: 'bool', doc: 'Show/hide on-screen gamepad (mobile).' },
    { name: 'controls_visible', insert: 'controls_visible()', detail: '→ bool', doc: 'Whether on-screen gamepad is visible.' },
    // Callbacks (snippets)
    { name: '_update', insert: 'function _update(dt)\n    \nend', detail: 'callback', doc: 'Called every frame with delta time (seconds). Put game logic here.' },
    { name: '_draw', insert: 'function _draw()\n    \nend', detail: 'callback', doc: 'Called every frame after _update. Put drawing calls here.' },
];

const LUAX_API_BY_NAME = {};
LUAX_API_DOCS.forEach(d => { LUAX_API_BY_NAME[d.name] = d; });

function luaxHint(cm) {
    const cur = cm.getCursor();
    const token = cm.getTokenAt(cur);
    let start = token.start;
    let end = cur.ch;
    let word = token.string || '';

    // Expand to full identifier including dots: gfx.cls
    const line = cm.getLine(cur.line) || '';
    while (start > 0 && /[\w.]/.test(line.charAt(start - 1))) start--;
    while (end < line.length && /[\w]/.test(line.charAt(end))) end++;
    word = line.slice(start, end);

    // After "gfx." only suggest gfx.* methods
    const lower = word.toLowerCase();
    const list = LUAX_API_DOCS.filter(d => {
        if (!lower) return true;
        return d.name.toLowerCase().indexOf(lower) === 0 ||
            d.name.toLowerCase().indexOf('.' + lower) !== -1;
    }).map(d => ({
        text: d.insert,
        displayText: d.name,
        className: 'cm-luax-hint',
        hint: function (cm2, data, completion) {
            cm2.replaceRange(completion.text, completion.from || data.from, completion.to || data.to, 'complete');
        },
        render: function (el) {
            el.appendChild(document.createTextNode(d.name));
            const span = document.createElement('span');
            span.className = 'cm-luax-hint-detail';
            span.textContent = d.detail || '';
            el.appendChild(span);
        },
        from: CodeMirror.Pos(cur.line, start),
        to: CodeMirror.Pos(cur.line, end),
    }));

    return {
        list: list,
        from: CodeMirror.Pos(cur.line, start),
        to: CodeMirror.Pos(cur.line, end),
    };
}

let editor = null;
try {
    if (typeof CodeMirror !== 'undefined' && document.getElementById('editor')) {
        editor = CodeMirror(document.getElementById('editor'), {
            mode: 'lua', theme: 'material-ocean',
            lineNumbers: true, matchBrackets: true, indentUnit: 4,
            styleActiveLine: true,
            viewportMargin: 80,
            historyEventDelay: 250,
            undoDepth: 200,
            gutters: ['CodeMirror-linenumbers', 'luax-error-gutter'],
            extraKeys: {
                'Ctrl-Space': function (cm) { cm.showHint({ hint: luaxHint, completeSingle: false }); },
                'Cmd-Space': function (cm) { cm.showHint({ hint: luaxHint, completeSingle: false }); },
                'Ctrl-A': function (cm) { cm.execCommand('selectAll'); },
                'Cmd-A': function (cm) { cm.execCommand('selectAll'); },
                'Ctrl-Z': function (cm) { cm.undo(); },
                'Cmd-Z': function (cm) { cm.undo(); },
                'Ctrl-Y': function (cm) { cm.redo(); },
                'Cmd-Shift-Z': function (cm) { cm.redo(); },
                'Ctrl-Shift-Z': function (cm) { cm.redo(); },
            },
        });
    } else {
        console.warn('CodeMirror not available — code editor disabled, PLAY still works');
    }
} catch (e) {
    console.warn('CodeMirror init failed', e);
    editor = null;
}

/** Active error widgets/markers in the editor */
let editorErrorState = { widgets: [], lineHandle: null, line: null };

function clearEditorErrors() {
    if (!editor) return;
    (editorErrorState.widgets || []).forEach(w => {
        try { editor.removeLineWidget(w); } catch (_) {}
    });
    editorErrorState.widgets = [];
    if (editorErrorState.line != null) {
        try { editor.setGutterMarker(editorErrorState.line, 'luax-error-gutter', null); } catch (_) {}
        try { editor.removeLineClass(editorErrorState.line, 'background', 'luax-error-line'); } catch (_) {}
    }
    editorErrorState.line = null;
    editorErrorState.lineHandle = null;
}

/**
 * Parse Lua / Fengari error strings for 1-based line number.
 * Examples:
 *   [string "@main.lua"]:12: unexpected symbol near 'end'
 *   main.lua:8: attempt to index a nil value
 *   @:3: ...
 */
function parseLuaErrorLine(errMsg) {
    if (!errMsg) return null;
    const s = String(errMsg);
    const patterns = [
        /\[string\s+"[^"]*"\]:(\d+)\s*:/,
        /@[\w./\\-]*:(\d+)\s*:/,
        /(?:^|[\s(])([\w./\\-]+\.lua):(\d+)\s*:/,
        /:(\d+)\s*:\s+/,
    ];
    for (let i = 0; i < patterns.length; i++) {
        const m = s.match(patterns[i]);
        if (!m) continue;
        // last capture group is usually the line
        const line = parseInt(m[m.length - 1], 10);
        if (line > 0 && line < 100000) return line;
    }
    return null;
}

/** Strip source prefix from error for cleaner widget text */
function formatLuaErrorMessage(errMsg) {
    let s = String(errMsg || '');
    s = s.replace(/^\[string\s+"[^"]*"\]:\d+\s*:\s*/i, '');
    s = s.replace(/^@[\w./\\-]*:\d+\s*:\s*/i, '');
    s = s.replace(/^[\w./\\-]+\.lua:\d+\s*:\s*/i, '');
    return s.trim() || String(errMsg);
}

/**
 * Highlight a line in the editor and show an inline error widget.
 * lineNum is 1-based (Lua style).
 */
function setEditorError(lineNum, errMsg) {
    clearEditorErrors();
    if (!editor || !lineNum || lineNum < 1) return;
    const lineCount = editor.lineCount();
    const idx = Math.min(Math.max(lineNum, 1), lineCount) - 1; // 0-based

    editor.addLineClass(idx, 'background', 'luax-error-line');

    const marker = document.createElement('div');
    marker.className = 'luax-error-marker';
    marker.title = formatLuaErrorMessage(errMsg);
    editor.setGutterMarker(idx, 'luax-error-gutter', marker);

    const node = document.createElement('div');
    node.className = 'luax-error-widget';
    node.textContent = 'Line ' + lineNum + ': ' + formatLuaErrorMessage(errMsg);
    const widget = editor.addLineWidget(idx, node, { coverGutter: false, noHScroll: true });

    editorErrorState = { widgets: [widget], line: idx, lineHandle: null };

    try {
        editor.scrollIntoView({ line: idx, ch: 0 }, 80);
    } catch (_) {}
}

/** Run syntax check and apply inline highlight if needed */
function applyEditorSyntaxCheck(code, filename) {
    const err = checkSyntax(code, filename || currentFileName || 'file.lua');
    if (!err) {
        clearEditorErrors();
        return null;
    }
    const line = parseLuaErrorLine(err);
    if (line) setEditorError(line, err);
    else clearEditorErrors();
    return err;
}

if (editor) {
editor.on('change', () => {
    if (!currentFileName) return;
    try {
        const now = editor.getValue();
        isDirty = (now !== savedContent);
        updateDirtyUI();
        if (editorErrorState.line != null) clearEditorErrors();
        clearTimeout(editor._luaxLintTimer);
        // Debounce lint — avoid freezing on select-all + delete
        editor._luaxLintTimer = setTimeout(() => {
            if (!currentFileName || !editor) return;
            try {
                const code = editor.getValue();
                if (code.length > 80000) return; // skip lint on huge pastes
                applyEditorSyntaxCheck(code, currentFileName);
            } catch (_) {}
        }, 900);
    } catch (_) {}
});

// Auto-show hints while typing identifiers / after a dot (not on delete/paste floods)
editor.on('inputRead', function (cm, change) {
    try {
        if (!change || change.origin !== '+input') return;
        const text = (change.text && change.text[0]) || '';
        if (!/[\w.]/.test(text)) return;
        if (text.length > 1) return;
        const tok = cm.getTokenAt(cm.getCursor());
        if (tok && (tok.type === 'string' || tok.type === 'comment')) return;
        CodeMirror.commands.autocomplete(cm, null, { hint: luaxHint, completeSingle: false });
    } catch (_) {}
});
}

function editorUndo() {
    if (!editor) return;
    editor.focus();
    editor.undo();
}
function editorRedo() {
    if (!editor) return;
    editor.focus();
    editor.redo();
}
function editorSelectAll() {
    if (!editor) return;
    editor.focus();
    editor.execCommand('selectAll');
}
function editorDeleteAll() {
    if (!editor) return;
    if (!confirm('Clear all text in this file? You can Undo.')) return;
    try {
        editor.focus();
        const last = { line: editor.lastLine(), ch: (editor.getLine(editor.lastLine()) || '').length };
        editor.replaceRange('', { line: 0, ch: 0 }, last, '+delete');
    } catch (_) {
        editor.setValue('');
    }
}

/** Copy selected text (or whole file if nothing selected) via Clipboard API — bypasses soft copy guard */
async function editorCopy() {
    if (!editor) return;
    editor.focus();
    let text = '';
    try {
        text = editor.getSelection();
        if (!text) text = editor.getValue();
    } catch (_) {
        text = '';
    }
    if (!text) {
        try { setStatus('Nothing to copy', ''); setTimeout(() => setStatus(''), 1500); } catch (_) {}
        return;
    }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            try { setStatus('Copied ✓', 'ok'); setTimeout(() => setStatus(''), 1500); } catch (_) {}
            return;
        }
    } catch (_) {
        // fall through to prompt
    }
    // Fallback: show text so user can copy manually
    try {
        prompt('Copy this text (Ctrl/Cmd+C):', text);
    } catch (_) {}
}

/** Paste — quiet Clipboard API, clean prompt fallback (no big console errors) */
async function editorPaste() {
    if (!editor) return;
    editor.focus();

    // Prefer modern Clipboard API when available and permitted
    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        try {
            const t = await navigator.clipboard.readText();
            if (typeof t === 'string') {
                editor.replaceSelection(t, 'around');
                return;
            }
        } catch (err) {
            // Permission denied / insecure context / etc. — silent, use fallback
            // Do not rethrow; avoids the large browser console error noise
        }
    }

    // Fallback: prompt dialog (always works, no permission required)
    let t = null;
    try {
        t = prompt('Paste text here (then OK):');
    } catch (_) {
        t = null;
    }
    if (t != null && t !== '') {
        try {
            editor.replaceSelection(t, 'around');
        } catch (_) {}
    }
}

// Hover documentation tooltip
(function setupLuaxHoverDocs() {
    if (!editor) return;
    const tip = document.createElement('div');
    tip.className = 'luax-hover-tip';
    tip.innerHTML = '<div class="tip-sig"></div><div class="tip-body"></div>';
    document.body.appendChild(tip);
    let hideTimer = null;

    function hideTip() {
        tip.style.display = 'none';
    }

    function wordAt(cm, pos) {
        const line = cm.getLine(pos.line) || '';
        let s = pos.ch, e = pos.ch;
        while (s > 0 && /[\w.]/.test(line.charAt(s - 1))) s--;
        while (e < line.length && /[\w.]/.test(line.charAt(e))) e++;
        // Prefer longest matching API name under cursor
        const full = line.slice(s, e);
        if (LUAX_API_BY_NAME[full]) return full;
        // Try trailing part after last dot chain pieces
        const parts = full.split('.');
        for (let i = 0; i < parts.length; i++) {
            const candidate = parts.slice(i).join('.');
            if (LUAX_API_BY_NAME[candidate]) return candidate;
        }
        // Single token match (btn, dt, …)
        if (parts.length && LUAX_API_BY_NAME[parts[parts.length - 1]]) {
            return parts[parts.length - 1];
        }
        return null;
    }

    editor.on('cursorActivity', hideTip);

    editor.getWrapperElement().addEventListener('mousemove', function (ev) {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        const pos = editor.coordsChar({ left: ev.clientX, top: ev.clientY }, 'window');
        const name = wordAt(editor, pos);
        if (!name || !LUAX_API_BY_NAME[name]) {
            hideTip();
            return;
        }
        const d = LUAX_API_BY_NAME[name];
        tip.querySelector('.tip-sig').textContent = d.name + (d.detail ? '  ·  ' + d.detail : '');
        tip.querySelector('.tip-body').textContent = d.doc || '';
        tip.style.display = 'block';
        let x = ev.clientX + 14;
        let y = ev.clientY + 18;
        const pad = 8;
        tip.style.left = '0px';
        tip.style.top = '0px';
        // measure then clamp
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        if (x + tw > window.innerWidth - pad) x = window.innerWidth - tw - pad;
        if (y + th > window.innerHeight - pad) y = ev.clientY - th - 12;
        tip.style.left = Math.max(pad, x) + 'px';
        tip.style.top = Math.max(pad, y) + 'px';
    });

    editor.getWrapperElement().addEventListener('mouseleave', function () {
        hideTimer = setTimeout(hideTip, 120);
    });
})();

// ---------------------------------------------------------------
// Soft code protection: block copy/cut from the editor; allow paste.
// This is friction only — browser DevTools can still read anything.
// Screenshots cannot be blocked by a website (OS-level).
// Toolbar Copy button uses clipboard.writeText and is not blocked.
// ---------------------------------------------------------------
(function setupEditorClipboardGuard() {
    // Soft copy protection only — do NOT block cut/delete/select (that froze the editor).
    const editorRoot = document.getElementById('editor');
    if (!editorRoot) return;

    function inEditorTarget(t) {
        if (!t) return false;
        if (editorRoot.contains(t)) return true;
        if (t.classList && (t.classList.contains('CodeMirror-code') || t.classList.contains('CodeMirror-line'))) return true;
        return !!(t.closest && t.closest('.CodeMirror'));
    }

    function blockCopyOnly(e) {
        try {
            if (!inEditorTarget(e.target)) {
                const sel = window.getSelection && window.getSelection();
                if (!(sel && sel.anchorNode && inEditorTarget(sel.anchorNode.parentElement || sel.anchorNode))) {
                    return;
                }
            }
            e.preventDefault();
        } catch (_) {}
        return false;
    }

    document.addEventListener('copy', blockCopyOnly, true);
    // cut is allowed so selection + delete works on all devices

    editorRoot.addEventListener('keydown', (e) => {
        const key = (e.key || '').toLowerCase();
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;
        // Block copy only — allow X (cut), A (select all), V (paste), Z (undo)
        if (key === 'c' || (key === 'insert' && e.ctrlKey && !e.shiftKey)) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, true);

    try {
        const ta = editor && editor.getInputField && editor.getInputField();
        if (ta) {
            ta.addEventListener('copy', (e) => { e.preventDefault(); }, true);
        }
    } catch (_) {}
})();

function updateDirtyUI() {
    const title = document.getElementById('current-file-title');
    title.textContent = (isDirty ? '• ' : '') + (currentFileName || '');
    const btn = document.getElementById('save-btn');
    btn.classList.toggle('dirty', isDirty);
    renderTabs();
}

function renderTabs() {
    const bar = document.getElementById('tabs-bar');
    if (!currentProjectName) { bar.innerHTML = ''; return; }
    const files = Object.keys(projects[currentProjectName] || {}).sort();
    bar.innerHTML = files.map(fn => {
        const active = fn === currentFileName ? ' active' : '';
        const dirty = (fn === currentFileName && isDirty) ? '<span class="dirty-dot">•</span>' : '';
        return `<div class="tab${active}" onclick="switchTab('${esc(fn)}')">${dirty}${escapeHtml(fn)}</div>`;
    }).join('');
}

function switchTab(fn) {
    if (fn === currentFileName) return;
    if (isDirty) {
        const stay = !confirm('Unsaved changes in ' + currentFileName + '.\n\nOK = discard and switch\nCancel = stay');
        if (stay) return;
        isDirty = false;
        try {
            if (savedContent != null && currentFileName && currentProjectName) {
                projects[currentProjectName][currentFileName] = savedContent;
            }
        } catch (_) {}
    }
    openFile(fn);
}

function openFile(name) {
    if (!isAuthed()) { applyAuthGate(); return; }
    currentFileName = name;
    const content = projects[currentProjectName][name] || '';
    savedContent = content;
    isDirty = false;
    clearEditorErrors();
    if (editor) {
        editor.setValue(content);
        switchView('editor-view');
        renderTabs();
        updateDirtyUI();
        setStatus('');
        setTimeout(() => {
            try { editor.refresh(); editor.focus(); } catch (_) {}
            applyEditorSyntaxCheck(content, name);
        }, 40);
    } else {
        // CodeMirror missing — still allow PLAY; show plain alert for editing
        alert('Code editor failed to load, but PLAY still works.\n\nFile: ' + name + '\n\nReload the page on a stable connection to edit code.');
        switchView('files-view');
    }
}

function setStatus(msg, type) {
    const el = document.getElementById('status-bar');
    if (!msg) { el.style.display = 'none'; el.className = ''; return; }
    el.style.display = 'block';
    el.textContent = msg;
    el.className = type || '';
}

function checkSyntax(code, filename) {
    if (typeof fengari === 'undefined') return null;
    try {
        const L = fengari.L;
        // load only (don't run)
        const bytes = fengari.to_luastring(code);
        const status = fengari.lauxlib.luaL_loadbuffer(L, bytes, bytes.length, fengari.to_luastring('@' + filename));
        if (status !== fengari.lua.LUA_OK) {
            const err = fengari.to_jsstring(fengari.lua.lua_tostring(L, -1));
            fengari.lua.lua_pop(L, 1);
            return err;
        }
        fengari.lua.lua_pop(L, 1); // pop the function
        return null;
    } catch (e) {
        return String(e.message || e);
    }
}

function saveCurrentFile() {
    if (!currentProjectName || !currentFileName) return;
    if (!editor) { alert('Code editor not loaded'); return; }
    const code = editor.getValue();
    projects[currentProjectName][currentFileName] = code;
    saveState();
    savedContent = code;
    isDirty = false;
    updateDirtyUI();

    const err = applyEditorSyntaxCheck(code, currentFileName);
    if (err) {
        const line = parseLuaErrorLine(err);
        setStatus(
            line
                ? ('Syntax error on line ' + line + ': ' + formatLuaErrorMessage(err))
                : ('Syntax error: ' + err),
            'error'
        );
    } else {
        clearEditorErrors();
        setStatus('Saved ✓  No syntax errors', 'ok');
        setTimeout(() => setStatus(''), 2500);
    }
}

function closeEditor() {
    if (isDirty && editor) {
        const stay = !confirm('You have unsaved changes.\n\nOK = discard and go back\nCancel = keep editing');
        if (stay) return;
        // Discard: reload last saved content into projects is already there
        isDirty = false;
        try {
            if (savedContent != null && currentFileName && currentProjectName) {
                // ensure in-memory project keeps last saved version
                projects[currentProjectName][currentFileName] = savedContent;
            }
        } catch (_) {}
    }
    try { if (editor) editor.getInputField()?.blur(); } catch (_) {}
    renderFiles();
    switchView('files-view');
}

// Inject Copy button into editor toolbar (keeps soft copy protection; toolbar Copy works)
(function injectEditorCopyButton() {
    function ensure() {
        const bar = document.getElementById('editor-toolbar');
        if (!bar) return;
        if (bar.querySelector('[data-luax-copy]')) return;
        const pasteBtn = Array.from(bar.querySelectorAll('button')).find(b =>
            (b.getAttribute('onclick') || '').indexOf('editorPaste') !== -1 ||
            (b.textContent || '').trim().toLowerCase() === 'paste'
        );
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm';
        btn.setAttribute('data-luax-copy', '1');
        btn.title = 'Copy selection (or whole file)';
        btn.textContent = 'Copy';
        btn.onclick = function () { editorCopy(); };
        if (pasteBtn && pasteBtn.parentNode === bar) {
            bar.insertBefore(btn, pasteBtn);
        } else {
            const selectBtn = Array.from(bar.querySelectorAll('button')).find(b =>
                (b.getAttribute('onclick') || '').indexOf('editorSelectAll') !== -1
            );
            if (selectBtn && selectBtn.nextSibling) {
                bar.insertBefore(btn, selectBtn.nextSibling);
            } else {
                bar.appendChild(btn);
            }
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensure);
    } else {
        ensure();
    }
    setTimeout(ensure, 500);
    setTimeout(ensure, 2000);
})();

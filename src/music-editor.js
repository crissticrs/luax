// src/music-editor.js — visual step sequencer / chiptune music editor

const MUSIC_KEY = 'luadeck_project_music';
let projectMusic = {};
try { projectMusic = JSON.parse(localStorage.getItem(MUSIC_KEY) || '{}') || {}; } catch (_) { projectMusic = {}; }

function saveProjectMusic() {
    try { localStorage.setItem(MUSIC_KEY, JSON.stringify(projectMusic)); } catch (_) {}
}
function getProjectMusicMap(name) {
    if (!projectMusic[name]) projectMusic[name] = {};
    return projectMusic[name];
}

const musEd = {
    name: '',
    bpm: 120,
    steps: 16,
    channelCount: 10,
    wave: 'square',
    channels: null,
    paintNote: 'C4',
};

const MUS_NOTES = ['', 'C3','D3','E3','F3','G3','A3','B3','C4','D4','E4','F4','G4','A4','B4','C5'];

function musicEmptyGrid(steps, chCount) {
    const n = chCount != null ? chCount : (musEd.channelCount || MUS_CHANNEL_COUNT);
    return Array.from({ length: n }, () => Array(steps).fill(''));
}

function refreshMusicLimitUI() {
    const maxCh = musicMaxChannels();
    const maxSt = musicMaxSteps();
    const chSel = document.getElementById('mus-channels');
    const stSel = document.getElementById('mus-steps');
    if (chSel) {
        Array.from(chSel.options).forEach(opt => {
            const v = parseInt(opt.value, 10);
            opt.disabled = v > maxCh;
        });
        if (parseInt(chSel.value, 10) > maxCh) chSel.value = String(maxCh);
    }
    if (stSel) {
        Array.from(stSel.options).forEach(opt => {
            const v = parseInt(opt.value, 10);
            opt.disabled = v > maxSt;
        });
        if (parseInt(stSel.value, 10) > maxSt) stSel.value = String(maxSt);
    }
    const hint = document.getElementById('mus-limit-hint');
    if (hint) {
        if (typeof isPro === 'function' && isPro()) {
            hint.innerHTML = '<b>Pro</b>: up to ' + MUS_PRO_MAX_CHANNELS + ' channels × ' + MUS_PRO_MAX_STEPS + ' steps';
        } else {
            hint.innerHTML = 'Free: up to <b>' + MUS_FREE_MAX_CHANNELS + '</b> channels × <b>' + MUS_FREE_MAX_STEPS + '</b> steps · <span style="color:var(--accent-color);cursor:pointer;font-weight:700" onclick="openSubscriptionInfo()">Pro unlocks more</span>';
        }
    }
}

function requireMusicProFor(nChannels, nSteps) {
    const needPro = (nChannels > MUS_FREE_MAX_CHANNELS) || (nSteps > MUS_FREE_MAX_STEPS);
    if (!needPro) return true;
    if (typeof isPro === 'function' && isPro()) return true;
    openSubscriptionInfo();
    return false;
}

function syncMusicFromEditorLive() {
    if (!musicState.active) return;
    if (!document.getElementById('music-editor-view')?.classList.contains('active')) return;
    const bpm = parseInt((document.getElementById('mus-bpm') || {}).value, 10) || musEd.bpm;
    const wave = (document.getElementById('mus-wave') || {}).value || musEd.wave;
    const steps = musEd.steps;
    const nCh = musEd.channelCount || (musEd.channels && musEd.channels.length) || MUS_CHANNEL_COUNT;
    const channels = [];
    const waves = [];
    for (let c = 0; c < nCh; c++) {
        const row = (musEd.channels && musEd.channels[c]) || [];
        channels[c] = normalizeChannel(row.map(n => (n ? noteToFreq(n) : 0)), steps);
        waves[c] = wave || 'square';
    }
    musicState.bpm = Math.max(40, Math.min(240, bpm));
    musicState.wave = wave === 'custom' ? 'square' : wave;
    musicState.waves = waves.map(() => (wave === 'custom' ? (musSynth.baseWave || 'square') : wave));
    musicState.synth = getActiveSynthParams();
    if (musicState.steps !== steps) {
        musicState.steps = steps;
        if (musicState.step >= steps) musicState.step = 0;
    }
    musicState.channels = channels;
}

function updateMusicLiveBar(stepIdx) {
    const stepEl = document.getElementById('mus-live-step');
    const notesEl = document.getElementById('mus-live-notes');
    if (!stepEl || !notesEl) return;
    if (!musicState.active || stepIdx == null || stepIdx < 0) {
        stepEl.textContent = '—';
        notesEl.innerHTML = '<span class="mus-live-empty">Press ▶ Play to hear notes live</span>';
        return;
    }
    stepEl.textContent = (stepIdx + 1) + ' / ' + musicState.steps;
    const chips = [];
    const nCh = (musicState.channels && musicState.channels.length) || 0;
    const ed = (document.getElementById('music-editor-view')?.classList.contains('active') && musEd.channels) ? musEd.channels : null;
    for (let c = 0; c < nCh; c++) {
        let label = '';
        if (ed && ed[c]) label = ed[c][stepIdx] || '';
        else {
            const cell = musicState.channels[c] && musicState.channels[c][stepIdx];
            if (typeof cell === 'object' && cell && cell.f) label = Math.round(cell.f) + 'Hz';
            else if (typeof cell === 'number' && cell > 0) label = Math.round(cell) + 'Hz';
        }
        if (label) {
            const col = (typeof musChannelColor === 'function') ? musChannelColor(c) : 'var(--accent-color)';
            chips.push('<span class="mus-live-chip" title="Ch' + (c + 1) + '" style="background:' + col + ';border-color:' + col + '">Ch' + (c + 1) + ' ' + label + '</span>');
        }
    }
    notesEl.innerHTML = chips.length ? chips.join('') : '<span class="mus-live-empty">Rest (no notes this step)</span>';
}

function updateMusicPlayhead(stepIdx) {
    const grid = document.getElementById('mus-grid');
    if (!grid) return;
    grid.querySelectorAll('.mus-cell.playhead').forEach(el => el.classList.remove('playhead'));
    if (stepIdx == null || stepIdx < 0 || !musicState.active) return;
    grid.querySelectorAll('.mus-cell[data-step="' + stepIdx + '"]').forEach(el => el.classList.add('playhead'));
}

function openMusicEditor(existingName) {
    if (!currentProjectName) return alert('Open a project first');
    musEd.name = existingName || '';
    const map = getProjectMusicMap(currentProjectName);
    if (existingName && map[existingName]) {
        const p = map[existingName];
        let steps = p.steps || 16;
        let loaded = (p.channels || []).map(ch => {
            const row = Array(steps).fill('');
            for (let i = 0; i < steps; i++) row[i] = (ch && ch[i]) || '';
            return row;
        });
        if (!loaded.length) loaded = musicEmptyGrid(steps, 10);
        let chCount = loaded.length;
        if (!isPro()) {
            if (chCount > MUS_FREE_MAX_CHANNELS) { loaded = loaded.slice(0, MUS_FREE_MAX_CHANNELS); chCount = MUS_FREE_MAX_CHANNELS; }
            if (steps > MUS_FREE_MAX_STEPS) { steps = MUS_FREE_MAX_STEPS; loaded = loaded.map(ch => ch.slice(0, steps)); }
        } else {
            chCount = Math.min(chCount, MUS_PRO_MAX_CHANNELS);
            steps = Math.min(steps, MUS_PRO_MAX_STEPS);
        }
        musEd.bpm = p.bpm || 120;
        musEd.steps = steps;
        musEd.wave = p.wave || 'square';
        musEd.synth = p.synth || null;
        if (p.synth && p.synth.custom) musEd.wave = 'custom';
        musEd.channelCount = chCount;
        musEd.channels = loaded;
    } else {
        musEd.bpm = 120; musEd.steps = 16; musEd.channelCount = 10; musEd.wave = 'square';
        musEd.channels = musicEmptyGrid(16, 10);
    }
    const title = document.getElementById('music-editor-title');
    if (title) title.textContent = musEd.name || 'New pattern';
    const bpm = document.getElementById('mus-bpm');
    if (bpm) bpm.value = musEd.bpm;
    refreshMusicLimitUI();
    const st = document.getElementById('mus-steps');
    if (st) {
        if (![...st.options].some(o => o.value === String(musEd.steps))) {
            const o = document.createElement('option'); o.value = String(musEd.steps); o.textContent = String(musEd.steps); st.appendChild(o);
        }
        st.value = String(musEd.steps);
    }
    const ch = document.getElementById('mus-channels');
    if (ch) {
        if (![...ch.options].some(o => o.value === String(musEd.channelCount))) {
            const o = document.createElement('option'); o.value = String(musEd.channelCount); o.textContent = String(musEd.channelCount); ch.appendChild(o);
        }
        ch.value = String(musEd.channelCount);
    }
    const wv = document.getElementById('mus-wave');
    if (wv) {
        const w = musEd.wave || 'square';
        if (w === 'custom' || (musEd.synth && musEd.synth.custom)) wv.value = 'custom';
        else wv.value = w;
    }
    if (musEd.synth) {
        ['pitch','length','volume','slide','noise','echo'].forEach(k => {
            if (musEd.synth[k] == null) return;
            const el = document.getElementById('mus-syn-' + k);
            if (el) el.value = musEd.synth[k];
            const lab = document.getElementById('mus-syn-' + k + '-v');
            if (lab) lab.textContent = String(musEd.synth[k]);
            musSynth[k] = musEd.synth[k];
        });
    }
    onMusWaveChange();
    renderMusicNoteBar();
    renderMusicGrid();
    ensureAudio();
    startMusWaveVisualizer();
    switchView('music-editor-view');
}

function closeMusicEditor() {
    try { stopMusic(); } catch (_) {}
    switchView('files-view');
}

function musicEditorResizeSteps() {
    const st = document.getElementById('mus-steps');
    let n = parseInt(st && st.value, 10) || 16;
    if (!requireMusicProFor(musEd.channelCount || 10, n)) {
        if (st) st.value = String(musEd.steps);
        refreshMusicLimitUI();
        return;
    }
    n = clampMusicSteps(n);
    if (st) st.value = String(n);
    const old = musEd.channels || musicEmptyGrid(n);
    const chCount = musEd.channelCount || old.length || 10;
    musEd.steps = n;
    musEd.channels = Array.from({ length: chCount }, (_, c) => {
        const row = Array(n).fill('');
        for (let i = 0; i < n; i++) row[i] = (old[c] && old[c][i]) || '';
        return row;
    });
    renderMusicGrid();
    syncMusicFromEditorLive();
}

function musicEditorResizeChannels() {
    const chSel = document.getElementById('mus-channels');
    let n = parseInt(chSel && chSel.value, 10) || 10;
    if (!requireMusicProFor(n, musEd.steps || 16)) {
        if (chSel) chSel.value = String(musEd.channelCount || 10);
        refreshMusicLimitUI();
        return;
    }
    n = clampMusicChannels(n);
    if (chSel) chSel.value = String(n);
    const steps = musEd.steps || 16;
    const old = musEd.channels || musicEmptyGrid(steps, n);
    musEd.channelCount = n;
    musEd.channels = Array.from({ length: n }, (_, c) => {
        const row = Array(steps).fill('');
        for (let i = 0; i < steps; i++) row[i] = (old[c] && old[c][i]) || '';
        return row;
    });
    renderMusicGrid();
    syncMusicFromEditorLive();
}

function renderMusicNoteBar() {
    const bar = document.getElementById('mus-note-bar');
    if (!bar) return;
    bar.innerHTML = '';
    MUS_NOTES.forEach(n => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mus-note-btn' + (musEd.paintNote === n ? ' active' : '');
        b.textContent = n === '' ? '∅' : n;
        b.title = n === '' ? 'Rest (clear)' : n;
        b.onclick = () => { musEd.paintNote = n; renderMusicNoteBar(); };
        bar.appendChild(b);
    });
}

const MUS_CHANNEL_COLORS = [
    '#8b5cf6', '#22c55e', '#3b82f6', '#f59e0b', '#f43f5e',
    '#14b8a6', '#e879f9', '#84cc16', '#38bdf8', '#fb923c',
    '#a78bfa', '#4ade80', '#60a5fa', '#fbbf24', '#fb7185', '#2dd4bf'
];

function musChannelColor(c) {
    return MUS_CHANNEL_COLORS[c % MUS_CHANNEL_COLORS.length];
}

function renderMusicGrid() {
    const grid = document.getElementById('mus-grid');
    if (!grid || !musEd.channels) return;
    const steps = musEd.steps;
    const nCh = musEd.channelCount || musEd.channels.length || 10;
    musEd.channelCount = nCh;
    while (musEd.channels.length < nCh) musEd.channels.push(Array(steps).fill(''));
    if (musEd.channels.length > nCh) musEd.channels = musEd.channels.slice(0, nCh);
    const wide = (typeof window !== 'undefined' && window.innerWidth >= 900);
    const labelW = wide ? 48 : 36;
    const cellW = wide ? (window.innerWidth >= 1200 ? 48 : 42) : 30;
    const rowH = wide ? (window.innerWidth >= 1200 ? 38 : 34) : 24;
    grid.style.gridTemplateColumns = labelW + 'px repeat(' + steps + ', ' + cellW + 'px)';
    grid.style.gridAutoRows = rowH + 'px';
    const wrap = document.getElementById('mus-grid-wrap');
    if (wrap) {
        const gap = wide ? 4 : 2;
        const pad = wide ? 20 : 12;
        const contentH = nCh * rowH + Math.max(0, nCh - 1) * gap + pad;
        wrap.style.height = contentH + 'px';
        wrap.style.minHeight = contentH + 'px';
    }
    grid.innerHTML = '';
    const playStep = (musicState.active && musicState.lastPlayedStep >= 0) ? musicState.lastPlayedStep : -1;
    for (let c = 0; c < nCh; c++) {
        if (!musEd.channels[c]) musEd.channels[c] = Array(steps).fill('');
        const color = musChannelColor(c);
        const lab = document.createElement('div');
        lab.className = 'mus-row-label';
        lab.textContent = String(c + 1);
        lab.title = 'Channel ' + (c + 1);
        lab.style.setProperty('--ch-color', color);
        lab.style.color = color;
        grid.appendChild(lab);
        for (let s = 0; s < steps; s++) {
            const cell = document.createElement('button');
            cell.type = 'button';
            const val = musEd.channels[c][s] || '';
            cell.className = 'mus-cell' + (val ? ' on' : '') + (s === playStep ? ' playhead' : '');
            cell.textContent = val || '';
            cell.title = val ? ('Ch' + (c + 1) + ' · ' + val) : ('Ch' + (c + 1) + ' · step ' + (s + 1));
            cell.style.setProperty('--ch-color', color);
            if (!val) cell.style.borderColor = color + '33';
            cell.dataset.ch = c;
            cell.dataset.step = s;
            cell.onclick = () => {
                const cur = musEd.channels[c][s] || '';
                if (musEd.paintNote === '') musEd.channels[c][s] = '';
                else if (cur === musEd.paintNote) musEd.channels[c][s] = '';
                else musEd.channels[c][s] = musEd.paintNote;
                renderMusicGrid();
                syncMusicFromEditorLive();
                if (musicState.active && musicState.lastPlayedStep >= 0) updateMusicLiveBar(musicState.lastPlayedStep);
            };
            grid.appendChild(cell);
        }
    }
}

function musicEditorSpec() {
    const bpm = parseInt((document.getElementById('mus-bpm') || {}).value, 10) || musEd.bpm;
    let wave = (document.getElementById('mus-wave') || {}).value || musEd.wave;
    const steps = musEd.steps;
    const channels = (musEd.channels || musicEmptyGrid(steps)).map(ch => ch.map(n => n ? noteToFreq(n) : 0));
    const synth = getActiveSynthParams();
    if (wave === 'custom') wave = synth.wave || 'square';
    return { bpm, wave, steps, loop: true, channels, synth };
}

function normalizeMusicName(name) {
    name = String(name || '').trim().replace(/[^\w.\-]+/g, '_');
    if (!name) return '';
    if (!/\.music$/i.test(name)) name += '.music';
    return name;
}

function resolveMusicPattern(name) {
    if (!currentProjectName || !name) return null;
    const map = getProjectMusicMap(currentProjectName);
    if (map[name]) return map[name];
    if (/\.music$/i.test(name)) {
        const bare = name.replace(/\.music$/i, '');
        if (map[bare]) return map[bare];
    } else if (map[name + '.music']) return map[name + '.music'];
    return null;
}

function previewMusicEditor() {
    ensureAudio();
    const spec = musicEditorSpec();
    spec.vol = 0.1;
    startMusic(spec);
    updateMusicPlayButton();
}

function saveMusicFromEditor() {
    if (!currentProjectName) return;
    let name = musEd.name;
    if (!name) {
        name = prompt('Pattern name (e.g. theme)', 'theme');
        if (!name) return;
    }
    name = normalizeMusicName(name);
    if (!name) return;
    const bpm = parseInt((document.getElementById('mus-bpm') || {}).value, 10) || 120;
    let wave = (document.getElementById('mus-wave') || {}).value || 'square';
    const steps = musEd.steps;
    const channels = (musEd.channels || musicEmptyGrid(steps)).map(ch => ch.slice());
    const synth = getActiveSynthParams();
    if (wave === 'custom') musEd.synth = synth;
    const map = getProjectMusicMap(currentProjectName);
    map[name] = { bpm, wave, steps, channels, synth: wave === 'custom' ? synth : undefined };
    saveProjectMusic();
    musEd.name = name;
    const title = document.getElementById('music-editor-title');
    if (title) title.textContent = name;
    const bare = name.replace(/\.music$/i, '');
    alert('Saved "' + name + '".\n\nIn Lua (both work):\nsfx.music("' + name + '")\nsfx.music("' + bare + '")');
    try { stopMusic(); } catch (_) {}
    switchView('files-view');
    renderFiles();
}

const _startMusicRaw = typeof startMusic === 'function' ? startMusic : null;
startMusic = function(spec) {
    if (typeof spec === 'string') {
        const p = resolveMusicPattern(spec);
        if (!p) {
            console.warn('Music pattern not found:', spec);
            try { pushConsole('Music not found: ' + spec, 'err'); } catch (_) {}
            return;
        }
        const channels = (p.channels || []).map(ch =>
            (ch || []).map(n => {
                if (typeof n === 'number') return n;
                return n ? noteToFreq(n) : 0;
            })
        );
        spec = {
            bpm: p.bpm || 120,
            wave: p.wave || 'square',
            steps: p.steps || 16,
            loop: true,
            vol: 0.08,
            channels: channels,
            synth: p.synth || null
        };
    }
    if (_startMusicRaw) return _startMusicRaw(spec);
};

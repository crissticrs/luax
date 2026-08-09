// src/play-mode.js — input, audio, LuaShim, game loop, PLAY/EXIT

// ============================================================
// DEVICE + ON-SCREEN CONTROLS
// ============================================================
// Desktop → hide joystick + face buttons (use WASD + mouse look)
// Mobile  → show them
// Export / force off → ?nocontrols=1  or  setControlsVisible(false)

function detectMobile() {
    // Prefer capability checks over user-agent alone
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const noHover = window.matchMedia && window.matchMedia('(hover: none)').matches;
    const touchPoints = (navigator.maxTouchPoints || 0) > 0;
    const ua = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
    // iPadOS desktop UA still has touch
    const iPadDesktop = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return !!(coarse || noHover || ua || iPadDesktop || (touchPoints && Math.min(screen.width, screen.height) < 900));
}

const isMobileDevice = detectMobile();

/**
 * On-screen gamepad: mobile only.
 * Desktop never shows joystick/face buttons (keyboard + mouse look).
 * On mobile, per-project Gamepad ON/OFF still applies.
 */
function applyControlsVisibility() {
    let show = false;
    if (isMobileDevice) {
        show = currentProjectName ? getProjectGamepad(currentProjectName) : true;
    }
    document.body.classList.toggle('controls-hidden', !show);
    return !show;
}

/** Public API: set current project's gamepad (also updates UI if on files view) */
function setControlsVisible(visible) {
    if (currentProjectName) {
        setProjectGamepad(currentProjectName, !!visible);
        updateGamepadToggleUI();
    }
    applyControlsVisibility();
}
function areControlsVisible() {
    return !document.body.classList.contains('controls-hidden');
}

window.LuaDeckControls = {
    isMobile: () => isMobileDevice,
    setVisible: setControlsVisible,
    isVisible: areControlsVisible,
    apply: applyControlsVisibility
};

// ============================================================
// INPUT STATE
// ============================================================
const canvas = document.getElementById('game-canvas');
const ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;

let loopId = null;
let isPlaying = false;
let isPaused = false;
let lastTime = 0;
let fpsFrames = 0;
let fpsTimer = 0;
let currentFps = 0;

// 0:Up 1:Down 2:Left 3:Right 4:A 5:B 6:X 7:Y
let btnState = new Array(8).fill(false);
let btnPrevState = new Array(8).fill(false);
let stickAxis = { x: 0, y: 0 };
let pointer = { x: 0, y: 0, btn: false };
let lookDeltaX = 0;         // yaw this frame
let lookDeltaY = 0;         // pitch this frame
let _lastLookY = 0;         // paired with lookx/looky single consume
let lookSensitivity = 0.004;
let lookActive = false;
let lookLastX = 0;
let lookLastY = 0;
let lookPointerId = null;
let cam = { x: 0, y: 0 };
let consoleOpen = false;
const consoleLines = [];

const stickEl = document.getElementById('joystick-stick');
const zoneEl = document.getElementById('joystick-zone');
const maxJoy = 48;
let joyActive = false;
let joyPointerId = null;

function updateStick(cx, cy) {
    const rect = zoneEl.getBoundingClientRect();
    const mx = rect.left + rect.width / 2;
    const my = rect.top + rect.height / 2;
    let dx = cx - mx, dy = cy - my;
    const dist = Math.hypot(dx, dy);
    if (dist > maxJoy) { dx = dx / dist * maxJoy; dy = dy / dist * maxJoy; }
    stickEl.style.transform = `translate(${dx}px,${dy}px)`;
    stickAxis.x = dx / maxJoy;
    stickAxis.y = dy / maxJoy;
    // Stick only drives axis — digital btn 0-3 stay keyboard-only to avoid conflicts
}

function resetStick() {
    stickEl.style.transform = 'translate(0,0)';
    stickAxis.x = stickAxis.y = 0;
    joyActive = false;
    joyPointerId = null;
}

function isInside(el, clientX, clientY) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

function isOnControl(clientX, clientY) {
    if (isInside(zoneEl, clientX, clientY)) return true;
    if (isInside(document.getElementById('action-container'), clientX, clientY)) return true;
    if (isInside(document.querySelector('.play-top-bar'), clientX, clientY)) return true;
    if (consoleOpen && isInside(document.getElementById('console-panel'), clientX, clientY)) return true;
    return false;
}

// Camera look: right half when on-screen stick is visible, full screen when controls hidden
function isLookArea(clientX, clientY) {
    if (isOnControl(clientX, clientY)) return false;
    // Desktop / export (no joystick) → entire screen is look area
    if (!areControlsVisible()) return true;
    const rect = canvas.getBoundingClientRect();
    const midX = rect.left + rect.width * 0.45; // left ~45% reserved for movement stick
    return clientX >= midX;
}

function joyStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const t = e.changedTouches ? e.changedTouches[0] : e;
    joyActive = true;
    joyPointerId = t.identifier !== undefined ? t.identifier : 'mouse';
    updateStick(t.clientX, t.clientY);
}
function joyMove(e) {
    if (!joyActive) return;
    e.preventDefault();
    const t = e.changedTouches
        ? Array.from(e.changedTouches).find(x => x.identifier === joyPointerId)
        : e;
    if (!t) return;
    updateStick(t.clientX, t.clientY);
}
function joyEnd(e) {
    if (!joyActive) return;
    const t = e.changedTouches
        ? Array.from(e.changedTouches).find(x => x.identifier === joyPointerId)
        : e;
    if (e.changedTouches && !t) return; // different finger
    e.preventDefault();
    resetStick();
}

zoneEl.addEventListener('touchstart', joyStart, { passive: false });
zoneEl.addEventListener('touchmove', joyMove, { passive: false });
zoneEl.addEventListener('touchend', joyEnd, { passive: false });
zoneEl.addEventListener('touchcancel', joyEnd, { passive: false });
zoneEl.addEventListener('mousedown', e => {
    joyStart(e);
    const mv = ev => joyMove(ev);
    const up = ev => { joyEnd(ev); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
});
zoneEl.addEventListener('contextmenu', e => e.preventDefault());

function setupAction(id) {
    const el = document.getElementById(id);
    const idx = +el.dataset.btn;
    const down = e => { e.preventDefault(); e.stopPropagation(); btnState[idx] = true; el.classList.add('active-btn'); };
    const up = e => { e.preventDefault(); btnState[idx] = false; el.classList.remove('active-btn'); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
}
['btn-a','btn-b','btn-x','btn-y'].forEach(setupAction);

// Keyboard
const keyMap = {
    ArrowUp: 0, KeyW: 0, ArrowDown: 1, KeyS: 1,
    ArrowLeft: 2, KeyA: 2, ArrowRight: 3, KeyD: 3,
    KeyZ: 4, Space: 4, KeyX: 5, KeyC: 6, KeyV: 7
};
// Q/E also turn via a dedicated look from keys
let keyLook = 0;
window.addEventListener('keydown', e => {
    if (!isPlaying) return;
    const i = keyMap[e.code];
    if (i !== undefined) {
        e.preventDefault();
        btnState[i] = true;
        if (i >= 4) {
            const ids = ['btn-a','btn-b','btn-x','btn-y'];
            document.getElementById(ids[i-4])?.classList.add('active-btn');
        }
    }
    if (e.code === 'KeyQ' || e.code === 'Comma') { keyLook = -1; e.preventDefault(); }
    if (e.code === 'KeyE' || e.code === 'Period') { keyLook = 1; e.preventDefault(); }
    if (e.code === 'Escape') stopPlayMode();
    if (e.code === 'KeyP') togglePause();
});
window.addEventListener('keyup', e => {
    if (!isPlaying) return;
    const i = keyMap[e.code];
    if (i !== undefined) {
        e.preventDefault();
        btnState[i] = false;
        if (i >= 4) {
            const ids = ['btn-a','btn-b','btn-x','btn-y'];
            document.getElementById(ids[i-4])?.classList.remove('active-btn');
        }
    }
    if (e.code === 'KeyQ' || e.code === 'Comma' || e.code === 'KeyE' || e.code === 'Period') {
        keyLook = 0;
    }
});

// Pointer / touch-look over the play area (not on joystick or face buttons)
function updatePointerPos(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = clientX - rect.left;
    pointer.y = clientY - rect.top;
}

function lookStart(clientX, clientY, pointerId) {
    if (!isPlaying || isPaused) return;
    if (!isLookArea(clientX, clientY)) return;
    lookActive = true;
    lookLastX = clientX;
    lookLastY = clientY;
    lookPointerId = pointerId;
    pointer.btn = true;
    updatePointerPos(clientX, clientY);
}

function lookMove(clientX, clientY, pointerId) {
    if (!lookActive || pointerId !== lookPointerId) return;
    const dx = clientX - lookLastX;
    const dy = clientY - lookLastY;
    lookLastX = clientX;
    lookLastY = clientY;
    lookDeltaX += dx * lookSensitivity;
    lookDeltaY += dy * lookSensitivity;
    updatePointerPos(clientX, clientY);
}

function lookEnd(pointerId) {
    if (pointerId !== lookPointerId) return;
    lookActive = false;
    lookPointerId = null;
    pointer.btn = false;
}

// Look handlers on canvas + play-view (ui-layer has pointer-events:none so empty
// areas pass through to the canvas; joystick/buttons sit on top with their own handlers)
canvas.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
        lookStart(t.clientX, t.clientY, t.identifier);
    }
}, { passive: true });
canvas.addEventListener('touchmove', e => {
    if (!lookActive) return;
    for (const t of e.changedTouches) {
        if (t.identifier === lookPointerId) {
            e.preventDefault();
            lookMove(t.clientX, t.clientY, t.identifier);
        }
    }
}, { passive: false });
canvas.addEventListener('touchend', e => {
    for (const t of e.changedTouches) lookEnd(t.identifier);
}, { passive: true });
canvas.addEventListener('touchcancel', e => {
    for (const t of e.changedTouches) lookEnd(t.identifier);
}, { passive: true });

canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    lookStart(e.clientX, e.clientY, 'mouse');
});
window.addEventListener('mousemove', e => {
    if (lookActive && lookPointerId === 'mouse') lookMove(e.clientX, e.clientY, 'mouse');
    else if (isPlaying) updatePointerPos(e.clientX, e.clientY);
});
window.addEventListener('mouseup', e => {
    if (e.button === 0) lookEnd('mouse');
});

// Consume look deltas each frame. Returns { x: yaw, y: pitch } in radian-ish units.
function consumeLook() {
    const out = {
        x: lookDeltaX + keyLook * 0.045,
        y: lookDeltaY
    };
    lookDeltaX = 0;
    lookDeltaY = 0;
    return out;
}

// ============================================================
// AUDIO
// ============================================================
let audioCtx = null;
let audioMaster = null;   // GainNode → analyser → destination
let audioAnalyser = null;
let audioWaveData = null;
let musWaveAnimId = null;

function ensureAudio() {
    if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (audioCtx && !audioMaster) {
        try {
            audioMaster = audioCtx.createGain();
            audioMaster.gain.value = 1;
            audioAnalyser = audioCtx.createAnalyser();
            audioAnalyser.fftSize = 2048;
            audioAnalyser.smoothingTimeConstant = 0.75;
            audioWaveData = new Uint8Array(audioAnalyser.fftSize);
            audioMaster.connect(audioAnalyser);
            audioAnalyser.connect(audioCtx.destination);
            startMusWaveVisualizer();
        } catch (_) {
            audioMaster = null;
            audioAnalyser = null;
        }
    }
}

function audioOut() {
    return audioMaster || (audioCtx && audioCtx.destination);
}

/** Default / custom synth params (0–100 UI scale). */
const musSynth = {
    pitch: 50,   // 0 = -1 octave, 50 = unison, 100 = +1 octave
    length: 40,  // note duration scale
    volume: 55,
    slide: 15,   // pitch bend amount
    noise: 0,
    echo: 10,
    baseWave: 'square'
};

function readMusSynthFromUI() {
    const ids = ['pitch', 'length', 'volume', 'slide', 'noise', 'echo'];
    ids.forEach(k => {
        const el = document.getElementById('mus-syn-' + k);
        if (el) {
            musSynth[k] = Math.max(0, Math.min(100, parseInt(el.value, 10) || 0));
            const lab = document.getElementById('mus-syn-' + k + '-v');
            if (lab) lab.textContent = String(musSynth[k]);
        }
    });
}

function onMusSynthChange() {
    readMusSynthFromUI();
    syncMusicFromEditorLive();
}

function onMusWaveChange() {
    const wv = document.getElementById('mus-wave');
    const wave = (wv && wv.value) || 'square';
    musSynth.baseWave = wave === 'custom' ? 'square' : wave;
    const card = document.getElementById('mus-synth-card');
    if (card) card.style.display = wave === 'custom' ? 'block' : 'none';
    if (wave === 'custom') readMusSynthFromUI();
    syncMusicFromEditorLive();
}

function getActiveSynthParams() {
    const wv = (document.getElementById('mus-wave') || {}).value || musSynth.baseWave || 'square';
    if (wv === 'custom') {
        readMusSynthFromUI();
        return {
            wave: musSynth.baseWave || 'square',
            pitch: musSynth.pitch,
            length: musSynth.length,
            volume: musSynth.volume,
            slide: musSynth.slide,
            noise: musSynth.noise,
            echo: musSynth.echo,
            custom: true
        };
    }
    return {
        wave: wv,
        pitch: 50,
        length: 40,
        volume: 55,
        slide: 0,
        noise: 0,
        echo: 0,
        custom: false
    };
}

function playBeep(freq, dur, type, vol, opts) {
    ensureAudio();
    if (!audioCtx) return;
    opts = opts || {};
    try {
        const t0 = audioCtx.currentTime;
        const baseF = Math.max(20, Number(freq) || 440);
        // pitch 0–100 → multiply 0.5 … 2.0
        const pitchAmt = (opts.pitch != null ? opts.pitch : 50) / 100;
        const fMul = 0.5 + pitchAmt * 1.5; // 0.5 .. 2.0
        const fStartSlide = opts.slide != null ? opts.slide : 0;
        // slide: start higher or lower then settle
        const slideAmt = fStartSlide / 100;
        const f0 = baseF * fMul * (1 + slideAmt * 0.85);
        const f1 = baseF * fMul;

        const lenScale = (opts.length != null ? opts.length : 40) / 100;
        const d = Math.max(0.03, (Number(dur) || 0.1) * (0.35 + lenScale * 1.8));

        const volUI = opts.volume != null ? opts.volume : 55;
        let v = (vol != null && vol > 0) ? Number(vol) : (0.03 + (volUI / 100) * 0.18);
        v = Math.min(0.28, Math.max(0.01, v));

        const oscType = type || opts.wave || 'square';
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = (oscType === 'custom') ? 'square' : oscType;
        osc.frequency.setValueAtTime(f0, t0);
        if (slideAmt > 0.02) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + d * 0.55);
        } else {
            osc.frequency.setValueAtTime(f1, t0);
        }
        gain.gain.setValueAtTime(v, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + d);

        const mix = audioCtx.createGain();
        mix.gain.value = 1;
        osc.connect(gain);
        gain.connect(mix);

        // Noise mix
        const noiseAmt = (opts.noise != null ? opts.noise : 0) / 100;
        if (noiseAmt > 0.02) {
            const nLen = Math.floor(audioCtx.sampleRate * d);
            const buf = audioCtx.createBuffer(1, nLen, audioCtx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < nLen; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
            const noise = audioCtx.createBufferSource();
            noise.buffer = buf;
            const ng = audioCtx.createGain();
            ng.gain.setValueAtTime(v * noiseAmt * 0.7, t0);
            ng.gain.exponentialRampToValueAtTime(0.001, t0 + d);
            noise.connect(ng);
            ng.connect(mix);
            noise.start(t0);
            noise.stop(t0 + d + 0.02);
        }

        // Echo (delay)
        const echoAmt = (opts.echo != null ? opts.echo : 0) / 100;
        if (echoAmt > 0.02) {
            const delay = audioCtx.createDelay(1.0);
            delay.delayTime.value = 0.12 + echoAmt * 0.22;
            const fb = audioCtx.createGain();
            fb.gain.value = Math.min(0.55, 0.15 + echoAmt * 0.4);
            const echoGain = audioCtx.createGain();
            echoGain.gain.value = echoAmt * 0.7;
            mix.connect(delay);
            delay.connect(fb);
            fb.connect(delay);
            delay.connect(echoGain);
            echoGain.connect(audioOut());
        }

        mix.connect(audioOut());
        osc.start(t0);
        osc.stop(t0 + d + 0.05);
    } catch (_) {}
}

function previewMusSynth() {
    const p = getActiveSynthParams();
    playBeep(440, 0.12, p.wave, null, p);
}

function startMusWaveVisualizer() {
    if (musWaveAnimId) return;
    const draw = () => {
        musWaveAnimId = requestAnimationFrame(draw);
        drawMusWaveform();
    };
    musWaveAnimId = requestAnimationFrame(draw);
}

function drawMusWaveform() {
    const canvas = document.getElementById('mus-wave-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    // background
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, w, h);
    // center line
    ctx.strokeStyle = 'rgba(139,92,246,0.15)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    let accent = '#8b5cf6';
    try {
        accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || accent;
    } catch (_) {}

    if (audioAnalyser && audioWaveData) {
        audioAnalyser.getByteTimeDomainData(audioWaveData);
        ctx.lineWidth = 2;
        ctx.strokeStyle = accent;
        ctx.beginPath();
        const slice = w / audioWaveData.length;
        for (let i = 0; i < audioWaveData.length; i++) {
            const v = audioWaveData[i] / 128.0;
            const y = (v * h) / 2;
            const x = i * slice;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // soft glow fill
        ctx.globalAlpha = 0.12;
        ctx.lineTo(w, h / 2);
        ctx.lineTo(0, h / 2);
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.globalAlpha = 1;
    } else {
        // idle sine
        const t = performance.now() / 1000;
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
            const y = h / 2 + Math.sin(x * 0.04 + t * 3) * 8;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

const MUS_FREE_MAX_CHANNELS = 10;
const MUS_FREE_MAX_STEPS = 16;
const MUS_PRO_MAX_CHANNELS = 16;
const MUS_PRO_MAX_STEPS = 64;
/** Default / free max; actual row count is musEd.channelCount */
const MUS_CHANNEL_COUNT = MUS_FREE_MAX_CHANNELS;

function musicMaxChannels() {
    try { return isPro() ? MUS_PRO_MAX_CHANNELS : MUS_FREE_MAX_CHANNELS; } catch (_) { return MUS_FREE_MAX_CHANNELS; }
}
function musicMaxSteps() {
    try { return isPro() ? MUS_PRO_MAX_STEPS : MUS_FREE_MAX_STEPS; } catch (_) { return MUS_FREE_MAX_STEPS; }
}
function clampMusicChannels(n) {
    n = Math.max(1, Math.min(MUS_PRO_MAX_CHANNELS, parseInt(n, 10) || MUS_CHANNEL_COUNT));
    const max = musicMaxChannels();
    if (n > max) return max;
    return n;
}
function clampMusicSteps(n) {
    n = Math.max(4, Math.min(MUS_PRO_MAX_STEPS, parseInt(n, 10) || 16));
    const max = musicMaxSteps();
    if (n > max) return max;
    return n;
}

const musicState = {
    active: false, loop: true, bpm: 120, steps: 16, step: 0, acc: 0,
    wave: 'square', vol: 0.08,
    channels: Array.from({ length: MUS_PRO_MAX_CHANNELS }, () => []),
    waves: Array.from({ length: MUS_PRO_MAX_CHANNELS }, () => 'square'),
    _clockId: null,
    _clockLast: 0,
    lastPlayedStep: -1,
};

const NOTE_FREQ = {
    'C2':65.41,'C#2':69.30,'D2':73.42,'D#2':77.78,'E2':82.41,'F2':87.31,'F#2':92.50,'G2':98.00,'G#2':103.83,'A2':110.00,'A#2':116.54,'B2':123.47,
    'C3':130.81,'C#3':138.59,'D3':146.83,'D#3':155.56,'E3':164.81,'F3':174.61,'F#3':185.00,'G3':196.00,'G#3':207.65,'A3':220.00,'A#3':233.08,'B3':246.94,
    'C4':261.63,'C#4':277.18,'D4':293.66,'D#4':311.13,'E4':329.63,'F4':349.23,'F#4':369.99,'G4':392.00,'G#4':415.30,'A4':440.00,'A#4':466.16,'B4':493.88,
    'C5':523.25,'C#5':554.37,'D5':587.33,'D#5':622.25,'E5':659.25,'F5':698.46,'F#5':739.99,'G5':783.99,'G#5':830.61,'A5':880.00,'A#5':932.33,'B5':987.77,
    'C6':1046.50
};

function noteToFreq(n) {
    if (n == null || n === 0 || n === '0' || n === '-') return 0;
    if (typeof n === 'number') return n > 0 ? n : 0;
    const s = String(n).trim().toUpperCase().replace('S', '#');
    if (NOTE_FREQ[s]) return NOTE_FREQ[s];
    const num = Number(n);
    return (num > 0) ? num : 0;
}

function normalizeChannel(row, steps) {
    const out = new Array(steps).fill(0);
    if (!row) return out;
    const len = row.length != null ? Number(row.length) : 0;
    for (let i = 0; i < steps; i++) {
        let cell = (i < len) ? row[i] : 0;
        if ((cell == null || cell === undefined) && row[i + 1] != null) cell = row[i + 1];
        if (cell && typeof cell === 'object') {
            out[i] = {
                f: noteToFreq(cell.f != null ? cell.f : (cell.freq != null ? cell.freq : cell.note)),
                wave: cell.wave || cell.type || null,
                dur: cell.dur != null ? cell.dur : null,
                vol: cell.vol != null ? cell.vol : null
            };
        } else {
            out[i] = noteToFreq(cell);
        }
    }
    return out;
}

function startMusic(spec) {
    ensureAudio();
    if (!spec || typeof spec !== 'object') return;
    const steps = Math.max(4, Math.min(32, Math.floor(Number(spec.steps) || 16)));
    const bpm = Math.max(40, Math.min(240, Number(spec.bpm) || 120));
    const wave = spec.wave || spec.type || 'square';
    const vol = (spec.vol != null) ? Number(spec.vol) : 0.05;
    const loop = spec.loop !== false && spec.loop !== 0;
    let rows = spec.channels || spec.ch || null;
    if (!rows) {
        rows = [];
        for (let i = 0; i < MUS_CHANNEL_COUNT; i++) {
            if (spec[i] != null) rows[i] = spec[i];
            else if (spec[String(i + 1)] != null) rows[i] = spec[String(i + 1)];
            else if (spec['ch' + (i + 1)] != null) rows[i] = spec['ch' + (i + 1)];
        }
    }
    const channels = [];
    const waves = [];
    const nCh = Math.max(MUS_CHANNEL_COUNT, (rows && rows.length) || 0);
    for (let c = 0; c < nCh; c++) {
        channels[c] = normalizeChannel(rows[c], steps);
        let cw = wave;
        if (spec.waves && spec.waves[c]) cw = spec.waves[c];
        if (spec['wave' + (c + 1)]) cw = spec['wave' + (c + 1)];
        waves[c] = cw || 'square';
    }
    while (channels.length < MUS_CHANNEL_COUNT) {
        channels.push(normalizeChannel(null, steps));
        waves.push(wave || 'square');
    }
    musicState.active = true;
    musicState.loop = loop;
    musicState.bpm = bpm;
    musicState.steps = steps;
    musicState.step = 0;
    musicState.acc = 0;
    musicState.wave = wave;
    musicState.vol = vol;
    musicState.channels = channels;
    musicState.waves = waves;
    musicState.vol = (vol > 0 ? vol : 0.08);
    musicState.synth = (spec && spec.synth) ? spec.synth : getActiveSynthParams();
    musicState.lastPlayedStep = 0;
    playMusicStep(0);
    musicState.step = 1;
    if (musicState.step >= steps) {
        if (loop) musicState.step = 0;
        else musicState.active = false;
    }
    updateMusicLiveBar(0);
    ensureMusicClock();
    updateMusicPlayButton();
}

function playMusicStep(stepIdx) {
    if (!audioCtx) return;
    const steps = musicState.steps;
    if (stepIdx < 0 || stepIdx >= steps) return;
    const stepDur = (60 / musicState.bpm) * (4 / steps);
    const noteDur = stepDur * 0.85;
    const nCh = (musicState.channels && musicState.channels.length) || MUS_CHANNEL_COUNT;
    const synth = (musicState.synth && typeof musicState.synth === 'object')
        ? musicState.synth
        : getActiveSynthParams();
    for (let c = 0; c < nCh; c++) {
        const row = musicState.channels[c];
        if (!row) continue;
        const cell = row[stepIdx];
        if (!cell) continue;
        let f = 0, w = (musicState.waves && musicState.waves[c]) || musicState.wave || synth.wave || 'square';
        let dur = noteDur, v = musicState.vol;
        if (typeof cell === 'object') {
            f = cell.f || 0;
            if (cell.wave) w = cell.wave;
            if (cell.dur != null) dur = Number(cell.dur);
            if (cell.vol != null) v = Number(cell.vol);
        } else {
            f = cell;
        }
        if (f > 0) {
            if (w === 'custom') w = synth.wave || 'square';
            playBeep(f, dur, w, v, synth);
        }
    }
    musicState.lastPlayedStep = stepIdx;
    updateMusicLiveBar(stepIdx);
    updateMusicPlayhead(stepIdx);
}

function tickMusic(dt) {
    if (!musicState.active) return;
    const steps = musicState.steps;
    const stepDur = (60 / musicState.bpm) * (4 / steps);
    musicState.acc += dt;
    let guard = 0;
    while (musicState.acc >= stepDur && guard++ < 8) {
        musicState.acc -= stepDur;
        playMusicStep(musicState.step);
        musicState.step++;
        if (musicState.step >= steps) {
            if (musicState.loop) musicState.step = 0;
            else {
                musicState.active = false;
                musicState.acc = 0;
                updateMusicPlayButton();
                updateMusicLiveBar(-1);
                updateMusicPlayhead(-1);
                break;
            }
        }
    }
}

function stopMusic() {
    musicState.active = false;
    musicState.acc = 0;
    musicState.step = 0;
    musicState.lastPlayedStep = -1;
    if (musicState._clockId) {
        cancelAnimationFrame(musicState._clockId);
        musicState._clockId = null;
    }
    musicState._clockLast = 0;
    updateMusicLiveBar(-1);
    updateMusicPlayhead(-1);
    updateMusicPlayButton();
}

function updateMusicPlayButton() {
    const btn = document.getElementById('mus-play-btn');
    if (!btn) return;
    if (musicState.active) {
        btn.textContent = '■ Stop';
        btn.classList.add('playing');
        btn.classList.remove('play');
        btn.classList.add('stop');
    } else {
        btn.textContent = '▶ Play';
        btn.classList.remove('playing');
        btn.classList.remove('stop');
        btn.classList.add('play');
    }
}

function toggleMusicPreview() {
    if (musicState.active) {
        stopMusic();
    } else {
        previewMusicEditor();
    }
}

function clearMusicEditorNotes() {
    if (!musEd.channels) return;
    const steps = musEd.steps || 16;
    const nCh = musEd.channelCount || musEd.channels.length || 10;
    const hasAny = musEd.channels.some(ch => ch && ch.some(n => n));
    if (hasAny && !confirm('Clear all notes on all channels?')) return;
    musEd.channels = musicEmptyGrid(steps, nCh);
    renderMusicGrid();
    syncMusicFromEditorLive();
    if (musicState.active && musicState.lastPlayedStep >= 0) {
        updateMusicLiveBar(musicState.lastPlayedStep);
    }
}

// ============================================================
// RANDOM MUSIC GENERATOR
// ============================================================
const MUS_GEN_LOW = ['C3','D3','E3','F3','G3','A3','B3','C4'];
const MUS_GEN_MID = ['C4','D4','E4','F4','G4','A4','B4','C5'];
const MUS_GEN_HIGH = ['G4','A4','B4','C5','D5','E5','F5','G5'];
// D5+ need to be in NOTE_FREQ - we already have up to C6

let musGenPitch = 'mid';
let musGenStyle = 'melody';

function openMusicGenerator() {
    musGenPitch = 'mid';
    musGenStyle = 'melody';
    openModal(
        'Random music',
        `<div style="font-size:0.9rem;color:var(--text-color)">
          <p class="mus-gen-label">Pitch range</p>
          <div class="mus-gen-opt" id="mus-gen-pitch">
            <button type="button" data-v="low" onclick="musGenSelect('pitch', this)">Low · bass</button>
            <button type="button" data-v="mid" class="selected" onclick="musGenSelect('pitch', this)">Mid</button>
            <button type="button" data-v="high" onclick="musGenSelect('pitch', this)">High · lead</button>
            <button type="button" data-v="mixed" onclick="musGenSelect('pitch', this)">Mixed</button>
          </div>
          <p class="mus-gen-label">Style</p>
          <div class="mus-gen-opt" id="mus-gen-style">
            <button type="button" data-v="melody" class="selected" onclick="musGenSelect('style', this)">Melody</button>
            <button type="button" data-v="basslead" onclick="musGenSelect('style', this)">Bass + lead</button>
            <button type="button" data-v="chords" onclick="musGenSelect('style', this)">Chords</button>
            <button type="button" data-v="sparse" onclick="musGenSelect('style', this)">Sparse</button>
            <button type="button" data-v="dense" onclick="musGenSelect('style', this)">Dense</button>
            <button type="button" data-v="arpeggio" onclick="musGenSelect('style', this)">Arpeggio</button>
          </div>
          <p style="margin:0;font-size:0.78rem;color:var(--muted)">Fills the current grid (${musEd.channelCount || 10} ch × ${musEd.steps || 16} steps). You can edit after.</p>
        </div>`,
        'Generate',
        () => { generateRandomMusic(musGenPitch, musGenStyle); }
    );
}

function musGenSelect(kind, btn) {
    const v = btn.getAttribute('data-v');
    if (kind === 'pitch') {
        musGenPitch = v;
        document.querySelectorAll('#mus-gen-pitch button').forEach(b => b.classList.toggle('selected', b === btn));
    } else {
        musGenStyle = v;
        document.querySelectorAll('#mus-gen-style button').forEach(b => b.classList.toggle('selected', b === btn));
    }
}

function musGenPool(pitch) {
    if (pitch === 'low') return MUS_GEN_LOW.slice();
    if (pitch === 'high') return MUS_GEN_HIGH.slice();
    if (pitch === 'mixed') return MUS_GEN_LOW.concat(MUS_GEN_MID, MUS_GEN_HIGH);
    return MUS_GEN_MID.slice();
}

function musGenPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomMusic(pitch, style) {
    const steps = musEd.steps || 16;
    const nCh = musEd.channelCount || 10;
    const grid = musicEmptyGrid(steps, nCh);
    const mid = musGenPool(pitch === 'mixed' ? 'mid' : pitch);
    const low = pitch === 'high' ? mid : MUS_GEN_LOW;
    const high = pitch === 'low' ? mid : MUS_GEN_HIGH;
    const scale = musGenPool(pitch);

    const density = style === 'dense' ? 0.7 : style === 'sparse' ? 0.22 : style === 'chords' ? 0.45 : 0.4;

    if (style === 'basslead') {
        // Ch1 bass root pattern
        const roots = low.filter((_, i) => i % 2 === 0);
        for (let s = 0; s < steps; s++) {
            if (s % 4 === 0 || Math.random() < 0.35) grid[0][s] = musGenPick(roots.length ? roots : low);
        }
        // Ch2 melody
        let note = musGenPick(high);
        for (let s = 0; s < steps; s++) {
            if (Math.random() < 0.55) {
                const idx = Math.max(0, scale.indexOf(note));
                const next = scale[Math.min(scale.length - 1, Math.max(0, idx + (Math.random() < 0.5 ? -1 : 1) * (1 + (Math.random() * 2 | 0))))] || musGenPick(scale);
                note = next;
                grid[1][s] = note;
            }
        }
        // remaining channels light fills
        for (let c = 2; c < nCh; c++) {
            for (let s = 0; s < steps; s++) {
                if (Math.random() < density * 0.35) grid[c][s] = musGenPick(scale);
            }
        }
    } else if (style === 'chords') {
        // stack 3-note chords on first channels every 2–4 steps
        const chordTones = [0, 2, 4]; // scale degrees
        for (let s = 0; s < steps; s++) {
            if (s % 2 !== 0 && Math.random() > 0.25) continue;
            const rootIdx = Math.floor(Math.random() * Math.max(1, scale.length - 4));
            for (let t = 0; t < chordTones.length && t < nCh; t++) {
                const ni = Math.min(scale.length - 1, rootIdx + chordTones[t]);
                grid[t][s] = scale[ni];
            }
            // optional higher sparkle
            if (nCh > 3 && Math.random() < 0.4) grid[3][s] = musGenPick(high);
        }
    } else if (style === 'arpeggio') {
        const arp = scale.slice(0, Math.min(6, scale.length));
        for (let s = 0; s < steps; s++) {
            const note = arp[s % arp.length];
            grid[0][s] = note;
            if (nCh > 1 && s % 2 === 0) grid[1][s] = arp[(s + 2) % arp.length];
            if (nCh > 2 && Math.random() < 0.3) grid[2][s] = musGenPick(low);
        }
        for (let c = 3; c < nCh; c++) {
            for (let s = 0; s < steps; s++) {
                if (Math.random() < 0.15) grid[c][s] = musGenPick(scale);
            }
        }
    } else if (style === 'melody') {
        let note = musGenPick(scale);
        for (let s = 0; s < steps; s++) {
            if (Math.random() < 0.65) {
                const idx = scale.indexOf(note);
                const step = (Math.random() < 0.7 ? 1 : 2) * (Math.random() < 0.5 ? -1 : 1);
                const ni = Math.min(scale.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + step));
                note = scale[ni];
                grid[0][s] = note;
            }
        }
        // soft harmony / rhythm on other channels
        for (let c = 1; c < nCh; c++) {
            for (let s = 0; s < steps; s++) {
                if (c === 1 && s % 4 === 0) grid[c][s] = musGenPick(low);
                else if (Math.random() < density * 0.25) grid[c][s] = musGenPick(scale);
            }
        }
    } else {
        // sparse / dense generic
        for (let c = 0; c < nCh; c++) {
            const pool = c === 0 ? low : (c === 1 ? mid : scale);
            for (let s = 0; s < steps; s++) {
                if (Math.random() < density) grid[c][s] = musGenPick(pool);
            }
        }
    }

    musEd.channels = grid;
    // mild BPM variety
    const bpmEl = document.getElementById('mus-bpm');
    if (bpmEl && Math.random() < 0.5) {
        const bpms = [90, 100, 110, 120, 128, 140, 150];
        const b = musGenPick(bpms);
        bpmEl.value = b;
        musEd.bpm = b;
    }
    renderMusicGrid();
    syncMusicFromEditorLive();
    if (!musicState.active) {
        // auto-preview so user hears it
        try { previewMusicEditor(); } catch (_) {}
    } else if (musicState.lastPlayedStep >= 0) {
        updateMusicLiveBar(musicState.lastPlayedStep);
    }
}

function isMusicPlaying() {
    return !!musicState.active;
}

/** Advance the sequencer outside PLAY (music editor preview). */
function ensureMusicClock() {
    if (musicState._clockId) return;
    musicState._clockLast = 0;
    const tick = (ts) => {
        if (!musicState.active) {
            musicState._clockId = null;
            musicState._clockLast = 0;
            return;
        }
        if (!(typeof isPlaying !== 'undefined' && isPlaying && !isPaused)) {
            if (!musicState._clockLast) musicState._clockLast = ts;
            let dt = (ts - musicState._clockLast) / 1000;
            musicState._clockLast = ts;
            if (dt > 0.1) dt = 0.1;
            tickMusic(dt);
        } else {
            musicState._clockLast = ts;
        }
        musicState._clockId = requestAnimationFrame(tick);
    };
    musicState._clockId = requestAnimationFrame(tick);
}


// ============================================================
// CONSOLE
// ============================================================
function pushConsole(msg, kind) {
    consoleLines.push({ msg: String(msg), kind: kind || '' });
    if (consoleLines.length > 80) consoleLines.shift();
    renderConsole();
}
function renderConsole() {
    const panel = document.getElementById('console-panel');
    panel.innerHTML = consoleLines.map(l =>
        `<div class="line ${l.kind}">${escapeHtml(l.msg)}</div>`
    ).join('');
    panel.scrollTop = panel.scrollHeight;
}
function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function toggleConsole() {
    consoleOpen = !consoleOpen;
    document.getElementById('console-panel').classList.toggle('open', consoleOpen);
}
function clearConsole() {
    consoleLines.length = 0;
    renderConsole();
}

// ============================================================
// LUA BINDINGS
// ============================================================

// ============================================================

// PARTICLE FX (auto-managed — no user arrays needed)
// ============================================================
const fxParticles = [];
const FX_MAX = 400;

function fxClear() {
    fxParticles.length = 0;
}

function fxSpawn(opts) {
    if (!opts) return;
    const n = Math.max(1, Math.min(80, Math.floor(Number(opts.count) || 12)));
    const x = Number(opts.x) || 0;
    const y = Number(opts.y) || 0;
    const color = opts.color || '#fff';
    const life = Math.max(0.05, Number(opts.life) || 0.55);
    const speed = Math.max(0, Number(opts.speed) || 120);
    const size = Math.max(0.5, Number(opts.size) || 3);
    const gravity = opts.gravity != null ? Number(opts.gravity) : 280;
    const spread = opts.spread != null ? Number(opts.spread) : Math.PI * 2;
    const angle = opts.angle != null ? Number(opts.angle) : 0;
    const drag = opts.drag != null ? Number(opts.drag) : 0.92;
    const shape = opts.shape || 'circle';
    for (let i = 0; i < n; i++) {
        if (fxParticles.length >= FX_MAX) fxParticles.shift();
        const a = angle + (Math.random() - 0.5) * spread;
        const sp = speed * (0.35 + Math.random() * 0.9);
        fxParticles.push({
            x: x, y: y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: life * (0.6 + Math.random() * 0.6),
            maxLife: life,
            size: size * (0.5 + Math.random() * 0.9),
            color: color,
            gravity: gravity,
            drag: drag,
            shape: shape,
            rot: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 10
        });
    }
}

function fxBurst(x, y, color, count) {
    fxSpawn({
        x: x, y: y, color: color || '#ff8844',
        count: count != null ? count : 16,
        life: 0.5, speed: 160, size: 3.5, gravity: 220,
        spread: Math.PI * 2, shape: 'circle'
    });
}

function fxSpark(x, y, color, count) {
    fxSpawn({
        x: x, y: y, color: color || '#ffe566',
        count: count != null ? count : 10,
        life: 0.35, speed: 220, size: 2.2, gravity: 120,
        spread: Math.PI * 2, shape: 'spark'
    });
}

function fxDust(x, y, color, count) {
    fxSpawn({
        x: x, y: y, color: color || '#c4b5a0',
        count: count != null ? count : 8,
        life: 0.7, speed: 50, size: 4, gravity: -20,
        spread: Math.PI * 1.2, angle: -Math.PI / 2, drag: 0.88, shape: 'circle'
    });
}

function fxSmoke(x, y, color, count) {
    fxSpawn({
        x: x, y: y, color: color || '#8899aa',
        count: count != null ? count : 6,
        life: 1.1, speed: 35, size: 5, gravity: -40,
        spread: 0.9, angle: -Math.PI / 2, drag: 0.95, shape: 'circle'
    });
}

function fxConfetti(x, y, color, count) {
    const colors = Array.isArray(color) ? color : null;
    const n = count != null ? count : 20;
    for (let i = 0; i < n; i++) {
        fxSpawn({
            x: x, y: y,
            color: colors ? colors[i % colors.length] : (color || '#8b5cf6'),
            count: 1, life: 0.9, speed: 140, size: 3.5, gravity: 320,
            spread: Math.PI * 2, shape: 'square'
        });
    }
}

function fxUpdate(dt) {
    if (!fxParticles.length) return;
    for (let i = fxParticles.length - 1; i >= 0; i--) {
        const p = fxParticles[i];
        p.life -= dt;
        if (p.life <= 0) {
            fxParticles.splice(i, 1);
            continue;
        }
        p.vx *= Math.pow(p.drag, dt * 60);
        p.vy *= Math.pow(p.drag, dt * 60);
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
    }
}

function fxDraw() {
    if (!fxParticles.length || typeof ctx === 'undefined' || !ctx) return;
    for (let i = 0; i < fxParticles.length; i++) {
        const p = fxParticles[i];
        const t = Math.max(0, p.life / p.maxLife);
        const alpha = t * t;
        const s = p.size * (0.6 + 0.4 * t);
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.fillStyle = p.color;
        if (p.shape === 'square') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillRect(-s, -s, s * 2, s * 2);
            ctx.restore();
        } else if (p.shape === 'spark') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(Math.atan2(p.vy, p.vx) || 0);
            ctx.fillRect(-s * 1.8, -s * 0.35, s * 3.6, s * 0.7);
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1;
}


// ============================================================
// GAME SAVE DATA (player progress — not project source)
// Per-project localStorage. Independent of cloud project sync.
// ============================================================
const GAMEDATA_PREFIX = 'luax_gamedata_v1:';

function gameDataStorageKey(projectName) {
    const proj = projectName || currentProjectName || '_default';
    let account = '';
    try {
        if (typeof currentAccountEmail === 'function') account = currentAccountEmail() || '';
        else if (typeof googleProfile !== 'undefined' && googleProfile && googleProfile.email)
            account = String(googleProfile.email).toLowerCase();
    } catch (_) {}
    // Scope by account when signed in so devices/users don't collide
    return GAMEDATA_PREFIX + (account ? account + '::' : '') + proj;
}

function loadGameDataStore(projectName) {
    try {
        const raw = localStorage.getItem(gameDataStorageKey(projectName));
        if (!raw) return {};
        const data = JSON.parse(raw);
        return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    } catch (_) {
        return {};
    }
}

function saveGameDataStore(store, projectName) {
    try {
        localStorage.setItem(gameDataStorageKey(projectName), JSON.stringify(store || {}));
        return true;
    } catch (e) {
        console.warn('Game data save failed', e);
        return false;
    }
}

function gameDataSave(key, value) {
    if (key == null || key === '') return false;
    const k = String(key);
    const store = loadGameDataStore();
    store[k] = value;
    return saveGameDataStore(store);
}

function gameDataLoad(key, defaultValue) {
    if (key == null || key === '') {
        return defaultValue !== undefined ? defaultValue : null;
    }
    const store = loadGameDataStore();
    const k = String(key);
    if (!Object.prototype.hasOwnProperty.call(store, k)) {
        return defaultValue !== undefined ? defaultValue : null;
    }
    return store[k];
}

function gameDataHas(key) {
    if (key == null || key === '') return false;
    const store = loadGameDataStore();
    return Object.prototype.hasOwnProperty.call(store, String(key));
}

function gameDataRemove(key) {
    if (key == null || key === '') return false;
    const store = loadGameDataStore();
    const k = String(key);
    if (!Object.prototype.hasOwnProperty.call(store, k)) return false;
    delete store[k];
    return saveGameDataStore(store);
}

function gameDataClear() {
    try {
        localStorage.removeItem(gameDataStorageKey());
        return true;
    } catch (_) {
        return false;
    }
}

function gameDataKeys() {
    return Object.keys(loadGameDataStore());
}

function gameDataAll() {
    return loadGameDataStore();
}

window.LuaDeckAPI = {
    gfx: {
        cls(c) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            const dpr = window.devicePixelRatio || 1;
            ctx.fillStyle = c || '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.translate(-cam.x, -cam.y);
        },
        rect(x, y, w, h, c) { ctx.strokeStyle = c || '#fff'; ctx.strokeRect(x, y, w, h); },
        rectfill(x, y, w, h, c) { ctx.fillStyle = c || '#fff'; ctx.fillRect(x, y, w, h); },
        circle(x, y, r, c) {
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.strokeStyle = c || '#fff'; ctx.stroke();
        },
        circlefill(x, y, r, c) {
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = c || '#fff'; ctx.fill();
        },
        line(x1, y1, x2, y2, c) {
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
            ctx.strokeStyle = c || '#fff'; ctx.stroke();
        },
        pixel(x, y, c) {
            ctx.fillStyle = c || '#fff';
            ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
        },
        text(s, x, y, c, f) {
            ctx.font = f || '16px sans-serif';
            ctx.fillStyle = c || '#fff';
            ctx.fillText(String(s), x, y);
        },
        cam(x, y) { cam.x = x || 0; cam.y = y || 0; },

        /** Resolve a project PNG to a loaded HTMLImageElement (or null). */
        _spriteImg(name) {
            if (!name || !currentProjectName) return null;
            const map = getProjectAssetMap(currentProjectName);
            const src = map[name];
            if (!src) return null;
            const key = currentProjectName + '::' + name;
            let img = spriteImageCache[key];
            if (!img) {
                img = new Image();
                img.src = src;
                spriteImageCache[key] = img;
            }
            if (!img.complete || !img.naturalWidth) return null;
            return img;
        },

        /**
         * Draw a project image asset.
         * gfx.sprite("player.png", x, y)
         * gfx.sprite("player.png", x, y, w, h)
         */
        sprite(name, x, y, w, h) {
            const img = this._spriteImg(name);
            if (!img) return;
            if (w != null && h != null) ctx.drawImage(img, x, y, w, h);
            else ctx.drawImage(img, x, y);
        },

        /**
         * Draw one frame from a sprite sheet (grid, left→right then top→bottom).
         * Frame is 0-based.
         *
         *   gfx.anim("walk.png", frame, x, y)
         *   gfx.anim("walk.png", frame, x, y, fw, fh)
         *   gfx.anim("walk.png", frame, x, y, fw, fh, dw, dh)
         *   gfx.anim("walk.png", frame, x, y, fw, fh, dw, dh, cols, rows)
         *
         * Easiest for a 2×2 sheet (ignore pixel sizes):
         *   gfx.anim("hero.png", frame, x, y, 0, 0, 96, 96, 2, 2)
         *   -- cell size is computed as imageWidth/cols × imageHeight/rows
         *
         * fw/fh = cell size in the sheet (optional if cols+rows given)
         * dw/dh = size on screen
         * cols/rows = grid size (optional; otherwise derived from fw/fh)
         */
        anim(name, frame, x, y, fw, fh, dw, dh, cols, rows) {
            const img = (typeof this._spriteImg === 'function')
                ? this._spriteImg(name)
                : (window.LuaDeckAPI && window.LuaDeckAPI.gfx._spriteImg(name));
            if (!img) return;

            const imgW = img.naturalWidth;
            const imgH = img.naturalHeight;
            if (!imgW || !imgH) return;

            let nCols = Number(cols);
            let nRows = Number(rows);
            let cellW = Number(fw);
            let cellH = Number(fh);

            // Preferred: explicit grid (cols × rows) → auto cell size
            if (nCols > 0 && nRows > 0) {
                cellW = imgW / nCols;
                cellH = imgH / nRows;
            } else {
                // Fallback: cell size in pixels (default 16)
                if (!(cellW > 0)) cellW = 16;
                if (!(cellH > 0)) cellH = 16;
                nCols = Math.max(1, Math.floor(imgW / cellW));
                nRows = Math.max(1, Math.floor(imgH / cellH));
                // Recompute exact cell from grid so we don't clip remainder
                cellW = imgW / nCols;
                cellH = imgH / nRows;
            }

            const total = Math.max(1, nCols * nRows);
            let fi = Math.floor(Number(frame) || 0);
            fi = ((fi % total) + total) % total;

            const col = fi % nCols;
            const row = Math.floor(fi / nCols);
            const sx = col * cellW;
            const sy = row * cellH;

            let outW = Number(dw);
            let outH = Number(dh);
            if (!(outW > 0)) outW = cellW;
            if (!(outH > 0)) outH = cellH;

            const dx = Number(x) || 0;
            const dy = Number(y) || 0;

            ctx.drawImage(
                img,
                sx, sy, cellW, cellH,
                dx, dy, outW, outH
            );
        },

        /** List asset filenames for current project (JS array) */
        sprites() {
            if (!currentProjectName) return [];
            return Object.keys(getProjectAssetMap(currentProjectName));
        },


        /**
         * Raycast renderer (Wolfenstein-style solid walls).
         * opts = {
         *   map: 2D array of numbers (0 = empty, 1+ = wall id),
         *   x, y: player position in map units,
         *   angle: facing direction in radians (0 = +X / east),
         *   fov: field of view in radians (default Math.PI/3),
         *   ceil: ceiling color (default "#1a1c28"),
         *   floor: floor color (default "#2a2c35"),
         *   colors: optional map { [wallId]: "#hex" },
         *   fog: max distance for fog fade (default 16),
         *   scale: projection scale (default 0.66),
         *   pitch: look up/down in radians, clamped ~±90° (default 0)
         * }
         */
        raycast(opts) {
            if (!opts || !opts.map) return;
            const map = opts.map;
            const mapH = map.length;
            if (!mapH) return;
            const mapW = map[0].length;
            // Lua maps are 1-based: cell (1,1) lives at continuous [1,2)×[1,2).
            // After tojs(), map[0] === Lua map[1], so shift positions into 0-based space.
            const px = (opts.x ?? 1.5) - 1;
            const py = (opts.y ?? 1.5) - 1;
            const angle = opts.angle ?? 0;
            const fov = opts.fov ?? (Math.PI / 3);
            const ceilC = opts.ceil || '#1a1c28';
            const floorC = opts.floor || '#2a2c35';
            const fogMax = opts.fog ?? 16;
            const projScale = opts.scale ?? 0.66;
            // pitch in radians; shift horizon (positive = look up)
            let pitch = opts.pitch ?? 0;
            const pitchMax = Math.PI / 2 - 0.01;
            if (pitch > pitchMax) pitch = pitchMax;
            if (pitch < -pitchMax) pitch = -pitchMax;
            const defaultColors = {
                1: '#c44', 2: '#4a8', 3: '#48a', 4: '#a84',
                5: '#84a', 6: '#a48', 7: '#8a4', 8: '#aaa'
            };
            const colors = opts.colors || defaultColors;

            // Force clean transform for full-screen raycast (ignore 2D cam)
            const dpr = window.devicePixelRatio || 1;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;
            // horizon shifts with pitch (look up → more floor visible below)
            const pitchOffset = Math.tan(pitch) * h * 0.5;
            const mid = h / 2 + pitchOffset;
            const numRays = Math.max(1, Math.floor(w));

            // Ceiling + floor relative to shifted horizon
            ctx.fillStyle = ceilC;
            ctx.fillRect(0, 0, w, Math.max(0, mid));
            ctx.fillStyle = floorC;
            ctx.fillRect(0, Math.max(0, mid), w, h);

            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            for (let col = 0; col < numRays; col++) {
                const rayOffset = ((col / numRays) - 0.5) * fov;
                const rayAngle = angle + rayOffset;
                const rayDirX = Math.cos(rayAngle);
                const rayDirY = Math.sin(rayAngle);

                // DDA setup
                let mapX = Math.floor(px);
                let mapY = Math.floor(py);
                const deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
                const deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);

                let stepX, stepY, sideDistX, sideDistY;
                if (rayDirX < 0) {
                    stepX = -1;
                    sideDistX = (px - mapX) * deltaDistX;
                } else {
                    stepX = 1;
                    sideDistX = (mapX + 1 - px) * deltaDistX;
                }
                if (rayDirY < 0) {
                    stepY = -1;
                    sideDistY = (py - mapY) * deltaDistY;
                } else {
                    stepY = 1;
                    sideDistY = (mapY + 1 - py) * deltaDistY;
                }

                let hit = 0;
                let side = 0; // 0 = NS (vertical wall), 1 = EW
                let wallId = 0;
                const maxSteps = mapW + mapH + 4;
                for (let i = 0; i < maxSteps; i++) {
                    if (sideDistX < sideDistY) {
                        sideDistX += deltaDistX;
                        mapX += stepX;
                        side = 0;
                    } else {
                        sideDistY += deltaDistY;
                        mapY += stepY;
                        side = 1;
                    }
                    if (mapY < 0 || mapY >= mapH || mapX < 0 || mapX >= mapW) {
                        hit = 1;
                        wallId = 1;
                        break;
                    }
                    const cell = map[mapY][mapX];
                    if (cell && cell !== 0) {
                        hit = 1;
                        wallId = cell;
                        break;
                    }
                }

                if (!hit) continue;

                // Perpendicular distance (fish-eye correction)
                let perpDist;
                if (side === 0) {
                    perpDist = (mapX - px + (1 - stepX) / 2) / rayDirX;
                } else {
                    perpDist = (mapY - py + (1 - stepY) / 2) / rayDirY;
                }
                perpDist = Math.max(0.05, Math.abs(perpDist));

                const lineH = (h / perpDist) * projScale;
                const drawStart = Math.max(0, mid - lineH / 2);
                const drawEnd = Math.min(h, mid + lineH / 2);

                // Color + side shading + distance fog
                let base = colors[wallId] || colors[1] || '#888';
                // Parse hex → RGB for darkening
                let r = 136, g = 136, b = 136;
                if (typeof base === 'string' && base[0] === '#') {
                    const hex = base.length === 4
                        ? base[1] + base[1] + base[2] + base[2] + base[3] + base[3]
                        : base.slice(1);
                    r = parseInt(hex.slice(0, 2), 16) || 0;
                    g = parseInt(hex.slice(2, 4), 16) || 0;
                    b = parseInt(hex.slice(4, 6), 16) || 0;
                }
                if (side === 1) { // EW walls darker
                    r = (r * 0.65) | 0;
                    g = (g * 0.65) | 0;
                    b = (b * 0.65) | 0;
                }
                const fog = Math.min(1, perpDist / fogMax);
                r = (r * (1 - fog) + 20 * fog) | 0;
                g = (g * (1 - fog) + 22 * fog) | 0;
                b = (b * (1 - fog) + 28 * fog) | 0;

                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(col, drawStart, 1, drawEnd - drawStart);
            }
        },

        // Logical screen size (CSS pixels)
        width() {
            const dpr = window.devicePixelRatio || 1;
            return canvas.width / dpr;
        },
        height() {
            const dpr = window.devicePixelRatio || 1;
            return canvas.height / dpr;
        }
    },
    input: {
        btn: i => !!btnState[i|0],
        btnp: i => !!(btnState[i|0] && !btnPrevState[i|0]),
        btnr: i => !!(!btnState[i|0] && btnPrevState[i|0]),
        axis: i => (i|0) === 0 ? stickAxis.x : stickAxis.y,
        // Touch/mouse look deltas (yaw / pitch). Cleared after each _update.
        lookx: () => lookDeltaX + keyLook * 0.045,
        looky: () => lookDeltaY,
        mouseX: () => pointer.x,
        mouseY: () => pointer.y,
        mouseBtn: () => !!pointer.btn
    },
    sfx: {
        beep: (freq, dur, type) => playBeep(freq, dur, type),
        music(spec) { startMusic(spec); },
        stop() { stopMusic(); },
        playing() { return isMusicPlaying(); },
        note(name) { return noteToFreq(name); },
    },
    fx: {
        burst(x, y, color, count) { fxBurst(x, y, color, count); },
        spark(x, y, color, count) { fxSpark(x, y, color, count); },
        dust(x, y, color, count) { fxDust(x, y, color, count); },
        smoke(x, y, color, count) { fxSmoke(x, y, color, count); },
        confetti(x, y, color, count) { fxConfetti(x, y, color, count); },
        spawn(opts) { fxSpawn(opts); },
        clear() { fxClear(); },
        count() { return fxParticles.length; },
    },
    data: {
        save(key, value) { return gameDataSave(key, value); },
        load(key, defaultValue) {
            const v = gameDataLoad(key, defaultValue !== undefined ? defaultValue : null);
            return v;
        },
        has(key) { return gameDataHas(key); },
        remove(key) { return gameDataRemove(key); },
        clear() { return gameDataClear(); },
        keys() { return gameDataKeys(); },
        all() { return gameDataAll(); },
    },
    sys: {
        getFileContent(filename) {
            if (!currentProjectName) return null;
            const c = projects[currentProjectName][filename];
            return typeof c === 'string' ? c : null;
        },
        log(msg) { pushConsole(msg, 'info'); },
        isMobile: () => isMobileDevice,
        setControlsVisible: (v) => setControlsVisible(!!v),
        controlsVisible: () => areControlsVisible()
    }
};


const LuaShim = `
local _orig_require = require
local js = _orig_require("js")
local api = js.global.LuaDeckAPI

-- Convert nested Lua tables → plain JS arrays/objects so JS can index them
local function tojs(val)
    if type(val) ~= "table" then return val end
    local is_array = true
    local n = 0
    for k, _ in pairs(val) do
        if type(k) ~= "number" or k < 1 or k ~= math.floor(k) then
            is_array = false
            break
        end
        if k > n then n = k end
    end
    if is_array then
        local arr = js.new(js.global.Array)
        for i = 1, n do
            arr[i - 1] = tojs(val[i])  -- JS arrays are 0-based
        end
        return arr
    else
        local obj = js.new(js.global.Object)
        for k, v in pairs(val) do
            obj[tostring(k)] = tojs(v)
        end
        return obj
    end
end

gfx = {
    cls = function(c) api.gfx:cls(c) end,
    rect = function(x,y,w,h,c) api.gfx:rect(x,y,w,h,c) end,
    rectfill = function(x,y,w,h,c) api.gfx:rectfill(x,y,w,h,c) end,
    circle = function(x,y,r,c) api.gfx:circle(x,y,r,c) end,
    circlefill = function(x,y,r,c) api.gfx:circlefill(x,y,r,c) end,
    line = function(x1,y1,x2,y2,c) api.gfx:line(x1,y1,x2,y2,c) end,
    pixel = function(x,y,c) api.gfx:pixel(x,y,c) end,
    text = function(s,x,y,c,f) api.gfx:text(tostring(s),x,y,c,f) end,
    cam = function(x,y) api.gfx:cam(x,y) end,
    sprite = function(name, x, y, w, h) api.gfx:sprite(name, x, y, w, h) end,
    -- Draw frame from a sprite sheet (0-based frame index)
    -- gfx.anim("walk.png", frame, x, y)
    -- gfx.anim("walk.png", frame, x, y, fw, fh)
    -- gfx.anim("walk.png", frame, x, y, fw, fh, dw, dh)
    -- gfx.anim("hero.png", frame, x, y, 0, 0, 96, 96, 2, 2)  -- 2x2 grid, auto cell size
    anim = function(name, frame, x, y, fw, fh, dw, dh, cols, rows)
        api.gfx:anim(name, frame, x, y, fw, fh, dw, dh, cols, rows)
    end,
    sprites = function()
        local arr = api.gfx:sprites()
        local t = {}
        if arr then
            local n = tonumber(arr.length) or 0
            for i = 0, n - 1 do t[#t+1] = arr[i] end
        end
        return t
    end,
    raycast = function(opts)
        -- deep-convert so JS receives real arrays
        local jsOpts = tojs(opts)
        api.gfx:raycast(jsOpts)
    end,
    width = function() return api.gfx:width() end,
    height = function() return api.gfx:height() end
}

function btn(i) return api.input:btn(i) end
function btnp(i) return api.input:btnp(i) end
function btnr(i) return api.input:btnr(i) end
function axis(i) return api.input:axis(i) end
function lookx() return api.input:lookx() end
function looky() return api.input:looky() end
-- Returns yaw, pitch deltas this frame (for: local lookX, lookY = look())
function look()
    return api.input:lookx(), api.input:looky()
end

mouse = setmetatable({}, {
    __index = function(_, k)
        if k == "x" then return api.input:mouseX() end
        if k == "y" then return api.input:mouseY() end
        if k == "btn" then return api.input:mouseBtn() end
    end
})

sfx = {
    beep = function(freq, dur, typ) api.sfx:beep(freq, dur, typ) end,
    -- string = saved pattern name ("theme" / "theme.music")
    -- table  = inline { bpm, wave, steps, channels / [1]=row, ... }
    music = function(opts)
        if type(opts) == "string" then
            api.sfx:music(opts)
            return
        end
        if type(opts) ~= "table" then return end
        api.sfx:music(tojs(opts))
    end,
    stop = function() api.sfx:stop() end,
    playing = function() return api.sfx:playing() end,
    note = function(name) return api.sfx:note(tostring(name or "")) end,
}

-- Particle effects (auto update + draw — no arrays needed)
fx = {
    burst = function(x, y, color, count) api.fx:burst(x, y, color, count) end,
    spark = function(x, y, color, count) api.fx:spark(x, y, color, count) end,
    dust  = function(x, y, color, count) api.fx:dust(x, y, color, count) end,
    smoke = function(x, y, color, count) api.fx:smoke(x, y, color, count) end,
    confetti = function(x, y, color, count) api.fx:confetti(x, y, color, count) end,
    spawn = function(opts)
        if type(opts) ~= "table" then return end
        api.fx:spawn(tojs(opts))
    end,
    clear = function() api.fx:clear() end,
    count = function() return api.fx:count() end,
}

-- Persistent player save data (per project, not source code)
-- data.save("highscore", 500)
-- local hs = data.load("highscore", 0)
data = {
    save = function(key, value)
        -- tables → plain JS objects/arrays for JSON storage
        if type(value) == "table" then
            return api.data:save(tostring(key), tojs(value))
        end
        return api.data:save(tostring(key), value)
    end,
    load = function(key, defaultValue)
        local v = api.data:load(tostring(key), nil)
        if v == nil or v == js.null then
            return defaultValue
        end
        -- Convert JS arrays/objects back to Lua tables
        local function fromjs(val)
            if val == nil or val == js.null then return nil end
            local t = type(val)
            -- Fengari may expose JS objects with special type
            if t ~= "userdata" and t ~= "table" and t ~= "object" then
                return val
            end
            -- Try array
            local ok, len = pcall(function() return tonumber(val.length) end)
            if ok and len and len >= 0 and val[0] ~= nil then
                local arr = {}
                for i = 0, len - 1 do
                    arr[i + 1] = fromjs(val[i])
                end
                return arr
            end
            -- Try object keys via JS Object.keys if available
            local ok2, keys = pcall(function()
                return js.global.Object:keys(val)
            end)
            if ok2 and keys then
                local n = tonumber(keys.length) or 0
                if n > 0 then
                    local obj = {}
                    for i = 0, n - 1 do
                        local k = keys[i]
                        obj[k] = fromjs(val[k])
                    end
                    return obj
                end
            end
            return val
        end
        return fromjs(v)
    end,
    has = function(key) return api.data:has(tostring(key)) end,
    remove = function(key) return api.data:remove(tostring(key)) end,
    clear = function() return api.data:clear() end,
    keys = function()
        local arr = api.data:keys()
        local t = {}
        if arr then
            local n = tonumber(arr.length) or 0
            for i = 0, n - 1 do t[#t + 1] = arr[i] end
        end
        return t
    end,
}

dt = 0.016

function print(...)
    local n = select("#", ...)
    local parts = {}
    for i = 1, n do parts[i] = tostring(select(i, ...)) end
    api.sys:log(table.concat(parts, "\\t"))
end

-- Device / on-screen controls (joystick + face buttons)
function is_mobile() return api.sys:isMobile() end
function set_controls_visible(v) api.sys:setControlsVisible(not not v) end
function controls_visible() return api.sys:controlsVisible() end

-- Clear only user modules; keep system ones like "js"
do
    local keep = { js = true, package = true, coroutine = true, string = true, table = true, math = true, io = true, os = true, debug = true, utf8 = true, _G = true }
    for k in pairs(package.loaded) do
        if not keep[k] then package.loaded[k] = nil end
    end
end

function require(modname)
    if modname == "js" then return _orig_require("js") end
    if package.loaded[modname] then return package.loaded[modname] end
    local filename = modname
    if not string.match(filename, "%.lua$") then filename = filename .. ".lua" end
    local content = api.sys:getFileContent(filename)
    if type(content) == "string" then
        local f, err = load(content, "@" .. filename)
        if f then
            local res = f()
            if res == nil then res = true end
            package.loaded[modname] = res
            return res
        else
            error("Syntax Error in " .. filename .. ": " .. tostring(err))
        end
    end
    error("Module not found: " .. modname)
end
`;

function setLuaGlobal(name, value) {
    const L = fengari.L;
    if (typeof value === 'number') {
        fengari.lua.lua_pushnumber(L, value);
    } else if (typeof value === 'string') {
        fengari.lua.lua_pushstring(L, fengari.to_luastring(value));
    } else if (typeof value === 'boolean') {
        fengari.lua.lua_pushboolean(L, value);
    } else return;
    fengari.lua.lua_setglobal(L, fengari.to_luastring(name));
}

function callLua(name, arg) {
    const L = fengari.L;
    fengari.lua.lua_getglobal(L, fengari.to_luastring(name));
    if (!fengari.lua.lua_isfunction(L, -1)) {
        fengari.lua.lua_pop(L, 1);
        return true;
    }
    let nArgs = 0;
    if (typeof arg === 'number') {
        fengari.lua.lua_pushnumber(L, arg);
        nArgs = 1;
    }
    if (fengari.lua.lua_pcall(L, nArgs, 0, 0) !== fengari.lua.LUA_OK) {
        const err = fengari.to_jsstring(fengari.lua.lua_tostring(L, -1));
        fengari.lua.lua_pop(L, 1);
        showError('Runtime: ' + err);
        pushConsole(err, 'err');
        stopPlayMode();
        // Jump to editor and mark the runtime line when possible
        try {
            const line = parseLuaErrorLine(err);
            // Prefer file named in the error, else main.lua
            let file = 'main.lua';
            const fm = String(err).match(/([\w./\\-]+\.lua)/);
            if (fm && currentProjectName && projects[currentProjectName][fm[1]] != null) {
                file = fm[1];
            }
            if (currentProjectName && projects[currentProjectName][file] != null) {
                openFile(file);
                if (line) setEditorError(line, err);
                setStatus(
                    line
                        ? ('Runtime error on line ' + line + ': ' + formatLuaErrorMessage(err))
                        : ('Runtime: ' + err),
                    'error'
                );
            }
        } catch (_) {}
        return false;
    }
    return true;
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function showError(msg) {
    const el = document.getElementById('error-overlay');
    el.textContent = msg;
    el.style.display = 'block';
}



// ============================================================
// GAME LOOP
// ============================================================
function gameLoop(timestamp) {
    if (!isPlaying) return;
    if (isPaused) {
        loopId = requestAnimationFrame(gameLoop);
        return;
    }

    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.1) dt = 0.1; // clamp big stalls

    tickMusic(dt);

    // FPS
    fpsFrames++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
        currentFps = Math.round(fpsFrames / fpsTimer);
        document.getElementById('fps-badge').textContent = currentFps + ' FPS';
        fpsFrames = 0;
        fpsTimer = 0;
    }

    setLuaGlobal('dt', dt);
    cam.x = cam.y = 0;

    if (!callLua('_update', dt)) return;
    // clear look deltas after Lua has read them
    lookDeltaX = 0;
    lookDeltaY = 0;
    try { fxUpdate(dt); } catch (_) {}
    if (!callLua('_draw')) return;
    try { fxDraw(); } catch (_) {}

    for (let i = 0; i < 8; i++) btnPrevState[i] = btnState[i];
    loopId = requestAnimationFrame(gameLoop);
}


async function startPlayMode() {
    if (!isAuthed()) { applyAuthGate(); return; }
    if (!currentProjectName) {
        return alert('Open a project first.');
    }
    if (!projects[currentProjectName] || projects[currentProjectName]['main.lua'] == null) {
        return alert('This project has no main.lua.\n\nPLAY runs your Lua script (main.lua), not the sprite editor.\nAdd or open main.lua, write your game code, then press PLAY.');
    }
    // Leave any editor sub-views; PLAY always goes to the game
    try {
        document.getElementById('sprite-editor-view')?.classList.remove('active');
        document.getElementById('scene-editor-view')?.classList.remove('active');
        document.getElementById('editor-view')?.classList.remove('active');
    } catch (_) {}

    // Re-apply in case device rotated / URL changed
    applyControlsVisibility();

    // flush dirty editor (safe if CodeMirror not ready)
    if (currentFileName && isDirty) {
        try {
            if (typeof editor !== 'undefined' && editor && editor.getValue) {
                projects[currentProjectName][currentFileName] = editor.getValue();
            }
            saveState();
            isDirty = false;
        } catch (_) {}
    }

    clearConsole();
    document.getElementById('error-overlay').style.display = 'none';
    document.getElementById('pause-overlay').classList.remove('show');
    isPaused = false;
    document.getElementById('btn-pause').textContent = '⏸ Pause';
    consoleOpen = false;
    document.getElementById('console-panel').classList.remove('open');

    ensureAudio();
    try { fxClear(); } catch (_) {}

    try {
        if (typeof fengari === 'undefined') throw new Error('Fengari not loaded');
        const L = fengari.L;
        let st = fengari.lauxlib.luaL_dostring(L, fengari.to_luastring(LuaShim));
        if (st !== fengari.lua.LUA_OK) {
            const err = fengari.to_jsstring(fengari.lua.lua_tostring(L, -1));
            fengari.lua.lua_pop(L, 1);
            throw new Error(err);
        }
        st = fengari.lauxlib.luaL_dostring(L, fengari.to_luastring(projects[currentProjectName]['main.lua']));
        if (st !== fengari.lua.LUA_OK) {
            const err = fengari.to_jsstring(fengari.lua.lua_tostring(L, -1));
            fengari.lua.lua_pop(L, 1);
            throw new Error(err);
        }
    } catch (err) {
        const msg = err.message || String(err);
        pushConsole(msg, 'err');
        // Open main.lua and highlight the failing line in the editor
        try {
            if (currentProjectName && projects[currentProjectName]['main.lua'] != null) {
                openFile('main.lua');
                const line = parseLuaErrorLine(msg);
                if (line) setEditorError(line, msg);
                setStatus(
                    line
                        ? ('Compile error on line ' + line + ': ' + formatLuaErrorMessage(msg))
                        : ('Compile error: ' + msg),
                    'error'
                );
            }
        } catch (_) {}
        alert('Compile error:\n' + msg);
        return;
    }

    switchView('play-view');
    isPlaying = true;
    lastTime = 0;
    fpsFrames = 0;
    fpsTimer = 0;

    // Fullscreen only on non-iOS (Safari keeps its chrome anyway and hides our UI)
    try {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (!isIOS) {
            const el = document.documentElement;
            if (el.requestFullscreen) await el.requestFullscreen().catch(() => {});
            else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
            if (screen.orientation?.lock) await screen.orientation.lock('landscape').catch(() => {});
        }
    } catch (_) {}

    if (loopId) cancelAnimationFrame(loopId);
    setTimeout(() => {
        resizeCanvas();
        btnState.fill(false);
        btnPrevState.fill(false);
        resetStick();
        pointer.btn = false;
        lookDeltaX = 0;
        lookDeltaY = 0;
        lookActive = false;
        lookPointerId = null;
        keyLook = 0;
        cam.x = cam.y = 0;
        gameLoop(performance.now());
    }, 60);
}
// Expose immediately when defined
window.startPlayMode = startPlayMode;

function stopPlayMode() {
    isPlaying = false;
    isPaused = false;
    try { stopMusic(); } catch (_) {}
    try { fxClear(); } catch (_) {}
    if (loopId) { cancelAnimationFrame(loopId); loopId = null; }
    btnState.fill(false);
    resetStick();
    lookDeltaX = 0;
    lookDeltaY = 0;
    lookActive = false;
    lookPointerId = null;
    keyLook = 0;
    document.querySelectorAll('.action-btn').forEach(e => e.classList.remove('active-btn'));
    document.getElementById('pause-overlay').classList.remove('show');
    switchView('files-view');
    try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        }
        screen.orientation?.unlock?.();
    } catch (_) {}
}

function togglePause() {
    if (!isPlaying) return;
    isPaused = !isPaused;
    document.getElementById('btn-pause').textContent = isPaused ? '▶ Resume' : '⏸ Pause';
    document.getElementById('pause-overlay').classList.toggle('show', isPaused);
    if (!isPaused) lastTime = 0; // avoid huge dt jump
}

function restartPlay() {
    if (!isPlaying) return;
    isPlaying = false;
    if (loopId) cancelAnimationFrame(loopId);
    isPaused = false;
    document.getElementById('pause-overlay').classList.remove('show');
    document.getElementById('btn-pause').textContent = '⏸ Pause';
    // re-run start without leaving view
    setTimeout(() => startPlayMode(), 30);
}

window.addEventListener('resize', () => { if (isPlaying) resizeCanvas(); });
window.addEventListener('orientationchange', () => { if (isPlaying) setTimeout(resizeCanvas, 200); });

/* ============================================================================
   Home-lab Control Panel — client
   All telemetry is fetched from /api/summary (centralized single-pane control)
   ========================================================================== */
'use strict';

// Auto-upgrade Tailscale connection to HTTPS so Web Speech API and PWA work reliably
if (typeof location !== 'undefined' && location.protocol === 'http:' && location.hostname.endsWith('.ts.net')) {
    location.replace('https://' + location.host + location.pathname + location.search);
}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const setText = (el, val) => { const node = (typeof el === 'string') ? $(el) : el; if (node) node.textContent = (val != null ? val : ''); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (name, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// ── format ───────────────────────────────────────────────────────────────────
function fmtBytes(b) {
    if (!Number.isFinite(b) || b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    const v = b / Math.pow(1024, i);
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
function fmtDur(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '—';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m ${Math.floor(sec % 60)}s`;
}
function fmtRate(bps) {
    if (!Number.isFinite(bps)) return '—';
    return `${fmtBytes(bps)}/s`;
}
function fmtTime(iso) {
    if (!iso) return '—';
    const t = new Date(iso);
    return t.toLocaleTimeString('en-GB', { hour12: false });
}
function level(pct, warn, serious, crit) {
    if (pct >= crit) return 'critical';
    if (pct >= serious) return 'serious';
    if (pct >= warn) return 'warning';
    return 'good';
}

// ── state ────────────────────────────────────────────────────────────────────
const THEME_ORDER = ['tactical', 'futuristic', 'dark', 'light', 'auto'];
const rawUrlTheme = new URLSearchParams(location.search).get('theme');
const urlTheme = (rawUrlTheme === 'cyber' || rawUrlTheme === 'hud') ? 'tactical' : rawUrlTheme;
const savedTheme = localStorage.getItem('lab-theme-v2');

const state = {
    activeView: 'overview',
    activeTermSubtab: 'gemini',
    theme: (urlTheme && THEME_ORDER.includes(urlTheme))
        ? urlTheme
        : (savedTheme && THEME_ORDER.includes(savedTheme) ? savedTheme : 'tactical'),
    sound: localStorage.getItem('homelab_sound_fx') !== '0',
    isReady: false,
    paused: false,
    timer: null,
    hist: { cpu: [], mem: [], disks: {}, rx: [], tx: [], t: [] },
    diskOrder: [],
    diskMeta: {},
    lastNet: null,
    lastDiskIo: {},
    lastAt: 0,
    ethName: 'enp1s0',
};

// ── Web Audio Sound Effects ──────────────────────────────────────────────────
let audioCtx = null;
function getAudioContext() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    return audioCtx;
}

function isSoundEnabled() {
    return Boolean(state.sound);
}

function updateSoundUI() {
    const enabled = isSoundEnabled();
    const iconName = enabled ? 'volume-on' : 'volume-off';
    const label = enabled ? 'เสียงเอฟเฟกต์: เปิด (Sound ON)' : 'เสียงเอฟเฟกต์: ปิด (Muted)';
    
    const icoTop = $('#sound-ico');
    if (icoTop) icoTop.innerHTML = `<use href="#i-${iconName}"/>`;
    const btnTop = $('#btn-sound');
    if (btnTop) {
        btnTop.title = label;
        btnTop.setAttribute('aria-label', label);
        btnTop.classList.toggle('is-muted', !enabled);
    }

    const icoSb = $('#sound-ico-sb');
    if (icoSb) icoSb.innerHTML = `<use href="#i-${iconName}"/>`;
    const btnSb = $('#btn-sound-sb');
    if (btnSb) {
        btnSb.title = label;
        btnSb.setAttribute('aria-label', label);
        btnSb.classList.toggle('is-muted', !enabled);
    }
}

function toggleSound(force) {
    state.sound = (typeof force === 'boolean') ? force : !state.sound;
    localStorage.setItem('homelab_sound_fx', state.sound ? '1' : '0');
    updateSoundUI();
    if (state.sound) playNavSound();
    
    // Broadcast to iframes (e.g. Gemini AI Assistant)
    document.querySelectorAll('iframe').forEach((ifr) => {
        try {
            ifr.contentWindow?.postMessage({ type: 'homelab_sound_fx', enabled: state.sound }, '*');
        } catch (_) {}
    });
}

function playNavSound() {
    if (!isSoundEnabled()) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(680, t);
        osc.frequency.exponentialRampToValueAtTime(340, t + 0.04);
        gain.gain.setValueAtTime(0.06, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.045);
    } catch (_) {}
}

// Each warp scene gets its own synthesized soundtrack, timed to the scene's phases
function playWarpSound(duration = 2000, sceneName = 'blackhole', volume = 1) {
    if (!isSoundEnabled() || volume <= 0) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();
        const scene = (window.WarpFX && window.WarpFX.scenes[sceneName]) || { swapAt: 0.4, emergeAt: 0.7 };
        const d = duration / 1000;
        const t0 = ctx.currentTime;
        const at = (frac) => t0 + d * frac;
        const tSwap = at(scene.swapAt);
        const tOut = at(scene.emergeAt);

        const master = ctx.createGain();
        master.gain.value = 0.22 * volume;
        master.connect(ctx.destination);

        const ramp = (param, v0, t, v1, t1) => {
            param.setValueAtTime(v0, t);
            param.exponentialRampToValueAtTime(v1, t1);
        };

        // Brown noise shared by the whooshes
        const noiseBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (d + 2)), ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
            last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
            data[i] = last * 3.5;
        }
        const noise = (start, stop, filterType, f0, f1, q, peak, tPeak, tEnd) => {
            const src = ctx.createBufferSource();
            src.buffer = noiseBuf;
            const f = ctx.createBiquadFilter();
            f.type = filterType;
            f.Q.value = q;
            ramp(f.frequency, f0, start, f1, tEnd);
            const g = ctx.createGain();
            ramp(g.gain, 0.0001, start, peak, tPeak);
            g.gain.exponentialRampToValueAtTime(0.0001, tEnd);
            src.connect(f).connect(g).connect(master);
            src.start(start);
            src.stop(stop);
        };
        // Oscillator with a pitch glide and an attack/decay envelope
        const tone = (type, f0, f1, start, tPeak, end, peak, dest = master) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = type;
            ramp(o.frequency, f0, start, f1, end);
            ramp(g.gain, 0.0001, start, peak, tPeak);
            g.gain.exponentialRampToValueAtTime(0.0001, end);
            o.connect(g).connect(dest);
            o.start(start);
            o.stop(end + 0.05);
        };
        const sweepFilter = (type, f0, f1, start, end, q) => {
            const f = ctx.createBiquadFilter();
            f.type = type;
            f.Q.value = q;
            ramp(f.frequency, f0, start, f1, end);
            f.connect(master);
            return f;
        };

        if (sceneName === 'supernova') {
            const tDet = at(0.30);
            // Charge-up: beating sines climbing as the star destabilizes
            tone('sine', 180, 900, t0, tDet - 0.05, tDet, 0.35);
            tone('sine', 183, 915, t0, tDet - 0.05, tDet, 0.3);
            tone('sawtooth', 60, 240, t0, tDet - 0.05, tDet, 0.12, sweepFilter('lowpass', 200, 2500, t0, tDet, 4));
            // Implosion suck
            noise(tDet - 0.2, tDet + 0.02, 'bandpass', 4500, 250, 1.5, 0.7, tDet - 0.01, tDet + 0.01);
            // Detonation: sub boom + long rolling blast + crackles
            tone('sine', 95, 22, tDet, tDet + 0.02, tDet + 1.6, 1.0);
            noise(tDet, tDet + 2, 'lowpass', 7000, 90, 0.7, 1.0, tDet + 0.015, tDet + 1.9);
            for (let i = 0; i < 7; i++) {
                const st = tDet + 0.05 + Math.random() * 0.6;
                noise(st, st + 0.08, 'highpass', 3000, 6000, 1, 0.35, st + 0.005, st + 0.07);
            }
            // Pulsar ticks + nebula chord
            for (let i = 0; i < 10; i++) {
                const st = tSwap + i * 0.085;
                tone('sine', 2400, 2200, st, st + 0.004, st + 0.04, 0.12);
            }
            [261.6, 329.6, 392, 523.3, 659.3].forEach((f) => tone('sine', f, f * 1.01, tOut - 0.1, tOut + 0.35, tOut + 1.6, 0.06));
        } else if (sceneName === 'galaxy') {
            // Cosmic choir pad swelling as the camera dives in
            const pad = sweepFilter('lowpass', 400, 4500, t0, tSwap, 2);
            [110, 164.8, 220, 329.6, 493.9].forEach((f) => tone('triangle', f, f * 1.5, t0, tSwap - 0.05, tSwap + 0.3, 0.09, pad));
            noise(t0, tSwap + 0.2, 'bandpass', 300, 3200, 0.8, 0.45, tSwap - 0.05, tSwap + 0.15);
            // Golden gong in the core
            [196, 523.5, 871, 1310, 1863].forEach((f, i) => tone('sine', f, f * 0.995, tSwap, tSwap + 0.01, tSwap + 1.8 - i * 0.2, 0.14 / (i + 1)));
            tone('sine', 70, 40, tSwap, tSwap + 0.02, tSwap + 1, 0.6);
            // Pull-back shimmer
            noise(tOut, tOut + 0.6, 'highpass', 7000, 900, 0.7, 0.25, tOut + 0.05, tOut + 0.55);
            [1568, 2093, 2637].forEach((f, i) => {
                const st = tOut + 0.05 + i * 0.07;
                tone('sine', f, f, st, st + 0.01, st + 1.1, 0.07);
            });
        } else if (sceneName === 'grid') {
            const tCrt = at(0.26);
            // Arpeggiator racing upward
            const arp = sweepFilter('lowpass', 1200, 7000, t0, tOut, 3);
            const notes = [220, 261.6, 329.6, 392, 440, 523.3, 659.3, 784];
            const steps = 24;
            const step = (tOut - t0) / steps;
            for (let i = 0; i < steps; i++) {
                const f = notes[i % notes.length] * (i >= 16 ? 2 : 1);
                const st = t0 + i * step;
                tone('square', f, f, st, st + 0.005, st + step * 0.9, 0.05, arp);
            }
            // Glitch bursts
            for (let i = 0; i < 4; i++) {
                const st = t0 + Math.random() * (tCrt - t0);
                noise(st, st + 0.06, 'highpass', 2500, 5000, 1, 0.4, st + 0.004, st + 0.05);
                tone('square', 55, 55, st, st + 0.004, st + 0.05, 0.08);
            }
            // CRT power-off
            tone('sine', 1600, 40, tCrt, tCrt + 0.01, tSwap, 0.35);
            // Synthwave bass pulses during the ride
            const bass = sweepFilter('lowpass', 300, 1400, tSwap, tOut, 6);
            const beats = 6;
            for (let i = 0; i < beats; i++) {
                const st = tSwap + i * ((tOut - tSwap) / beats);
                tone('sawtooth', 55, 55, st, st + 0.01, st + (tOut - tSwap) / beats * 0.9, 0.3, bass);
            }
            // CRT power-on: thoom + zap
            tone('sine', 130, 38, tOut, tOut + 0.015, tOut + 0.7, 0.9);
            tone('sawtooth', 70, 1100, tOut, tOut + 0.02, tOut + 0.28, 0.12);
            noise(tOut, tOut + 0.3, 'bandpass', 6000, 1500, 2, 0.4, tOut + 0.01, tOut + 0.25);
        } else {
            // Black hole: rumble into the horizon, suction, hyperdrive, white-hole boom
            tone('sine', 110, 28, t0, tSwap - 0.05, tSwap + 0.25, 0.9);
            noise(t0, tSwap + 0.15, 'bandpass', 2400, 120, 1.2, 0.8, tSwap - 0.08, tSwap + 0.1);
            const hf = sweepFilter('lowpass', 200, 5000, tSwap, tOut, 8);
            [55, 55.7, 82.4].forEach((f) => tone('sawtooth', f, f * 4, tSwap, tSwap + 0.12, tOut + 0.15, 0.16, hf));
            noise(tSwap, tOut + 0.1, 'highpass', 400, 6000, 0.7, 0.35, tOut - 0.02, tOut + 0.08);
            tone('sine', 150, 35, tOut, tOut + 0.02, tOut + 0.9, 1.0);
            noise(tOut, tOut + 0.8, 'lowpass', 3000, 200, 0.8, 0.6, tOut + 0.02, tOut + 0.7);
            [1318.5, 1975.5, 2637].forEach((f, i) => {
                const st = tOut + 0.05 + i * 0.05;
                tone('sine', f, f, st, st + 0.01, st + 1.2, 0.07);
            });
        }
    } catch (_) {}
}

// ── Warp FX config (one JSON blob; migrates the older per-setting keys) ──────
const WARP_CONFIG_KEY = 'core_warp_config';
const WARP_SCENE_META = {
    blackhole: { desc: 'หลุมดำดูดหน้าเดิม → อุโมงค์ไฮเปอร์สเปซ → หลุมขาวพ่นหน้าใหม่', grad: 'radial-gradient(circle at 50% 50%, #000 0 18%, #fff 20%, #38bdf8 26%, #8b5cf6 38%, #0b0420 70%)' },
    supernova: { desc: 'ดาวยักษ์ยุบตัวแล้วระเบิด เศษดาวพุ่ง 3D เนบิวลาและพัลซาร์', grad: 'radial-gradient(circle at 50% 50%, #fff 0 6%, #ffd27a 14%, #ff6a2a 30%, #c0265e 48%, #1a0612 75%)' },
    galaxy: { desc: 'หน้าเดิมนอนลงในกาแล็กซี่ก้นหอย กล้องดิ่งทะลุแกนกลางสีทอง', grad: 'radial-gradient(ellipse 60% 30% at 50% 50%, #fff4d6 0 8%, #f5b65a 18%, #4f7dff 45%, #120a2a 80%)' },
    grid: { desc: 'Glitch + ปิดทีวีจอแก้ว ซิ่งบนกริดนีออนซินธ์เวฟ แล้วเปิดจอใหม่', grad: 'linear-gradient(180deg, #12002e 0%, #6a0f8e 48%, #ff3cac 52%, #14002a 54%, #2b0a4a 100%)' },
};

function defaultWarpConfig() {
    const scenes = {};
    Object.keys(WARP_SCENE_META).forEach((n) => { scenes[n] = { on: true, weight: 3 }; });
    return {
        enabled: false,
        mode: 'random',
        fixed: 'blackhole',
        scenes,
        noRepeat: true,
        duration: 2,
        density: 1,
        flash: 1,
        sound: true,
        volume: 0.8,
        disableMobile: false,
        respectReducedMotion: true,
        cycleIndex: 0,
        stats: {},
    };
}

function getWarpConfig() {
    const cfg = defaultWarpConfig();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(WARP_CONFIG_KEY) || 'null'); } catch (_) {}
    if (saved && typeof saved === 'object') {
        Object.assign(cfg, saved, { scenes: cfg.scenes });
        Object.keys(cfg.scenes).forEach((n) => Object.assign(cfg.scenes[n], (saved.scenes || {})[n]));
        cfg.stats = saved.stats || {};
    } else {
        // Migrate the keys used before the Warp FX Studio existed
        if (localStorage.getItem('core_warp_fx') === '0') cfg.enabled = false;
        const speed = parseFloat(localStorage.getItem('core_warp_speed'));
        if (speed) cfg.duration = Math.round(speed * 20) / 10;
        const style = localStorage.getItem('core_warp_style');
        if (style && cfg.scenes[style]) { cfg.mode = 'fixed'; cfg.fixed = style; }
    }
    return cfg;
}

function saveWarpConfig(cfg) {
    localStorage.setItem(WARP_CONFIG_KEY, JSON.stringify(cfg));
}

function warpSceneNames() {
    return window.WarpFX ? Object.keys(window.WarpFX.scenes) : [];
}

function warpPool(cfg) {
    const pool = warpSceneNames().filter((n) => cfg.scenes[n] && cfg.scenes[n].on);
    return pool.length ? pool : warpSceneNames();
}

function isWarpActive(cfg) {
    if (!cfg.enabled || !window.WarpFX) return false;
    if (cfg.respectReducedMotion && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (cfg.disableMobile && window.innerWidth < 700) return false;
    return true;
}

// Pick the next scene per the configured mode (fixed / cycle / weighted random)
function pickWarpScene(cfg, record = true) {
    const names = warpSceneNames();
    let pick;
    if (cfg.mode === 'fixed' && names.includes(cfg.fixed)) {
        pick = cfg.fixed;
    } else if (cfg.mode === 'cycle') {
        const pool = warpPool(cfg);
        pick = pool[(cfg.cycleIndex || 0) % pool.length];
        cfg.cycleIndex = ((cfg.cycleIndex || 0) + 1) % pool.length;
    } else {
        let pool = warpPool(cfg);
        if (cfg.noRepeat && pool.length > 1) pool = pool.filter((n) => n !== state.lastWarpScene);
        const weights = pool.map((n) => Math.max(0, Number(cfg.scenes[n].weight) || 0));
        const total = weights.reduce((a, w) => a + w, 0);
        if (total <= 0) {
            pick = pool[Math.floor(Math.random() * pool.length)];
        } else {
            let r = Math.random() * total;
            pick = pool[pool.length - 1];
            for (let i = 0; i < pool.length; i++) {
                r -= weights[i];
                if (r < 0) { pick = pool[i]; break; }
            }
        }
    }
    state.lastWarpScene = pick;
    if (record) cfg.stats[pick] = (cfg.stats[pick] || 0) + 1;
    saveWarpConfig(cfg);
    if (typeof refreshWarpStudio === 'function') refreshWarpStudio();
    return pick;
}

// Run a warp scene over a view: fromEl leaves, hooks.swap() returns the element that
// enters (already displayed), hooks.done() runs after the overlay is gone
function playViewWarp(fromEl, sceneName, cfg, hooks) {
    const S = window.WarpFX.scenes[sceneName];
    const duration = Math.round(cfg.duration * 1000);
    let toEl = null;
    if (cfg.sound) playWarpSound(duration, sceneName, cfg.volume);

    fromEl.dataset.warp = sceneName;
    fromEl.style.animation = '';
    setViewportOrigin(fromEl);
    fromEl.style.setProperty('--warp-dur', `${Math.round(duration * S.swapAt)}ms`);
    fromEl.classList.add('warp-out');

    window.WarpFX.play({
        scene: sceneName,
        duration,
        density: cfg.density,
        flash: cfg.flash,
        onSwap: () => {
            fromEl.classList.remove('warp-out');
            fromEl.style.transformOrigin = '';
            toEl = hooks.swap();
            toEl.dataset.warp = sceneName;
            toEl.style.animation = '';
            toEl.classList.add('warp-hold');
        },
        onEmerge: () => {
            setViewportOrigin(toEl);
            toEl.style.setProperty('--warp-dur', `${Math.round(duration * (1 - S.emergeAt))}ms`);
            toEl.classList.remove('warp-hold');
            toEl.classList.add('warp-in');
        },
        onDone: () => {
            // Pin animation to none so the base fade-in doesn't replay when warp-in is removed
            toEl.style.animation = 'none';
            toEl.style.transformOrigin = '';
            toEl.classList.remove('warp-in', 'warp-hold');
            if (hooks.done) hooks.done();
        },
    });
}

// Point a view's transform-origin at the viewport centre (views can be taller than the screen)
function setViewportOrigin(el) {
    const rect = el.getBoundingClientRect();
    el.style.transformOrigin = `${window.innerWidth / 2 - rect.left}px ${window.innerHeight / 2 - rect.top}px`;
}

window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'homelab_sound_fx') {
        state.sound = Boolean(ev.data.enabled);
        updateSoundUI();
    }
});

window.addEventListener('storage', (ev) => {
    if (ev.key === 'homelab_sound_fx') {
        state.sound = ev.newValue !== '0';
        updateSoundUI();
    }
});

// ── theme ────────────────────────────────────────────────────────────────────
const THEME_ICON = { tactical: 'tactical', futuristic: 'future', dark: 'moon', light: 'sun', auto: 'auto' };
const THEME_LABEL = {
    tactical: 'Tactical HUD',
    futuristic: 'Futuristic',
    dark: 'Dark Mode',
    light: 'Light Mode',
    auto: 'System Auto',
};

function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem('lab-theme-v2', state.theme);
    localStorage.setItem('lab-theme', state.theme);
    $('#theme-ico').innerHTML = `<use href="#i-${THEME_ICON[state.theme] || 'tactical'}"/>`;
    $('#btn-theme').title = `${THEME_LABEL[state.theme]} — Click to switch`;
    $('#btn-theme').setAttribute('aria-label', `Switch theme (${THEME_LABEL[state.theme]})`);
    syncHudFrames();
    if (state.lastAt) drawCharts();     // Redraw SVG charts when theme changes
}

// ── Tactical Cyber-HUD Vector Frame Renderer ────────────────────────────────
function buildHudSvg(w, h, kind) {
    if (w < 40 || h < 36) return '';
    const C = '#00d2f0';       // Primary Electric Cyan
    const CD = 'rgba(0, 210, 240, 0.42)';
    const O = '#f2541b';       // Tactical Vermilion Orange
    const x1 = w - 1.5, y1 = h - 1.5;
    const cx = Math.round(w / 2);

    if (kind === 'tile-0') {
        const c = 11;
        const sx = Math.round(w * 0.48);
        const outer = `M 1.5,${c} L ${c},1.5 H ${x1 - c} L ${x1},${c} V ${y1 - c} L ${x1 - c},${y1} H 54 L 45,${y1 - 9} H 9 L 1.5,${y1 - 16} Z`;
        const heavyTL = `M 1.5,${c + 18} V ${c} L ${c},1.5 H ${c + 24}`;
        const heavyBR = `M ${x1 - 36},${y1} H ${x1 - c} L ${x1},${y1 - c} V ${y1 - c - 18}`;
        const stepLine = `M 1.5,35 H ${sx} L ${sx + 9},26 H ${x1}`;
        const topOrange = `M ${cx - 22},1.5 L ${cx - 17},5.5 H ${cx + 17} L ${cx + 22},1.5`;
        let bars = '';
        for (let i = 0; i < 6; i++) {
            const bx = 8 + i * 6;
            const by = h - 7.5;
            bars += i < 3
                ? `<rect x="${bx}" y="${by}" width="3.6" height="6" fill="${O}"/>`
                : `<rect x="${bx}" y="${by}" width="3.6" height="6" fill="none" stroke="${C}" stroke-width="1"/>`;
        }
        return `<path d="${outer}" fill="none" stroke="${C}" stroke-width="1.35"/>
                <path d="${heavyTL} ${heavyBR}" fill="none" stroke="${C}" stroke-width="3" stroke-linecap="square"/>
                <path d="${stepLine}" fill="none" stroke="${CD}" stroke-width="1.15"/>
                <path d="${topOrange}" fill="none" stroke="${O}" stroke-width="2"/>
                ${bars}`;
    }

    if (kind === 'tile-1') {
        const c = 11;
        const sx = Math.round(w * 0.56);
        const outer = `M 1.5,${c} L ${c},1.5 H ${x1 - c} L ${x1},${c} V ${y1 - 11} H ${x1 - 46} L ${x1 - 54},${y1} H ${c} L 1.5,${y1 - c} Z`;
        const heavy = `M 1.5,${c + 22} V ${c} L ${c},1.5 H ${c + 28} M ${x1 - 26},1.5 H ${x1 - c} L ${x1},${c} V ${c + 16}`;
        const stepLine = `M 1.5,33 H ${sx} L ${sx + 8},40 H ${x1}`;
        const tri = `<polygon points="${x1 - 38},5 ${x1 - 32},5 ${x1 - 32},10" fill="${O}"/>`;
        let sqs = '';
        for (let i = 0; i < 4; i++) {
            const qx = x1 - 41 + i * 10;
            const qy = h - 8.5;
            sqs += i === 1
                ? `<rect x="${qx}" y="${qy}" width="6.5" height="6.5" fill="${O}"/>`
                : `<rect x="${qx}" y="${qy}" width="6.5" height="6.5" fill="none" stroke="${C}" stroke-width="1.15"/>`;
        }
        return `<path d="${outer}" fill="none" stroke="${C}" stroke-width="1.35"/>
                <path d="${heavy}" fill="none" stroke="${C}" stroke-width="3" stroke-linecap="square"/>
                <path d="${stepLine}" fill="none" stroke="${CD}" stroke-width="1.15"/>
                ${tri}${sqs}`;
    }

    if (kind === 'tile-2') {
        const c = 12;
        const sx = Math.round(w * 0.44);
        const outer = `M 1.5,${c} L ${c},1.5 H ${x1 - c} L ${x1},${c} V ${y1 - c} L ${x1 - c},${y1} H 48 L 40,${y1 - 8} H 10 L 1.5,${y1 - 16} Z`;
        const heavy = `M 1.5,${c + 16} V ${c} L ${c},1.5 H ${c + 28} M ${x1},${y1 - c - 16} V ${y1 - c} L ${x1 - c},${y1} H ${x1 - c - 20}`;
        const stepLine = `M 1.5,35 H ${sx} L ${sx + 9},26 H ${x1}`;
        const trap = `<polygon points="10,${h - 6.5} 18,${h - 6.5} 22,${h - 1.5} 14,${h - 1.5}" fill="${O}"/>
                      <polygon points="21,${h - 6.5} 37,${h - 6.5} 41,${h - 1.5} 25,${h - 1.5}" fill="none" stroke="${O}" stroke-width="1.2"/>
                      <polygon points="${x1 - 7},${y1} ${x1},${y1} ${x1},${y1 - 7}" fill="${O}"/>`;
        return `<path d="${outer}" fill="none" stroke="${C}" stroke-width="1.35"/>
                <path d="${heavy}" fill="none" stroke="${C}" stroke-width="3" stroke-linecap="square"/>
                <path d="${stepLine}" fill="none" stroke="${CD}" stroke-width="1.15"/>
                ${trap}`;
    }

    if (kind === 'tile-3') {
        const c = 15;
        const outer = `M 1.5,${c} L ${c},1.5 H ${x1 - 8} L ${x1},9.5 V ${y1 - 14} L ${x1 - 12},${y1} H 10 L 1.5,${y1 - 8.5} Z`;
        const heavy = `M 1.5,${c + 20} V ${c} L ${c},1.5 H ${c + 24} M 1.5,${y1 - 24} V ${y1 - 8.5} L 10,${y1} H 36`;
        const stepLine = `M 1.5,34 H ${x1 - 14} L ${x1},46`;
        const orangeL = `<path d="M ${x1},${y1 - 24} V ${y1} H ${x1 - 14}" fill="none" stroke="${O}" stroke-width="2.6" stroke-linecap="square"/>`;
        return `<path d="${outer}" fill="none" stroke="${C}" stroke-width="1.35"/>
                <path d="${heavy}" fill="none" stroke="${C}" stroke-width="3" stroke-linecap="square"/>
                <path d="${stepLine}" fill="none" stroke="${CD}" stroke-width="1.15"/>
                ${orangeL}`;
    }

    if (kind === 'chart') {
        const c = 15;
        const nw = Math.min(32, Math.round(w * 0.09));
        const sx = Math.round(w * 0.44);
        const outer = `M 1.5,${c} L ${c},1.5 H ${cx - nw - 6} L ${cx - nw},7.5 H ${cx + nw} L ${cx + nw + 6},1.5 H ${x1 - c} L ${x1},${c} V ${y1 - c} L ${x1 - c},${y1} H ${cx + nw + 8} L ${cx + nw},${y1 - 7} H ${cx - nw} L ${cx - nw - 8},${y1} H ${c} L 1.5,${y1 - c} Z`;
        const heavy = `M 1.5,${c + 26} V ${c} L ${c},1.5 H ${c + 34}
                       M ${x1 - c - 34},1.5 H ${x1 - c} L ${x1},${c} V ${c + 26}
                       M 1.5,${y1 - c - 26} V ${y1 - c} L ${c},${y1} H ${c + 34}
                       M ${x1 - c - 34},${y1} H ${x1 - c} L ${x1},${y1 - c} V ${y1 - c - 26}`;
        const stepLine = `M 1.5,42 H ${sx} L ${sx + 10},32 H ${x1}`;
        const topU = `<path d="M ${cx - 16},1.5 V 5 H ${cx + 16} V 1.5" fill="none" stroke="${O}" stroke-width="2.5"/>`;
        const botArch = `<path d="M ${cx - 22},${y1} L ${cx - 16},${y1 - 4.5} H ${cx + 16} L ${cx + 22},${y1}" fill="none" stroke="${O}" stroke-width="2.5"/>`;
        let ticks = '';
        const ty0 = Math.round(h * 0.34);
        for (let i = 0; i < 8; i++) {
            const ty = ty0 + i * 7;
            if (ty < h - 24) ticks += `<line x1="5" y1="${ty}" x2="12" y2="${ty}" stroke="${C}" stroke-width="1.8"/>`;
        }
        return `<path d="${outer}" fill="none" stroke="${C}" stroke-width="1.4"/>
                <path d="${heavy}" fill="none" stroke="${C}" stroke-width="3.2" stroke-linecap="square"/>
                <path d="${stepLine}" fill="none" stroke="${CD}" stroke-width="1.15"/>
                ${topU}${botArch}${ticks}`;
    }

    if (kind === 'svc-0' || kind === 'svc-1') {
        const c = 11;
        const sx = Math.round(w * 0.50);
        const outer = `M 1.5,${c} L ${c},1.5 H ${x1 - c} L ${x1},${c} V ${y1 - c} L ${x1 - c},${y1} H ${c} L 1.5,${y1 - c} Z`;
        const heavy = `M 1.5,${c + 18} V ${c} L ${c},1.5 H ${c + 28} M ${x1 - c - 24},${y1} H ${x1 - c} L ${x1},${y1 - c} V ${y1 - c - 16}`;
        const stepLine = `M 1.5,52 H ${sx} L ${sx + 8},44 H ${x1}`;
        const callout = kind === 'svc-0'
            ? `<rect x="${x1 - 44}" y="${y1 - 5.5}" width="5" height="3.5" fill="none" stroke="${C}" stroke-width="1"/>
               <rect x="${x1 - 36}" y="${y1 - 5.5}" width="5" height="3.5" fill="${O}"/>
               <rect x="${x1 - 28}" y="${y1 - 5.5}" width="5" height="3.5" fill="none" stroke="${C}" stroke-width="1"/>
               <polygon points="14,1.5 34,1.5 31,4.5 17,4.5" fill="${O}"/>`
            : `<path d="M ${x1},${y1 - 18} V ${y1} H ${x1 - 18}" fill="none" stroke="${O}" stroke-width="2.5"/>
               <polygon points="14,${y1} 26,${y1} 29,${y1 - 3.5} 17,${y1 - 3.5}" fill="${O}"/>`;
        return `<path d="${outer}" fill="none" stroke="${C}" stroke-width="1.35"/>
                <path d="${heavy}" fill="none" stroke="${C}" stroke-width="2.9" stroke-linecap="square"/>
                <path d="${stepLine}" fill="none" stroke="${CD}" stroke-width="1.1"/>
                ${callout}`;
    }

    if (kind === 'table') {
        const c = 13;
        const nL = Math.min(180, Math.round(w * 0.22));
        const nR = Math.min(340, Math.round(w * 0.46));
        const outer = `M 1.5,${c} L ${c},1.5 H ${nL} L ${nL + 8},6.5 H ${nR} L ${nR + 8},1.5 H ${x1 - c} L ${x1},${c} V ${y1 - 16} L ${x1 - 16},${y1} H 92 L 84,${y1 - 8} H 1.5 Z`;
        const heavy = `M 1.5,${c + 28} V ${c} L ${c},1.5 H ${Math.min(nL, 90)}
                       M ${x1 - 90},1.5 H ${x1 - c} L ${x1},${c} V ${c + 28}
                       M ${x1 - 64},${y1} H ${x1 - 16} L ${x1},${y1 - 16} V ${y1 - 42}`;
        const orangeSub = `<path d="M 1.5,${y1 - 5} L 6.5,${y1} H 52 L 47,${y1 - 5} Z" fill="none" stroke="${O}" stroke-width="1.4"/>
                           <rect x="57" y="${y1 - 6.5}" width="4" height="6.5" fill="${O}"/>
                           <rect x="64" y="${y1 - 6.5}" width="4" height="6.5" fill="${O}"/>
                           <rect x="71" y="${y1 - 6.5}" width="4" height="6.5" fill="${O}"/>
                           <rect x="78" y="${y1 - 6.5}" width="4" height="6.5" fill="none" stroke="${C}" stroke-width="1.1"/>`;
        let ticks = '';
        for (let i = 0; i < 6; i++) {
            const ty = 14 + i * 5.5;
            if (ty < h - 24) ticks += `<line x1="${x1 - 11}" y1="${ty}" x2="${x1 - 4}" y2="${ty}" stroke="${C}" stroke-width="1.6"/>`;
        }
        return `<path d="${outer}" fill="none" stroke="${C}" stroke-width="1.4"/>
                <path d="${heavy}" fill="none" stroke="${C}" stroke-width="3.2" stroke-linecap="square"/>
                ${orangeSub}${ticks}`;
    }

    const c = 13;
    const sx = Math.round(w * 0.46);
    const outer = `M 1.5,${c} L ${c},1.5 H ${x1 - c} L ${x1},${c} V ${y1 - c} L ${x1 - c},${y1} H ${c} L 1.5,${y1 - c} Z`;
    const heavy = `M 1.5,${c + 22} V ${c} L ${c},1.5 H ${c + 32}
                   M ${x1 - c - 32},${y1} H ${x1 - c} L ${x1},${y1 - c} V ${y1 - c - 22}`;
    const stepLine = `M 1.5,38 H ${sx} L ${sx + 9},29 H ${x1}`;
    let extra = '';
    if (kind === 'host-1' || kind === 'host-3') {
        extra = `<rect x="${x1 - 8}" y="${Math.round(h * 0.36)}" width="5.5" height="5.5" fill="none" stroke="${C}" stroke-width="1.1"/>
                 <rect x="${x1 - 8}" y="${Math.round(h * 0.36) + 9}" width="5.5" height="5.5" fill="none" stroke="${C}" stroke-width="1.1"/>
                 <rect x="${x1 - 8}" y="${Math.round(h * 0.36) + 18}" width="5.5" height="5.5" fill="${O}"/>
                 <polygon points="16,${y1} 36,${y1} 39,${y1 - 4} 19,${y1 - 4}" fill="${O}"/>`;
    } else {
        extra = `<line x1="1.5" y1="${c + 28}" x2="1.5" y2="${Math.max(c + 36, h - c - 20)}" stroke="${O}" stroke-width="3"/>
                 <path d="M ${x1},${y1 - 22} V ${y1} H ${x1 - 22}" fill="none" stroke="${O}" stroke-width="2.6"/>`;
    }
    return `<path d="${outer}" fill="none" stroke="${C}" stroke-width="1.35"/>
            <path d="${heavy}" fill="none" stroke="${C}" stroke-width="3" stroke-linecap="square"/>
            <path d="${stepLine}" fill="none" stroke="${CD}" stroke-width="1.15"/>
            ${extra}`;
}

const hudRO = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver((entries) => {
        if (state.theme !== 'tactical') return;
        for (const entry of entries) updateSingleHudFrame(entry.target);
    })
    : null;

function updateSingleHudFrame(el) {
    if (state.theme !== 'tactical') return;
    const w = Math.round(el.clientWidth);
    const h = Math.round(el.clientHeight);
    if (!w || !h) return;
    const kind = el.dataset.hud || 'card';
    const key = `${w}x${h}:${kind}`;
    let svg = el.querySelector(':scope > svg.hud-frame');
    if (svg && el._hudKey === key) return;
    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'hud-frame');
        svg.setAttribute('aria-hidden', 'true');
        el.prepend(svg);
        if (hudRO) hudRO.observe(el);
    }
    el._hudKey = key;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = buildHudSvg(w, h, kind);
}

function syncHudFrames() {
    if (state.theme !== 'tactical') return;
    $$('.tile, .svc, .card').forEach(updateSingleHudFrame);
}

// ── toast ────────────────────────────────────────────────────────────────────
function toast(kind, msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.kind = kind;
    el.innerHTML = `${ico(kind === 'ok' ? 'check' : 'x')}<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4500);
}

// ── confirm dialog ───────────────────────────────────────────────────────────
function confirmDialog(title, body, okLabel = 'Confirm') {
    const dlg = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    $('#confirm-ok').textContent = okLabel;
    return new Promise((resolve) => {
        dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
        dlg.showModal();
    });
}

async function doAction(url, title, body, okLabel) {
    if (!(await confirmDialog(title, body, okLabel))) return false;
    try {
        const r = await fetch(url, { method: 'POST' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        toast('ok', `${title} — Success`);
        await refresh(true);
        return true;
    } catch (e) {
        toast('err', `${title} failed: ${e.message}`);
        return false;
    }
}

// ── status pill (icon + label always) ────────────────────────────────────────
const STATUS_MAP = {
    up: 'good', running: 'good', online: 'good', ok: 'good', healthy: 'good', active: 'good',
    down: 'critical', stopped: 'critical', exited: 'critical', error: 'critical', dead: 'critical',
    warning: 'warning', degraded: 'serious', paused: 'unknown', unknown: 'unknown', created: 'unknown',
};
const STATUS_ICON = { good: 'check', warning: 'warn', serious: 'dot', critical: 'x', unknown: 'unknown' };

function pill(status, label) {
    const s = STATUS_MAP[status] || 'unknown';
    return `<span class="pill" data-status="${s}">${ico(STATUS_ICON[s])}<span>${esc(label)}</span></span>`;
}

// ── tiles ────────────────────────────────────────────────────────────────────
function tile({ icon, label, value, unit, meta, pct, levelName, idx = 0 }) {
    return `<article class="tile" data-hud="tile-${idx % 4}">
        <div class="tile__top">${ico(icon)}<span class="tile__label">${esc(label)}</span></div>
        <div class="tile__value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
        ${pct !== undefined ? `<div class="meter"><div class="meter__fill" style="width:${Math.min(100, Math.max(0, pct))}%"${levelName ? ` data-level="${levelName}"` : ''}></div></div>` : ''}
        <div class="tile__meta">${esc(meta || '')}</div>
    </article>`;
}


// ── multi-view navigation & routing ──────────────────────────────────────────

// ── view titles dictionary for desktop topbar ────────────────────────────────
const VIEW_TITLES = {
    overview: { icon: '📊', text: 'แดชบอร์ดภาพรวมเซิร์ฟเวอร์' },
    services: { icon: '📦', text: 'บริการ &amp; จัดการคอนเทนเนอร์' },
    ports:    { icon: '🛡️', text: 'ระบบพอร์ต &amp; ไฟร์วอลล์ (UFW)' },
    vpn:      { icon: '⚡', text: 'WireGuard VPN &amp; EMQX MQTT Hub' },
    terminal: { icon: '🤖', text: 'Gemini AI Assistant &amp; Tactical Terminal' },
    gemini:   { icon: '🤖', text: 'Gemini AI Assistant &amp; Project Builder' },
    settings: { icon: '⚙️', text: 'ตั้งค่าระบบ &amp; AI (System Settings)' },
    energy:   { icon: '⚡', text: 'Energy Monitor — โซลาร์ · แบตเตอรี่ · การไฟฟ้า · โหลด' },
};

function syncMobileTerminalMetrics() {
    const isMobTerm = document.body.classList.contains('is-mobile-terminal-view') && window.innerWidth <= 900;
    const mobNav = document.querySelector('.mobile-bottom-nav');
    if (isMobTerm && mobNav) {
        const navH = mobNav.offsetHeight || 62;
        document.documentElement.style.setProperty('--mob-nav-h', navH + 'px');
    } else {
        document.documentElement.style.removeProperty('--mob-nav-h');
    }
    if (window.visualViewport) {
        document.body.style.height = isMobTerm ? (window.visualViewport.height + 'px') : '';
    } else {
        document.body.style.height = '';
    }
}
window.addEventListener('resize', syncMobileTerminalMetrics);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncMobileTerminalMetrics);
}

function switchTerminalSubtab(subtab) {
    const target = subtab === 'shell' ? 'shell' : 'gemini';
    if (state.isReady && state.activeTermSubtab !== target) {
        playNavSound();
    }
    state.activeTermSubtab = target;
    const subtabs = document.querySelectorAll('#terminal-subtabs .term-subtab');
    const panelShell = document.getElementById('term-subpanel-shell');
    const panelGemini = document.getElementById('term-subpanel-gemini');

    subtabs.forEach((b) => {
        const isActive = b.dataset.termSubtab === target;
        b.classList.toggle('is-active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (panelShell) panelShell.style.display = (target === 'shell') ? 'block' : 'none';
    if (panelGemini) panelGemini.style.display = (target === 'gemini') ? 'block' : 'none';

    const textEl = document.getElementById('view-title-text');
    if (textEl && state.activeView === 'terminal') {
        textEl.innerHTML = (target === 'gemini')
            ? 'Gemini AI Assistant &amp; Project Builder'
            : 'Tactical Web Terminal &amp; Cockpit';
    }
}

function updateSidebarIndicator(target) {
    const nav = $('#sidebar-nav');
    const ind = $('#sidebar-indicator');
    const activeItem = nav ? nav.querySelector(`.sidebar__item[data-view="${target}"]`) : null;
    if (ind && activeItem) {
        ind.style.top = `${activeItem.offsetTop}px`;
        ind.style.height = `${activeItem.offsetHeight}px`;
        ind.style.opacity = '1';
    }
}

// ── Magnetic Attraction & Spotlight Physics ──────────────────────────────────
function initMagneticPhysics() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover)').matches) return;

    // Track mouse over cards for dynamic spotlight
    document.addEventListener('mousemove', (e) => {
        const card = e.target.closest('.card, .tile, .link, .sidebar__item');
        if (card) {
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
            card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        }
    });

    // Magnetic pull for interactive buttons
    document.addEventListener('mousemove', (e) => {
        const target = e.target.closest('[data-magnetic="true"], .link');
        if (!target) return;
        // Never apply magnetic pull on sidebar items when sidebar is collapsed (keeps active capsule rock solid)
        if (target.closest('.sidebar:not(:hover):not(.is-pinned)')) {
            target.style.transform = '';
            return;
        }
        const rect = target.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const distSq = (e.clientX - cx) ** 2 + (e.clientY - cy) ** 2;
        const maxDist = 90;
        if (distSq < maxDist * maxDist) {
            const pullFactor = 0.22;
            const px = (e.clientX - cx) * pullFactor;
            const py = (e.clientY - cy) * pullFactor;
            target.style.transform = `translate3d(${px}px, ${py}px, 0)`;
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-magnetic="true"], .link');
        if (target) {
            target.style.transform = '';
        }
    });
}

function switchView(viewName, updateHash = true) {
    if (viewName === 'gemini') {
        switchView('terminal', updateHash);
        switchTerminalSubtab('gemini');
        return;
    }
    if (viewName === 'vpn') {
        switchView('ports', updateHash);
        const vpnTabBtn = document.querySelector('.sec-subtab[data-ports-tab="vpn"]');
        if (vpnTabBtn) vpnTabBtn.click();
        return;
    }

    const prevView = state.activeView;
    const validViews = ['overview', 'services', 'ports', 'terminal', 'settings', 'energy'];
    const target = validViews.includes(viewName) ? viewName : 'overview';

    if (state.isReady && prevView === target && !state.warp) {
        return;
    }

    if (target === 'settings' && typeof loadSettingsView === 'function') {
        loadSettingsView();
    }

    if (target === 'energy') {
        // โหลด iframe เฉพาะตอนเปิดครั้งแรก (หน้า energy มี polling ของตัวเอง)
        const ef = document.getElementById('energy-frame');
        if (ef && !ef.getAttribute('src')) ef.setAttribute('src', ef.dataset.src);
    }

    const performNavUpdates = () => {
        // Update desktop subnav tabs
        $$('.subnav__tab').forEach((b) => {
            const isMatch = b.dataset.view === target;
            b.classList.toggle('is-active', isMatch);
            b.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });

        // Update mobile bottom nav buttons
        $$('.mobile-nav-btn').forEach((b) => {
            const isMatch = b.dataset.view === target;
            b.classList.toggle('is-active', isMatch);
        });

        // Update desktop sidebar items
        $$('.sidebar__item').forEach((b) => {
            const isMatch = b.dataset.view === target;
            b.classList.toggle('is-active', isMatch);
            b.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });

        updateSidebarIndicator(target);

        // Update Desktop Topbar Title
        const titleInfo = VIEW_TITLES[target] || VIEW_TITLES.overview;
        const iconEl = $('#view-title-icon');
        const textEl = $('#view-title-text');
        if (iconEl) iconEl.innerHTML = titleInfo.icon;
        if (textEl) textEl.innerHTML = titleInfo.text;

        if (updateHash && location.hash !== `#${target}`) {
            history.replaceState(null, '', `#${target}`);
        }

        document.body.classList.toggle('is-mobile-terminal-view', target === 'terminal');
        if (typeof syncMobileTerminalMetrics === 'function') {
            syncMobileTerminalMetrics();
            requestAnimationFrame(syncMobileTerminalMetrics);
        }
    };

    const activateTargetView = () => {
        // When switching to overview or terminal, ensure canvas/charts sync
        if (target === 'overview') {
            setTimeout(() => { syncHudFrames(); drawCharts(); }, 40);
        } else if (target === 'terminal') {
            const subtab = state.activeTermSubtab || 'gemini';
            switchTerminalSubtab(subtab);
            if (subtab === 'shell') {
                const out = $('#dterm-output');
                if (out) out.scrollTop = out.scrollHeight;
            }
        }
        window.scrollTo({ top: 0, behavior: 'instant' });
    };

    // A Settings preview is running: end it (its hooks restore the view) and switch normally
    if (state.warp && state.warp.preview) {
        window.WarpFX.finish();
    }

    // A warp is already in flight: retarget it before the swap, queue it after
    if (state.warp) {
        const w = state.warp;
        if (!w.swapped) {
            if (target !== w.target) {
                w.target = target;
                w.activate = activateTargetView;
                state.activeView = target;
                performNavUpdates();
            }
        } else {
            w.queued = target === state.activeView ? null : target;
        }
        return;
    }

    const warpCfg = getWarpConfig();
    const findView = (name) => document.querySelector(`.lab-view[data-view-id="${name}"], .lab-view[data-view="${name}"]`);

    if (state.isReady && prevView && prevView !== target && isWarpActive(warpCfg)) {
        const currentViewEl = document.querySelector('.lab-view.is-active') || findView(prevView);
        const firstTargetEl = findView(target);

        if (currentViewEl && firstTargetEl && currentViewEl !== firstTargetEl) {
            const w = state.warp = { target, activate: activateTargetView, swapped: false, queued: null };
            state.activeView = target;
            performNavUpdates();

            $$('.lab-view').forEach((v) => {
                v.classList.remove('warp-out', 'warp-in', 'warp-hold');
                v.style.animation = '';
                if (v !== currentViewEl) {
                    v.classList.remove('is-active');
                    v.style.display = 'none';
                }
            });

            playViewWarp(currentViewEl, pickWarpScene(warpCfg), warpCfg, {
                swap: () => {
                    w.swapped = true;
                    currentViewEl.classList.remove('is-active');
                    currentViewEl.style.display = 'none';
                    const el = findView(w.target);
                    el.style.display = 'block';
                    el.classList.add('is-active');
                    w.activate();
                    return el;
                },
                done: () => {
                    state.warp = null;
                    if (w.queued && w.queued !== state.activeView) switchView(w.queued);
                },
            });
            return;
        }
    }

    // Default immediate switch (e.g. initial load or reduced motion)
    if (state.isReady && prevView !== target) {
        playNavSound();
    }
    state.activeView = target;

    // Toggle view containers
    $$('.lab-view').forEach((v) => {
        const isMatch = (v.dataset.viewId || v.dataset.view) === target;
        v.style.display = isMatch ? 'block' : 'none';
        v.classList.remove('warp-out', 'warp-in', 'warp-hold');
        v.style.animation = '';
        v.classList.toggle('is-active', isMatch);
    });

    performNavUpdates();
    activateTargetView();
}

function renderTiles(s) {
    const h = s.host || {};
    const cpu = h.cpu || { pct: 0, cores: [] };
    const mem = h.mem || { pct: 0, used: 0, total: 0 };
    const root = (h.disks || []).find((d) => d.mount === '/') || (h.disks || [])[0] || {};
    const maxTemp = (h.temps || []).reduce((m, t) => Math.max(m, t.celsius || 0), 0);
    const svc = s.services || { up: 0, total: 0, down: 0 };
    const doc = s.docker || { running: 0, total: 0, stopped: 0 };
    const en = s.energy || {};
    const rt = en.realtime || {};
    const td = en.today || {};
    const tm = en.this_month || {};

    const items = [
        {
            icon: 'activity', label: 'AC Power (PZEM)',
            value: rt.power_watts != null ? Math.round(rt.power_watts) : '—', unit: 'W',
            pct: rt.power_watts ? Math.min(100, (rt.power_watts / 3500) * 100) : 0,
            levelName: level(rt.power_watts || 0, 1500, 2500, 3200),
            meta: td.cost_thb != null ? `วันนี้ ${td.cost_thb.toFixed(0)}฿ (${td.energy_kwh?.toFixed(1) || 0} kWh) · เดือนนี้ ${tm.cost_thb ? Math.round(tm.cost_thb) + '฿' : '—'}` : 'PZEM Grid Monitor',
        },
        {
            icon: 'cpu', label: 'CPU', value: (cpu.pct ?? 0).toFixed(0), unit: '%',
            pct: cpu.pct, levelName: level(cpu.pct, 60, 80, 90),
            meta: `${cpu.cores?.length || 0} cores · load ${(h.load || []).slice(0, 2).map((n) => n.toFixed(2)).join(' / ')}`,
        },
        {
            icon: 'mem', label: 'Memory', value: (mem.pct ?? 0).toFixed(0), unit: '%',
            pct: mem.pct, levelName: level(mem.pct, 70, 85, 95),
            meta: `${fmtBytes(mem.used)} / ${fmtBytes(mem.total)}`,
        },
        {
            icon: 'disk', label: `Disk ${root.mount || '/'}`, value: (root.usedPct ?? 0).toFixed(0), unit: '%',
            pct: root.usedPct, levelName: level(root.usedPct, 70, 85, 95),
            meta: `${fmtBytes(root.used || 0)} / ${fmtBytes(root.size || 0)}`,
        },
        {
            icon: 'temp', label: 'Peak Temp', value: maxTemp ? maxTemp.toFixed(0) : '—', unit: maxTemp ? '°C' : '',
            pct: maxTemp, levelName: level(maxTemp, 60, 75, 85),
            meta: `${(h.temps || []).length} sensors`,
        },
        {
            icon: 'box', label: 'Containers', value: `${doc.running}<small>/${doc.total}</small>`,
            meta: `${doc.stopped} stopped · see table below`,
        },
        {
            icon: 'server', label: 'Active Services', value: `${svc.up}<small>/${svc.total}</small>`,
            pct: svc.total ? (svc.up / svc.total) * 100 : 0,
            levelName: svc.down ? (svc.down > 1 ? 'serious' : 'warning') : 'good',
            meta: svc.down ? `${svc.down} service(s) degraded` : 'All services operational',
        },
        {
            icon: 'clock', label: 'System Uptime', value: fmtDur(h.uptimeSec).split(' ')[0],
            unit: fmtDur(h.uptimeSec).split(' ').slice(1).join(' '),
            meta: `${h.hostname || ''} · ${h.platform || ''}`,
        },
    ];

    const tilesEl = $('#tiles');
    if (tilesEl) tilesEl.innerHTML = items.map((it, idx) => tile({ ...it, idx })).join('');

    const hostEl = $('#hostname');
    if (hostEl) hostEl.textContent = h.hostname || '—';
    const sbHostEl = $('#sidebar-hostname');
    if (sbHostEl) sbHostEl.textContent = h.hostname || '—';
    const ovHint = $('#overview-hint');
    if (ovHint) ovHint.textContent = `Updated at ${fmtTime(s.generatedAt)}`;
}

function renderEnergy(s) {
    const en = s.energy || {};
    const sec = document.getElementById('sec-energy');
    if (!en || en.error || !en.realtime) {
        if (sec && !en.realtime) sec.style.display = 'none';
        return;
    }
    if (sec) sec.style.display = 'block';

    const rt = en.realtime || {};
    const td = en.today || {};
    const tm = en.this_month || {};

    const elWatts = document.getElementById('energy-val-watts');
    if (elWatts) elWatts.textContent = rt.power_watts != null ? Math.round(rt.power_watts).toLocaleString() : '—';

    const elAcMeta = document.getElementById('energy-meta-ac');
    if (elAcMeta) elAcMeta.textContent = `${rt.voltage_volts || '—'} V · ${rt.current_amps || '—'} A · PF ${rt.power_factor || '—'}`;

    const elTodayThb = document.getElementById('energy-val-today-thb');
    if (elTodayThb) elTodayThb.textContent = td.cost_thb != null ? td.cost_thb.toFixed(2) : '—';

    const elTodayKwh = document.getElementById('energy-meta-today-kwh');
    if (elTodayKwh) elTodayKwh.textContent = `${td.energy_kwh != null ? td.energy_kwh.toFixed(3) : '—'} kWh`;

    const elMonthThb = document.getElementById('energy-val-month-thb');
    if (elMonthThb) elMonthThb.textContent = tm.cost_thb != null ? Math.round(tm.cost_thb).toLocaleString() : '—';

    const elMonthKwh = document.getElementById('energy-meta-month-kwh');
    if (elMonthKwh) elMonthKwh.textContent = `${tm.energy_kwh != null ? tm.energy_kwh.toFixed(1) : '—'} kWh (${tm.days_recorded || 0} วัน)`;

    const elProjThb = document.getElementById('energy-val-proj-thb');
    if (elProjThb) elProjThb.textContent = tm.projected_cost_thb != null ? Math.round(tm.projected_cost_thb).toLocaleString() : '—';

    const elProjKwh = document.getElementById('energy-meta-proj-kwh');
    if (elProjKwh) elProjKwh.textContent = `~${tm.projected_kwh != null ? Math.round(tm.projected_kwh).toLocaleString() : '—'} kWh`;
}

// ── services ─────────────────────────────────────────────────────────────────
const SVC_ICON = {
    caddy: 'globe', cockpit: 'server', portainer: 'box', homepage: 'activity',
    'mongo-express': 'db', mongodb: 'db', 'uptime-kuma': 'activity', 'pm2-ui': 'activity', filebrowser: 'box', samba: 'server', onepercentbot: 'activity',
    wireguard: 'shield', emqx: 'activity', 'emqx-mqtt': 'activity', 'iot-dashboard': 'cpu', homeassistant: 'home', zigbee2mqtt: 'box',
};

function renderServices(s) {
    const items = (s.services && s.services.items) || [];
    const svcHint = $('#services-hint');
    if (svcHint) svcHint.textContent = `${(s.services && s.services.up) || 0}/${(s.services && s.services.total) || 0} responding normally`;
    const svcEl = $('#services');
    if (svcEl) {
        svcEl.innerHTML = items.map((v, idx) => {
            const cleanName = String(v.name || '').replace('เวอร์ชันเดิม', 'Legacy');
            return `
            <article class="svc" data-hud="svc-${idx % 2}">
                <div class="svc__head">
                    <span class="svc__icon">${ico(SVC_ICON[v.id] || 'server')}</span>
                    <span class="svc__name">${esc(cleanName)}</span>
                    ${pill(v.up ? 'up' : 'down', v.up ? 'Online' : 'Offline')}
                </div>
                <div class="svc__meta">
                    <span>${esc(v.detail || '')}${v.latencyMs !== undefined ? ` · ${v.latencyMs} ms` : ''}</span>
                    <a class="svc__open" href="${esc(v.url)}" target="_blank" rel="noopener">Open ${ico('external')}</a>
                </div>
            </article>`;
        }).join('');
    }
}

function renderLinks(links) {
    if (!links || !links.length) return;
    const ql = $('#quicklinks');
    if (!ql) return;
    ql.innerHTML = links.map((l) => {
        const label = String(l.label || '').replace('เวอร์ชันเดิม', 'Legacy');
        let href = esc(l.url);
        let extra = ' target="_blank" rel="noopener"';
        if (l.url === '#sec-ports' || l.url === '#ports') {
            href = '#ports';
            extra = ' data-view="ports" data-view-jump="1"';
        } else if (l.url === '#energy') {
            href = '#energy';
            extra = ' data-view="energy" data-view-jump="1"';
        } else if (l.url === '/terminal' || l.url === '#sec-terminal' || l.url === '#terminal') {
            href = '#terminal';
            extra = ' data-view="terminal" data-view-jump="1"';
        } else if (l.url === '#vpn') {
            href = '#ports';
            extra = ' data-view="ports" data-view-jump="1" data-ports-jump="vpn"';
        } else if (l.url === '#services') {
            href = '#services';
            extra = ' data-view="services" data-view-jump="1"';
        } else if (typeof l.url === 'string' && l.url.startsWith('/')) {
            extra = '';
        }
        return `<a class="link" href="${href}"${extra}>${ico(l.icon || 'link')}<span>${esc(label)}</span></a>`;
    }).join('');
}

// ── tables ──────────────────────────────────────────────────────────────────
function renderContainers(items) {
    const tb = $('#tbl-containers tbody');
    if (!tb) return;
    if (!items || !items.length) {
        tb.innerHTML = '<tr><td colspan="7" class="dim">No containers found</td></tr>';
        return;
    }
    tb.innerHTML = items.map((c) => {
        const running = c.state === 'running';
        return `<tr>
            <td class="name">${esc(c.name)}</td>
            <td class="dim col-hide-sm"><span class="img">${esc(c.image)}</span></td>
            <td>${pill(running ? 'running' : (c.state === 'paused' ? 'paused' : 'stopped'), running ? 'Running' : esc(c.state))}</td>
            <td class="num">${running ? c.cpu.toFixed(1) + '%' : '—'}</td>
            <td class="num">${running ? esc(c.mem || '—') : '—'}</td>
            <td class="dim col-hide-sm">${esc(c.ports.join(', ') || '—')}</td>
            <td>
                <div class="rowbtns">
                    ${running
                        ? `<button class="btn btn--icon" data-c="${esc(c.name)}" data-a="restart" title="Restart">${ico('restart')}</button>
                           <button class="btn btn--icon" data-c="${esc(c.name)}" data-a="stop" title="Stop">${ico('stop')}</button>`
                        : `<button class="btn btn--icon" data-c="${esc(c.name)}" data-a="start" title="Start">${ico('play')}</button>`}
                </div>
            </td>
        </tr>`;
    }).join('');
}

function renderPm2(items) {
    const tb = $('#tbl-pm2 tbody');
    if (!tb) return;
    if (!items || !items.length) {
        tb.innerHTML = '<tr><td colspan="8" class="dim">No processes found</td></tr>';
        return;
    }
    tb.innerHTML = items.map((p) => {
        const online = p.status === 'online';
        return `<tr>
            <td class="name">${esc(p.name)}</td>
            <td>${pill(online ? 'online' : 'stopped', online ? 'Online' : esc(p.status))}</td>
            <td class="num">${p.pid || '—'}</td>
            <td class="num">${p.cpu.toFixed(1)}%</td>
            <td class="num">${fmtBytes(p.mem)}</td>
            <td class="num">${p.restarts ?? 0}</td>
            <td class="dim">${fmtDur(p.uptimeSec)}</td>
            <td>
                <div class="rowbtns">
                    ${online
                        ? `<button class="btn btn--icon" data-p="${esc(p.name)}" data-a="restart" title="Restart">${ico('restart')}</button>
                           <button class="btn btn--icon" data-p="${esc(p.name)}" data-a="stop" title="Stop">${ico('stop')}</button>`
                        : `<button class="btn btn--icon" data-p="${esc(p.name)}" data-a="start" title="Start">${ico('play')}</button>`}
                </div>
            </td>
        </tr>`;
    }).join('');
}

function renderKuma(items) {
    const tb = $('#tbl-kuma tbody');
    const k = items || [];
    const kumaHint = $('#kuma-hint');
    if (kumaHint) kumaHint.textContent = k.length ? `${k.filter((m) => m.status === 'up').length}/${k.length} healthy` : '';
    if (!tb) return;
    if (!k.length) {
        tb.innerHTML = '<tr><td colspan="6" class="dim">No monitors configured</td></tr>';
        return;
    }
    tb.innerHTML = k.map((m) => {
        const up = m.status === 'up';
        const upPct = m.uptime === null ? null : m.uptime;
        const checkDate = m.lastCheck ? (typeof m.lastCheck === 'number' ? new Date(m.lastCheck < 1e11 ? m.lastCheck * 1000 : m.lastCheck) : new Date(m.lastCheck.includes('T') ? m.lastCheck : m.lastCheck.replace(' ', 'T') + (m.lastCheck.endsWith('Z') ? '' : 'Z'))) : null;
        const checkStr = (checkDate && !isNaN(checkDate.getTime())) ? checkDate.toLocaleString('en-GB', { hour12: false }) : '—';
        return `<tr>
            <td class="name">${esc(m.name)}</td>
            <td>${pill(up ? 'up' : 'down', up ? 'Up' : 'Down')}</td>
            <td class="num">${upPct === null ? '—' : upPct.toFixed(1) + '%'}</td>
            <td class="num">${m.avgPing === null ? '—' : m.avgPing + ' ms'}</td>
            <td class="dim">${esc(m.target || '—')}</td>
            <td class="dim">${checkStr}</td>
        </tr>`;
    }).join('');
}

function renderTailscale(ts) {
    const tb = $('#tbl-tailscale tbody');
    const bar = $('#ts-node-bar');
    const hint = $('#ts-hint');
    const panicBtn = $('#btn-ts-panic');
    const lockBtn = $('#btn-ts-lock');
    if (!tb || !bar) return;

    if (lockBtn) {
        lockBtn.textContent = state.tsUnlockSystem ? '🔓 System Ports Unlocked' : '🔒 System Ports Locked';
        lockBtn.classList.toggle('btn--danger', Boolean(state.tsUnlockSystem));
    }

    if (!ts || !ts.dnsName) {
        if (hint) hint.textContent = 'Unavailable';
        tb.innerHTML = '<tr><td colspan="8" class="dim">Tailscale telemetry unavailable</td></tr>';
        return;
    }

    const routes = ts.routes || [];
    const funnelCount = ts.funnelCount || 0;
    const serveCount = ts.serveCount || 0;

    if (hint) {
        hint.textContent = `${routes.length} active route${routes.length === 1 ? '' : 's'} · ${funnelCount} Public Funnel · ${serveCount} Tailnet Only`;
    }
    if (panicBtn) {
        panicBtn.style.display = funnelCount > 0 ? 'inline-flex' : 'none';
    }

    const ip4 = (ts.tailscaleIPs || [])[0] || '—';
    bar.innerHTML = `
        <div class="ts-bar__items">
            <span class="ts-bar__item">Node: <strong>${esc(ts.dnsName)}</strong></span>
            <span class="ts-bar__item">Tailscale IP: <strong>${esc(ip4)}</strong></span>
            <span class="ts-bar__item">Relay: <strong>${esc((ts.relay || 'direct').toUpperCase())}</strong></span>
            <span class="ts-bar__item">ACL Funnel: ${ts.canFunnel ? pill('good', 'Enabled (443, 8443, 10000)') : pill('warning', 'Not in ACL')}</span>
        </div>
        <div class="ts-bar__items">
            <span class="ts-bar__item">${funnelCount > 0
                ? `<span class="ts-mode-badge ts-mode-badge--funnel">🌐 ${funnelCount} PUBLIC ON INTERNET</span>`
                : `<span class="ts-mode-badge ts-mode-badge--serve">🔒 0 PUBLIC · ALL PRIVATE</span>`}</span>
        </div>
    `;

    // Update Auto-detected local ports picker without losing user selection
    const picker = $('#ts-local-picker');
    if (picker && Array.isArray(ts.localPorts)) {
        const key = ts.localPorts.map((p) => `${p.targetUrl}:${p.label}`).join('|');
        if (key !== state.lastLocalPortsKey) {
            state.lastLocalPortsKey = key;
            const cur = picker.value;
            picker.innerHTML = `<option value="">⚡ Pick active local port (${ts.localPorts.length} found)…</option>` +
                ts.localPorts.map((p) => `<option value="${esc(p.targetUrl)}">${esc(`:${p.port} — ${p.label} (${p.targetUrl})`)}</option>`).join('');
            picker.value = cur;
        }
    }

    if (!routes.length) {
        tb.innerHTML = '<tr><td colspan="8" class="dim">No Tailscale Serve or Funnel routes configured</td></tr>';
        return;
    }

    tb.innerHTML = routes.map((r) => {
        const isLocked = r.protected && !state.tsUnlockSystem;
        const modeBadge = r.funnel
            ? `<span class="ts-mode-badge ts-mode-badge--funnel">🌐 Public Funnel</span>`
            : `<span class="ts-mode-badge ts-mode-badge--serve">🔒 Tailnet Only</span>`;
        const safetyBadge = r.protected
            ? (state.tsUnlockSystem ? pill('warning', 'Unlocked System') : pill('unknown', '🛡️ System Locked'))
            : pill('good', 'Project Port');

        let toggleBtn = '';
        if (r.funnel) {
            toggleBtn = `<button type="button" class="btn btn--sm" data-ts-act="set-mode" data-port="${r.port}" data-path="${esc(r.path)}" data-target="${esc(r.target)}" data-mode="serve" ${isLocked ? 'disabled title="System port is locked"' : 'title="Switch to private Tailnet Only"'} >🔒 Make Private</button>`;
        } else if (r.canToggleFunnel) {
            toggleBtn = `<button type="button" class="btn btn--sm" data-ts-act="set-mode" data-port="${r.port}" data-path="${esc(r.path)}" data-target="${esc(r.target)}" data-mode="funnel" ${isLocked ? 'disabled title="System port is locked"' : 'title="Expose to public internet via Funnel"'}>🌐 Make Public</button>`;
        }

        return `<tr>
            <td>${modeBadge}</td>
            <td>
                <a class="ts-url-link" href="${esc(r.externalUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.externalUrl)}</a>
            </td>
            <td class="num"><strong>:${r.port}</strong></td>
            <td class="dim"><code>${esc(r.path)}</code></td>
            <td>
                <div><code>${esc(r.target)}</code></div>
                <div class="dim" style="font-size:11px">${esc(r.serviceLabel || '')}</div>
            </td>
            <td>${pill(r.targetUp ? 'up' : 'down', r.targetUp ? `Online (${r.latencyMs}ms)` : `Offline (${r.targetDetail || 'down'})`)}</td>
            <td>${safetyBadge}</td>
            <td>
                <div class="rowbtns">
                    <button type="button" class="btn btn--sm" data-ts-act="copy" data-url="${esc(r.externalUrl)}" title="Copy URL">📋 Copy</button>
                    ${toggleBtn}
                    <button type="button" class="btn btn--sm" data-ts-act="remove" data-port="${r.port}" data-path="${esc(r.path)}" ${isLocked ? 'disabled title="System port is locked"' : 'title="Turn off and remove route"'}>✕ Off</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ── WireGuard VPN & EMQX MQTT Hub ────────────────────────────────────────────
function renderVpnAndMqtt(wg = {}, emqx = {}) {
    const wgEl = $('#wg-panel');
    const wgPill = $('#wg-status-pill');
    if (wgEl && wgPill) {
        wgPill.innerHTML = pill(wg.up ? 'up' : 'down', wg.up ? `wg0 Active · :${wg.listenPort || 51820}/UDP` : 'Offline');
        const clients = wg.clients || [];
        wgEl.innerHTML = `
            <div class="kv"><span class="kv__k">🌐 Public DDNS Endpoint</span><span class="kv__v"><code>${esc(wg.ddnsEndpoint || 'asri-minipc.thaiddns.com:51820')}</code> <button type="button" class="btn btn--sm" data-ts-act="copy" data-url="${esc(wg.ddnsEndpoint || 'asri-minipc.thaiddns.com:51820')}">📋</button></span></div>
            <div class="kv"><span class="kv__k">🏠 Local LAN Endpoint</span><span class="kv__v"><code>${esc(wg.lanEndpoint || '192.168.1.123:51820')}</code> <button type="button" class="btn btn--sm" data-ts-act="copy" data-url="${esc(wg.lanEndpoint || '192.168.1.123:51820')}">📋</button></span></div>
            <div class="kv"><span class="kv__k">VPN Subnet / Server IP</span><span class="kv__v"><code>${esc(wg.subnet || '10.10.10.0/24')}</code> (Server: <code>10.10.10.1</code>)</span></div>
            <div class="kv"><span class="kv__k">Active Clients / Total</span><span class="kv__v"><strong>${wg.activePeers || 0}</strong> active now / <strong>${wg.totalPeers || 0}</strong> clients</span></div>
            <div class="kv"><span class="kv__k">Total Traffic (All Time)</span><span class="kv__v">↓ ${fmtBytes(wg.rxBytes || 0)} received · ↑ ${fmtBytes(wg.txBytes || 0)} sent</span></div>
            <div class="rowbtns" style="justify-content:flex-start;margin-top:8px">
                <button type="button" class="btn btn--primary btn--sm" id="btn-wg-panel-new">➕ Add Client</button>
                <a class="btn btn--sm" href="#sec-ports">🧱 Manage Port 51820/UDP</a>
            </div>
        `;
    }

    // Render Granular WireGuard Clients & Policy Cards
    const clientsContainer = $('#wg-clients-container');
    const badgeClientCount = $('#badge-wg-client-count');
    const clients = wg.clients || [];

    if (badgeClientCount) {
        badgeClientCount.textContent = `${clients.length} clients (${wg.activePeers || 0} online)`;
        badgeClientCount.classList.toggle('badge--good', (wg.activePeers || 0) > 0);
    }

    if (clientsContainer) {
        if (!clients.length) {
            clientsContainer.innerHTML = `
                <div class="empty-state" style="padding:28px 16px;text-align:center;grid-column:1/-1">
                    <div style="font-size:28px;margin-bottom:8px">🛡️</div>
                    <div style="font-weight:600;margin-bottom:4px">ยังไม่มี WireGuard Client ในระบบ</div>
                    <p class="dim" style="font-size:12px;margin-bottom:14px">กดปุ่ม "+ New Client" เพื่อสร้างโปรไฟล์ VPN และสแกน QR Code เข้ามือถือได้ทันที</p>
                    <button type="button" class="btn btn--primary btn--sm" id="btn-wg-empty-new">➕ สร้าง Client เครื่องแรก</button>
                </div>
            `;
        } else {
            clientsContainer.innerHTML = clients.map((c) => {
                const pol = c.policy || {
                    preset: 'admin',
                    allowInternet: true,
                    allowLan: true,
                    allowP2P: true,
                    homelabOnly: false,
                };
                const isOnline = Boolean(c.online);
                const isEnabled = c.enabled !== false;
                const handshakeText = c.handshakeAgeSec !== null ? `${c.handshakeAgeSec}s ago` : 'Never';
                const endpointText = c.endpoint ? c.endpoint : '(Not connected)';

                return `
                    <div class="wg-client-card ${isOnline ? 'is-online' : ''} ${!isEnabled ? 'is-disabled' : ''}" data-wg-client-id="${esc(c.id)}" data-wg-pubkey="${esc(c.publicKey)}">
                        <!-- Head -->
                        <div class="wg-client-card__head">
                            <div class="wg-client-card__title">
                                <span>👤 ${esc(c.name)}</span>
                                <span class="badge" style="font-family:var(--fx-mono);font-size:11px">${esc(c.address)}</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:6px">
                                ${pill(isEnabled ? (isOnline ? 'up' : 'unknown') : 'down', !isEnabled ? 'Disabled' : (isOnline ? '🟢 Online' : '⚪ Idle'))}
                                <button type="button" class="btn btn--sm" data-wg-act="toggle-enable" data-id="${esc(c.id)}" data-enabled="${isEnabled ? 'true' : 'false'}" title="${isEnabled ? 'Disable Client' : 'Enable Client'}">
                                    ${isEnabled ? '⏸️' : '▶️'}
                                </button>
                            </div>
                        </div>

                        <!-- Metrics Grid -->
                        <div class="wg-client-card__metrics">
                            <div class="wg-metric-item">
                                <span class="wg-metric-label">Latest Handshake</span>
                                <span class="wg-metric-val">${esc(handshakeText)}</span>
                            </div>
                            <div class="wg-metric-item">
                                <span class="wg-metric-label">Current Endpoint</span>
                                <span class="wg-metric-val" style="font-size:10.5px;overflow:hidden;text-overflow:ellipsis" title="${esc(endpointText)}">${esc(endpointText)}</span>
                            </div>
                            <div class="wg-metric-item">
                                <span class="wg-metric-label">Received (Rx)</span>
                                <span class="wg-metric-val">↓ ${fmtBytes(c.rxBytes || 0)}</span>
                            </div>
                            <div class="wg-metric-item">
                                <span class="wg-metric-label">Sent (Tx)</span>
                                <span class="wg-metric-val">↑ ${fmtBytes(c.txBytes || 0)}</span>
                            </div>
                        </div>

                        <!-- Access Control Policy Box -->
                        <div class="wg-policy-box">
                            <div class="wg-policy-title">
                                <span>🛡️ Granular Policy Firewall</span>
                                <span class="dim" style="font-size:10px">iptables enforced</span>
                            </div>

                            <!-- Presets -->
                            <div class="wg-preset-chips" data-wg-pubkey="${esc(c.publicKey)}">
                                <button type="button" class="wg-preset-chip ${pol.preset === 'admin' ? 'is-active' : ''}" data-wg-preset="admin" title="Full Access: Net ON, LAN ON, Server ON, P2P ON">👑 Admin</button>
                                <button type="button" class="wg-preset-chip ${pol.preset === 'standard' ? 'is-active' : ''}" data-wg-preset="standard" title="Family: Net ON, LAN OFF, Server ON, P2P OFF">👨‍👩‍👧 Standard</button>
                                <button type="button" class="wg-preset-chip ${pol.preset === 'guest' ? 'is-active' : ''}" data-wg-preset="guest" title="Guest: Net ON, LAN OFF, Server OFF, P2P OFF">☕ Guest</button>
                                <button type="button" class="wg-preset-chip ${pol.preset === 'serveronly' ? 'is-active' : ''}" data-wg-preset="serveronly" title="Homelab Only: Net OFF, LAN OFF, Server ON, P2P OFF">🛡️ Homelab Only</button>
                            </div>

                            <!-- Individual Checkbox Toggles -->
                            <div class="wg-toggle-group">
                                <label class="wg-toggle-label">
                                    <input type="checkbox" class="wg-chk" data-wg-opt="allowInternet" ${pol.allowInternet ? 'checked' : ''} />
                                    <div class="wg-toggle-info">
                                        <span class="wg-toggle-title">🌐 ออกเน็ต (Full Tunnel)</span>
                                        <span class="wg-toggle-sub">เล่นเน็ตนอกบ้านผ่าน VPN</span>
                                    </div>
                                </label>

                                <label class="wg-toggle-label">
                                    <input type="checkbox" class="wg-chk" data-wg-opt="allowLan" ${pol.allowLan ? 'checked' : ''} />
                                    <div class="wg-toggle-info">
                                        <span class="wg-toggle-title">🏠 วงแลนบ้าน (LAN)</span>
                                        <span class="wg-toggle-sub">เข้าถึงเครื่องอื่นใน 192.168.1.x</span>
                                    </div>
                                </label>

                                <label class="wg-toggle-label">
                                    <input type="checkbox" class="wg-chk" data-wg-opt="homelabOnly" ${pol.homelabOnly ? 'checked' : ''} />
                                    <div class="wg-toggle-info">
                                        <span class="wg-toggle-title">🔒 เฉพาะ Homelab</span>
                                        <span class="wg-toggle-sub">เข้าได้แค่ตัวเซิร์ฟเวอร์เท่านั้น</span>
                                    </div>
                                </label>

                                <label class="wg-toggle-label">
                                    <input type="checkbox" class="wg-chk" data-wg-opt="allowP2P" ${pol.allowP2P ? 'checked' : ''} />
                                    <div class="wg-toggle-info">
                                        <span class="wg-toggle-title">👥 คุยข้าม Peer (P2P)</span>
                                        <span class="wg-toggle-sub">คุยกับอุปกรณ์ VPN เครื่องอื่น</span>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <!-- Card Action Buttons -->
                        <div class="wg-client-actions">
                            <div class="rowbtns" style="gap:6px">
                                <button type="button" class="btn btn--primary btn--sm" data-wg-act="show-qr" data-id="${esc(c.id)}" data-name="${esc(c.name)}" data-ip="${esc(c.address)}">
                                    📱 Scan QR
                                </button>
                                <a href="/api/wireguard/client/${esc(c.id)}/configuration" class="btn btn--sm" download="wg-${esc(c.name)}.conf" title="Download configuration file">
                                    ⬇️ .conf
                                </a>
                            </div>
                            <button type="button" class="btn btn--danger btn--sm" data-wg-act="delete-client" data-id="${esc(c.id)}" data-name="${esc(c.name)}" title="Delete client">
                                🗑️ Delete
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    const eqEl = $('#emqx-panel');
    const eqPill = $('#emqx-status-pill');
    if (eqEl && eqPill) {
        eqPill.innerHTML = pill(emqx.up ? 'up' : 'down', emqx.up ? 'Broker Running' : 'Offline');
        const eps = emqx.endpoints || [];
        eqEl.innerHTML = `
            <div class="kv"><span class="kv__k">Node Status</span><span class="kv__v"><code>${esc(emqx.statusText || '—')}</code></span></div>
            <div class="kv"><span class="kv__k">Connected Clients</span><span class="kv__v"><strong>${emqx.connections || 0}</strong> active (Peak: ${emqx.connectionsMax || 0})</span></div>
            <div class="kv"><span class="kv__k">Topics / Subscriptions / Retained</span><span class="kv__v"><strong>${emqx.topics || 0}</strong> topics · <strong>${emqx.subscriptions || 0}</strong> subs · <strong>${emqx.retained || 0}</strong> retained</span></div>
            ${eps.map((ep) => `<div class="kv"><span class="kv__k">${esc(ep.label)}</span><span class="kv__v"><code>${esc(ep.url)}</code> <button type="button" class="btn btn--sm" data-ts-act="copy" data-url="${esc(ep.url)}">📋</button></span></div>`).join('')}
            <div class="rowbtns" style="justify-content:flex-start;margin-top:8px">
                <a class="btn btn--primary" href="${esc(emqx.uiUrl || '#')}" target="_blank" rel="noopener">📡 Open EMQX Dashboard (:18083) ${ico('external')}</a>
                <a class="btn btn--sm" href="#sec-ports">🧱 Manage MQTT Ports</a>
            </div>
        `;
    }
}

// ── Server Port & Firewall Management ────────────────────────────────────────
function renderPortsManager(pm = {}) {

    const badgePorts = $('#badge-tab-ports');
    const badgeSbPorts = $('#badge-sidebar-ports');
    if (badgePorts || badgeSbPorts) {
        const ufwOn = Boolean(pm && pm.ufw && pm.ufw.active);
        const txt = ufwOn ? 'UFW ON' : 'UFW OFF';
        if (badgePorts) { badgePorts.textContent = txt; badgePorts.classList.toggle('badge--good', ufwOn); }
        if (badgeSbPorts) { badgeSbPorts.textContent = txt; badgeSbPorts.classList.toggle('badge--good', ufwOn); }
    }

    const bar = $('#pm-summary-bar');
    const grid = $('#pm-presets-grid');
    const tbPorts = $('#tbl-ports tbody');
    const tbUfw = $('#tbl-ufw tbody');
    const hint = $('#pm-hint');
    const lockBtn = $('#btn-pm-lock');
    if (!tbPorts || !tbUfw) return;

    if (lockBtn) {
        lockBtn.textContent = state.pmUnlockSystem ? '🔓 System Ports Unlocked' : '🔒 System Ports Locked';
        lockBtn.classList.toggle('btn--danger', Boolean(state.pmUnlockSystem));
    }

    const listeners = pm.listeners || [];
    const rules = pm.rules || [];
    const presets = pm.presets || [];

    if (hint) {
        hint.textContent = `${listeners.length} listening ports · ${pm.openFirewallPorts || 0} open in UFW firewall`;
    }

    if (bar) {
        bar.innerHTML = `
            <div class="ts-bar__items">
                <span class="ts-bar__item">Firewall (UFW): ${pm.ufwActive ? pill('good', 'ACTIVE · Default Deny Incoming') : pill('warning', 'INACTIVE')}</span>
                <span class="ts-bar__item">Listening Sockets: <strong>${listeners.length}</strong></span>
                <span class="ts-bar__item">Allowed External Ports: <strong>${pm.openFirewallPorts || 0}</strong></span>
                <span class="ts-bar__item">Active Rules: <strong>${rules.length} IPv4 (${pm.allRulesCount || 0} total)</strong></span>
            </div>
        `;
    }

    if (grid) {
        grid.innerHTML = presets.map((p) => {
            const stStatus = p.open ? (p.from === 'Anywhere' ? 'good' : 'warning') : 'critical';
            const stLabel = p.open ? (p.from === 'Anywhere' ? 'OPEN (ALL)' : 'LAN+VPN ONLY') : 'CLOSED';
            return `<div class="pm-preset-card">
                <div class="pm-preset-card__top">
                    <span class="pm-preset-card__title">${esc(p.title)}</span>
                    ${pill(stStatus, stLabel)}
                </div>
                <div class="pm-preset-card__sub">${esc(p.subtitle)} · ${esc(p.scopeLabel)}</div>
                <div class="pm-preset-card__actions">
                    <button type="button" class="btn btn--sm" data-pm-act="set-port-mode" data-port="${p.port}" data-proto="${p.proto}" data-mode="allow-any" data-comment="${esc(p.title)}">🟢 Open All</button>
                    <button type="button" class="btn btn--sm" data-pm-act="set-port-mode" data-port="${p.port}" data-proto="${p.proto}" data-mode="allow-lan" data-comment="${esc(p.title)}">🏠 LAN+VPN</button>
                    <button type="button" class="btn btn--sm" data-pm-act="set-port-mode" data-port="${p.port}" data-proto="${p.proto}" data-mode="close" data-comment="${esc(p.title)}">🔒 Close</button>
                </div>
            </div>`;
        }).join('');
    }

    const filter = state.pmFilter || 'all';
    const filteredListeners = listeners.filter((l) => {
        if (filter === 'wg-emqx') return l.category === 'wireguard' || l.category === 'emqx';
        if (filter === 'open') return l.firewallState === 'ALLOW' || l.firewallState === 'LIMIT';
        if (filter === 'local') return l.scope === 'local' || l.scope === 'docker';
        return true;
    });

    if (!filteredListeners.length) {
        tbPorts.innerHTML = '<tr><td colspan="7" class="dim">No matching listening ports found</td></tr>';
    } else {
        tbPorts.innerHTML = filteredListeners.map((l) => {
            const isLocked = l.protected && !state.pmUnlockSystem;
            const permLock = l.port === 22 || l.port === 41641;
            const fwBadge =
                l.firewallState === 'ALLOW' ? pill('good', `ALLOW IN (${l.firewallSource})`) :
                l.firewallState === 'LIMIT' ? pill('good', `RATE-LIMIT (${l.firewallSource})`) :
                l.firewallState === 'LOOPBACK' ? pill('unknown', 'LOOPBACK ONLY (127.0.0.1)') :
                l.firewallState === 'TAILNET' ? pill('good', 'TAILSCALE ONLY (tailscale0)') :
                pill('critical', `BLOCKED (${l.firewallSource})`);

            const scopeBadge =
                l.scope === 'public' ? `<span class="ts-mode-badge ts-mode-badge--funnel">0.0.0.0 (All Ifaces)</span>` :
                l.scope === 'lan' ? `<span class="ts-mode-badge ts-mode-badge--serve">${esc(l.bindAddr)} (LAN)</span>` :
                l.scope === 'tailscale' ? `<span class="ts-mode-badge ts-mode-badge--serve">${esc(l.bindAddr)} (Tailnet)</span>` :
                `<code>${esc(l.bindAddr)}</code>`;

            const safetyBadge = permLock
                ? pill('unknown', '🛡️ Core Lock')
                : l.protected
                    ? (state.pmUnlockSystem ? pill('warning', 'Unlocked System') : pill('unknown', '🔒 System Protected'))
                    : pill('good', 'Manageable');

            const disAttr = (isLocked || permLock) ? 'disabled title="Protected system port"' : '';
            return `<tr>
                <td class="num"><strong>:${l.port}</strong> <span class="dim">/${esc(l.proto.toUpperCase())}</span></td>
                <td>
                    <div class="name">${esc(l.serviceName)}</div>
                    <div class="dim" style="font-size:11px">${esc(l.description)} · <code>${esc(l.process)}${l.pid ? ` (pid ${l.pid})` : ''}</code></div>
                </td>
                <td>${scopeBadge}</td>
                <td>${fwBadge}</td>
                <td class="num">${l.connections || 0}</td>
                <td>${safetyBadge}</td>
                <td>
                    <div class="rowbtns">
                        <button type="button" class="btn btn--sm" data-pm-act="test-port" data-port="${l.port}" data-proto="${l.proto}" title="Test port reachability">⚡ Test</button>
                        <button type="button" class="btn btn--sm" data-pm-act="set-port-mode" data-port="${l.port}" data-proto="${l.proto}" data-mode="allow-any" data-comment="${esc(l.serviceName)}" ${disAttr}>🟢 Allow</button>
                        <button type="button" class="btn btn--sm" data-pm-act="set-port-mode" data-port="${l.port}" data-proto="${l.proto}" data-mode="allow-lan" data-comment="${esc(l.serviceName)}" ${disAttr}>🏠 LAN+VPN</button>
                        <button type="button" class="btn btn--sm" data-pm-act="set-port-mode" data-port="${l.port}" data-proto="${l.proto}" data-mode="close" data-comment="${esc(l.serviceName)}" ${disAttr}>🔒 Close</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    if (!rules.length) {
        tbUfw.innerHTML = '<tr><td colspan="7" class="dim">No UFW firewall rules found</td></tr>';
    } else {
        tbUfw.innerHTML = rules.map((r) => {
            const permLock = r.port === 22 || r.to.includes('tailscale0');
            const isLocked = (r.protected && !state.pmUnlockSystem) || permLock;
            const actPill = r.action.startsWith('ALLOW')
                ? pill('good', r.action)
                : r.action.startsWith('LIMIT')
                    ? pill('warning', r.action)
                    : pill('critical', r.action);
            return `<tr>
                <td class="num">#${r.num}</td>
                <td><strong><code>${esc(r.to)}</code></strong></td>
                <td>${actPill}</td>
                <td><code>${esc(r.from)}</code></td>
                <td class="dim">${esc(r.comment || '—')}</td>
                <td>${permLock ? pill('unknown', '🛡️ Core Lock') : r.protected ? pill('unknown', '🔒 System') : pill('good', 'Custom / Service')}</td>
                <td>
                    <div class="rowbtns">
                        <button type="button" class="btn btn--sm" data-pm-act="delete-rule" data-num="${r.num}" ${isLocked ? 'disabled title="Protected rule"' : 'title="Delete firewall rule"'}>✕ Delete</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }
}

// ── host detail ─────────────────────────────────────────────────────────────
function renderDisks(disks) {
    const el = $('#disks');
    if (!el) return;
    if (!disks || !disks.length) { el.innerHTML = '<div class="kv"><span class="kv__k">—</span></div>'; return; }
    el.innerHTML = disks.map((d, i) => {
        const tag = `Disk ${i + 1} (${d.mount}${d.device ? ' · ' + d.device : ''})`;
        if (d.error) return `<div class="kv"><span class="kv__k">${esc(tag)}</span><span class="kv__v">${esc(d.error)}</span></div>`;
        return `<div class="bar-row">
            <div class="bar-row__top">
                <span class="bar-row__name">${esc(tag)}</span>
                <span class="bar-row__val">${fmtBytes(d.used)} / ${fmtBytes(d.size)} (${d.usedPct}%)</span>
            </div>
            <div class="meter"><div class="meter__fill" style="width:${Math.min(100, d.usedPct)}%" data-level="${level(d.usedPct, 70, 85, 95)}"></div></div>
        </div>`;
    }).join('');
}

function renderTemps(temps) {
    const el = $('#temps');
    if (!el) return;
    if (!temps || !temps.length) { el.innerHTML = '<div class="kv"><span class="kv__k">No thermal sensors detected</span></div>'; return; }
    el.innerHTML = temps.map((t) => {
        const lv = level(t.celsius, 60, 75, 85);
        return `<div class="bar-row">
            <div class="bar-row__top">
                <span class="bar-row__name">${esc(t.label)}</span>
                <span class="bar-row__val">${t.celsius.toFixed(1)} °C</span>
            </div>
            <div class="meter"><div class="meter__fill" style="width:${Math.min(100, t.celsius)}%" data-level="${lv}"></div></div>
        </div>`;
    }).join('');
}

function renderNet(net, rate) {
    const el = $('#net');
    if (!el) return;
    if (!net) { el.innerHTML = ''; return; }
    const ifaces = Object.entries(net.iface || {}).sort((a, b) => (b[1].rx + b[1].tx) - (a[1].rx + a[1].tx)).slice(0, 5);
    el.innerHTML = `
        <div class="kv"><span class="kv__k">Total RX / TX (Cumulative)</span><span class="kv__v">${fmtBytes(net.rx)} / ${fmtBytes(net.tx)}</span></div>
        <div class="kv"><span class="kv__k">Current Throughput (${esc(state.ethName)})</span><span class="kv__v">↓ ${fmtRate(rate.rx)} · ↑ ${fmtRate(rate.tx)}</span></div>
        ${ifaces.map(([name, v]) => `<div class="kv"><span class="kv__k">${esc(name)}</span><span class="kv__v">↓ ${fmtBytes(v.rx)} · ↑ ${fmtBytes(v.tx)}</span></div>`).join('')}`;
}

function renderMongo(mongo) {
    const el = $('#mongo');
    if (!el) return;
    if (!mongo || mongo.error || !mongo.collections && mongo.collections !== 0) {
        el.innerHTML = `<div class="kv"><span class="kv__k">${esc((mongo && mongo.error) || 'Unable to read database stats')}</span></div>`;
        return;
    }
    el.innerHTML = `
        <div class="kv"><span class="kv__k">Collections</span><span class="kv__v">${mongo.collections}</span></div>
        <div class="kv"><span class="kv__k">Documents</span><span class="kv__v">${(mongo.objects || 0).toLocaleString('en-US')}</span></div>
        <div class="kv"><span class="kv__k">Data Size</span><span class="kv__v">${fmtBytes(mongo.dataSize || 0)}</span></div>
        <div class="kv"><span class="kv__k">Index Size</span><span class="kv__v">${fmtBytes(mongo.indexSize || 0)}</span></div>
        <div class="kv"><span class="kv__k">Storage Size</span><span class="kv__v">${fmtBytes(mongo.storageSize || 0)}</span></div>
        ${(mongo.names || []).length ? `<div class="kv"><span class="kv__k">Collection Names</span><span class="kv__v">${esc(mongo.names.join(', '))}</span></div>` : ''}`;
}

function renderCores(cores) {
    const el = $('#cores');
    if (!el) return;
    if (!cores || !cores.length) { el.innerHTML = '<div class="kv"><span class="kv__k">—</span></div>'; return; }
    el.innerHTML = cores.map((c, i) => `<div class="bar-row">
        <div class="bar-row__top">
            <span class="bar-row__name">Core ${i}</span>
            <span class="bar-row__val">${c.toFixed(1)}%</span>
        </div>
        <div class="meter"><div class="meter__fill" style="width:${Math.min(100, c)}%" data-level="${level(c, 60, 80, 90)}"></div></div>
    </div>`).join('');
}

function renderOs(host) {
    const el = $('#osinfo');
    if (!el) return;
    const failed = host.failedUnits || [];
    el.innerHTML = `
        <div class="kv"><span class="kv__k">Hostname</span><span class="kv__v">${esc(host.hostname || '—')}</span></div>
        <div class="kv"><span class="kv__k">Operating System</span><span class="kv__v">${esc(host.platform || '—')}</span></div>
        <div class="kv"><span class="kv__k">Kernel</span><span class="kv__v">${esc(host.kernel || '—')}</span></div>
        <div class="kv"><span class="kv__k">CPU Cores</span><span class="kv__v">${(host.cpu && host.cpu.count) || '—'}</span></div>
        <div class="kv"><span class="kv__k">Total Memory</span><span class="kv__v">${fmtBytes((host.mem || {}).total)}</span></div>
        <div class="kv"><span class="kv__k">Failed Systemd Units</span><span class="kv__v">${failed.length ? pill('critical', `${failed.length} failed`) : pill('good', 'None')}</span></div>
        ${failed.length ? failed.map((f) => `<div class="kv"><span class="kv__k">${esc(f)}</span></div>`).join('') : ''}`;
}

// ── charts (CPU, Memory, Disk 1..N, Ethernet/Traffic) ────────────────────────
const CH = { grid: 'var(--grid)', axis: 'var(--baseline)', muted: 'var(--ink-muted)', surface: 'var(--surface-1)' };
const DISK_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

function niceMax(v) {
    if (!Number.isFinite(v) || v <= 0) return 10;
    const exp = Math.floor(Math.log10(v));
    const base = Math.pow(10, exp);
    const n = v / base;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * base;
}

function ensureDiskTrendCards(disks) {
    const valid = (disks || []).filter((d) => d && d.mount && !d.error);
    const order = valid.map((d) => d.mount);
    const same = order.length === state.diskOrder.length && order.every((m, i) => m === state.diskOrder[i]);
    if (same) return;

    state.diskOrder = order;
    const slot = $('#disk-charts-slot');
    if (!slot) return;
    slot.innerHTML = valid.map((d, idx) => {
        const title = `Disk ${idx + 1} (${d.mount}${d.device ? ' · ' + d.device : ''})`;
        return `<figure class="card chart-card" data-hud="chart">
            <figcaption class="card__head">
                <span class="card__title" id="disk-chart-title-${idx}">${esc(title)}</span>
                <span class="card__value" id="disk-chart-now-${idx}">—</span>
            </figcaption>
            <div class="chart" id="chart-disk-${idx}" role="img" aria-label="${esc(title)} usage trend chart"></div>
            <div class="chart__axis"><span id="disk-chart-cap-${idx}">—</span><span id="disk-chart-io-${idx}">—</span></div>
        </figure>`;
    }).join('');
}

function drawChart(el, cfg) {
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    const m = { l: 42, r: 10, t: 10, b: 16 };
    const iw = Math.max(10, w - m.l - m.r), ih = Math.max(10, h - m.t - m.b);
    const n = cfg.x.length;

    const allVals = cfg.series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
    const yMax = cfg.yMax !== undefined ? cfg.yMax : niceMax(Math.max(...allVals, 0));
    const X = (i) => (n <= 1 ? m.l + iw / 2 : m.l + (i / (n - 1)) * iw);
    const Y = (v) => m.t + ih - (Math.min(v, yMax) / yMax) * ih;

    const gridLines = [0, 0.5, 1].map((f) => {
        const y = m.t + ih - f * ih;
        const label = cfg.yFormat ? cfg.yFormat(yMax * f) : Math.round(yMax * f);
        return `<line x1="${m.l}" y1="${y}" x2="${m.l + iw}" y2="${y}" stroke="${CH.grid}" stroke-width="1"/>
                <text x="${m.l - 6}" y="${y + 3.2}" text-anchor="end" fill="${CH.muted}" font-size="9.5" style="font-variant-numeric:tabular-nums">${esc(label)}</text>`;
    }).join('');

    const paths = cfg.series.map((s) => {
        const pts = s.values.map((v, i) => [X(i), Y(v)]);
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        let area = '';
        if (cfg.area && s.values.length > 1) {
            area = `<path d="${d} L${X(n - 1).toFixed(1)},${(m.t + ih).toFixed(1)} L${X(0).toFixed(1)},${(m.t + ih).toFixed(1)} Z" fill="${s.color}" fill-opacity="0.16"/>`;
        }
        return area + `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');

    const lastVals = cfg.series.map((s) => s.values[n - 1]);
    const lastDots = cfg.series.map((s, si) => {
        const v = lastVals[si];
        if (!Number.isFinite(v)) return '';
        return `<circle cx="${X(n - 1).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5" fill="${s.color}" stroke="${CH.surface}" stroke-width="2"/>`;
    }).join('');

    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">
        ${gridLines}${paths}${lastDots}
        <g id="cross" style="display:none">
            <line id="cross-line" x1="0" y1="${m.t}" x2="0" y2="${m.t + ih}" stroke="${CH.axis}" stroke-width="1" stroke-dasharray="3 3"/>
            <circle id="cross-dot" r="4.5" fill="${cfg.series[0].color}" stroke="${CH.surface}" stroke-width="2"/>
        </g>
        <rect id="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" style="cursor:crosshair"/>
      </svg><div class="tooltip" id="tt"></div>`;

    const svg = el.querySelector('svg');
    const hit = el.querySelector('#hit');
    const cross = el.querySelector('#cross');
    const crossLine = el.querySelector('#cross-line');
    const crossDot = el.querySelector('#cross-dot');
    const tt = el.querySelector('#tt');

    hit.addEventListener('pointermove', (ev) => {
        if (!n) return;
        const box = svg.getBoundingClientRect();
        const scale = w / box.width;
        const px = (ev.clientX - box.left) * scale;
        let idx = n <= 1 ? 0 : Math.round(((px - m.l) / iw) * (n - 1));
        idx = Math.max(0, Math.min(n - 1, idx));
        const x = X(idx);
        cross.style.display = '';
        crossLine.setAttribute('x1', x); crossLine.setAttribute('x2', x);
        const v0 = cfg.series[0].values[idx];
        crossDot.setAttribute('cx', x);
        crossDot.setAttribute('cy', Y(Number.isFinite(v0) ? v0 : 0));
        const rows = cfg.series.map((s) => {
            const v = s.values[idx];
            const txt = cfg.vFormat ? cfg.vFormat(v) : (Number.isFinite(v) ? v.toFixed(1) : '—');
            return `<span style="color:${s.color}">●</span> ${esc(s.label)} <b>${esc(txt)}</b>`;
        });
        const extra = cfg.extraTooltip ? cfg.extraTooltip(idx) : '';
        tt.innerHTML = `${esc(cfg.x[idx])} · ${rows.join(' · ')}${extra ? ` · ${extra}` : ''}`;
        tt.dataset.show = '1';
        const pxCss = (x / scale);
        tt.style.left = `${Math.max(46, Math.min(box.width - 46, pxCss))}px`;
        tt.style.top = `${(m.t / scale) + 4}px`;
    });
    hit.addEventListener('pointerleave', () => { cross.style.display = 'none'; tt.dataset.show = '0'; });
}

function drawCharts() {
    const h = state.hist;
    const x = h.t.map((v) => fmtTime(v));

    // 1. CPU Trend
    drawChart($('#chart-cpu'), {
        x, area: true, yMax: 100,
        yFormat: (v) => `${Math.round(v)}%`,
        vFormat: (v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—'),
        series: [{ label: 'CPU', color: 'var(--series-1)', values: h.cpu }],
    });

    // 2. Memory Trend
    drawChart($('#chart-mem'), {
        x, area: true, yMax: 100,
        yFormat: (v) => `${Math.round(v)}%`,
        vFormat: (v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—'),
        series: [{ label: 'Memory', color: 'var(--series-3)', values: h.mem }],
    });

    // 3. Disk 1, 2, ... Trends
    state.diskOrder.forEach((mount, idx) => {
        const dh = h.disks[mount] || { pct: [], r: [], w: [] };
        const color = DISK_COLORS[idx % DISK_COLORS.length];
        drawChart($(`#chart-disk-${idx}`), {
            x, area: true, yMax: 100,
            yFormat: (v) => `${Math.round(v)}%`,
            vFormat: (v) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—'),
            extraTooltip: (i) => {
                const r = dh.r[i] ?? 0;
                const w = dh.w[i] ?? 0;
                return `R <b>${esc(fmtRate(r))}</b> · W <b>${esc(fmtRate(w))}</b>`;
            },
            series: [{ label: `Disk ${idx + 1}`, color, values: dh.pct }],
        });
    });

    // 4. Ethernet / Traffic Trend
    drawChart($('#chart-net'), {
        x, yMax: undefined,
        yFormat: (v) => fmtBytes(v),
        vFormat: (v) => fmtRate(v),
        series: [
            { label: 'RX (Down)', color: 'var(--series-1)', values: h.rx },
            { label: 'TX (Up)', color: 'var(--series-2)', values: h.tx },
        ],
    });
}

// ── data ─────────────────────────────────────────────────────────────────────
function pushHistory(s, rate, diskRates) {
    const h = state.hist;
    const max = 60;
    h.t.push(s.generatedAt);
    h.cpu.push((s.host && s.host.cpu ? s.host.cpu.pct : 0));
    h.mem.push((s.host && s.host.mem ? s.host.mem.pct : 0));
    h.rx.push(rate.rx);
    h.tx.push(rate.tx);
    while (h.t.length > max) {
        h.t.shift();
        h.cpu.shift();
        h.mem.shift();
        h.rx.shift();
        h.tx.shift();
    }

    const disks = (s.host && s.host.disks) || [];
    for (const d of disks) {
        if (!d || !d.mount || d.error) continue;
        if (!h.disks[d.mount]) h.disks[d.mount] = { pct: [], r: [], w: [] };
        const dh = h.disks[d.mount];
        const dr = diskRates[d.mount] || { r: 0, w: 0 };
        dh.pct.push(d.usedPct ?? 0);
        dh.r.push(dr.r);
        dh.w.push(dr.w);
        while (dh.pct.length > max) {
            dh.pct.shift();
            dh.r.shift();
            dh.w.shift();
        }
        state.diskMeta[d.mount] = d;
    }
}

async function refresh(force) {
    if ((state.paused || document.hidden) && !force) return;   // ไม่ poll ตอนแท็บถูกซ่อน
    try {
        const r = await fetch('/api/summary', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const s = await r.json();

        const now = Date.now();
        const dt = (state.lastAt && now > state.lastAt) ? (now - state.lastAt) / 1000 : 0;

        // Calculate Ethernet / Network throughput (prefer primary physical Ethernet NIC e.g. enp1s0/eth0)
        const net = (s.host && s.host.net) || { rx: 0, tx: 0, iface: {} };
        const ifaceEntries = Object.entries(net.iface || {});
        const ethEntry = ifaceEntries.find(([k]) => /^(en|eth|eno|ens|enp)/.test(k)) || ifaceEntries[0];
        state.ethName = ethEntry ? ethEntry[0] : 'eth0';
        const curNet = ethEntry ? ethEntry[1] : { rx: net.rx || 0, tx: net.tx || 0 };

        let rate = { rx: 0, tx: 0 };
        if (state.lastNet && dt > 0) {
            rate = {
                rx: Math.max(0, (curNet.rx - state.lastNet.rx) / dt),
                tx: Math.max(0, (curNet.tx - state.lastNet.tx) / dt),
            };
        }
        state.lastNet = { rx: curNet.rx, tx: curNet.tx };

        // Calculate per-disk Read / Write I/O rates
        const disks = (s.host && s.host.disks) || [];
        const diskRates = {};
        for (const d of disks) {
            if (!d || !d.mount || d.error) continue;
            const prev = state.lastDiskIo[d.mount];
            const rb = Number(d.readBytes) || 0;
            const wb = Number(d.writeBytes) || 0;
            diskRates[d.mount] = (prev && dt > 0)
                ? { r: Math.max(0, (rb - prev.r) / dt), w: Math.max(0, (wb - prev.w) / dt) }
                : { r: 0, w: 0 };
            state.lastDiskIo[d.mount] = { r: rb, w: wb };
        }

        state.lastAt = now;

        ensureDiskTrendCards(disks);
        pushHistory(s, rate, diskRates);

        renderTiles(s);
        if (typeof window.updateOverviewGalaxy === 'function') window.updateOverviewGalaxy(s, rate);
        renderEnergy(s);
        renderServices(s);
        renderLinks(s.links);
        renderTailscale(s.tailscale);
        renderVpnAndMqtt(s.wireguard, s.emqx);
        renderPortsManager(s.ports);
        renderContainers(s.docker && s.docker.items);
        renderPm2(s.pm2 && s.pm2.items);
        renderKuma(s.kuma && s.kuma.items);

        const countDocker = document.getElementById('count-docker');
        if (countDocker) countDocker.textContent = (s.docker && s.docker.total) || 0;
        const countPm2 = document.getElementById('count-pm2');
        if (countPm2) countPm2.textContent = (s.pm2 && s.pm2.total) || 0;
        const countKuma = document.getElementById('count-kuma');
        if (countKuma) countKuma.textContent = (s.kuma && s.kuma.total) || 0;
        renderDisks(disks);
        renderTemps(s.host && s.host.temps);
        renderNet(net, rate);
        renderMongo(s.mongo);
        renderCores(s.host && s.host.cpu && s.host.cpu.cores);
        renderOs(s.host || {});
        syncHudFrames();
        drawCharts();

        // Update Sidebar Mini Vitals
        const cpuPct = (s.host && s.host.cpu && s.host.cpu.pct) || 0;
        const memPct = (s.host && s.host.mem && s.host.mem.pct) || 0;
        const sbCpuFill = $('#sb-cpu-fill');
        const sbCpuVal = $('#sb-cpu-val');
        const sbMemFill = $('#sb-mem-fill');
        const sbMemVal = $('#sb-mem-val');
        if (sbCpuFill) sbCpuFill.style.width = `${Math.min(100, Math.max(0, cpuPct))}%`;
        if (sbCpuVal) sbCpuVal.textContent = `${cpuPct.toFixed(0)}%`;
        if (sbMemFill) sbMemFill.style.width = `${Math.min(100, Math.max(0, memPct))}%`;
        if (sbMemVal) sbMemVal.textContent = `${memPct.toFixed(0)}%`;

        // Update Hostname in Sidebar
        const sbHost = $('#sidebar-hostname');
        if (sbHost && s.host && s.host.hostname) sbHost.textContent = s.host.hostname;

        // Update Live Dot on Desktop Topbar
        const dtLive = $('#live-dot-desktop');
        if (dtLive) dtLive.classList.remove('is-stale', 'is-off');


        // Update CPU Trend labels
        const cpuNow = $('#cpu-chart-now'); if (cpuNow) cpuNow.textContent = `${((s.host && s.host.cpu && s.host.cpu.pct) || 0).toFixed(1)}%`;
        const cpuVals = state.hist.cpu;
        const cpuMin = $('#cpu-chart-min'); if (cpuMin) cpuMin.textContent = `Min ${cpuVals.length ? Math.min(...cpuVals).toFixed(0) : 0}%`;
        const cpuMax = $('#cpu-chart-max'); if (cpuMax) cpuMax.textContent = `Max ${cpuVals.length ? Math.max(...cpuVals).toFixed(0) : 0}%`;

        // Update Memory Trend labels
        const mem = (s.host && s.host.mem) || { pct: 0, used: 0, total: 0 };
        const memNow = $('#mem-chart-now'); if (memNow) memNow.textContent = `${(mem.pct || 0).toFixed(1)}%`;
        const memVals = state.hist.mem;
        const memUsed = $('#mem-chart-used'); if (memUsed) memUsed.textContent = `Used ${fmtBytes(mem.used)} / ${fmtBytes(mem.total)}`;
        const memMinMax = $('#mem-chart-minmax'); if (memMinMax) memMinMax.textContent = `Min ${memVals.length ? Math.min(...memVals).toFixed(0) : 0}% · Max ${memVals.length ? Math.max(...memVals).toFixed(0) : 0}%`;

        // Update Disk 1..N Trend labels
        state.diskOrder.forEach((mount, idx) => {
            const d = state.diskMeta[mount] || {};
            const dr = diskRates[mount] || { r: 0, w: 0 };
            const nowEl = $(`#disk-chart-now-${idx}`);
            const capEl = $(`#disk-chart-cap-${idx}`);
            const ioEl = $(`#disk-chart-io-${idx}`);
            if (nowEl) nowEl.textContent = `${(d.usedPct ?? 0).toFixed(1)}%`;
            if (capEl) capEl.textContent = `Used ${fmtBytes(d.used || 0)} / ${fmtBytes(d.size || 0)} (Free ${fmtBytes(d.avail || 0)})`;
            if (ioEl) ioEl.textContent = `R ${fmtRate(dr.r)} · W ${fmtRate(dr.w)}`;
        });

        // Update Ethernet / Traffic Trend labels
        const netTitle = $('#net-chart-title'); if (netTitle) netTitle.textContent = `Ethernet / Traffic (${state.ethName})`;
        const netLeg = $('#net-legend'); if (netLeg) netLeg.innerHTML = `<span><i style="background:var(--series-1)"></i>RX (Down)</span><span><i style="background:var(--series-2)"></i>TX (Up)</span>`;
        const chHint = $('#charts-hint');
        if (chHint) {
            chHint.textContent = state.hist.t.length < 2
                ? 'Collecting telemetry… (requires at least 2 samples)'
                : `${state.hist.t.length} samples collected · refreshes every 5s`;
        }
        const netAxisFrom = $('#net-axis-from'); if (netAxisFrom) netAxisFrom.textContent = `↓ RX ${fmtRate(rate.rx)} · ↑ TX ${fmtRate(rate.tx)}`;
        const netAxisTo = $('#net-axis-to');
        if (netAxisTo) {
            netAxisTo.textContent = state.hist.t.length >= 2
                ? `${fmtTime(state.hist.t[0])} → ${fmtTime(state.hist.t[state.hist.t.length - 1])}`
                : fmtTime(s.generatedAt);
        }

        const footGen = $('#foot-gen'); if (footGen) footGen.textContent = `Last updated ${fmtTime(s.generatedAt)} · auto-refresh every 5s`;
        const dot = $('#live-dot');
        if (dot) {
            dot.classList.remove('is-stale');
            const doti = dot.querySelector('i');
            if (doti) doti.style.background = '';
        }
        const liveTxt = $('#live-text'); if (liveTxt) liveTxt.textContent = fmtTime(s.generatedAt);
        const liveTxtDt = $('#live-text-desktop'); if (liveTxtDt) liveTxtDt.textContent = `Live · ${fmtTime(s.generatedAt)}`;
    } catch (e) {
        console.error('Failed to load telemetry:', e);
        const errLoc = (e && e.stack) ? (e.stack.split('\n')[1] || '').trim() : '';
        toast('err', `Failed to load telemetry: ${e.message}${errLoc ? ` (${errLoc})` : ''}`);
        const ld = $('#live-dot');
        if (ld) ld.classList.add('is-stale');
    }
}

// ── markdown (zero dependencies) ─────────────────────────────────────────────
function mdInline(src) {
    const codes = [];
    let s = String(src ?? '');
    s = s.replace(/<((?:https?:\/\/)[^>\s]+)>/g, '[$1]($1)');
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
        (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,;:)!?])/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
    return s;
}

function mdCells(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
        if (ch === '|') { cells.push(cur); cur = ''; continue; }
        cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
}

function renderMarkdown(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    let i = 0;

    const flush = () => {
        if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para = []; }
    };

    while (i < lines.length) {
        const line = lines[i];

        const fence = line.match(/^```(\w*)\s*$/);
        if (fence) {
            flush();
            const lang = fence[1] || '';
            const buf = [];
            i++;
            while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
            i++;
            out.push(`<pre class="md-code" data-lang="${esc(lang)}">` +
                `<button class="md-copy" type="button" title="Copy code">Copy</button>` +
                `<code>${esc(buf.join('\n'))}</code></pre>`);
            continue;
        }

        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
            flush();
            const lvl = h[1].length;
            out.push(`<h${lvl} class="md-h md-h${lvl}">${mdInline(h[2])}</h${lvl}>`);
            i++;
            continue;
        }

        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push('<hr class="md-hr"/>'); i++; continue; }

        if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
            flush();
            const head = mdCells(line);
            const align = mdCells(lines[i + 1]).map((c) => {
                if (/^:.*:$/.test(c)) return 'center';
                if (/:$/.test(c)) return 'right';
                return 'left';
            });
            i += 2;
            const rows = [];
            while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(mdCells(lines[i])); i++; }
            const th = head.map((c, k) => `<th style="text-align:${align[k] || 'left'}">${mdInline(c)}</th>`).join('');
            const tb = rows.map((r) => `<tr>${head.map((_, k) =>
                `<td style="text-align:${align[k] || 'left'}">${mdInline(r[k] || '')}</td>`).join('')}</tr>`).join('');
            out.push(`<div class="md-tablewrap"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
            continue;
        }

        if (/^\s*>/.test(line)) {
            flush();
            const buf = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
            out.push(`<blockquote class="md-quote">${renderMarkdown(buf.join('\n'))}</blockquote>`);
            continue;
        }

        if (/^(\s*)([-*+]|\d+\.)\s+(.*)$/.test(line)) {
            flush();
            const ordered = /^\s*\d+\./.test(line);
            const items = [];
            while (i < lines.length) {
                const m = lines[i].match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
                if (!m) break;
                items.push(m[1]);
                i++;
                while (i < lines.length
                       && /^\s{2,}\S/.test(lines[i])
                       && !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i])) {
                    items[items.length - 1] += ` ${lines[i].trim()}`;
                    i++;
                }
            }
            const tag = ordered ? 'ol' : 'ul';
            out.push(`<${tag} class="md-list">${items.map((t) => `<li>${mdInline(t)}</li>`).join('')}</${tag}>`);
            continue;
        }

        if (!line.trim()) { flush(); i++; continue; }
        para.push(line.trim());
        i++;
    }
    flush();
    return out.join('\n');
}

// ── helpers ───────────────────────────────────────────────────────────────────
async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (_) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (_) { return false; }
    }
}

// ── events ───────────────────────────────────────────────────────────────────
function setPaused(paused) {
    state.paused = paused;
    $('#btn-pause').classList.toggle('is-on', paused);
    $('#btn-pause').innerHTML = ico(paused ? 'play' : 'pause');
    $('#live-dot').classList.toggle('is-off', paused);
    if (paused) toast('ok', 'Auto-refresh paused');
    else { toast('ok', 'Auto-refresh resumed'); refresh(true); }
}

function bindEvents() {
    // Explicit direct click listeners for all sidebar and mobile nav items
    $$('.sidebar__item, .mobile-nav-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const v = btn.dataset.view;
            if (v) {
                e.preventDefault();
                e.stopPropagation();
                switchView(v);
            }
        });
    });

    // Sidebar footer control rack bindings
    const sbSound = $('#btn-sound-sb');
    if (sbSound) sbSound.addEventListener('click', () => toggleSound());
    const topSound = $('#btn-sound');
    if (topSound) topSound.addEventListener('click', () => toggleSound());
    updateSoundUI();

    const sbTheme = $('#btn-theme-sb');
    if (sbTheme) sbTheme.addEventListener('click', () => {
        const i = THEME_ORDER.indexOf(state.theme);
        state.theme = THEME_ORDER[(i + 1) % THEME_ORDER.length];
        applyTheme();
    });
    const sbRefresh = $('#btn-refresh-sb');
    if (sbRefresh) sbRefresh.addEventListener('click', () => refresh(true));
    const sbPause = $('#btn-pause-sb');
    if (sbPause) sbPause.addEventListener('click', () => setPaused(!state.paused));
    const sbLogout = $('#btn-logout-sb');
    if (sbLogout) sbLogout.addEventListener('click', () => $('#btn-logout').click());

    
    // Multi-view navigation clicks (Desktop Sidebar + Mobile Bottom Nav + Deep Links)
    document.addEventListener('click', (ev) => {
        // Allow all normal external links, app links, and target="_blank" anchors to open freely!
        const anchor = ev.target.closest('a');
        if (anchor) {
            const href = anchor.getAttribute('href') || '';
            // If it's an external link or normal page URL, do NOT intercept
            if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/os/') || href.startsWith('/portainer') || href.startsWith('/mongo') || href.startsWith('/terminal') || href.startsWith('/energy') || href.startsWith('/bg-remove') || href.startsWith('/3d-vault') || href.startsWith('/video-studio') || href.startsWith('/agent-hub') || anchor.target === '_blank') {
                return;
            }
        }

        // Only handle explicit navigation tabs/buttons
        const navBtn = ev.target.closest('.sidebar__item, .mobile-nav-btn, .subnav__tab, [data-view-jump]');
        if (navBtn && navBtn.dataset.view) {
            ev.preventDefault();
            switchView(navBtn.dataset.view);
        }

        // Terminal & AI subtab switching
        const termSubBtn = ev.target.closest('[data-term-subtab]');
        if (termSubBtn && termSubBtn.dataset.termSubtab) {
            ev.preventDefault();
            switchTerminalSubtab(termSubBtn.dataset.termSubtab);
        }
    });

    window.addEventListener('hashchange', () => {
        const h = location.hash.replace('#', '');
        if (h) switchView(h, false);
    });

    $('#btn-theme').addEventListener('click', () => {
        const i = THEME_ORDER.indexOf(state.theme);
        state.theme = THEME_ORDER[(i + 1) % THEME_ORDER.length];
        applyTheme();
    });
    $('#btn-refresh').addEventListener('click', () => refresh(true));
    $('#btn-pause').addEventListener('click', () => setPaused(!state.paused));

    // Sign out — ล้าง session cookie แล้วกลับไปหน้า login
    $('#btn-logout').addEventListener('click', async () => {
        try {
            await fetch('/api/logout', { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        } catch (_) { /* ไม่มีเน็ต — ก็ล้าง cookie ในเครื่องต่อไป */ }
        location.href = '/login';
    });

    // Table control buttons (event delegation)
    document.addEventListener('click', async (ev) => {
        const tsBtn = ev.target.closest('button[data-ts-act]');
        if (tsBtn) {
            const act = tsBtn.dataset.tsAct;
            if (act === 'copy') {
                const url = tsBtn.dataset.url || '';
                if (await copyText(url)) toast('ok', `Copied URL: ${url}`);
                else toast('err', 'Failed to copy URL');
                return;
            }
            const port = Number(tsBtn.dataset.port);
            const path = tsBtn.dataset.path || '/';
            if (act === 'set-mode') {
                const mode = tsBtn.dataset.mode;
                const target = tsBtn.dataset.target;
                try {
                    tsBtn.disabled = true;
                    const r = await fetch('/api/tailscale/action', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'set-mode', port, path, target, mode, unlockSystem: Boolean(state.tsUnlockSystem) }),
                    });
                    const j = await r.json();
                    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                    toast('ok', mode === 'funnel'
                        ? `🌐 Port :${port} is now PUBLIC on the internet (Funnel ON)`
                        : `🔒 Port :${port} switched to PRIVATE (Tailnet Only)`);
                    refresh(true);
                } catch (e) {
                    toast('err', `Tailscale error: ${e.message}`);
                    tsBtn.disabled = false;
                }
                return;
            }
            if (act === 'remove') {
                try {
                    tsBtn.disabled = true;
                    const r = await fetch('/api/tailscale/action', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'remove', port, path, unlockSystem: Boolean(state.tsUnlockSystem) }),
                    });
                    const j = await r.json();
                    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                    toast('ok', `Removed route :${port}${path}`);
                    refresh(true);
                } catch (e) {
                    toast('err', `Failed to remove route: ${e.message}`);
                    tsBtn.disabled = false;
                }
                return;
            }
        }

        const btn = ev.target.closest('button[data-c], button[data-p]');
        if (!btn) return;
        if (btn.dataset.c) {
            const name = btn.dataset.c, act = btn.dataset.a;
            const verb = { start: 'Start', stop: 'Stop', restart: 'Restart' }[act];
            doAction(`/api/containers/${encodeURIComponent(name)}/${act}`,
                `${verb} container “${name}”`,
                act === 'stop' ? 'This container will be stopped immediately and dependent services may become unavailable.' : 'Confirm this container operation.',
                verb);
        } else if (btn.dataset.p) {
            const name = btn.dataset.p, act = btn.dataset.a;
            const verb = { start: 'Start', stop: 'Stop', restart: 'Restart' }[act];
            doAction(`/api/pm2/${encodeURIComponent(name)}/${act}`,
                `${verb} process “${name}”`,
                act === 'stop' ? 'This PM2 process will be stopped and its service may become unavailable.' : 'Confirm this PM2 process operation.',
                verb);
        }
    });

    // Tailscale Control Center form & buttons
    const lockBtn = $('#btn-ts-lock');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            state.tsUnlockSystem = !state.tsUnlockSystem;
            toast(state.tsUnlockSystem ? 'err' : 'ok',
                state.tsUnlockSystem
                    ? '🔓 System ports (443, 3001, 8082) unlocked — proceed with caution!'
                    : '🔒 System ports (443, 3001, 8082) locked and protected');
            refresh(true);
        });
    }

    const panicBtn = $('#btn-ts-panic');
    if (panicBtn) {
        panicBtn.addEventListener('click', async () => {
            try {
                panicBtn.disabled = true;
                const r = await fetch('/api/tailscale/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'panic-off' }),
                });
                const j = await r.json();
                if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                toast('ok', `🚨 Disabled all public Funnels (${(j.turnedOff || []).join(', ') || 'done'}) — reverted to Tailnet Only`);
                refresh(true);
            } catch (e) {
                toast('err', `Panic-off failed: ${e.message}`);
            } finally {
                panicBtn.disabled = false;
            }
        });
    }

    const presets = $('#ts-port-presets');
    if (presets) {
        presets.addEventListener('click', (ev) => {
            const chip = ev.target.closest('button[data-port]');
            if (!chip) return;
            $('#ts-port').value = chip.dataset.port;
            if (chip.dataset.mode) $('#ts-mode').value = chip.dataset.mode;
        });
    }

    const picker = $('#ts-local-picker');
    if (picker) {
        picker.addEventListener('change', () => {
            if (picker.value) $('#ts-target').value = picker.value;
        });
    }

    const testBtn = $('#btn-ts-test');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            const target = ($('#ts-target').value || '').trim();
            const out = $('#ts-test-result');
            if (!target) {
                toast('err', 'Enter a local backend port or URL first');
                return;
            }
            out.innerHTML = `<span class="dim">Probing ${esc(target)}…</span>`;
            try {
                const r = await fetch('/api/tailscale/test-target', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target }),
                });
                const j = await r.json();
                if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                out.innerHTML = j.up
                    ? `${pill('good', `Reachable · ${j.detail} (${j.latencyMs}ms)`)} <span class="dim">Target: <code>${esc(j.normalizedTarget)}</code> is ready to expose</span>`
                    : `${pill('critical', `Unreachable · ${j.detail}`)} <span class="dim">Target: <code>${esc(j.normalizedTarget)}</code> is not responding yet (you can still pre-configure the route)</span>`;
            } catch (e) {
                out.innerHTML = `${pill('critical', 'Invalid Target')} <span class="dim">${esc(e.message)}</span>`;
            }
        });
    }

    const deployForm = $('#ts-deploy-form');
    if (deployForm) {
        deployForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const mode = $('#ts-mode').value;
            const port = parseInt($('#ts-port').value, 10);
            const path = ($('#ts-path').value || '/').trim() || '/';
            const target = ($('#ts-target').value || '').trim();
            const deployBtn = $('#btn-ts-deploy');
            const out = $('#ts-test-result');
            try {
                deployBtn.disabled = true;
                const r = await fetch('/api/tailscale/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'deploy',
                        mode,
                        port,
                        path,
                        target,
                        unlockSystem: Boolean(state.tsUnlockSystem),
                    }),
                });
                const j = await r.json();
                if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                toast('ok', mode === 'funnel'
                    ? `🌐 Deployed PUBLIC Funnel on :${port}${path} → ${j.target}`
                    : `🔒 Deployed PRIVATE Tailnet route on :${port}${path} → ${j.target}`);
                if (out) out.innerHTML = `${pill('good', 'Deployed ✓')} <span class="dim">Active on port <code>:${port}${esc(path)}</code> → <code>${esc(j.target)}</code></span>`;
                refresh(true);
            } catch (e) {
                toast('err', e.message);
                if (out) out.innerHTML = `${pill('critical', 'Deploy Error')} <span class="dim">${esc(e.message)}</span>`;
            } finally {
                deployBtn.disabled = false;
            }
        });
    }

    // ── Port & Firewall Manager events ──────────────────────────────────────
    const pmLockBtn = $('#btn-pm-lock');
    if (pmLockBtn) {
        pmLockBtn.addEventListener('click', () => {
            state.pmUnlockSystem = !state.pmUnlockSystem;
            toast(state.pmUnlockSystem ? 'err' : 'ok',
                state.pmUnlockSystem
                    ? '🔓 System ports unlocked (SSH 22 & Tailscale remain permanently protected)'
                    : '🔒 System ports locked and protected');
            refresh(true);
        });
    }

    const pmFilters = $('#pm-filters');
    if (pmFilters) {
        pmFilters.addEventListener('click', (ev) => {
            const chip = ev.target.closest('button[data-pm-filter]');
            if (!chip) return;
            pmFilters.querySelectorAll('button[data-pm-filter]').forEach((b) => b.classList.remove('is-active'));
            chip.classList.add('is-active');
            state.pmFilter = chip.dataset.pmFilter;
            refresh(true);
        });
    }

    const pmChips = $('#pm-port-chips');
    if (pmChips) {
        pmChips.addEventListener('click', (ev) => {
            const chip = ev.target.closest('button[data-pm-chip]');
            if (!chip) return;
            $('#pm-port').value = chip.dataset.pmChip;
            if (chip.dataset.proto) $('#pm-proto').value = chip.dataset.proto;
            if (chip.dataset.comment) $('#pm-comment').value = chip.dataset.comment;
        });
    }

    document.addEventListener('click', async (ev) => {
        const batchBtn = ev.target.closest('button[data-pm-batch]');
        if (batchBtn) {
            const mode = batchBtn.dataset.pmBatch;
            try {
                batchBtn.disabled = true;
                const r = await fetch('/api/ports/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'batch-emqx', mode }),
                });
                const j = await r.json();
                if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                toast('ok', `EMQX ports updated (${mode})`);
                refresh(true);
            } catch (e) {
                toast('err', `EMQX batch error: ${e.message}`);
            } finally {
                batchBtn.disabled = false;
            }
            return;
        }

        const pmBtn = ev.target.closest('button[data-pm-act]');
        if (pmBtn) {
            const act = pmBtn.dataset.pmAct;
            const out = $('#pm-feedback');
            if (act === 'test-port') {
                const port = parseInt(pmBtn.dataset.port, 10);
                const proto = pmBtn.dataset.proto || 'tcp';
                try {
                    pmBtn.disabled = true;
                    const r = await fetch('/api/ports/action', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'test-port', port, proto }),
                    });
                    const j = await r.json();
                    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                    toast(j.up ? 'ok' : 'err', `Port :${port}/${proto.toUpperCase()} — ${j.detail} (${j.latencyMs}ms)`);
                    if (out) out.innerHTML = j.up
                        ? `${pill('good', `:${port}/${proto.toUpperCase()} Reachable (${j.latencyMs}ms)`)} <span class="dim">${esc(j.detail)}</span>`
                        : `${pill('critical', `:${port}/${proto.toUpperCase()} Unreachable`)} <span class="dim">${esc(j.detail)}</span>`;
                } catch (e) {
                    toast('err', e.message);
                } finally {
                    pmBtn.disabled = false;
                }
                return;
            }
            if (act === 'set-port-mode') {
                const port = parseInt(pmBtn.dataset.port, 10);
                const proto = pmBtn.dataset.proto || 'tcp';
                const mode = pmBtn.dataset.mode || 'allow-any';
                const comment = pmBtn.dataset.comment || '';
                try {
                    pmBtn.disabled = true;
                    const r = await fetch('/api/ports/action', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'set-port-mode', port, proto, mode, comment, unlockSystem: Boolean(state.pmUnlockSystem) }),
                    });
                    const j = await r.json();
                    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                    toast('ok', `Port :${port}/${proto.toUpperCase()} firewall updated → ${mode}`);
                    refresh(true);
                } catch (e) {
                    toast('err', `Firewall error: ${e.message}`);
                    pmBtn.disabled = false;
                }
                return;
            }
            if (act === 'delete-rule') {
                const num = parseInt(pmBtn.dataset.num, 10);
                try {
                    pmBtn.disabled = true;
                    const r = await fetch('/api/ports/action', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'delete-rule', num, unlockSystem: Boolean(state.pmUnlockSystem) }),
                    });
                    const j = await r.json();
                    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                    toast('ok', `Deleted UFW rule #${num}`);
                    refresh(true);
                } catch (e) {
                    toast('err', `Delete rule failed: ${e.message}`);
                    pmBtn.disabled = false;
                }
                return;
            }
        }
    });

    const pmTestBtn = $('#btn-pm-test');
    if (pmTestBtn) {
        pmTestBtn.addEventListener('click', async () => {
            const port = parseInt($('#pm-port').value, 10);
            const proto = $('#pm-proto').value || 'tcp';
            const out = $('#pm-feedback');
            if (!port) return;
            if (out) out.innerHTML = `<span class="dim">Testing :${port}/${proto.toUpperCase()}…</span>`;
            try {
                const r = await fetch('/api/ports/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'test-port', port, proto }),
                });
                const j = await r.json();
                if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                if (out) out.innerHTML = j.up
                    ? `${pill('good', `Reachable · ${j.detail} (${j.latencyMs}ms)`)} <span class="dim">Port <code>:${port}/${proto.toUpperCase()}</code> is active</span>`
                    : `${pill('critical', `Unreachable · ${j.detail}`)} <span class="dim">No service responding on <code>:${port}/${proto.toUpperCase()}</code></span>`;
            } catch (e) {
                if (out) out.innerHTML = `${pill('critical', 'Error')} <span class="dim">${esc(e.message)}</span>`;
            }
        });
    }

    const pmForm = $('#pm-rule-form');
    if (pmForm) {
        pmForm.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const port = parseInt($('#pm-port').value, 10);
            const proto = $('#pm-proto').value || 'tcp';
            const mode = $('#pm-mode').value || 'allow-any';
            const comment = ($('#pm-comment').value || '').trim();
            const applyBtn = $('#btn-pm-apply');
            const out = $('#pm-feedback');
            try {
                applyBtn.disabled = true;
                const r = await fetch('/api/ports/action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'set-port-mode',
                        port,
                        proto,
                        mode,
                        comment,
                        unlockSystem: Boolean(state.pmUnlockSystem),
                    }),
                });
                const j = await r.json();
                if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                toast('ok', `Updated firewall rule for :${port}/${proto.toUpperCase()} → ${mode}`);
                if (out) out.innerHTML = `${pill('good', 'Rule Applied ✓')} <span class="dim">Port <code>:${port}/${proto.toUpperCase()}</code> set to <strong>${esc(mode)}</strong></span>`;
                refresh(true);
            } catch (e) {
                toast('err', e.message);
                if (out) out.innerHTML = `${pill('critical', 'Rule Error')} <span class="dim">${esc(e.message)}</span>`;
            } finally {
                applyBtn.disabled = false;
            }
        });
    }

    // ── Embedded Web Terminal & Cockpit Shell events ────────────────────────
    const termTabs = $('#dash-term-tabs');
    if (termTabs) {
        termTabs.addEventListener('click', (ev) => {
            const tab = ev.target.closest('button[data-term-tab]');
            if (!tab) return;
            termTabs.querySelectorAll('button[data-term-tab]').forEach((b) => b.classList.remove('is-active'));
            tab.classList.add('is-active');
            const which = tab.dataset.termTab;
            $('#dash-term-console').style.display = which === 'console' ? '' : 'none';
            $('#dash-term-cockpit').style.display = which === 'cockpit' ? '' : 'none';
            if (which === 'cockpit') {
                const iframe = $('#dcockpit-iframe');
                if (iframe && !iframe.getAttribute('src')) {
                    iframe.setAttribute('src', iframe.dataset.src || '/os/system/terminal');
                }
            }
            syncHudFrames();
        });
    }

    document.querySelectorAll('[data-dcockpit-src]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const iframe = $('#dcockpit-iframe');
            if (iframe) iframe.src = btn.dataset.dcockpitSrc;
        });
    });

    const reloadCockpitBtn = $('#btn-dcockpit-reload');
    if (reloadCockpitBtn) {
        reloadCockpitBtn.addEventListener('click', () => {
            const iframe = $('#dcockpit-iframe');
            if (iframe && iframe.src) iframe.src = iframe.src;
        });
    }

    const dtermOut = $('#dterm-output');
    const dtermInput = $('#dterm-input');
    const dtermForm = $('#dterm-form');
    const dtermRunBtn = $('#btn-dterm-run');

    async function runDashTerm(payload) {
        if (!dtermOut) return;
        try {
            if (dtermRunBtn) { dtermRunBtn.disabled = true; dtermRunBtn.textContent = 'Running…'; }
            const r = await fetch('/api/terminal/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const j = await r.json();
            if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
            const entry = document.createElement('div');
            entry.className = 'dterm-entry';
            if (j.code !== 0) entry.dataset.err = '1';
            entry.innerHTML =
                `<div class="dterm-cmd"><span>$ ${esc(j.command)}</span><span class="dim" style="font-size:10.5px">exit ${j.code} · ${j.durationMs}ms</span></div>` +
                (j.stdout ? `<div>${esc(j.stdout.trimEnd())}</div>` : '') +
                (j.stderr ? `<div class="dterm-err">${esc(j.stderr.trimEnd())}</div>` : '') +
                (!j.stdout && !j.stderr ? `<div class="dim">(no output)</div>` : '');
            dtermOut.appendChild(entry);
            dtermOut.scrollTop = dtermOut.scrollHeight;
        } catch (e) {
            toast('err', `Terminal error: ${e.message}`);
        } finally {
            if (dtermRunBtn) { dtermRunBtn.disabled = false; dtermRunBtn.textContent = '▶ Execute'; }
        }
    }

    if (dtermForm) {
        dtermForm.addEventListener('submit', (ev) => {
            ev.preventDefault();
            const cmd = (dtermInput.value || '').trim();
            if (!cmd) return;
            if (cmd === 'clear') { dtermOut.innerHTML = ''; dtermInput.value = ''; return; }
            dtermInput.value = '';
            runDashTerm({ command: cmd });
        });
    }

    const dtermMacros = $('#dash-term-macros');
    if (dtermMacros) {
        dtermMacros.addEventListener('click', (ev) => {
            const chip = ev.target.closest('button[data-dmacro]');
            if (!chip) return;
            runDashTerm({ macro: chip.dataset.dmacro });
        });
    }

    const dtermClear = $('#btn-dterm-clear');
    if (dtermClear && dtermOut) dtermClear.addEventListener('click', () => { dtermOut.innerHTML = ''; });

    const dtermCopy = $('#btn-dterm-copy');
    if (dtermCopy && dtermOut) {
        dtermCopy.addEventListener('click', async () => {
            if (await copyText(dtermOut.innerText || '')) toast('ok', 'Copied terminal output');
        });
    }

    // Seed initial output in embedded console
    if (dtermOut) {
        runDashTerm({ macro: 'wg-status' });
    }

    let rt;
    window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => { syncHudFrames(); drawCharts(); }, 120);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
}

// ── boot ─────────────────────────────────────────────────────────────────────
applyTheme();



bindEvents();
initMagneticPhysics();

// Restore view from URL hash or path
const initHash = location.hash.replace('#', '');
const initPath = location.pathname.replace('/', '');
const validViews = ['overview', 'services', 'ports', 'vpn', 'terminal', 'gemini', 'energy'];
const startView = validViews.includes(initHash) ? initHash : (validViews.includes(initPath) ? initPath : 'overview');
switchView(startView, false);
state.isReady = true;

refresh(true);
state.timer = setInterval(() => refresh(false), 5000);
setInterval(() => {
    const dot = $('#live-dot');
    if (Date.now() - state.lastAt > 20000) dot.classList.add('is-stale');
}, 5000);


    // ── WireGuard Client & Policy Management Event Handlers ───────────────────────
    document.addEventListener('click', async (ev) => {
        // Open New Client Modal
        if (ev.target.closest('#btn-wg-new-client') || ev.target.closest('#btn-wg-panel-new') || ev.target.closest('#btn-wg-empty-new')) {
            const m = $('#modal-wg-new-client');
            if (m) {
                $('#wg-new-name').value = '';
                $('#wg-new-preset').value = 'admin';
                m.showModal();
                $('#wg-new-name').focus();
            }
            return;
        }

        // Cancel New Client Modal
        if (ev.target.closest('#btn-wg-new-cancel')) {
            const m = $('#modal-wg-new-client');
            if (m) m.close();
            return;
        }

        // Refresh WireGuard Clients
        if (ev.target.closest('#btn-wg-refresh')) {
            refresh(true);
            toast('ok', '🔄 Refreshing WireGuard status...');
            return;
        }

        // Close QR Code Modal
        if (ev.target.closest('#btn-wg-qr-close') || ev.target.closest('#btn-wg-qr-done')) {
            const m = $('#modal-wg-qrcode');
            if (m) m.close();
            return;
        }

        // Show QR Code Button
        const qrBtn = ev.target.closest('button[data-wg-act="show-qr"]');
        if (qrBtn) {
            const id = qrBtn.dataset.id;
            const name = qrBtn.dataset.name;
            const ip = qrBtn.dataset.ip;
            const modal = $('#modal-wg-qrcode');
            const svgBox = $('#wg-qr-svg-box');
            const nameEl = $('#wg-qr-client-name');
            const ipEl = $('#wg-qr-ip');
            const dlBtn = $('#btn-wg-download-conf');

            if (nameEl) nameEl.textContent = `📱 ${name}`;
            if (ipEl) ipEl.textContent = ip;
            if (dlBtn) {
                dlBtn.href = `/api/wireguard/client/${encodeURIComponent(id)}/configuration`;
                dlBtn.download = `wg-${name}.conf`;
            }

            if (svgBox) {
                svgBox.innerHTML = '<div style="color:#000;font-size:12px;padding:30px">Loading QR Code...</div>';
            }
            if (modal) modal.showModal();

            try {
                const r = await fetch(`/api/wireguard/client/${encodeURIComponent(id)}/qrcode.svg`);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                let svgText = await r.text();
                // Ensure SVG width/height scale 100% to box
                svgText = svgText.replace(/width="\d+"/, 'width="100%"').replace(/height="\d+"/, 'height="100%"');
                if (svgBox) svgBox.innerHTML = svgText;
            } catch (e) {
                if (svgBox) svgBox.innerHTML = `<div style="color:red;font-size:12px;padding:20px">Error loading QR: ${esc(e.message)}</div>`;
            }
            return;
        }

        // Toggle Client Enable / Disable
        const toggleBtn = ev.target.closest('button[data-wg-act="toggle-enable"]');
        if (toggleBtn) {
            const id = toggleBtn.dataset.id;
            const currentEnabled = toggleBtn.dataset.enabled === 'true';
            toggleBtn.disabled = true;
            try {
                const r = await fetch(`/api/wireguard/client/${encodeURIComponent(id)}/toggle`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: !currentEnabled }),
                });
                const j = await r.json();
                if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                toast('ok', `Client ${!currentEnabled ? 'Enabled ▶️' : 'Disabled ⏸️'}`);
                refresh(true);
            } catch (e) {
                toast('err', `Failed to toggle client: ${e.message}`);
            } finally {
                toggleBtn.disabled = false;
            }
            return;
        }

        // Delete Client
        const delBtn = ev.target.closest('button[data-wg-act="delete-client"]');
        if (delBtn) {
            const id = delBtn.dataset.id;
            const name = delBtn.dataset.name;
            const ok = await confirmDialog(`ลบ Client "${name}"?`, `คุณแน่ใจหรือไม่ว่าต้องการลบโปรไฟล์ VPN นี้? อุปกรณ์ที่ใช้โปรไฟล์นี้จะไม่สามารถเชื่อมต่อได้อีกต่อไป`);
            if (!ok) return;

            delBtn.disabled = true;
            try {
                const r = await fetch(`/api/wireguard/client/${encodeURIComponent(id)}`, {
                    method: 'DELETE',
                });
                const j = await r.json();
                if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                toast('ok', `🗑️ ลบ Client "${name}" สำเร็จ`);
                refresh(true);
            } catch (e) {
                toast('err', `ลบไม่สำเร็จ: ${e.message}`);
            } finally {
                delBtn.disabled = false;
            }
            return;
        }

        // Policy Preset Chip Click
        const presetChip = ev.target.closest('button[data-wg-preset]');
        if (presetChip) {
            const card = presetChip.closest('.wg-client-card');
            if (!card) return;
            const pubKey = card.dataset.wgPubkey;
            const presetKey = presetChip.dataset.wgPreset;

            const PRESETS_DEF = {
                admin: { allowInternet: true, allowLan: true, allowP2P: true, homelabOnly: false },
                standard: { allowInternet: true, allowLan: false, allowP2P: false, homelabOnly: false },
                guest: { allowInternet: true, allowLan: false, allowP2P: false, homelabOnly: false },
                serveronly: { allowInternet: false, allowLan: false, allowP2P: false, homelabOnly: true },
            };

            const targetPolicy = PRESETS_DEF[presetKey] || PRESETS_DEF.admin;

            // Update UI immediately for snappiness
            const chipGroup = card.querySelectorAll('.wg-preset-chip');
            chipGroup.forEach((c) => c.classList.toggle('is-active', c.dataset.wgPreset === presetKey));

            const chkNet = card.querySelector('input[data-wg-opt="allowInternet"]');
            const chkLan = card.querySelector('input[data-wg-opt="allowLan"]');
            const chkHome = card.querySelector('input[data-wg-opt="homelabOnly"]');
            const chkP2P = card.querySelector('input[data-wg-opt="allowP2P"]');

            if (chkNet) chkNet.checked = targetPolicy.allowInternet;
            if (chkLan) chkLan.checked = targetPolicy.allowLan;
            if (chkHome) chkHome.checked = targetPolicy.homelabOnly;
            if (chkP2P) chkP2P.checked = targetPolicy.allowP2P;

            // Send to server
            try {
                const r = await fetch('/api/wireguard/policy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        publicKey: pubKey,
                        preset: presetKey,
                        ...targetPolicy,
                    }),
                });
                const j = await r.json();
                if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
                toast('ok', `🛡️ บันทึกสิทธิ์ [${presetKey.toUpperCase()}] สำเร็จ (iptables updated)`);
            } catch (e) {
                toast('err', `บันทึกสิทธิ์ไม่สำเร็จ: ${e.message}`);
                refresh(true);
            }
            return;
        }
    });

    // Form Submit: New WireGuard Client
    const formNewClient = $('#form-wg-new-client');
    if (formNewClient) {
        formNewClient.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const nameInput = $('#wg-new-name');
            const presetSelect = $('#wg-new-preset');
            const name = (nameInput.value || '').trim();
            const preset = presetSelect ? presetSelect.value : 'admin';

            if (!name) return;

            const submitBtn = $('#btn-wg-new-submit');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const r = await fetch('/api/wireguard/client', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, preset }),
                });
                const j = await r.json();
                if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);

                const modal = $('#modal-wg-new-client');
                if (modal) modal.close();

                toast('ok', `✨ สร้าง Client "${name}" สำเร็จ!`);
                refresh(true);
            } catch (e) {
                toast('err', `สร้าง Client ไม่สำเร็จ: ${e.message}`);
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    // Checkbox Change: Individual Policy Toggle
    document.addEventListener('change', async (ev) => {
        const chk = ev.target.closest('input.wg-chk');
        if (!chk) return;
        const card = chk.closest('.wg-client-card');
        if (!card) return;

        const pubKey = card.dataset.wgPubkey;
        const chkNet = card.querySelector('input[data-wg-opt="allowInternet"]');
        const chkLan = card.querySelector('input[data-wg-opt="allowLan"]');
        const chkHome = card.querySelector('input[data-wg-opt="homelabOnly"]');
        const chkP2P = card.querySelector('input[data-wg-opt="allowP2P"]');

        const chipGroup = card.querySelectorAll('.wg-preset-chip');
        chipGroup.forEach((c) => c.classList.remove('is-active'));

        const payload = {
            publicKey: pubKey,
            preset: 'custom',
            allowInternet: chkNet ? chkNet.checked : true,
            allowLan: chkLan ? chkLan.checked : true,
            homelabOnly: chkHome ? chkHome.checked : false,
            allowP2P: chkP2P ? chkP2P.checked : false,
        };

        try {
            const r = await fetch('/api/wireguard/policy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const j = await r.json();
            if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
            toast('ok', `🛡️ อัปเดตกฎ Firewall สำเร็จ`);
        } catch (e) {
            toast('err', `อัปเดตไม่สำเร็จ: ${e.message}`);
            refresh(true);
        }
    });


// ── PWA & Service Worker Support ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((reg) => console.log('[PWA] Service Worker registered with scope:', reg.scope))
            .catch((err) => console.warn('[PWA] Service Worker registration failed:', err));
    });
}

let deferredPwaPrompt = null;
const pwaInstallBtn = document.getElementById('btn-pwa-install');
const pwaSbBtn = document.getElementById('btn-pwa-install-sb');
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function setPwaButtonsVisible(show) {
    if (pwaInstallBtn) pwaInstallBtn.style.display = show ? 'inline-flex' : 'none';
    if (pwaSbBtn) pwaSbBtn.style.display = show ? 'inline-flex' : 'none';
}

if (isStandalone) {
    setPwaButtonsVisible(false);
} else {
    setPwaButtonsVisible(true);
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    if (!isStandalone) {
        setPwaButtonsVisible(true);
    }
});

function showPwaInstallGuide() {
    const modal = document.getElementById('modal-pwa-install');
    const body = document.getElementById('pwa-install-body');
    const actionBtn = document.getElementById('btn-pwa-modal-action');
    if (!modal || !body) return;

    const isHttp = location.protocol === 'http:';
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    let html = '';
    if (isHttp && !isLocal) {
        html = `
          <div style="background:rgba(242,84,27,0.12); border:1px solid rgba(242,84,27,0.35); border-radius:6px; padding:10px 12px; margin-bottom:12px;">
            <div style="font-weight:700; color:#ff794d; margin-bottom:4px;">⚠️ ต้องการการเชื่อมต่อปลอดภัย (HTTPS)</div>
            <div>การติดตั้งเป็นแอป PWA อัตโนมัติในคลิกเดียว มาตรฐานเบราว์เซอร์บังคับให้ใช้งานผ่าน <b>HTTPS</b> ครับ</div>
          </div>
          <div style="margin-bottom:10px;">
            สลับไปเปิดใช้งานผ่าน Caddy HTTPS ของเซิร์ฟเวอร์ Homelab:
          </div>
          <a href="https://${location.hostname}/" target="_top" class="btn btn--primary" style="display:inline-flex; align-items:center; gap:6px; width:100%; justify-content:center; text-decoration:none; margin-bottom:12px; padding:8px 12px;">
            🔐 สลับไปเปิดผ่าน HTTPS (https://${location.hostname}/)
          </a>
          <div style="font-size:11.5px; color:var(--ink-muted);">
            * เมื่อเปิดผ่าน HTTPS แล้วคลิกปุ่มติดตั้ง PWA อีกครั้ง เบราว์เซอร์จะแสดงหน้าต่างให้ติดตั้งลงในเครื่องทันที
          </div>
        `;
        if (actionBtn) actionBtn.textContent = 'ปิดหน้าต่าง';
    } else if (isIOS) {
        html = `
          <div style="margin-bottom:10px;">
            สำหรับ <b>iPhone / iPad (Safari)</b> สามารถเพิ่มลงในหน้าจอหลักได้ทันที:
          </div>
          <ol style="padding-left:18px; margin:0 0 12px; display:flex; flex-direction:column; gap:6px;">
            <li>แตะที่ปุ่ม <b>แชร์ (Share)</b> <span style="font-size:14px;">⎋</span> ตรงแถบด้านล่างของ Safari</li>
            <li>เลื่อนลงมาแล้วเลือก <b>"เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen)</b></li>
            <li>แตะ <b>"เพิ่ม" (Add)</b> ที่มุมขวาบน</li>
          </ol>
          <div style="font-size:11.5px; color:var(--ink-muted);">
            แอป Homelab จะไปปรากฏบนหน้าจอหลักเหมือนแอปพลิเคชันทั่วไป ใช้งานได้เต็มหน้าจอไร้แถบเบราว์เซอร์
          </div>
        `;
        if (actionBtn) actionBtn.textContent = 'เข้าใจแล้ว';
    } else {
        html = `
          <div style="margin-bottom:10px;">
            สามารถติดตั้ง Homelab เป็นแอปพลิเคชันลงในเครื่องได้โดยตรง:
          </div>
          <div style="background:rgba(0,210,240,0.08); border:1px solid rgba(0,210,240,0.25); border-radius:6px; padding:10px 12px; margin-bottom:10px;">
            <b>วิธีที่ 1:</b> มองหาไอคอน <b>ติดตั้งแอป (⊕ หรือ 📲)</b> บนแถบพิมพ์ URL (Address bar) ด้านขวาบน แล้วคลิก "ติดตั้ง"
          </div>
          <div style="background:rgba(255,255,255,0.04); border:1px solid var(--border); border-radius:6px; padding:10px 12px; margin-bottom:10px;">
            <b>วิธีที่ 2:</b> คลิกเมนู <b>3 จุด (⋮)</b> ของเบราว์เซอร์ &gt; เลือก <b>"บันทึกและแชร์" (Save and Share)</b> หรือ <b>"แอป" (Apps)</b> &gt; <b>"ติดตั้ง Homelab"</b>
          </div>
        `;
        if (actionBtn) actionBtn.textContent = 'เข้าใจแล้ว';
    }

    body.innerHTML = html;
    modal.showModal();
}

async function handlePwaInstall() {
    if (deferredPwaPrompt) {
        try {
            deferredPwaPrompt.prompt();
            const { outcome } = await deferredPwaPrompt.userChoice;
            console.log('[PWA] User install choice:', outcome);
            deferredPwaPrompt = null;
            if (outcome === 'accepted') {
                setPwaButtonsVisible(false);
            }
        } catch (err) {
            console.warn('[PWA] prompt error:', err);
            showPwaInstallGuide();
        }
    } else {
        showPwaInstallGuide();
    }
}

if (pwaInstallBtn) pwaInstallBtn.addEventListener('click', handlePwaInstall);
if (pwaSbBtn) pwaSbBtn.addEventListener('click', handlePwaInstall);

const btnPwaModalClose = document.getElementById('btn-pwa-modal-close');
const btnPwaModalAction = document.getElementById('btn-pwa-modal-action');
const modalPwa = document.getElementById('modal-pwa-install');
if (btnPwaModalClose && modalPwa) {
    btnPwaModalClose.addEventListener('click', () => modalPwa.close());
}
if (btnPwaModalAction && modalPwa) {
    btnPwaModalAction.addEventListener('click', () => modalPwa.close());
}

window.addEventListener('appinstalled', () => {
    console.log('[PWA] App successfully installed!');
    setPwaButtonsVisible(false);
});

// ── Services Hub Subtabs (Docker / PM2 / Kuma / All) ───────────────────────
document.querySelectorAll('.svc-subtab').forEach((btn) => {
    btn.addEventListener('click', () => {
        playNavSound();
        document.querySelectorAll('.svc-subtab').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const tab = btn.dataset.svcTab;
        const secDocker = document.getElementById('sec-docker');
        const secPm2 = document.getElementById('sec-pm2');
        const secKuma = document.getElementById('sec-kuma');

        if (tab === 'all') {
            if (secDocker) secDocker.style.display = 'block';
            if (secPm2) secPm2.style.display = 'block';
            if (secKuma) secKuma.style.display = 'block';
        } else if (tab === 'docker') {
            if (secDocker) secDocker.style.display = 'block';
            if (secPm2) secPm2.style.display = 'none';
            if (secKuma) secKuma.style.display = 'none';
        } else if (tab === 'pm2') {
            if (secDocker) secDocker.style.display = 'none';
            if (secPm2) secPm2.style.display = 'block';
            if (secKuma) secKuma.style.display = 'none';
        } else if (tab === 'kuma') {
            if (secDocker) secDocker.style.display = 'none';
            if (secPm2) secPm2.style.display = 'none';
            if (secKuma) secKuma.style.display = 'block';
        }
    });
});

// ── Ports & Firewall Subtabs (UFW / Tailscale / WireGuard & MQTT / All) ───
document.querySelectorAll('.sec-subtab').forEach((btn) => {
    btn.addEventListener('click', () => {
        playNavSound();
        document.querySelectorAll('.sec-subtab').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const tab = btn.dataset.portsTab;
        const secPorts = document.getElementById('sec-ports');
        const secTailscale = document.getElementById('sec-tailscale');
        const secVpnMqtt = document.getElementById('sec-vpn-mqtt');

        if (tab === 'all') {
            if (secPorts) secPorts.style.display = 'block';
            if (secTailscale) secTailscale.style.display = 'block';
            if (secVpnMqtt) secVpnMqtt.style.display = 'block';
        } else if (tab === 'ufw') {
            if (secPorts) secPorts.style.display = 'block';
            if (secTailscale) secTailscale.style.display = 'none';
            if (secVpnMqtt) secVpnMqtt.style.display = 'none';
        } else if (tab === 'tailscale') {
            if (secPorts) secPorts.style.display = 'none';
            if (secTailscale) secTailscale.style.display = 'block';
            if (secVpnMqtt) secVpnMqtt.style.display = 'none';
        } else if (tab === 'vpn') {
            if (secPorts) secPorts.style.display = 'none';
            if (secTailscale) secTailscale.style.display = 'none';
            if (secVpnMqtt) secVpnMqtt.style.display = 'block';
        }
    });
});

// ── Integrated System & AI Settings View ──────────────────────────────────
let settingsInitialized = false;
function loadSettingsView() {
    const selModel = document.getElementById('set-model');
    const selCwd = document.getElementById('set-cwd');
    const authBadge = document.getElementById('set-auth-badge');
    const inpKey = document.getElementById('set-apikey');
    const selStt = document.getElementById('set-stt');
    const selVoice = document.getElementById('set-tts-voice');
    const selVoiceStyle = document.getElementById('set-tts-style');
    const chkAutoTts = document.getElementById('chk-set-auto-tts');
    const chkSoundFx = document.getElementById('chk-set-sound-fx');
    const chkHud = document.getElementById('chk-set-hud');
    const txtMemory = document.getElementById('set-memory');
    const hint = document.getElementById('settings-hint');

    if (!selModel) return;

    const notify = (msg) => {
        if (hint) hint.textContent = msg;
        if (typeof toast === 'function') toast(msg);
    };

    if (!settingsInitialized) {
        settingsInitialized = true;
        selModel.value = localStorage.getItem('core_default_model') || 'auto';
        selStt.value = localStorage.getItem('stt_engine') || 'whisper';
        if (selVoiceStyle) selVoiceStyle.value = localStorage.getItem('core_tts_style') || 'natural';
        chkAutoTts.checked = localStorage.getItem('core_auto_tts') === '1';
        chkSoundFx.checked = localStorage.getItem('gemini_sound_enabled') !== '0';
        chkHud.checked = localStorage.getItem('core_hud_hidden') !== '1';

        selModel.addEventListener('change', () => {
            const v = selModel.value;
            localStorage.setItem('core_default_model', v);
            fetch('/api/gemini/default-model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: v }) })
                .then(r => r.json())
                .then(r => notify(r && r.ok ? '✅ บันทึกโมเดลเริ่มต้นแล้ว (ใช้กับแชทใหม่ทุกห้อง)' : '⚠️ บันทึกไม่สำเร็จ'))
                .catch(() => notify('⚠️ บันทึกลงเครื่องแล้ว แต่ซิงก์ขึ้น server ไม่สำเร็จ'));
        });
        selCwd.addEventListener('change', () => {
            localStorage.setItem('core_default_cwd', selCwd.value);
            notify('✅ บันทึกโฟลเดอร์ทำงานแล้ว');
        });
        selStt.addEventListener('change', () => {
            localStorage.setItem('stt_engine', selStt.value);
            notify('✅ บันทึกโหมดแปลงเสียงแล้ว');
        });
        selVoice.addEventListener('change', () => {
            localStorage.setItem('core_tts_voice', selVoice.value);
            notify('✅ บันทึกเสียงพูด AI แล้ว');
        });
        selVoiceStyle?.addEventListener('change', () => {
            localStorage.setItem('core_tts_style', selVoiceStyle.value);
            notify('✅ บันทึกสไตล์น้ำเสียงแล้ว');
        });
        chkAutoTts.addEventListener('change', () => {
            localStorage.setItem('core_auto_tts', chkAutoTts.checked ? '1' : '0');
            notify(chkAutoTts.checked ? '🗣️ เปิดอ่านออกเสียงอัตโนมัติ' : '🔇 ปิดอ่านออกเสียงอัตโนมัติ');
        });
        chkSoundFx.addEventListener('change', () => {
            localStorage.setItem('gemini_sound_enabled', chkSoundFx.checked ? '1' : '0');
            notify(chkSoundFx.checked ? '🔊 เปิดเสียงเอฟเฟกต์แล้ว' : '🔇 ปิดเสียงเอฟเฟกต์แล้ว');
        });
        chkHud.addEventListener('change', () => {
            localStorage.setItem('core_hud_hidden', chkHud.checked ? '0' : '1');
            notify(chkHud.checked ? '👁️ แสดงลูกแก้ว 3D HUD' : '🙈 ซ่อนลูกแก้ว 3D HUD');
        });
        initWarpStudio(notify);
        initThinkSoundPicker(notify);

        document.getElementById('btn-set-save-key')?.addEventListener('click', async () => {
            const res = await fetch('/api/gemini/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: inpKey.value.trim() })
            });
            const d = await res.json();
            notify(d.ok ? '🔑 บันทึก API Key เรียบร้อย' : '❌ บันทึกไม่สำเร็จ');
        });

        let testAudio = null;
        document.getElementById('btn-set-test-voice')?.addEventListener('click', async () => {
            if (testAudio) { try { testAudio.pause(); } catch (_) {} }
            notify('🔊 กำลังสร้างเสียงทดสอบ...');
            try {
                const res = await fetch('/api/tts', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: 'สวัสดีค่ะ! ระบบเสียงธรรมชาติพร้อมใช้งานแล้วนะคะ ✨ วันนี้อยากให้ช่วยดูแลเรื่องอะไรดีคะ?',
                        voice: selVoice.value,
                        style: selVoiceStyle ? selVoiceStyle.value : (localStorage.getItem('core_tts_style') || 'natural')
                    })
                });
                if (!res.ok) throw new Error('TTS HTTP ' + res.status);
                const blob = await res.blob();
                testAudio = new Audio(URL.createObjectURL(blob));
                await testAudio.play();
                notify('✅ ทดสอบเสียงสำเร็จ');
            } catch (e) {
                notify('❌ ทดสอบเสียงไม่สำเร็จ: ' + e.message);
            }
        });

        document.getElementById('btn-set-save-memory')?.addEventListener('click', async () => {
            const res = await fetch('/api/gemini/memory', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memory: txtMemory.value })
            });
            const d = await res.json();
            notify(d.ok ? '🧠 บันทึกความจำระยะยาวเรียบร้อย' : '❌ บันทึกไม่สำเร็จ');
        });

        document.getElementById('btn-set-test-telegram')?.addEventListener('click', async () => {
            notify('✈️ กำลังส่งข้อความทดสอบเข้า Telegram...');
            try {
                const res = await fetch('/api/settings/telegram-test', { method: 'POST' });
                const d = await res.json();
                notify(d.ok ? '✅ ส่งข้อความเข้า Telegram สำเร็จ!' : '❌ ' + (d.error || 'ส่งไม่สำเร็จ'));
            } catch (e) {
                notify('❌ ' + e.message);
            }
        });

        initPrayerSettingsUI(notify);
        initFamilySettingsUI(notify);
    }
    if (typeof window._syncPrayerSettingsUI === 'function') window._syncPrayerSettingsUI();
    if (typeof window._syncFamilySettingsUI === 'function') window._syncFamilySettingsUI();

    fetch('/api/gemini/status').then(r => r.json()).then(d => {
        // เติมรายชื่อโมเดลจริงทั้งหมด (Auto + ทุกค่าย) และตั้งค่าตามที่บันทึกไว้บน server
        if (Array.isArray(d.models) && d.models.length) {
            selModel.innerHTML = '';
            d.models.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; selModel.appendChild(o); });
        }
        const wantModel = d.defaultModel || localStorage.getItem('core_default_model') || 'auto';
        if (d.defaultModel) localStorage.setItem('core_default_model', d.defaultModel);
        if ([...selModel.options].some(o => o.value === wantModel)) selModel.value = wantModel;
        if (authBadge) {
            if (d.hasAuth || d.hasKey) {
                authBadge.textContent = d.authType !== 'api-key' ? 'AUTH: ANTIGRAVITY OK' : 'AUTH: API KEY OK';
                authBadge.className = 'badge badge--ok';
            } else {
                authBadge.textContent = 'AUTH: NOT CONFIGURED';
                authBadge.className = 'badge badge--warn';
            }
        }
        if (Array.isArray(d.availableDirs) && d.availableDirs.length) {
            selCwd.innerHTML = d.availableDirs.map(dir => `<option value="${esc(dir)}">${esc(dir)}</option>`).join('');
            const savedCwd = localStorage.getItem('core_default_cwd') || d.defaultCwd || d.availableDirs[0];
            if ([...selCwd.options].some(o => o.value === savedCwd)) selCwd.value = savedCwd;
        }
    }).catch(() => {});

    let savedVoice = localStorage.getItem('core_tts_voice') || 'vachana:th_f_1';
    fetch('/api/tts/voices').then(r => r.json()).then(d => {
        if (d && d.ok && Array.isArray(d.voices)) {
            if (d.defaultVoice && localStorage.getItem('core_tts_v2_migrated') !== '1') {
                savedVoice = d.defaultVoice;
                localStorage.setItem('core_tts_voice', savedVoice);
                localStorage.setItem('core_tts_v2_migrated', '1');
            }
            selVoice.innerHTML = d.voices.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
            if ([...selVoice.options].some(o => o.value === savedVoice)) selVoice.value = savedVoice;
        }
    }).catch(() => {});

    fetch('/api/gemini/memory').then(r => r.json()).then(d => {
        if (txtMemory) txtMemory.value = d.memory || '';
    }).catch(() => {});
}

window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'open-settings') {
        switchView('settings');
    }
});

// ── Prayer Times Advanced Settings Controller ─────────────────────────────────
function initPrayerSettingsUI(notify) {
    const PRESET_COORDS = {
        'Bangkok': [13.7563, 100.5018],
        'Nonthaburi': [13.8621, 100.5144],
        'Pathum Thani': [14.0208, 100.5250],
        'Chonburi': [13.3611, 100.9847],
        'Chiang Mai': [18.7883, 98.9853],
        'Phuket': [7.8804, 98.3923],
        'Hat Yai': [7.0086, 100.4747],
        'Pattani': [6.8695, 101.2505],
        'Yala': [6.5411, 101.2804],
        'Narathiwat': [6.4255, 101.8253],
        'Nakhon Si Thammarat': [8.4304, 99.9631],
        'Krabi': [8.0863, 98.9063],
        'Satun': [6.6238, 100.0674]
    };
    const METHOD_NAMES = {
        0: 'Jafari', 1: 'Karachi', 2: 'ISNA', 3: 'MWL', 4: 'Makkah',
        5: 'Egypt', 11: 'MUIS', 13: 'Diyanet', 15: 'Moonsighting',
        17: 'JAKIM', 20: 'KEMENAG', 99: 'Custom'
    };
    const DEFAULTS = {
        city: 'Bangkok',
        lat: 13.7563,
        lon: 100.5018,
        tz: 7,
        method: 3,
        fajrAngle: 18,
        ishaAngle: 17,
        school: 0,
        highLat: 3,
        midnightMode: 0,
        hijriAdj: 0,
        tune: { Fajr: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 },
        showSunrise: false,
        timeFormat: '24h'
    };

    const $id = (id) => document.getElementById(id);
    const selCity = $id('set-prayer-city');
    if (!selCity) return;

    const inpLat = $id('set-prayer-lat');
    const inpLon = $id('set-prayer-lon');
    const inpTz = $id('set-prayer-tz');
    const selMethod = $id('set-prayer-method');
    const customRow = $id('prayer-custom-angles-row');
    const inpFajrAng = $id('set-prayer-fajr-angle');
    const inpIshaAng = $id('set-prayer-isha-angle');
    const selSchool = $id('set-prayer-school');
    const selHighLat = $id('set-prayer-highlat');
    const selMidnight = $id('set-prayer-midnight');
    const inpHijriAdj = $id('set-prayer-hijri-adj');
    const tuneAll = $id('set-prayer-tune-all');
    const tuneFajr = $id('set-prayer-tune-fajr');
    const tuneDhuhr = $id('set-prayer-tune-dhuhr');
    const tuneAsr = $id('set-prayer-tune-asr');
    const tuneMaghrib = $id('set-prayer-tune-maghrib');
    const tuneIsha = $id('set-prayer-tune-isha');
    const chkSunrise = $id('chk-prayer-sunrise');
    const selTimeFmt = $id('set-prayer-timefmt');
    const badge = $id('set-prayer-summary-badge');

    function readCfg() {
        try {
            const raw = localStorage.getItem('ov_prayer_settings_v1');
            if (raw) {
                const p = JSON.parse(raw);
                return { ...DEFAULTS, ...p, tune: { ...DEFAULTS.tune, ...(p.tune || {}) } };
            }
        } catch (_) {}
        const legacyCity = localStorage.getItem('ov_prayer_city');
        if (legacyCity && PRESET_COORDS[legacyCity]) {
            return { ...DEFAULTS, city: legacyCity, lat: PRESET_COORDS[legacyCity][0], lon: PRESET_COORDS[legacyCity][1] };
        }
        return { ...DEFAULTS };
    }

    function updateBadge(cfg) {
        if (!badge) return;
        const m = METHOD_NAMES[cfg.method] || 'MWL';
        const s = Number(cfg.school) === 1 ? 'Hanafi' : 'Shafi';
        const c = cfg.city === 'custom' ? `${Number(cfg.lat).toFixed(2)},${Number(cfg.lon).toFixed(2)}` : cfg.city;
        badge.textContent = `${m} · ${s} · ${c}`;
    }

    function syncUI() {
        const cfg = readCfg();
        selCity.value = PRESET_COORDS[cfg.city] ? cfg.city : 'custom';
        inpLat.value = cfg.lat;
        inpLon.value = cfg.lon;
        inpTz.value = cfg.tz;
        selMethod.value = String(cfg.method);
        inpFajrAng.value = cfg.fajrAngle;
        inpIshaAng.value = cfg.ishaAngle;
        customRow.style.display = Number(cfg.method) === 99 ? 'grid' : 'none';
        selSchool.value = String(cfg.school);
        selHighLat.value = String(cfg.highLat);
        selMidnight.value = String(cfg.midnightMode);
        inpHijriAdj.value = cfg.hijriAdj;
        tuneFajr.value = cfg.tune.Fajr || 0;
        tuneDhuhr.value = cfg.tune.Dhuhr || 0;
        tuneAsr.value = cfg.tune.Asr || 0;
        tuneMaghrib.value = cfg.tune.Maghrib || 0;
        tuneIsha.value = cfg.tune.Isha || 0;
        chkSunrise.checked = !!cfg.showSunrise;
        selTimeFmt.value = cfg.timeFormat || '24h';
        updateBadge(cfg);
    }

    function saveFromUI(msg) {
        const cfg = {
            city: selCity.value,
            lat: parseFloat(inpLat.value) || DEFAULTS.lat,
            lon: parseFloat(inpLon.value) || DEFAULTS.lon,
            tz: parseFloat(inpTz.value) ?? DEFAULTS.tz,
            method: parseInt(selMethod.value, 10),
            fajrAngle: parseFloat(inpFajrAng.value) || 18,
            ishaAngle: parseFloat(inpIshaAng.value) || 17,
            school: parseInt(selSchool.value, 10) || 0,
            highLat: parseInt(selHighLat.value, 10) || 3,
            midnightMode: parseInt(selMidnight.value, 10) || 0,
            hijriAdj: parseInt(inpHijriAdj.value, 10) || 0,
            tune: {
                Fajr: parseInt(tuneFajr.value, 10) || 0,
                Dhuhr: parseInt(tuneDhuhr.value, 10) || 0,
                Asr: parseInt(tuneAsr.value, 10) || 0,
                Maghrib: parseInt(tuneMaghrib.value, 10) || 0,
                Isha: parseInt(tuneIsha.value, 10) || 0
            },
            showSunrise: !!chkSunrise.checked,
            timeFormat: selTimeFmt.value || '24h'
        };
        try {
            localStorage.setItem('ov_prayer_settings_v1', JSON.stringify(cfg));
            if (cfg.city !== 'custom') localStorage.setItem('ov_prayer_city', cfg.city);
        } catch (_) {}
        updateBadge(cfg);
        window.dispatchEvent(new CustomEvent('prayer-settings-updated'));
        if (msg) notify(msg);
    }

    selCity.addEventListener('change', () => {
        if (PRESET_COORDS[selCity.value]) {
            const [lat, lon] = PRESET_COORDS[selCity.value];
            inpLat.value = lat;
            inpLon.value = lon;
        }
        saveFromUI('📍 อัปเดตตำแหน่งเวลาละหมาดแล้ว');
    });

    [inpLat, inpLon].forEach((el) => {
        el.addEventListener('change', () => {
            selCity.value = 'custom';
            saveFromUI('🎯 อัปเดตพิกัดเวลาละหมาดแล้ว');
        });
    });

    selMethod.addEventListener('change', () => {
        customRow.style.display = Number(selMethod.value) === 99 ? 'grid' : 'none';
        saveFromUI('🧭 บันทึกมาตรฐานการคำนวณเวลาละหมาดแล้ว');
    });

    [inpTz, inpFajrAng, inpIshaAng, selSchool, selHighLat, selMidnight, inpHijriAdj,
     tuneFajr, tuneDhuhr, tuneAsr, tuneMaghrib, tuneIsha, chkSunrise, selTimeFmt].forEach((el) => {
        el?.addEventListener('change', () => saveFromUI('☪️ บันทึกการตั้งค่าเวลาละหมาดแล้ว'));
    });

    $id('btn-prayer-apply-all')?.addEventListener('click', () => {
        const v = parseInt(tuneAll.value, 10) || 0;
        tuneFajr.value = v;
        tuneDhuhr.value = v;
        tuneAsr.value = v;
        tuneMaghrib.value = v;
        tuneIsha.value = v;
        saveFromUI(`⏱️ ปรับชดเชยทุกเวลา ${v >= 0 ? '+' : ''}${v} นาทีแล้ว`);
    });

    $id('btn-prayer-gps')?.addEventListener('click', () => {
        if (!navigator.geolocation) {
            notify('❌ เบราว์เซอร์ไม่รองรับ GPS');
            return;
        }
        notify('📡 กำลังดึงพิกัด GPS...');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                selCity.value = 'custom';
                inpLat.value = pos.coords.latitude.toFixed(4);
                inpLon.value = pos.coords.longitude.toFixed(4);
                saveFromUI('📡 อัปเดตพิกัดจาก GPS เรียบร้อยแล้ว');
            },
            (err) => notify('❌ ดึงพิกัด GPS ไม่สำเร็จ: ' + err.message),
            { timeout: 8000 }
        );
    });

    $id('btn-prayer-save')?.addEventListener('click', () => {
        saveFromUI('✅ บันทึกและคำนวณเวลาละหมาดใหม่เรียบร้อย');
    });

    $id('btn-prayer-reset')?.addEventListener('click', () => {
        try {
            localStorage.setItem('ov_prayer_settings_v1', JSON.stringify(DEFAULTS));
            localStorage.setItem('ov_prayer_city', DEFAULTS.city);
        } catch (_) {}
        syncUI();
        window.dispatchEvent(new CustomEvent('prayer-settings-updated'));
        notify('↺ คืนค่าตั้งต้นเวลาละหมาดแล้ว');
    });

    window._syncPrayerSettingsUI = syncUI;
    window.addEventListener('prayer-settings-updated', syncUI);
    syncUI();
}

// ── Warp FX Studio (Settings card #card-warp-studio) ────────────────────────
const warpEsc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function warpSceneLabel(name) {
    const scene = window.WarpFX && window.WarpFX.scenes[name];
    return scene ? scene.label : name;
}

// Preview a scene over the current view without changing pages (no stats recorded)
function previewWarp(sceneName) {
    if (!window.WarpFX) return null;
    if (state.warp) {
        if (!state.warp.preview) return null;
        window.WarpFX.finish();
    }
    const viewEl = document.querySelector('.lab-view.is-active');
    if (!viewEl) return null;
    const cfg = getWarpConfig();
    const name = sceneName || pickWarpScene(cfg, false);
    const w = state.warp = { preview: true, swapped: true };
    playViewWarp(viewEl, name, cfg, {
        swap: () => viewEl,
        done: () => { if (state.warp === w) state.warp = null; },
    });
    return name;
}

function refreshWarpStudio() {
    const card = document.getElementById('card-warp-studio');
    if (!card || !card.dataset.ready) return;
    const cfg = getWarpConfig();
    const names = warpSceneNames();
    const pool = warpPool(cfg);
    const $id = (id) => document.getElementById(id);

    $id('warp-enabled').checked = cfg.enabled;
    card.classList.toggle('is-disabled', !cfg.enabled);
    card.querySelectorAll('input[name="warp-mode"]').forEach((r) => { r.checked = r.value === cfg.mode; });
    card.querySelectorAll('input[name="warp-density"]').forEach((r) => { r.checked = Number(r.value) === Number(cfg.density); });
    $id('warp-duration').value = cfg.duration;
    $id('warp-duration-val').textContent = `${Number(cfg.duration).toFixed(1)} วิ`;
    card.querySelectorAll('[data-warp-duration]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.warpDuration) === Number(cfg.duration)));
    $id('warp-flash').value = Math.round(cfg.flash * 100);
    $id('warp-flash-val').textContent = `${Math.round(cfg.flash * 100)}%`;
    $id('warp-volume').value = Math.round(cfg.volume * 100);
    $id('warp-volume-val').textContent = `${Math.round(cfg.volume * 100)}%`;
    $id('warp-volume').disabled = !cfg.sound;
    $id('warp-sound').checked = cfg.sound;
    $id('warp-norepeat').checked = cfg.noRepeat;
    $id('warp-mobile-off').checked = cfg.disableMobile;
    $id('warp-reduced-motion').checked = cfg.respectReducedMotion;

    const hints = {
        random: 'สุ่มจากฉากที่เปิดไว้ ฉากที่น้ำหนักมากจะออกบ่อยกว่า',
        cycle: 'เล่นฉากที่เปิดไว้ทีละแบบเรียงตามลำดับ วนไปเรื่อยๆ (ไม่ใช้น้ำหนัก)',
        fixed: 'ใช้ฉากที่ปักหมุด 📌 ไว้แบบเดียวทุกครั้ง',
    };
    $id('warp-mode-hint').textContent = hints[cfg.mode] || '';

    const totalWeight = pool.reduce((a, n) => a + Math.max(0, Number(cfg.scenes[n].weight) || 0), 0);
    names.forEach((n) => {
        const el = card.querySelector(`.warp-scene[data-scene="${n}"]`);
        if (!el) return;
        const sc = cfg.scenes[n];
        const inPool = pool.includes(n) && sc.on;
        let prob = '';
        if (cfg.mode === 'fixed') prob = n === cfg.fixed ? '📌 100%' : '0%';
        else if (cfg.mode === 'cycle') prob = inPool ? `ลำดับ ${pool.indexOf(n) + 1}/${pool.length}` : 'ข้าม';
        else prob = inPool && totalWeight > 0 ? `${Math.round((sc.weight / totalWeight) * 100)}%` : '0%';
        el.querySelector('[data-role="prob"]').textContent = prob;
        el.querySelector('[data-role="on"]').checked = sc.on;
        el.querySelector('[data-role="on"]').disabled = cfg.mode === 'fixed';
        el.querySelector('[data-role="weight"]').value = sc.weight;
        el.querySelector('[data-role="weight"]').disabled = cfg.mode !== 'random' || !sc.on;
        el.querySelector('[data-role="weight-val"]').textContent = sc.weight;
        el.querySelector('[data-role="count"]').textContent = `เล่นแล้ว ${cfg.stats[n] || 0} ครั้ง`;
        el.classList.toggle('is-off', cfg.mode === 'fixed' ? n !== cfg.fixed : !sc.on);
        el.classList.toggle('is-pinned', cfg.mode === 'fixed' && n === cfg.fixed);
    });

    const badge = $id('warp-summary-badge');
    const modeText = { random: '🎲 สุ่ม', cycle: '🔁 วนลำดับ', fixed: '📌 แบบเดียว' }[cfg.mode] || '';
    const scope = cfg.mode === 'fixed' ? warpSceneLabel(cfg.fixed) : `${pool.length}/${names.length} ฉาก`;
    badge.textContent = cfg.enabled ? `${modeText} · ${scope} · ${Number(cfg.duration).toFixed(1)} วิ` : '⏸️ ปิดอยู่';
    badge.className = `badge ${cfg.enabled ? 'badge--ok' : ''}`;

    const total = names.reduce((a, n) => a + (cfg.stats[n] || 0), 0);
    $id('warp-stats-text').textContent = total
        ? `📊 สถิติการวาร์ป: ${names.map((n) => `${warpSceneLabel(n)} ${cfg.stats[n] || 0}`).join(' · ')} (รวม ${total} ครั้ง)`
        : '📊 ยังไม่มีสถิติการวาร์ป';
}

function initWarpStudio(notify) {
    const card = document.getElementById('card-warp-studio');
    const list = document.getElementById('warp-scenes');
    if (!card || !list || card.dataset.ready) return;
    const say = (msg) => { if (typeof notify === 'function') notify(msg); };
    const update = (fn, msg) => {
        const cfg = getWarpConfig();
        if (fn(cfg) === false) { refreshWarpStudio(); return; }
        saveWarpConfig(cfg);
        refreshWarpStudio();
        if (msg) say(typeof msg === 'function' ? msg(cfg) : msg);
    };

    list.innerHTML = warpSceneNames().map((n) => {
        const meta = WARP_SCENE_META[n] || { desc: '', grad: '#111' };
        return `
        <div class="warp-scene" data-scene="${warpEsc(n)}">
          <div class="warp-scene__thumb" style="background:${meta.grad}">
            <span class="warp-scene__prob" data-role="prob"></span>
          </div>
          <div class="warp-scene__body">
            <div class="warp-scene__title">${warpEsc(warpSceneLabel(n))}</div>
            <p class="warp-scene__desc">${warpEsc(meta.desc)}</p>
            <label class="warp-switch warp-switch--sm"><input type="checkbox" data-role="on" /><span class="warp-switch__track" aria-hidden="true"></span><span class="warp-switch__text">ใส่ในการสุ่ม</span></label>
            <label class="warp-scene__weight">น้ำหนัก <input type="range" min="1" max="5" step="1" data-role="weight" /><b data-role="weight-val"></b></label>
            <div class="warp-scene__actions">
              <button type="button" class="btn btn--sm" data-role="preview">▶ ดูตัวอย่าง</button>
              <button type="button" class="btn btn--sm btn--ghost" data-role="pin" title="ใช้ฉากนี้แบบเดียว">📌</button>
            </div>
            <small class="warp-scene__count" data-role="count"></small>
          </div>
        </div>`;
    }).join('');
    card.dataset.ready = '1';

    list.addEventListener('change', (ev) => {
        const sceneEl = ev.target.closest('.warp-scene');
        if (!sceneEl) return;
        const n = sceneEl.dataset.scene;
        const role = ev.target.dataset.role;
        if (role === 'on') {
            const on = ev.target.checked;
            update((cfg) => {
                cfg.scenes[n].on = on;
                if (!warpSceneNames().some((k) => cfg.scenes[k].on)) {
                    say('⚠️ ต้องเปิดไว้อย่างน้อย 1 ฉาก');
                    return false;
                }
                cfg.cycleIndex = 0;
                return true;
            }, `${on ? '✅ เพิ่ม' : '➖ เอาออก'} ${warpSceneLabel(n)} ${on ? 'เข้า' : 'จาก'}การสุ่ม`);
        } else if (role === 'weight') {
            update((cfg) => { cfg.scenes[n].weight = Number(ev.target.value); });
        }
    });
    list.addEventListener('input', (ev) => {
        if (ev.target.dataset.role !== 'weight') return;
        const n = ev.target.closest('.warp-scene').dataset.scene;
        update((cfg) => { cfg.scenes[n].weight = Number(ev.target.value); });
    });
    list.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-role]');
        if (!btn) return;
        const n = btn.closest('.warp-scene').dataset.scene;
        if (btn.dataset.role === 'preview') {
            previewWarp(n);
        } else if (btn.dataset.role === 'pin') {
            update((cfg) => { cfg.mode = 'fixed'; cfg.fixed = n; }, `📌 ใช้ ${warpSceneLabel(n)} แบบเดียว`);
        }
    });

    document.getElementById('warp-enabled').addEventListener('change', (ev) => {
        const on = ev.target.checked;
        update((cfg) => { cfg.enabled = on; }, on ? '🌀 เปิดเอฟเฟกต์วาร์ปเปลี่ยนหน้าแล้ว' : '⚡ ปิดเอฟเฟกต์วาร์ป (เปลี่ยนหน้าทันที)');
    });
    card.querySelectorAll('input[name="warp-mode"]').forEach((r) => r.addEventListener('change', () => {
        update((cfg) => { cfg.mode = r.value; cfg.cycleIndex = 0; }, `🎛️ โหมดวาร์ป: ${r.nextElementSibling.textContent}`);
    }));
    card.querySelectorAll('input[name="warp-density"]').forEach((r) => r.addEventListener('change', () => {
        update((cfg) => { cfg.density = Number(r.value); }, `✨ ความหนาแน่นอนุภาค: ${r.nextElementSibling.textContent}`);
    }));
    document.getElementById('warp-duration').addEventListener('input', (ev) => {
        update((cfg) => { cfg.duration = Number(ev.target.value); });
    });
    card.querySelectorAll('[data-warp-duration]').forEach((b) => b.addEventListener('click', () => {
        update((cfg) => { cfg.duration = Number(b.dataset.warpDuration); }, `⏱️ ความยาวฉากวาร์ป ${Number(b.dataset.warpDuration).toFixed(1)} วิ`);
    }));
    document.getElementById('warp-flash').addEventListener('input', (ev) => {
        update((cfg) => { cfg.flash = Number(ev.target.value) / 100; });
    });
    document.getElementById('warp-volume').addEventListener('input', (ev) => {
        update((cfg) => { cfg.volume = Number(ev.target.value) / 100; });
    });
    const toggles = {
        'warp-sound': ['sound', '🎵 เปิดเสียงประกอบวาร์ป', '🔇 ปิดเสียงประกอบวาร์ป'],
        'warp-norepeat': ['noRepeat', '🚫 ไม่สุ่มซ้ำแบบเดิมติดกัน', '🔂 อนุญาตให้สุ่มซ้ำติดกันได้'],
        'warp-mobile-off': ['disableMobile', '📱 ปิดวาร์ปบนจอเล็กแล้ว', '📱 เปิดวาร์ปบนจอเล็กแล้ว'],
        'warp-reduced-motion': ['respectReducedMotion', '♿ เคารพการตั้งค่า "ลดการเคลื่อนไหว" ของระบบ', '♿ เล่นวาร์ปแม้ระบบตั้ง "ลดการเคลื่อนไหว"'],
    };
    Object.entries(toggles).forEach(([id, [key, onMsg, offMsg]]) => {
        document.getElementById(id).addEventListener('change', (ev) => {
            const on = ev.target.checked;
            update((cfg) => { cfg[key] = on; }, on ? onMsg : offMsg);
        });
    });

    document.getElementById('btn-warp-test-random').addEventListener('click', () => {
        const name = previewWarp();
        if (name) say(`🎲 ทดสอบ: ${warpSceneLabel(name)}`);
    });
    document.getElementById('btn-warp-reset').addEventListener('click', () => {
        update((cfg) => {
            const stats = cfg.stats;
            Object.keys(cfg).forEach((k) => delete cfg[k]);
            Object.assign(cfg, defaultWarpConfig(), { stats });
        }, '↺ คืนค่าเอฟเฟกต์วาร์ปเป็นค่าเริ่มต้นแล้ว');
    });
    document.getElementById('btn-warp-stats-reset').addEventListener('click', () => {
        update((cfg) => { cfg.stats = {}; }, '🧹 ล้างสถิติการวาร์ปแล้ว');
    });

    refreshWarpStudio();
}

// ── AI thinking sound picker (Settings → Voice & UI) ───────────────────────
function initThinkSoundPicker(notify) {
    const sel = document.getElementById('set-think-sound');
    const btn = document.getElementById('btn-set-test-think');
    const desc = document.getElementById('set-think-sound-desc');
    const S = window.AiThinkSounds;
    if (!sel || !btn || !S) return;

    sel.innerHTML = Object.entries(S.themes)
        .map(([key, th]) => `<option value="${key}">${th.label}</option>`)
        .join('');
    sel.value = S.selected();
    const showDesc = () => { if (desc) desc.textContent = (S.themes[sel.value] || {}).desc || ''; };
    showDesc();

    let previewTimer = null;
    const resetBtn = () => {
        clearTimeout(previewTimer);
        btn.textContent = '▶ ทดลองฟัง';
    };
    const play = () => {
        const ctx = getAudioContext();
        if (!ctx || sel.value === 'none') { resetBtn(); return; }
        S.preview(ctx, sel.value, 5);
        btn.textContent = '⏹ หยุด';
        clearTimeout(previewTimer);
        previewTimer = setTimeout(resetBtn, 5300);
    };

    sel.addEventListener('change', () => {
        localStorage.setItem(S.KEY, sel.value);
        showDesc();
        notify(`🧠 เสียงตอน AI คิด: ${S.themes[sel.value].label}`);
        if (S.isPlaying()) play();
    });
    btn.addEventListener('click', () => {
        if (S.isPlaying()) {
            S.stop();
            resetBtn();
        } else {
            play();
        }
    });
}

// ── Family Mode Settings Controller ─────────────────────────────────────────
function initFamilySettingsUI(notify) {
    if (window._famInit) return;
    window._famInit = true;

    const card = document.getElementById('card-family-settings');
    if (!card) return;

    const chkEnabled = document.getElementById('fam-enabled');
    const statusBadge = document.getElementById('fam-status-badge');
    const verBadge = document.getElementById('fam-ver-badge');
    const inpUser = document.getElementById('fam-user');
    const inpPin = document.getElementById('fam-pin');
    const btnReveal = document.getElementById('btn-fam-reveal');
    const btnGen = document.getElementById('btn-fam-gen');
    const btnCopyPin = document.getElementById('btn-fam-copy-pin');
    const btnSave = document.getElementById('btn-fam-save');
    const btnRevoke = document.getElementById('btn-fam-revoke');
    const shareText = document.getElementById('fam-share-text');
    const btnCopyShare = document.getElementById('btn-fam-copy-share');
    const appsBox = document.getElementById('fam-apps');
    const btnAppsSave = document.getElementById('btn-fam-apps-save');

    const famState = {
        enabled: false,
        user: 'family',
        hasPin: false,
        pinPlain: '',
        loginUrl: window.location.origin,
        familyVer: '0',
        apps: []
    };

    async function copyText(text) {
        if (!text) return false;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (_) {}
        }
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (_) {
            return false;
        }
    }

    function generateClientPin(len = 6) {
        const buf = new Uint32Array(len);
        window.crypto.getRandomValues(buf);
        let out = '';
        for (let i = 0; i < len; i++) {
            out += String(buf[i] % 10);
        }
        return out;
    }

    function updateStatusUI() {
        if (statusBadge) {
            const on = !!chkEnabled?.checked;
            statusBadge.textContent = on ? 'เปิดใช้งาน' : 'ปิดอยู่';
            statusBadge.className = `badge ${on ? 'badge--ok' : 'badge--warn'}`;
        }
        if (verBadge) {
            verBadge.style.display = famState.familyVer ? '' : 'none';
            verBadge.textContent = `v${famState.familyVer || '0'}`;
        }
    }

    function getShareMessage() {
        const url = famState.loginUrl || window.location.origin;
        const typedPin = inpPin ? inpPin.value : '';
        const pinVal = typedPin || famState.pinPlain || (famState.hasPin ? '<รหัส PIN ที่ตั้งไว้>' : '<ยังไม่ได้ตั้ง PIN>');
        return `เข้า ${url} ใส่รหัส ${pinVal} ได้เลย`;
    }

    function updateShareUI() {
        if (shareText) {
            shareText.textContent = getShareMessage();
        }
    }

    function renderApps(apps) {
        if (!appsBox) return;
        const groups = new Map();
        (apps || []).forEach((a) => {
            const g = a.group || 'อื่นๆ';
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push(a);
        });
        if (!groups.size) {
            appsBox.innerHTML = '<div style="font-size:12px;color:var(--ink-muted);">ไม่พบรายการแอป</div>';
            return;
        }
        let html = '';
        groups.forEach((items, groupName) => {
            html += `<div style="padding:10px;border-radius:8px;border:1px solid var(--line, rgba(255,255,255,0.08));background:rgba(255,255,255,0.02);">`;
            html += `<div style="font-size:11px;font-weight:600;color:var(--ink-muted);margin-bottom:8px;">${esc(groupName)}</div>`;
            html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:8px;">`;
            items.forEach((a) => {
                const checked = a.family ? ' checked' : '';
                html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;padding:4px 6px;border-radius:6px;background:rgba(255,255,255,0.02);">` +
                    `<input type="checkbox" class="fam-app-chk" data-app-id="${esc(a.id)}"${checked} style="width:16px;height:16px;flex-shrink:0;" />` +
                    `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.emoji || '📱')} ${esc(a.label || a.id)}</span>` +
                    `</label>`;
            });
            html += `</div></div>`;
        });
        appsBox.innerHTML = html;
    }

    async function fetchRevealPin() {
        try {
            const res = await fetch('/api/settings/family?reveal=1');
            if (!res.ok) return '';
            const d = await res.json();
            if (d && d.ok && d.pinPlain) {
                famState.pinPlain = d.pinPlain;
                return d.pinPlain;
            }
        } catch (_) {}
        return '';
    }

    async function loadFamilySettings() {
        try {
            const res = await fetch('/api/settings/family');
            if (res.status === 403) {
                card.style.display = 'none';
                return;
            }
            if (!res.ok) {
                if (statusBadge) {
                    statusBadge.textContent = 'โหลดไม่สำเร็จ';
                    statusBadge.className = 'badge badge--warn';
                }
                return;
            }
            const d = await res.json();
            if (!d || !d.ok) return;

            card.style.display = '';
            famState.enabled = !!d.enabled;
            famState.user = d.user || 'family';
            famState.hasPin = !!d.hasPin;
            famState.pinPlain = d.pinPlain || '';
            famState.loginUrl = d.loginUrl || window.location.origin;
            famState.familyVer = String(d.familyVer ?? '0');
            famState.apps = Array.isArray(d.apps) ? d.apps : [];

            if (chkEnabled) chkEnabled.checked = famState.enabled;
            if (inpUser) inpUser.value = famState.user;
            if (inpPin) {
                inpPin.value = '';
                inpPin.type = 'password';
                inpPin.placeholder = famState.hasPin
                    ? (d.pinMasked || '•••••• (ตั้งไว้แล้ว กรอกใหม่เพื่อเปลี่ยน)')
                    : 'กรอก PIN 4–64 ตัว';
            }
            if (btnReveal) btnReveal.textContent = '👁 แสดง';

            updateStatusUI();
            updateShareUI();
            renderApps(famState.apps);
        } catch (_) {
            if (statusBadge) {
                statusBadge.textContent = 'เชื่อมต่อไม่ได้';
                statusBadge.className = 'badge badge--warn';
            }
        }
    }

    window._syncFamilySettingsUI = loadFamilySettings;

    chkEnabled?.addEventListener('change', () => {
        updateStatusUI();
    });

    inpPin?.addEventListener('input', () => {
        updateShareUI();
    });

    btnReveal?.addEventListener('click', async () => {
        if (!inpPin) return;
        if (inpPin.type === 'password') {
            if (!inpPin.value && famState.hasPin) {
                const plain = famState.pinPlain || await fetchRevealPin();
                if (plain) inpPin.value = plain;
            }
            inpPin.type = 'text';
            btnReveal.textContent = '🙈 ซ่อน';
            updateShareUI();
        } else {
            inpPin.type = 'password';
            btnReveal.textContent = '👁 แสดง';
        }
    });

    btnGen?.addEventListener('click', () => {
        if (!inpPin) return;
        const pin = generateClientPin(6);
        inpPin.value = pin;
        inpPin.type = 'text';
        if (btnReveal) btnReveal.textContent = '🙈 ซ่อน';
        updateShareUI();
        notify('🎲 สุ่มรหัส PIN 6 หลักแล้ว (กดบันทึกเพื่อใช้งาน)');
    });

    btnCopyPin?.addEventListener('click', async () => {
        let pin = inpPin ? inpPin.value : '';
        if (!pin && famState.hasPin) {
            pin = famState.pinPlain || await fetchRevealPin();
        }
        if (!pin) {
            notify('⚠️ ยังไม่มีรหัส PIN ให้คัดลอก');
            return;
        }
        const ok = await copyText(pin);
        notify(ok ? '📋 คัดลอกรหัส PIN แล้ว' : '⚠️ คัดลอกไม่สำเร็จ');
    });

    btnCopyShare?.addEventListener('click', async () => {
        if (!inpPin?.value && famState.hasPin && !famState.pinPlain) {
            await fetchRevealPin();
            updateShareUI();
        }
        const ok = await copyText(getShareMessage());
        notify(ok ? '📋 คัดลอกข้อความแชร์แล้ว' : '⚠️ คัดลอกไม่สำเร็จ');
    });

    btnSave?.addEventListener('click', async () => {
        const enabled = !!chkEnabled?.checked;
        const user = (inpUser?.value || '').trim() || 'family';
        const pin = inpPin ? inpPin.value : '';

        if (pin) {
            if (pin.length < 4 || pin.length > 64) {
                notify('❌ รหัส PIN ต้องมีความยาว 4–64 ตัวอักษร');
                return;
            }
            if (pin.trim() !== pin || /[\r\n]/.test(pin)) {
                notify('❌ รหัส PIN ห้ามมีช่องว่างหัวท้ายหรือขึ้นบรรทัดใหม่');
                return;
            }
        } else if (enabled && !famState.hasPin) {
            notify('❌ กรุณากรอกรหัส PIN อย่างน้อย 4 ตัว หรือกดสุ่ม PIN ก่อนเปิดใช้งาน');
            return;
        }

        const payload = { enabled, user };
        if (pin) payload.pin = pin;

        btnSave.disabled = true;
        try {
            const res = await fetch('/api/settings/family', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const d = await res.json();
            if (!res.ok || !d || !d.ok) {
                notify('❌ ' + ((d && d.error) || 'บันทึกบัญชีคนในบ้านไม่สำเร็จ'));
                return;
            }
            famState.enabled = !!d.enabled;
            famState.user = d.user || user;
            famState.familyVer = String(d.familyVer ?? famState.familyVer);
            if (d.pin) {
                famState.hasPin = true;
                famState.pinPlain = d.pin;
                if (inpPin) {
                    inpPin.value = d.pin;
                    inpPin.type = 'text';
                }
                if (btnReveal) btnReveal.textContent = '🙈 ซ่อน';
            } else if (!d.enabled) {
                famState.hasPin = false;
                famState.pinPlain = '';
                if (inpPin) {
                    inpPin.value = '';
                    inpPin.type = 'password';
                    inpPin.placeholder = 'กรอก PIN 4–64 ตัว';
                }
                if (btnReveal) btnReveal.textContent = '👁 แสดง';
            }
            if (chkEnabled) chkEnabled.checked = famState.enabled;
            if (inpUser) inpUser.value = famState.user;
            updateStatusUI();
            updateShareUI();
            notify(famState.enabled ? '✅ บันทึกและเปิดใช้งานบัญชีคนในบ้านแล้ว' : '✅ ปิดการใช้งานบัญชีคนในบ้านแล้ว');
        } catch (e) {
            notify('❌ บันทึกไม่สำเร็จ: ' + e.message);
        } finally {
            btnSave.disabled = false;
        }
    });

    btnRevoke?.addEventListener('click', async () => {
        if (!window.confirm('ยืนยันเตะทุกเครื่องของคนในบ้านออกจากระบบ?\nทุกคนที่ใช้บัญชีคนในบ้านจะต้องกรอก PIN ใหม่อีกครั้ง')) {
            return;
        }
        btnRevoke.disabled = true;
        try {
            const res = await fetch('/api/settings/family/revoke', { method: 'POST' });
            const d = await res.json();
            if (!res.ok || !d || !d.ok) {
                notify('❌ ' + ((d && d.error) || 'เตะเซสชันไม่สำเร็จ'));
                return;
            }
            famState.familyVer = String(d.familyVer ?? famState.familyVer);
            updateStatusUI();
            notify(`🚪 เตะทุกเครื่องของคนในบ้านออกแล้ว (v${famState.familyVer})`);
        } catch (e) {
            notify('❌ เตะเซสชันไม่สำเร็จ: ' + e.message);
        } finally {
            btnRevoke.disabled = false;
        }
    });

    btnAppsSave?.addEventListener('click', async () => {
        if (!appsBox) return;
        const apps = {};
        appsBox.querySelectorAll('.fam-app-chk').forEach((chk) => {
            const id = chk.dataset.appId;
            if (id) apps[id] = !!chk.checked;
        });
        btnAppsSave.disabled = true;
        try {
            const res = await fetch('/api/settings/family/apps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apps })
            });
            const d = await res.json();
            if (!res.ok || !d || !d.ok) {
                notify('❌ ' + ((d && d.error) || 'บันทึกรายการแอปไม่สำเร็จ'));
                return;
            }
            notify('✅ บันทึกสิทธิ์แอปที่คนในบ้านเห็นเรียบร้อย');
        } catch (e) {
            notify('❌ บันทึกรายการแอปไม่สำเร็จ: ' + e.message);
        } finally {
            btnAppsSave.disabled = false;
        }
    });
}

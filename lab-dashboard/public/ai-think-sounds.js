/* ── AI "thinking" sound themes ──────────────────────────────────────────────
 * Shared by gemini.html (plays while the AI works) and the Settings pages
 * (choose + preview). The choice lives in localStorage[AiThinkSounds.KEY].
 *
 *   AiThinkSounds.start(ctx, name, isActive)  begin intro + loop
 *   AiThinkSounds.stop(immediate)             fade out (or cut) the loop
 *   AiThinkSounds.preview(ctx, name, seconds) start, then stop after N s
 */
(function () {
  'use strict';

  const KEY = 'ai_thinking_sound';
  const DEFAULT = 'cosmic';

  let noiseBuf = null;
  function noise(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // One-shot oscillator with pitch glide and attack/decay envelope
  function tone(ctx, dest, t, type, f0, f1, peak, attack, decay) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  // Looping filtered noise bed; returns the source so the caller can stop it
  function noiseBed(ctx, dest, t, type, freq, q, level) {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    return { src, filter: f, gain: g };
  }

  // Slow LFO wired into an AudioParam
  function lfo(ctx, t, rate, depth, param) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = rate;
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start(t);
    return o;
  }

  const stopAll = (nodes) => nodes.forEach((n) => { try { n.stop(); } catch (_) { /* already stopped */ } });

  const themes = {
    // The original sound: warm space drone + crystalline telemetry pings
    cosmic: {
      label: '🌌 Cosmic Drone (เสียงเดิม)',
      desc: 'เสียงโดรนอวกาศอุ่นๆ พร้อมเสียงปิ๊งใสๆ ทุก 1 วินาที',
      intro(ctx, out, t) {
        [523.25, 659.25, 783.99, 987.77].forEach((f, i) => {
          tone(ctx, out, t + i * 0.055, 'sine', f, f * 1.12, 0.15 - i * 0.015, 0.025, 0.28);
          tone(ctx, out, t + i * 0.055, 'triangle', f * 0.5, f * 0.5, 0.06, 0.025, 0.28);
        });
      },
      loop(ctx, out, t, isActive) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        const pad = ctx.createGain();
        pad.gain.value = 0.055;
        filter.connect(pad).connect(out);
        const p1 = ctx.createOscillator();
        const p2 = ctx.createOscillator();
        p1.type = 'sine';
        p2.type = 'triangle';
        p1.frequency.value = 110;
        p2.frequency.value = 164.81;
        p1.connect(filter);
        p2.connect(filter);
        p1.start(t);
        p2.start(t);
        const l = lfo(ctx, t, 0.45, 160, filter.frequency);
        const scale = [659.25, 830.61, 987.77, 1174.66, 1318.51];
        let step = 0;
        const timer = setInterval(() => {
          if (!isActive()) return;
          const f = scale[step++ % scale.length];
          tone(ctx, out, ctx.currentTime, 'sine', f, f, 0.045, 0.03, 0.45);
        }, 1100);
        return () => { clearInterval(timer); stopAll([p1, p2, l]); };
      },
    },

    // Soft double heartbeat with neural sparks over a breathing noise bed
    pulse: {
      label: '🫀 Neural Heartbeat',
      desc: 'เสียงหัวใจเต้นทุ้มๆ ตึก-ตัก พร้อมประกายเซลล์ประสาท ให้ความรู้สึกว่า AI มีชีวิต',
      intro(ctx, out, t) {
        tone(ctx, out, t, 'sine', 220, 880, 0.08, 0.02, 0.22);
        tone(ctx, out, t + 0.05, 'triangle', 1760, 2640, 0.03, 0.01, 0.12);
      },
      loop(ctx, out, t, isActive) {
        const bed = noiseBed(ctx, out, t, 'lowpass', 520, 0.7, 0.025);
        const breath = lfo(ctx, t, 0.22, 0.018, bed.gain.gain);
        let beat = 0;
        const heartbeat = () => {
          if (!isActive()) return;
          const now = ctx.currentTime + 0.02;
          tone(ctx, out, now, 'sine', 72, 44, 0.42, 0.008, 0.2);
          tone(ctx, out, now + 0.24, 'sine', 62, 40, 0.3, 0.008, 0.22);
          if (beat++ % 2 === 0) {
            const f = 1600 + Math.random() * 1200;
            tone(ctx, out, now + 0.5, 'sine', f, f * 1.3, 0.025, 0.01, 0.14);
          }
        };
        heartbeat();
        const timer = setInterval(heartbeat, 1150);
        return () => { clearInterval(timer); stopAll([bed.src, breath]); };
      },
    },

    // Retro mainframe crunching data: soft random blips, disk ticks, low hum
    stream: {
      label: '💻 Data Stream',
      desc: 'เสียงคอมพิวเตอร์ยุคเก่ากำลังประมวลผล บี๊บๆ เบาๆ รัวๆ พร้อมเสียงจานหมุน',
      intro(ctx, out, t) {
        [784, 1046.5, 1568].forEach((f, i) => tone(ctx, out, t + i * 0.06, 'square', f, f, 0.035, 0.004, 0.05));
      },
      loop(ctx, out, t, isActive) {
        const hum = ctx.createGain();
        hum.gain.value = 0.012;
        hum.connect(out);
        const h1 = ctx.createOscillator();
        const h2 = ctx.createOscillator();
        h1.frequency.value = 100;
        h2.frequency.value = 150;
        h1.connect(hum);
        h2.connect(hum);
        h1.start(t);
        h2.start(t);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2600;
        lp.connect(out);
        const notes = [880, 1046.5, 1318.5, 1568, 1760, 2093];
        const timer = setInterval(() => {
          if (!isActive()) return;
          const now = ctx.currentTime;
          if (Math.random() < 0.65) {
            const f = notes[(Math.random() * notes.length) | 0] * (Math.random() < 0.2 ? 0.5 : 1);
            tone(ctx, lp, now, 'square', f, f, 0.024, 0.003, 0.045);
          }
          if (Math.random() < 0.1) {
            const src = ctx.createBufferSource();
            src.buffer = noise(ctx);
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 4200;
            bp.Q.value = 3;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(0.05, now + 0.002);
            g.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
            src.connect(bp).connect(g).connect(out);
            src.start(now, Math.random());
            src.stop(now + 0.03);
          }
        }, 95);
        return () => { clearInterval(timer); stopAll([h1, h2]); };
      },
    },

    // Meditative singing bowl struck every few seconds over a soft wind
    zen: {
      label: '🔔 Zen Singing Bowl',
      desc: 'เสียงขันทิเบตกังวานยาว ตีทุก 3 วินาที ผ่อนคลาย สงบ ไม่รบกวนสมาธิ',
      intro() { /* the first strike in loop() is the intro */ },
      loop(ctx, out, t, isActive) {
        const wind = noiseBed(ctx, out, t, 'bandpass', 700, 0.6, 0.012);
        const sway = lfo(ctx, t, 0.15, 260, wind.filter.frequency);
        const roots = [196, 233.08, 261.63, 220];
        let n = 0;
        const strike = () => {
          if (!isActive()) return;
          const now = ctx.currentTime + 0.02;
          const base = roots[n++ % roots.length];
          // Inharmonic bowl partials, each a detuned pair so they beat slowly
          [1, 2.71, 5.15, 8.1].forEach((k, i) => {
            const peak = 0.07 / Math.pow(i + 1, 0.8);
            const decay = 3.2 / (1 + i * 0.5);
            tone(ctx, out, now, 'sine', base * k, base * k, peak, 0.012, decay);
            tone(ctx, out, now, 'sine', base * k + 1.4, base * k + 1.4, peak * 0.7, 0.012, decay);
          });
          tone(ctx, out, now, 'triangle', 2400, 1800, 0.02, 0.002, 0.04);
        };
        strike();
        const timer = setInterval(strike, 3300);
        return () => { clearInterval(timer); stopAll([wind.src, sway]); };
      },
    },

    none: {
      label: '🔇 ไม่มีเสียงตอนคิด',
      desc: 'ปิดเฉพาะเสียงตอน AI คิด (เสียงเอฟเฟกต์อื่นยังทำงาน)',
    },
  };

  let current = null;

  function selected() {
    const v = localStorage.getItem(KEY);
    return themes[v] ? v : DEFAULT;
  }

  function stop(immediate = false) {
    if (!current) return;
    const { ctx, master, cleanup } = current;
    current = null;
    const end = () => {
      try { cleanup(); } catch (_) { /* ignore */ }
      try { master.disconnect(); } catch (_) { /* ignore */ }
    };
    if (immediate) { end(); return; }
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
    master.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    setTimeout(end, 350);
  }

  function start(ctx, name, isActive) {
    stop(true);
    const theme = themes[name] || themes[DEFAULT];
    if (!ctx || !theme.loop) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const active = typeof isActive === 'function' ? isActive : () => true;
    // Intro plays at full level; the loop fades in underneath it
    theme.intro(ctx, ctx.destination, t);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.exponentialRampToValueAtTime(1, t + 0.45);
    master.connect(ctx.destination);
    current = { ctx, master, cleanup: () => {} };
    const live = current;
    live.cleanup = theme.loop(ctx, master, t, () => current === live && active());
  }

  function preview(ctx, name, seconds = 4) {
    start(ctx, name);
    const mine = current;
    setTimeout(() => { if (current === mine) stop(); }, seconds * 1000);
  }

  window.AiThinkSounds = {
    KEY,
    themes,
    selected,
    start,
    stop,
    preview,
    isPlaying: () => Boolean(current),
  };
})();

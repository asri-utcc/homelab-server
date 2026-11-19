/* ── Warp FX: cinematic page-transition scenes (2D-canvas 3D renderer) ──────────
 * Usage: WarpFX.play({ scene, duration, onSwap, onEmerge, onDone })
 *   scene    – key of WarpFX.scenes ('blackhole' | 'supernova' | 'galaxy' | 'grid')
 *   onSwap   – fired when the old page is fully hidden (swap the views here)
 *   onEmerge – fired when the new page should start its entrance
 *   onDone   – fired when the overlay is gone
 * Each scene exposes swapAt / emergeAt (fractions of duration) so CSS view
 * animations and sounds can follow the same timeline.
 */
(function initWarpFX() {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const easeIn = (t) => t * t * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const color = (hue, l, a) => (hue < 0 ? `rgba(255,255,255,${a})` : `hsla(${hue},100%,${l}%,${a})`);
  const rand = (a, b) => a + Math.random() * (b - a);

  let canvas = null;
  let ctx = null;
  let W = 0, H = 0, cx = 0, cy = 0, halfDiag = 0, minSide = 0, mobile = false;
  let raf = 0;
  let run = null;
  let density = 1;   // particle-count multiplier (settings: economy / standard / ultra)
  let flashScale = 1; // 0 = no white flashes (a dark cover is used instead), 1 = full
  const count = (n) => Math.max(8, Math.round(n * density));

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'warp-fx-canvas';
    canvas.className = 'warp-fx';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2;
    cy = H / 2;
    halfDiag = Math.hypot(W, H) / 2;
    minSide = Math.min(W, H);
    mobile = W < 700;
  }

  function fillRadial(x, y, r, stops) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function line(x0, y0, x1, y1, style, width) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Full-screen flash; with a dimmed flash setting the missing brightness becomes a dark
  // cover so scenes that rely on the flash to hide the view swap still stay covered
  function flash(alpha, rgb = '235,248,255') {
    if (alpha <= 0.01) return;
    ctx.globalCompositeOperation = 'source-over';
    if (flashScale < 1) {
      ctx.fillStyle = `rgba(8,4,20,${alpha * (1 - flashScale)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (flashScale > 0) {
      ctx.fillStyle = `rgba(${rgb},${alpha * flashScale})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Radial sparks shared by several scenes
  function makeSparks(n, speedMin, speedMax, hueFn) {
    return Array.from({ length: n }, () => {
      const a = Math.random() * TAU;
      const v = rand(speedMin, speedMax);
      return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: rand(0.6, 1.6), hue: hueFn(), size: rand(1, 3.2) };
    });
  }

  function drawSparks(sparks, dt) {
    ctx.globalCompositeOperation = 'lighter';
    for (const s of sparks) {
      if (s.life <= 0) continue;
      const px = s.x, py = s.y;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 1 - dt * 0.8;
      s.vy *= 1 - dt * 0.8;
      s.life -= s.decay * dt;
      line(px, py, s.x, s.y, color(s.hue, 72, Math.max(0, s.life)), s.size);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Scene 1: Black Hole → Hyperspace Tunnel → White Hole
  // ═════════════════════════════════════════════════════════════════════════
  const blackhole = (() => {
    const SWAP = 0.40;
    const OUT = 0.70;
    const DISK_TILT = -0.16;
    const DISK_FLAT = 0.2;
    let infall = [], diskDots = [], stars = [], sparks = [];

    const spawnInfall = (anywhere) => ({
      r: anywhere ? rand(0.25, 1.25) : rand(0.95, 1.35),
      a: Math.random() * TAU,
      hue: rand(190, 320),
      size: rand(0.6, 2.4),
      spin: rand(0.7, 1.3),
    });

    const spawnStar = (anywhere) => {
      const ang = Math.random() * TAU;
      const rad = 0.06 + Math.pow(Math.random(), 0.7) * 1.1;
      return {
        x: Math.cos(ang) * rad,
        y: Math.sin(ang) * rad,
        z: anywhere ? rand(0.05, 1) : rand(0.85, 1),
        hue: Math.random() < 0.25 ? -1 : rand(175, 315),
      };
    };

    function drawDiskHalf(R, k, back) {
      const bands = [
        [1.35, 'rgba(255,255,255,', 0.95, 0.10],
        [1.6, 'rgba(165,243,252,', 0.85, 0.12],
        [1.95, 'rgba(56,189,248,', 0.70, 0.16],
        [2.4, 'rgba(129,140,248,', 0.55, 0.20],
        [2.95, 'rgba(192,132,252,', 0.38, 0.26],
        [3.6, 'rgba(236,72,153,', 0.20, 0.34],
      ];
      const from = back ? Math.PI : 0;
      const to = back ? TAU : Math.PI;
      for (const [rho, rgb, alpha, width] of bands) {
        const rx = rho * R;
        // Doppler beaming: the approaching (left) side is brighter
        const g = ctx.createLinearGradient(-rx, 0, rx, 0);
        g.addColorStop(0, `${rgb}${alpha * k})`);
        g.addColorStop(0.5, `${rgb}${alpha * 0.7 * k})`);
        g.addColorStop(1, `${rgb}${alpha * 0.22 * k})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = width * R * DISK_FLAT * 2.2;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, rx * DISK_FLAT, 0, from, to);
        ctx.stroke();
      }
      for (const d of diskDots) {
        const s = Math.sin(d.th);
        if ((s < 0) !== back) continue;
        const x = Math.cos(d.th) * d.rho * R;
        const y = s * d.rho * R * DISK_FLAT;
        const beam = 0.45 + 0.55 * (1 - (Math.cos(d.th) + 1) / 2);
        ctx.fillStyle = color(d.hue, 80, 0.9 * k * beam);
        ctx.fillRect(x, y, d.size, d.size);
      }
    }

    function drawBlackHole(R, k, time) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(DISK_TILT);
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * 5);
      halo.addColorStop(0, `rgba(168,85,247,${0.45 * k})`);
      halo.addColorStop(0.3, `rgba(56,189,248,${0.16 * k})`);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, R * 5, 0, TAU);
      ctx.fill();

      drawDiskHalf(R, k, true);

      // Gravitationally lensed back side of the disk wrapping over/under the shadow
      const pulse = 1 + Math.sin(time * 9) * 0.04;
      for (const [rr, lw, rgb, a] of [
        [1.28, 0.34, '139,92,246', 0.55],
        [1.14, 0.18, '56,189,248', 0.85],
        [1.05, 0.07, '255,255,255', 1.0],
      ]) {
        ctx.lineWidth = lw * R * pulse;
        ctx.strokeStyle = `rgba(${rgb},${a * k})`;
        ctx.beginPath();
        ctx.arc(0, 0, rr * R, 0, TAU);
        ctx.stroke();
      }

      // Event horizon
      ctx.globalCompositeOperation = 'source-over';
      const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      shadow.addColorStop(0, '#000');
      shadow.addColorStop(0.92, '#000');
      shadow.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fill();

      ctx.globalCompositeOperation = 'lighter';
      drawDiskHalf(R, k, false);
      ctx.restore();
    }

    function drawCollapse(p, dt, time) {
      const baseR = minSide * 0.085;
      const grow = easeOut(seg(p, 0, 0.5));
      const swallow = easeIn(seg(p, 0.58, 1));
      const R = Math.max(1, baseR * grow + (halfDiag * 1.15 - baseR) * swallow);

      ctx.globalCompositeOperation = 'source-over';
      const dim = 0.86 * easeInOut(seg(p, 0, 0.55));
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
      bg.addColorStop(0, `rgba(10,2,30,${dim})`);
      bg.addColorStop(1, `rgba(1,0,8,${Math.min(1, dim * 1.1)})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Matter spiralling in (spaghettified streaks)
      const pull = 0.25 + 2.2 * p * p;
      const horizon = R / halfDiag;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const m of infall) {
        if (m.r < 0) continue;
        const px = cx + Math.cos(m.a) * m.r * halfDiag;
        const py = cy + Math.sin(m.a) * m.r * halfDiag * 0.82;
        m.a += dt * m.spin * (0.9 + 3 * p) * 0.32 / (m.r + 0.06);
        m.r -= dt * pull * (0.35 + 0.22 / (m.r + 0.04));
        if (m.r < horizon * 0.95) {
          if (p < 0.8) Object.assign(m, spawnInfall(false));
          else m.r = -1;
          continue;
        }
        const nx = cx + Math.cos(m.a) * m.r * halfDiag;
        const ny = cy + Math.sin(m.a) * m.r * halfDiag * 0.82;
        const heat = clamp(1 - m.r, 0, 1);
        line(px, py, nx, ny, color(m.hue, 55 + heat * 40, (0.25 + heat * 0.75) * seg(p, 0, 0.15)), m.size * (0.6 + heat * 1.4));
      }

      for (const d of diskDots) d.th += dt * (2.2 + 4 * p) / Math.pow(d.rho, 1.5);
      drawBlackHole(R, clamp(seg(p, 0, 0.2) * (1 - seg(p, 0.85, 1) * 0.5), 0, 1), time);
    }

    function drawTunnelBackground(alpha) {
      ctx.globalCompositeOperation = 'source-over';
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
      bg.addColorStop(0, `rgba(36,10,80,${alpha})`);
      bg.addColorStop(0.45, `rgba(8,4,32,${alpha})`);
      bg.addColorStop(1, `rgba(0,0,6,${alpha})`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    }

    function drawTunnel(q, dt, time, fade) {
      const F = halfDiag * 0.28;
      const speed = lerp(0.5, 3.4, easeInOut(Math.min(1, q * 1.2))) * (1 + fade * 1.5);
      const shake = (1 - fade) * Math.sin(q * Math.PI) * 5;
      const ox = cx + (Math.random() - 0.5) * shake;
      const oy = cy + (Math.random() - 0.5) * shake;
      ctx.globalCompositeOperation = 'lighter';

      // Spinning cyber rings rushing past the camera
      for (let i = 0; i < 12; i++) {
        let z = ((i / 12) - time * speed * 0.18) % 1;
        if (z <= 0) z += 1;
        const r = (F * 1.8) / (z + 0.02);
        if (r > halfDiag * 2.2) continue;
        const a = Math.min(1, (1 - z) * 1.4) * 0.5 * (1 - fade);
        const hue = lerp(280, 185, q) + i * 6;
        const segs = 10;
        const rot = time * (i % 2 ? 1.6 : -1.3) + i;
        ctx.strokeStyle = `hsla(${hue},100%,65%,${a})`;
        ctx.lineWidth = Math.max(1, 5 / (z + 0.15));
        for (let s = 0; s < segs; s++) {
          const a0 = rot + (s / segs) * TAU;
          ctx.beginPath();
          ctx.arc(ox, oy, r, a0, a0 + (TAU / segs) * 0.62);
          ctx.stroke();
        }
      }

      // Star streaks
      const tail = 0.05 + speed * 0.03;
      for (const s of stars) {
        if (s.z < 0) continue;
        s.z -= dt * speed * 0.55;
        if (s.z < 0.015) {
          if (fade > 0.4) { s.z = -1; continue; }
          Object.assign(s, spawnStar(false));
        }
        const zt = s.z + tail;
        const near = clamp(1 - s.z, 0, 1);
        line(ox + (s.x / zt) * F, oy + (s.y / zt) * F, ox + (s.x / s.z) * F, oy + (s.y / s.z) * F,
          color(s.hue < 0 ? -1 : s.hue + q * 40, 70, (0.2 + near * 0.8) * (1 - fade)), 0.5 + near * near * 3.2);
      }

      // Destination light at the end of the tunnel
      const coreR = minSide * lerp(0.05, 0.22, easeIn(q)) * (1 + Math.sin(time * 14) * 0.06);
      fillRadial(ox, oy, coreR * 3, [
        [0, `rgba(255,255,255,${0.95 * (1 - fade)})`],
        [0.2, `rgba(165,243,252,${0.7 * (1 - fade)})`],
        [0.55, `rgba(139,92,246,${0.25 * (1 - fade)})`],
        [1, 'rgba(0,0,0,0)'],
      ]);
    }

    function drawEmerge(e, dt, time) {
      drawTunnelBackground(1 - easeOut(seg(e, 0.05, 0.8)));

      // Iris opening from the centre
      const open = easeOut(seg(e, 0, 0.75)) * halfDiag * 1.3;
      if (open > 1) {
        ctx.globalCompositeOperation = 'destination-out';
        fillRadial(cx, cy, open, [[0, 'rgba(0,0,0,1)'], [0.55, 'rgba(0,0,0,1)'], [1, 'rgba(0,0,0,0)']]);
      }

      drawTunnel(1, dt, time, seg(e, 0, 0.5));

      // Chromatic shockwave
      ctx.globalCompositeOperation = 'lighter';
      const sw = easeOut(e) * halfDiag * 1.4;
      for (const [off, rgb] of [[-7, '255,60,140'], [0, '80,255,220'], [7, '110,120,255']]) {
        ctx.strokeStyle = `rgba(${rgb},${(1 - e) * 0.75})`;
        ctx.lineWidth = Math.max(1, 34 * (1 - e));
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, sw + off), 0, TAU);
        ctx.stroke();
      }
      drawSparks(sparks, dt);
      flash(Math.pow(1 - seg(e, 0, 0.32), 2) * 0.92);
    }

    return {
      label: '🕳️ Black Hole',
      swapAt: SWAP,
      emergeAt: OUT,
      seed() {
        infall = Array.from({ length: count(mobile ? 380 : 720) }, () => spawnInfall(true));
        diskDots = Array.from({ length: count(mobile ? 260 : 480) }, () => ({
          rho: 1.35 + Math.pow(Math.random(), 1.6) * 2.6,
          th: Math.random() * TAU,
          size: rand(0.6, 2.2),
          hue: rand(180, 300),
        }));
        stars = Array.from({ length: count(mobile ? 520 : 1000) }, () => spawnStar(true));
        sparks = [];
      },
      emerge() {
        sparks = makeSparks(count(mobile ? 90 : 180), 200, 1500, () => (Math.random() < 0.3 ? -1 : rand(170, 320)));
      },
      draw(t, dt, time) {
        if (t < SWAP) drawCollapse(t / SWAP, dt, time);
        else if (t < OUT) {
          drawTunnelBackground(1);
          drawTunnel(seg(t, SWAP, OUT), dt, time, 0);
        } else drawEmerge(seg(t, OUT, 1), dt, time);
      },
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // Scene 2: Supernova — a star ignites, implodes, detonates; the new page
  //          condenses out of the glowing nebula while a pulsar sweeps
  // ═════════════════════════════════════════════════════════════════════════
  const supernova = (() => {
    const DET = 0.30;
    const SWAP = 0.46;
    const OUT = 0.62;
    let bgStars = [], gas = [], ejecta = [], clouds = [], sparks = [];

    return {
      label: '💥 Supernova',
      swapAt: SWAP,
      emergeAt: OUT,
      seed() {
        bgStars = Array.from({ length: count(mobile ? 140 : 300) }, () => ({ x: Math.random() * W, y: Math.random() * H, s: rand(0.4, 1.8), tw: Math.random() * TAU }));
        gas = Array.from({ length: count(mobile ? 240 : 460) }, () => ({ a: Math.random() * TAU, r: rand(0.15, 1.1), hue: rand(10, 55), size: rand(0.8, 2.6), spin: rand(0.6, 1.4) }));
        const pal = [18, 30, 42, 52, 0, 335, 195, 265];
        ejecta = Array.from({ length: count(mobile ? 560 : 1200) }, () => {
          const u = Math.random() * 2 - 1;
          const th = Math.random() * TAU;
          const s = Math.sqrt(1 - u * u);
          const fast = Math.random() < 0.35;
          return {
            dx: s * Math.cos(th), dy: s * Math.sin(th), dz: u,
            v: fast ? rand(0.95, 1.6) : rand(0.35, 0.95),
            hue: Math.random() < 0.15 ? -1 : pal[(Math.random() * pal.length) | 0],
            size: rand(0.8, 3),
            px: cx, py: cy,
          };
        });
        clouds = Array.from({ length: 18 }, (_, i) => ({
          a: (i / 18) * TAU + rand(-0.3, 0.3),
          d: rand(0.1, 0.55),
          r: rand(0.22, 0.5),
          hue: [12, 28, 335, 285, 200, 45][i % 6],
        }));
        sparks = [];
      },
      emerge() {
        sparks = makeSparks(count(mobile ? 60 : 120), 150, 900, () => (Math.random() < 0.4 ? -1 : rand(15, 55)));
      },
      draw(t, dt, time) {
        const u = seg(t, DET, 1);
        const expand = easeOut(u);
        const fadeOutAll = 1 - seg(t, 0.82, 1);

        // Background: dim → opaque nebula space → veil lifts
        const base = 0.9 * easeInOut(seg(t, 0, 0.18));
        const opaque = seg(t, DET, DET + 0.08);
        const veil = 1 - easeOut(seg(t, OUT, 0.95));
        const bgA = Math.max(base, opaque) * (t >= OUT ? veil : 1);
        ctx.globalCompositeOperation = 'source-over';
        const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
        bg.addColorStop(0, `rgba(${Math.round(lerp(14, 60, opaque))},${Math.round(lerp(4, 16, opaque))},${Math.round(lerp(30, 24, opaque))},${bgA})`);
        bg.addColorStop(1, `rgba(3,1,10,${bgA})`);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        ctx.globalCompositeOperation = 'lighter';
        for (const s of bgStars) {
          const a = (0.35 + 0.65 * Math.abs(Math.sin(time * 3 + s.tw))) * Math.min(base, veil + (t < OUT ? 1 : 0));
          ctx.fillStyle = `rgba(255,240,220,${a * 0.8})`;
          ctx.fillRect(s.x, s.y, s.s, s.s);
        }

        if (t < DET) {
          // Ignition: the star swells, flickers, sucks in gas, then implodes
          const p = t / DET;
          const swell = easeOut(seg(p, 0, 0.6));
          const implode = easeIn(seg(p, 0.78, 1));
          const unstable = seg(p, 0.4, 1);
          const wobble = 1 + Math.sin(time * 38) * 0.06 * unstable + Math.sin(time * 23) * 0.04 * unstable;
          const Rc = Math.max(1, minSide * (0.02 + 0.07 * swell) * (1 - implode * 0.88) * wobble);

          for (const g of gas) {
            const px = cx + Math.cos(g.a) * g.r * halfDiag;
            const py = cy + Math.sin(g.a) * g.r * halfDiag;
            g.a += dt * g.spin * (0.6 + 2.5 * p) * 0.25 / (g.r + 0.05);
            g.r -= dt * (0.08 + 1.8 * p * p) * (0.3 + 0.1 / (g.r + 0.03));
            if (g.r < Rc / halfDiag) g.r = rand(0.7, 1.1);
            const nx = cx + Math.cos(g.a) * g.r * halfDiag;
            const ny = cy + Math.sin(g.a) * g.r * halfDiag;
            line(px, py, nx, ny, color(g.hue, 60, 0.55 * seg(p, 0, 0.2)), g.size);
          }

          // Corona rays
          const rays = 28;
          for (let i = 0; i < rays; i++) {
            const a = (i / rays) * TAU + time * 0.6;
            const len = Rc * (2.2 + 1.6 * Math.abs(Math.sin(time * 7 + i * 1.7))) * (1 + unstable);
            line(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len, `rgba(255,${180 + (i % 3) * 25},90,${0.25 * seg(p, 0, 0.2)})`, Rc * 0.12 + 1);
          }
          fillRadial(cx, cy, Rc * 6, [
            [0, `rgba(255,255,255,${0.95 * seg(p, 0, 0.1)})`],
            [0.12, 'rgba(255,236,170,0.9)'],
            [0.3, 'rgba(255,140,40,0.5)'],
            [0.6, 'rgba(220,40,80,0.18)'],
            [1, 'rgba(0,0,0,0)'],
          ]);
          // The implosion pulse right before detonation
          fillRadial(cx, cy, Rc * 2.2, [[0, `rgba(255,255,255,${implode})`], [1, 'rgba(255,255,255,0)']]);
          return;
        }

        // Nebula clouds (behind everything else)
        for (const c of clouds) {
          const d = c.d * expand * halfDiag * 1.1;
          const r = c.r * minSide * (0.4 + expand * 1.6);
          const a = 0.2 * seg(u, 0, 0.1) * fadeOutAll;
          fillRadial(cx + Math.cos(c.a + time * 0.1) * d, cy + Math.sin(c.a + time * 0.1) * d, r, [
            [0, `hsla(${c.hue},95%,60%,${a})`],
            [0.5, `hsla(${c.hue + 20},90%,45%,${a * 0.45})`],
            [1, 'rgba(0,0,0,0)'],
          ]);
        }

        // Ejecta: 3D shell of debris flying out of the blast
        const shellR = halfDiag * 1.45 * expand;
        for (const e of ejecta) {
          const depth = 1 / (1 - e.dz * 0.4 * expand);
          const x = cx + e.dx * e.v * shellR * depth;
          const y = cy + e.dy * e.v * shellR * depth;
          const a = (1 - seg(u, 0.45, 1)) * (0.5 + 0.5 * depth);
          line(e.px, e.py, x, y, color(e.hue, lerp(95, 62, seg(u, 0, 0.3)), a), e.size * depth);
          e.px = x;
          e.py = y;
        }

        // Twin shockwaves
        for (const [lag, rgb, w] of [[1, '255,210,140', 46], [0.72, '120,200,255', 26]]) {
          const r = easeOut(seg(u, 0, 0.8)) * halfDiag * 1.6 * lag;
          ctx.strokeStyle = `rgba(${rgb},${(1 - seg(u, 0, 0.8)) * 0.8})`;
          ctx.lineWidth = Math.max(1, w * (1 - u));
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(1, r), 0, TAU);
          ctx.stroke();
        }

        // Pulsar remnant with sweeping beams
        if (t > SWAP - 0.05) {
          const pa = seg(t, SWAP - 0.05, SWAP + 0.05) * fadeOutAll;
          const ang = time * 7;
          for (const dir of [0, Math.PI]) {
            const a = ang + dir;
            const len = halfDiag * 1.2;
            const spread = 0.07;
            const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
            g.addColorStop(0, `rgba(190,240,255,${0.55 * pa})`);
            g.addColorStop(1, 'rgba(120,160,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a - spread) * len, cy + Math.sin(a - spread) * len);
            ctx.lineTo(cx + Math.cos(a + spread) * len, cy + Math.sin(a + spread) * len);
            ctx.closePath();
            ctx.fill();
          }
          fillRadial(cx, cy, minSide * 0.05, [[0, `rgba(255,255,255,${pa})`], [0.3, `rgba(160,220,255,${0.6 * pa})`], [1, 'rgba(0,0,0,0)']]);
        }

        drawSparks(sparks, dt);

        // Detonation flash (peaks just after DET) + soft second flash at emerge
        const det = seg(t, DET, DET + 0.015) * (1 - easeOut(seg(t, DET + 0.015, DET + 0.2)));
        flash(det * 0.95, '255,244,225');
        flash(Math.pow(1 - seg(t, OUT, OUT + 0.1), 2) * 0.5 * (t >= OUT ? 1 : 0), '255,236,200');
      },
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // Scene 3: Galaxy Dive — the page lies down into a spiral galaxy, the camera
  //          dives into the golden core and pulls back out of a new galaxy
  // ═════════════════════════════════════════════════════════════════════════
  const galaxy = (() => {
    const SWAP = 0.5;
    const OUT = 0.62;
    let gstars = [], dust = [];

    function project(s, D, tilt, roll, spinT, F) {
      const phi = s.th + spinT / (s.rr + 0.15);
      const X = s.rr * Math.cos(phi);
      const Zg = s.rr * Math.sin(phi);
      const Y = s.h;
      const Yt = Y * Math.cos(tilt) - Zg * Math.sin(tilt);
      const Zt = Y * Math.sin(tilt) + Zg * Math.cos(tilt);
      const depth = Zt + D;
      if (depth < 0.02) return null;
      const x = (X / depth) * F;
      const y = (Yt / depth) * F;
      const cr = Math.cos(roll), sr = Math.sin(roll);
      return { x: cx + x * cr - y * sr, y: cy + x * sr + y * cr, depth };
    }

    function drawGalaxy(D, tilt, roll, spinT, alpha, streak) {
      const F = minSide * 0.95;
      ctx.globalCompositeOperation = 'lighter';
      // Core bulge glow
      const coreR = Math.min(halfDiag * 4, (F * 0.22) / Math.max(0.02, D));
      fillRadial(cx, cy, coreR, [
        [0, `rgba(255,250,235,${0.9 * alpha})`],
        [0.15, `rgba(255,214,140,${0.55 * alpha})`],
        [0.45, `rgba(240,120,90,${0.16 * alpha})`],
        [1, 'rgba(0,0,0,0)'],
      ]);
      for (const s of gstars) {
        const p = project(s, D, tilt, roll, spinT, F);
        if (!p) { s.px = null; continue; }
        const size = clamp(s.size * (1.6 / p.depth), 0.4, 7);
        const a = alpha * clamp(1.4 - p.depth * 0.12, 0.25, 1);
        if (streak && s.px !== null && Math.abs(p.x - s.px) + Math.abs(p.y - s.py) < halfDiag * 0.6) {
          line(s.px, s.py, p.x, p.y, color(s.hue, s.l, a), size);
        } else {
          ctx.fillStyle = color(s.hue, s.l, a);
          ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        }
        s.px = p.x;
        s.py = p.y;
      }
    }

    return {
      label: '🌌 Galaxy Dive',
      swapAt: SWAP,
      emergeAt: OUT,
      seed() {
        gstars = Array.from({ length: count(mobile ? 1000 : 2000) }, () => {
          const bulge = Math.random() < 0.2;
          if (bulge) {
            const rr = Math.pow(Math.random(), 2) * 0.22;
            return { rr, th: Math.random() * TAU, h: (Math.random() - 0.5) * 0.14 * (1 - rr * 3), hue: rand(35, 50), l: 78, size: rand(0.6, 1.8), px: null, py: null };
          }
          const rr = 0.08 + Math.pow(Math.random(), 0.85) * 0.92;
          const arm = ((Math.random() * 3) | 0) * (TAU / 3);
          const pick = Math.random();
          return {
            rr,
            th: arm + rr * 5.2 + (Math.random() - 0.5) * (0.35 + rr * 0.7),
            h: (Math.random() - 0.5) * 0.035,
            hue: pick < 0.1 ? rand(315, 340) : pick < 0.22 ? -1 : rand(195, 235),
            l: pick < 0.1 ? 68 : 74,
            size: rand(0.6, 2.2),
            px: null, py: null,
          };
        });
        dust = Array.from({ length: count(mobile ? 260 : 520) }, () => ({
          x: rand(-1.2, 1.2), y: rand(-1.2, 1.2), z: rand(0.05, 1),
          hue: Math.random() < 0.5 ? rand(35, 50) : rand(195, 235),
        }));
      },
      draw(t, dt, time) {
        ctx.globalCompositeOperation = 'source-over';
        if (t < SWAP) {
          // Approach: galaxy fades in far away, then the camera dives into the core
          const appear = easeOut(seg(t, 0, 0.16));
          const dive = easeIn(seg(t, 0.12, SWAP));
          const D = lerp(lerp(9, 2.6, appear), 0.03, dive);
          const tilt = lerp(1.05, 1.5, easeInOut(seg(t, 0.1, SWAP)));
          const roll = time * 0.35 + dive * 1.6;
          const dim = 0.9 * easeInOut(seg(t, 0, 0.2));
          const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
          bg.addColorStop(0, `rgba(18,8,40,${dim})`);
          bg.addColorStop(1, `rgba(2,1,10,${dim})`);
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, W, H);
          drawGalaxy(D, tilt, roll, time * (0.25 + dive * 1.5), appear, dive > 0.15);
          flash(easeIn(seg(t, 0.38, SWAP)), '255,240,210');
          return;
        }

        if (t < OUT) {
          // Inside the core: gold whiteout cools into a star-dust flythrough
          const q = seg(t, SWAP, OUT);
          const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
          bg.addColorStop(0, 'rgba(120,70,30,1)');
          bg.addColorStop(0.5, 'rgba(40,14,50,1)');
          bg.addColorStop(1, 'rgba(6,2,16,1)');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, W, H);
          const F = halfDiag * 0.3;
          ctx.globalCompositeOperation = 'lighter';
          for (const d of dust) {
            d.z -= dt * 2.6;
            if (d.z < 0.02) d.z = rand(0.8, 1);
            const zt = d.z + 0.12;
            line(cx + (d.x / zt) * F, cy + (d.y / zt) * F, cx + (d.x / d.z) * F, cy + (d.y / d.z) * F,
              color(d.hue, 75, clamp(1.2 - d.z, 0, 1)), 0.6 + (1 - d.z) * 2.6);
          }
          flash(Math.pow(1 - q, 2), '255,240,210');
          return;
        }

        // Pull back: a fresh galaxy recedes over the new page as the veil lifts
        const e = seg(t, OUT, 1);
        const veil = 1 - easeOut(seg(e, 0, 0.55));
        const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
        bg.addColorStop(0, `rgba(30,12,50,${veil})`);
        bg.addColorStop(1, `rgba(2,1,10,${veil})`);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        const D = lerp(0.05, 6, easeOut(e));
        drawGalaxy(D, lerp(1.55, 1.2, e), -time * 0.4 - (1 - e) * 1.5, time * 0.6, (1 - seg(e, 0.4, 1)) * 0.9, e < 0.35);
      },
    };
  })();

  // ═════════════════════════════════════════════════════════════════════════
  // Scene 4: Neon Metaverse — glitch + CRT power-off, ride a synthwave grid
  //          through digital rain, CRT power-on into the new page
  // ═════════════════════════════════════════════════════════════════════════
  const grid = (() => {
    const CRT = 0.26;
    const SWAP = 0.42;
    const OUT = 0.6;
    const GLYPHS = '01アイウエオカキクケコサシスセソタチツテトナニヌネノ<>/{}#$%@ABCDEF';
    let drops = [], scan = null, scroll = 0;

    function glitchSlices(n, maxShift) {
      const dpr = canvas.width / W;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < n; i++) {
        const h = Math.round(rand(3, 42) * dpr);
        const y = Math.round(Math.random() * (canvas.height - h));
        ctx.drawImage(canvas, 0, y, canvas.width, h, Math.round((Math.random() - 0.5) * maxShift * dpr), y, canvas.width, h);
      }
      ctx.restore();
    }

    function drawRain(alpha, dt) {
      if (alpha <= 0.01) return;
      const fs = mobile ? 12 : 14;
      ctx.font = `${fs}px monospace`;
      ctx.globalCompositeOperation = 'lighter';
      for (const d of drops) {
        d.y += d.speed * dt;
        if (d.y - d.len * fs > H) d.y = rand(-200, 0);
        for (let j = 0; j < d.len; j++) {
          const y = d.y - j * fs;
          if (y < -fs || y > H + fs) continue;
          const a = alpha * (j === 0 ? 1 : (1 - j / d.len) * 0.55);
          ctx.fillStyle = j === 0 ? `rgba(230,255,250,${a})` : `hsla(${d.hue},100%,60%,${a})`;
          ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], d.x, y);
        }
      }
    }

    function drawWorld(speedT, alpha, time, dt) {
      const hy = H * 0.56;
      // Sky
      ctx.globalCompositeOperation = 'source-over';
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, `rgba(6,0,22,${alpha})`);
      sky.addColorStop(0.45, `rgba(42,6,78,${alpha})`);
      sky.addColorStop(0.56, `rgba(120,16,120,${alpha})`);
      sky.addColorStop(0.57, `rgba(14,0,30,${alpha})`);
      sky.addColorStop(1, `rgba(4,0,14,${alpha})`);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      drawRain(0.35 * alpha, dt);

      // Striped synthwave sun sitting on the horizon
      ctx.globalCompositeOperation = 'lighter';
      const sunR = minSide * lerp(0.2, 0.3, speedT);
      const sunY = hy - sunR * 0.42;
      fillRadial(cx, sunY, sunR * 2.4, [[0, `rgba(255,60,170,${0.35 * alpha})`], [1, 'rgba(0,0,0,0)']]);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, hy);
      ctx.clip();
      const sg = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
      sg.addColorStop(0, `rgba(255,236,120,${alpha})`);
      sg.addColorStop(0.5, `rgba(255,120,80,${alpha})`);
      sg.addColorStop(1, `rgba(255,30,150,${alpha})`);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(cx, sunY, sunR, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      for (let i = 0; i < 8; i++) {
        const k = ((i / 8) + time * 0.6) % 1;
        const y = sunY + k * sunR;
        ctx.fillRect(cx - sunR, y, sunR * 2, 1 + k * sunR * 0.09);
      }
      ctx.restore();

      // Floor + mirrored ceiling grid rushing at the camera
      ctx.globalCompositeOperation = 'lighter';
      scroll += dt * lerp(1.2, 14, easeIn(speedT));
      const bank = Math.sin(time * 1.3) * 0.04 * speedT;
      ctx.save();
      ctx.translate(cx, hy);
      ctx.rotate(bank);
      for (const [dir, hue, k] of [[1, 310, 1], [-1, 185, 0.45]]) {
        const depthH = dir > 0 ? H - hy : hy;
        for (let i = -16; i <= 16; i++) {
          const xs = i * W * 0.14;
          const st = `hsla(${hue},100%,62%,${0.75 * alpha * k})`;
          line(i * 3, 0, xs, depthH * 1.3 * dir, st, 1.4);
        }
        for (let n = 0; n < 22; n++) {
          const z = ((n - (scroll % 1)) / 22) * 9 + 0.3;
          if (z <= 0.3) continue;
          const y = (depthH * 0.9 / z) * dir;
          const a = alpha * k * clamp(1 - z / 9, 0, 1);
          line(-W, y, W, y, `hsla(${hue},100%,70%,${a * 0.35})`, 6 / z + 1);
          line(-W, y, W, y, `hsla(${hue},100%,80%,${a})`, 1.2);
        }
      }
      ctx.restore();
      fillRadial(cx, hy, W * 0.6, [[0, `rgba(255,80,200,${0.3 * alpha})`], [1, 'rgba(0,0,0,0)']]);
    }

    function drawScanlines(alpha) {
      if (alpha <= 0.01 || !scan) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.fillStyle = scan;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    return {
      label: '🟣 Neon Metaverse',
      swapAt: SWAP,
      emergeAt: OUT,
      seed() {
        const cols = Math.min(mobile ? 34 : 90, Math.floor(W / 18));
        drops = Array.from({ length: cols }, (_, i) => ({
          x: (i + 0.5) * (W / cols), y: rand(-H, H), speed: rand(250, 700), len: (rand(6, 18)) | 0,
          hue: Math.random() < 0.5 ? rand(165, 190) : rand(290, 320),
        }));
        const pc = document.createElement('canvas');
        pc.width = 2;
        pc.height = 4;
        const pctx = pc.getContext('2d');
        if (pctx) {
          pctx.fillStyle = 'rgba(0,0,0,0.45)';
          pctx.fillRect(0, 0, 2, 2);
          scan = ctx.createPattern(pc, 'repeat');
        }
        scroll = 0;
      },
      draw(t, dt, time) {
        if (t < SWAP) {
          // Glitch, then CRT power-off line → dot, then the grid world fades up
          const dim = 0.7 * easeInOut(seg(t, 0, CRT));
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = `rgba(10,0,26,${dim})`;
          ctx.fillRect(0, 0, W, H);
          drawRain(0.6 * seg(t, 0.05, CRT), dt);
          ctx.globalCompositeOperation = 'lighter';
          if (Math.random() < 0.45) {
            for (let i = 0; i < 3; i++) {
              ctx.fillStyle = `hsla(${Math.random() < 0.5 ? 180 : 310},100%,60%,${rand(0.08, 0.25)})`;
              ctx.fillRect(0, Math.random() * H, W, rand(2, 30));
            }
          }
          const off = seg(t, CRT, SWAP - 0.04);
          if (off > 0) {
            const lineW = W * (1 - easeIn(seg(off, 0.45, 1)));
            const lineH = lerp(10, 2, off);
            fillRadial(cx, cy, Math.max(4, lineW * 0.3), [[0, `rgba(200,255,255,${0.7 * (1 - off)})`], [1, 'rgba(0,0,0,0)']]);
            ctx.fillStyle = `rgba(230,255,255,${0.95 * (1 - seg(off, 0.85, 1))})`;
            ctx.fillRect(cx - lineW / 2, cy - lineH / 2, lineW, lineH);
          }
          const world = easeInOut(seg(t, CRT + 0.06, SWAP));
          if (world > 0) drawWorld(0, world, time, dt);
          drawScanlines(0.6);
          if (Math.random() < 0.35) glitchSlices(4, 40);
          return;
        }

        if (t < OUT) {
          drawWorld(seg(t, SWAP, OUT), 1, time, dt);
          drawScanlines(0.5);
          if (Math.random() < 0.3) glitchSlices(3, 60);
          return;
        }

        // CRT power-on: a bright line opens into the new page
        const e = seg(t, OUT, 1);
        drawWorld(1, 1 - seg(e, 0.2, 0.9), time, dt);
        const open = easeOut(seg(e, 0.04, 0.55)) * H * 1.1;
        if (open > 1) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = '#000';
          ctx.fillRect(0, cy - open / 2, W, open);
          ctx.globalCompositeOperation = 'lighter';
          const ea = 1 - seg(e, 0.3, 0.7);
          for (const y of [cy - open / 2, cy + open / 2]) {
            line(0, y, W, y, `rgba(120,255,255,${0.35 * ea})`, 14);
            line(0, y, W, y, `rgba(240,255,255,${0.95 * ea})`, 2);
          }
        }
        const lineIn = seg(e, 0, 0.06) * (1 - seg(e, 0.06, 0.2));
        if (lineIn > 0) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(240,255,255,${lineIn})`;
          ctx.fillRect(0, cy - 2, W * seg(e, 0, 0.05), 4);
        }
        drawScanlines(0.5 * (1 - seg(e, 0.4, 1)));
        if (e < 0.5 && Math.random() < 0.4) glitchSlices(4, 50);
      },
    };
  })();

  const scenes = { blackhole, supernova, galaxy, grid };

  // ── Engine ──────────────────────────────────────────────────────────────
  function safeCall(fn) {
    try { if (typeof fn === 'function') fn(); } catch (err) { console.error('[warp]', err); }
  }

  function frame(now) {
    if (!run) return;
    const dt = Math.min(0.05, (now - run.last) / 1000);
    run.last = now;
    const t = clamp((now - run.start) / run.duration, 0, 1);
    const time = (now - run.start) / 1000;
    const S = run.scene;

    if (!run.swapped && t >= S.swapAt) {
      run.swapped = true;
      safeCall(run.onSwap);
    }
    if (!run.emerged && t >= S.emergeAt) {
      run.emerged = true;
      safeCall(() => S.emerge && S.emerge());
      safeCall(run.onEmerge);
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.clearRect(0, 0, W, H);
    try {
      S.draw(t, dt, time);
    } catch (err) {
      console.error('[warp]', err);
      finish();
      return;
    }

    if (t >= 1) {
      finish();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function finish() {
    const r = run;
    run = null;
    cancelAnimationFrame(raf);
    if (canvas) {
      canvas.classList.remove('is-active');
      ctx.clearRect(0, 0, W, H);
    }
    if (!r) return;
    if (!r.swapped) safeCall(r.onSwap);
    if (!r.emerged) safeCall(r.onEmerge);
    safeCall(r.onDone);
  }

  function play(opts = {}) {
    ensureCanvas();
    if (run) finish();
    resize();
    density = clamp(Number(opts.density) || 1, 0.3, 2);
    flashScale = clamp(opts.flash === undefined ? 1 : Number(opts.flash) || 0, 0, 1);
    const scene = scenes[opts.scene] || blackhole;
    scene.seed();
    canvas.classList.add('is-active');
    const now = performance.now();
    run = {
      scene,
      start: now,
      last: now,
      duration: Math.max(600, opts.duration || 2000),
      onSwap: opts.onSwap,
      onEmerge: opts.onEmerge,
      onDone: opts.onDone,
      swapped: false,
      emerged: false,
    };
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => { if (run) resize(); });

  window.WarpFX = {
    play,
    finish,
    isRunning: () => Boolean(run),
    scenes,
  };
})();

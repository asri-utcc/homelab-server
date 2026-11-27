/**
 * workshop-3d.js
 * ============================================================================
 * Homelab Digital Video Production Office — Interactive 3D Isometric Workshop
 * Built with Three.js 0.162.0 ES Modules for the Lab Dashboard Overview Center.
 *
 * Features:
 *  - High-craft isometric studio platform with chamfered edges, holographic grid,
 *    perimeter LED trims, glass zone partitions, raised vocal booth & wall telemetry.
 *  - 5 articulated stylized chibi 3D characters with breathing, eye-blinking,
 *    shoulder/elbow/head kinematics, and department-specific props & live displays:
 *      1. script  — 📝 น้องสคริปต์ (typing, nodding, floating hologram script cards, coffee steam)
 *      2. art     — 🎨 น้องอาร์ต (tilted drafting tablet with live drawing canvas, glowing stylus & sparkles)
 *      3. voice   — 🎙️ น้องพากย์ (acoustic glass booth, condenser mic, 7-bar 3D EQ, expanding sound rings)
 *      4. edit    — 🎬 น้องตัดต่อ (curved dual monitors with live timeline playhead, GPU fans, render ring)
 *      5. publish — 🚀 น้องโปรดิวเซอร์ QC & โพสต์ (QC console, broadcast antenna, rising social platform orbs)
 *  - Flowing data-orb conveyor pipeline (1 -> 2 -> 3 -> 4 -> 5) reacting to live job status or Demo mode.
 *  - Smooth damped OrbitControls + click-to-zoom raycasting + 3D-to-2D projected status tags.
 *  - Full Dark / Light / Futuristic / Tactical theme support & graceful SVG fallback if WebGL fails.
 * ============================================================================
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── 1. Station Metadata, Camera Presets & Theme Palettes ─────────────────────

export const STATION_IDS = ['script', 'art', 'voice', 'edit', 'publish'];

export const STATIONS = [
  {
    id: 'script',
    index: 0,
    emoji: '📝',
    name: 'น้องสคริปต์',
    shortName: 'สคริปต์',
    dept: 'วิจัยข่าว & เขียนบท',
    role: 'Research & Story Script',
    accent: '#f59e0b',
    accentHex: 0xf59e0b,
    pos: [-4.4, 0, 2.15],
    rotY: 0.52,
    tagOffset: [0, 2.75, 0],
    demoDetail: 'เขียนบทข่าวเช้า 6 หัวข้อ',
    demoJob: 'Daily News Broadcast v2',
  },
  {
    id: 'art',
    index: 1,
    emoji: '🎨',
    name: 'น้องอาร์ต',
    shortName: 'วาดภาพ',
    dept: 'วาดฉาก & Motion Art',
    role: 'Visual & Storyboard Design',
    accent: '#fb7185',
    accentHex: 0xfb7185,
    pos: [-3.95, 0, -2.05],
    rotY: 0.58,
    tagOffset: [0, 2.85, 0],
    demoDetail: 'วาดฉาก & จัดเลย์เอาต์ 12 ซีน',
    demoJob: 'Daily News Broadcast v2',
  },
  {
    id: 'voice',
    index: 2,
    emoji: '🎙️',
    name: 'น้องพากย์',
    shortName: 'อัดเสียง',
    dept: 'พากย์เสียง & Sound Booth',
    role: 'Thai TTS & Voiceover',
    accent: '#a78bfa',
    accentHex: 0xa78bfa,
    pos: [0.0, 0.14, -2.45],
    rotY: 0.04,
    tagOffset: [0, 3.05, 0],
    demoDetail: 'อัดเสียง Gemini Charon · EQ สด',
    demoJob: 'Daily News Broadcast v2',
  },
  {
    id: 'edit',
    index: 3,
    emoji: '🎬',
    name: 'น้องตัดต่อ',
    shortName: 'ตัดต่อ GPU',
    dept: 'ตัดต่อ & เรนเดอร์ GPU',
    role: 'Remotion + FFmpeg Render',
    accent: '#38bdf8',
    accentHex: 0x38bdf8,
    pos: [4.1, 0, -1.75],
    rotY: -1.08,
    tagOffset: [0, 2.95, 0],
    demoDetail: 'เรนเดอร์ 60fps · 74% (GPU)',
    demoJob: 'Daily News Broadcast v2',
  },
  {
    id: 'publish',
    index: 4,
    emoji: '🚀',
    name: 'น้องโปรดิวเซอร์',
    shortName: 'QC & โพสต์',
    dept: 'ตรวจ QC & กระจายโซเชียล',
    role: 'QC Gate & Social Broadcast',
    accent: '#10b981',
    accentHex: 0x10b981,
    pos: [4.15, 0, 2.25],
    rotY: -0.92,
    tagOffset: [0, 3.05, 0],
    demoDetail: 'ผ่าน QC · ส่ง YT / TT / TG',
    demoJob: 'Daily News Broadcast v2',
  },
];

export const STATION_MAP = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

const CAMERA_PRESETS = {
  overview: { pos: [0.55, 10.6, 14.3], target: [0.0, 0.5, 0.15] },
  script:   { pos: [-7.1, 4.2, 6.2],   target: [-4.3, 1.05, 2.1] },
  art:      { pos: [-6.6, 4.1, 1.9],   target: [-3.9, 1.1, -2.0] },
  voice:    { pos: [0.65, 4.0, 1.9],   target: [0.0, 1.25, -2.4] },
  edit:     { pos: [6.8, 4.2, 2.25],   target: [4.05, 1.15, -1.7] },
  publish:  { pos: [6.9, 4.35, 6.35],  target: [4.1, 1.2, 2.2] },
};

const THEME_PALETTES = {
  dark: {
    isLight: false,
    bg: 0x07101c,
    fog: 0x07101c,
    slabTop: 0x101c2d,
    slabSide: 0x18293f,
    slabBase: 0x091322,
    floorTile: 0x142236,
    gridMain: 0x25486e,
    gridSub: 0x172b44,
    wallMain: 0x132236,
    wallTrim: 0x223956,
    glassTint: 0x7dd3fc,
    glassOpacity: 0.16,
    deskTop: 0x1d2e45,
    deskLeg: 0x2e4562,
    boothFloor: 0x2a233b,
    trimCyan: 0x38bdf8,
    trimAmber: 0xf59e0b,
    hemiSky: 0x89c4ff,
    hemiGround: 0x101828,
    hemiInt: 0.92,
    keyColor: 0xfff3e0,
    keyInt: 1.55,
    rimColor: 0x38bdf8,
    rimInt: 0.82,
    ambientInt: 0.34,
    exposure: 1.08,
    trackBase: 0x162b42,
    coneBoost: 1.0,
  },
  futuristic: {
    isLight: false,
    bg: 0x050c1a,
    fog: 0x050c1a,
    slabTop: 0x0d192d,
    slabSide: 0x152745,
    slabBase: 0x071020,
    floorTile: 0x12223d,
    gridMain: 0x22608a,
    gridSub: 0x132c4c,
    wallMain: 0x101f38,
    wallTrim: 0x1f3d63,
    glassTint: 0x38bdf8,
    glassOpacity: 0.18,
    deskTop: 0x192c49,
    deskLeg: 0x2a456b,
    boothFloor: 0x271e42,
    trimCyan: 0x22d3ee,
    trimAmber: 0x38bdf8,
    hemiSky: 0x7dd3fc,
    hemiGround: 0x0b1224,
    hemiInt: 0.95,
    keyColor: 0xf0f9ff,
    keyInt: 1.5,
    rimColor: 0x22d3ee,
    rimInt: 0.98,
    ambientInt: 0.35,
    exposure: 1.12,
    trackBase: 0x122c4a,
    coneBoost: 1.15,
  },
  light: {
    isLight: true,
    bg: 0xeaf2fb,
    fog: 0xeaf2fb,
    slabTop: 0xf8fbff,
    slabSide: 0xd2dfee,
    slabBase: 0xb8cae0,
    floorTile: 0xeef4fb,
    gridMain: 0xb4c8df,
    gridSub: 0xd6e3f1,
    wallMain: 0xf1f6fc,
    wallTrim: 0xc5d5e8,
    glassTint: 0x38bdf8,
    glassOpacity: 0.14,
    deskTop: 0xfafcff,
    deskLeg: 0x94a9c2,
    boothFloor: 0xece7f8,
    trimCyan: 0x0284c7,
    trimAmber: 0xd97706,
    hemiSky: 0xffffff,
    hemiGround: 0xb9cadf,
    hemiInt: 1.28,
    keyColor: 0xfff8ed,
    keyInt: 1.48,
    rimColor: 0x60a5fa,
    rimInt: 0.55,
    ambientInt: 0.48,
    exposure: 1.02,
    trackBase: 0xcbd9ea,
    coneBoost: 0.45,
  },
};

function resolveThemeName(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'light') return 'light';
  if (s === 'futuristic') return 'futuristic';
  return 'dark';
}

// ── 2. Scoped Low-Specificity CSS Injection (for tags & SVG fallback) ────────

let stylesInjected = false;
function ensureInjectedStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  if (document.getElementById('ws3d-injected-styles')) return;
  const style = document.createElement('style');
  style.id = 'ws3d-injected-styles';
  style.textContent = `
    :where(.ws3d-tag) {
      position: absolute;
      left: 0;
      top: 0;
      transform: translate3d(-9999px, -9999px, 0);
      pointer-events: auto;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 9px 4px 7px;
      border-radius: 999px;
      border: 1px solid rgba(56, 189, 248, 0.32);
      background: rgba(9, 17, 30, 0.84);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #e6f0fb;
      font-family: 'IBM Plex Sans Thai', system-ui, sans-serif;
      font-size: 11px;
      line-height: 1.2;
      white-space: nowrap;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.38);
      transition: border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease, background 0.2s ease;
      user-select: none;
      z-index: 4;
    }
    :where(.ws3d-tag:hover), :where(.ws3d-tag.is-selected) {
      border-color: var(--ws3d-accent, #38bdf8);
      box-shadow: 0 0 0 1px var(--ws3d-accent, #38bdf8), 0 6px 18px rgba(0, 0, 0, 0.45);
      z-index: 8;
    }
    :where(.ws3d-tag__dot) {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #64748b;
      flex-shrink: 0;
    }
    :where(.ws3d-tag.is-active .ws3d-tag__dot) {
      background: var(--ws3d-accent, #38bdf8);
      box-shadow: 0 0 8px var(--ws3d-accent, #38bdf8);
      animation: ws3dPulse 1.3s ease-in-out infinite;
    }
    :where(.ws3d-tag.is-done .ws3d-tag__dot) {
      background: #10b981;
    }
    :where(.ws3d-tag.is-pending .ws3d-tag__dot) {
      background: #f59e0b;
    }
    :where(.ws3d-tag.is-error .ws3d-tag__dot) {
      background: #f43f5e;
    }
    :where(.ws3d-tag__body) {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
    }
    :where(.ws3d-tag__top) {
      display: flex;
      align-items: center;
      gap: 5px;
      font-weight: 600;
    }
    :where(.ws3d-tag__state) {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.16);
      color: #cbd5e1;
    }
    :where(.ws3d-tag.is-active .ws3d-tag__state) {
      background: color-mix(in srgb, var(--ws3d-accent, #38bdf8) 22%, transparent);
      color: #f8fafc;
    }
    :where(.ws3d-tag.is-done .ws3d-tag__state) {
      background: rgba(16, 185, 129, 0.22);
      color: #6ee7b7;
    }
    :where(.ws3d-tag.is-pending .ws3d-tag__state) {
      background: rgba(245, 158, 11, 0.22);
      color: #fcd34d;
    }
    :where(.ws3d-tag__sub) {
      font-size: 10px;
      color: #94a3b8;
      max-width: 145px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    :where(.ws3d-theme-light .ws3d-tag) {
      background: rgba(255, 255, 255, 0.9);
      color: #0f172a;
      border-color: rgba(15, 23, 42, 0.14);
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
    }
    :where(.ws3d-theme-light .ws3d-tag__state) {
      background: rgba(15, 23, 42, 0.08);
      color: #334155;
    }
    :where(.ws3d-theme-light .ws3d-tag.is-active .ws3d-tag__state) {
      color: #0f172a;
    }
    :where(.ws3d-theme-light .ws3d-tag.is-done .ws3d-tag__state) {
      color: #047857;
    }
    :where(.ws3d-theme-light .ws3d-tag.is-pending .ws3d-tag__state) {
      color: #b45309;
    }
    :where(.ws3d-theme-light .ws3d-tag__sub) {
      color: #475569;
    }
    @keyframes ws3dPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.38); opacity: 0.65; }
    }
    @keyframes ws3dDash {
      to { stroke-dashoffset: -36; }
    }
    :where(.ws3d-fallback) {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
      background: radial-gradient(circle at 50% 42%, #132338 0%, #07101c 85%);
      color: #e2e8f0;
      font-family: 'IBM Plex Sans Thai', system-ui, sans-serif;
    }
    :where(.ws3d-fallback.is-light) {
      background: radial-gradient(circle at 50% 42%, #f8fbff 0%, #e2edf8 85%);
      color: #0f172a;
    }
    :where(.ws3d-fallback svg) {
      width: 100%;
      height: 100%;
      max-height: 100%;
    }
    :where(.ws3d-fb-pipe) {
      stroke-dasharray: 8 10;
      animation: ws3dDash 1.4s linear infinite;
    }
    :where(.ws3d-fb-node) {
      cursor: pointer;
      transition: transform 0.2s ease;
    }
    :where(.ws3d-fb-node:hover) {
      filter: brightness(1.12);
    }
  `;
  document.head.appendChild(style);
}

// ── 3. Geometry & Math Helpers ───────────────────────────────────────────────

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function createRoundedRectShape(width, height, radius) {
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

function tagStationTree(obj, stationId) {
  obj.traverse((child) => {
    child.userData.stationId = stationId;
  });
}

function setShadowFlags(obj, cast = true, receive = true) {
  obj.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}

function disposeObject3D(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry);
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        materials.add(m);
        for (const key of ['map', 'emissiveMap', 'alphaMap', 'roughnessMap', 'metalnessMap', 'normalMap']) {
          if (m[key] && typeof m[key].dispose === 'function') textures.add(m[key]);
        }
      }
    }
  });
  for (const t of textures) t.dispose();
  for (const m of materials) m.dispose();
  for (const g of geometries) g.dispose();
}

function makeCanvasTexture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return { canvas, ctx, tex };
}

function truncateText(text, maxLen = 28) {
  const s = String(text || '').trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(1, maxLen - 1)) + '…';
}

function rrect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

// ── 4. Dynamic Procedural Canvas Displays ────────────────────────────────────

function createDynamicDisplays() {
  const wall = makeCanvasTexture(512, 128);
  const script = makeCanvasTexture(256, 160);
  const art = makeCanvasTexture(320, 224);
  const edit = makeCanvasTexture(512, 192);
  const publish = makeCanvasTexture(320, 192);

  // Persistent brush history for Art tablet
  const artStrokes = [];
  const artColors = ['#fb7185', '#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#f472b6'];

  function drawWall(time, stateSummary, isLight) {
    const { ctx, canvas, tex } = wall;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = isLight ? '#0f1c2e' : '#081221';
    ctx.fillRect(0, 0, w, h);

    // Subtle header gradient bar
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#38bdf8');
    grad.addColorStop(0.5, '#a78bfa');
    grad.addColorStop(1, '#10b981');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, 5);

    // Subtle grid
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 24; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Title
    ctx.fillStyle = '#e2f1ff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText('HOMELAB VIDEO FACTORY OS', 18, 38);

    // Mode pill
    const pillColor = stateSummary.demoMode
      ? '#f59e0b'
      : stateSummary.anyActive
      ? '#10b981'
      : '#38bdf8';
    const pillText = stateSummary.demoMode
      ? 'DEMO LIVE'
      : stateSummary.anyActive
      ? 'PRODUCING'
      : 'STANDBY';
    ctx.fillStyle = pillColor;
    rrect(ctx, w - 134, 15, 116, 26, 13);
    ctx.fill();
    ctx.fillStyle = '#06101c';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(pillText, w - 76, 33);
    ctx.textAlign = 'left';

    // Subtitle / active job line
    ctx.fillStyle = '#94c5eb';
    ctx.font = '500 15px system-ui, sans-serif';
    ctx.fillText(truncateText(stateSummary.headline || '5-Department Autonomous Studio Pipeline', 46), 18, 66);

    // Bottom metrics strip
    const chips = [
      `ACTIVE: ${stateSummary.activeCount}/5`,
      `QC WAIT: ${stateSummary.qcPending}`,
      `GPU NODES: ${stateSummary.gpuNodes}`,
      `SOCIAL Q: ${stateSummary.socialQueued}`,
    ];
    let cx = 18;
    ctx.font = '600 12px monospace';
    for (let i = 0; i < chips.length; i++) {
      const label = chips[i];
      const cw = ctx.measureText(label).width + 18;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      rrect(ctx, cx, 84, cw, 26, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.stroke();
      ctx.fillStyle = '#e0f2fe';
      ctx.fillText(label, cx + 9, 101);
      cx += cw + 8;
    }

    // Animated activity heartbeat bar on right
    const barX = w - 68;
    for (let i = 0; i < 6; i++) {
      const amp = stateSummary.anyActive ? 0.35 + 0.65 * Math.abs(Math.sin(time * 4.5 + i * 0.9)) : 0.2;
      const bh = 6 + amp * 20;
      ctx.fillStyle = i % 2 === 0 ? '#38bdf8' : '#10b981';
      ctx.fillRect(barX + i * 8, 110 - bh, 5, bh);
    }

    tex.needsUpdate = true;
  }

  function drawScript(time, activity) {
    const { ctx, canvas, tex } = script;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0c1524';
    ctx.fillRect(0, 0, w, h);

    // Top bar
    ctx.fillStyle = '#192942';
    ctx.fillRect(0, 0, w, 24);
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(12, 12, 4, 0, Math.PI * 2);
    ctx.arc(24, 12, 4, 0, Math.PI * 2);
    ctx.arc(36, 12, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fcd34d';
    ctx.font = '700 11px monospace';
    ctx.fillText('SCRIPT_GEN.MD', 50, 16);

    // Typing script lines
    const speed = 1.2 + activity * 5.2;
    const totalChars = Math.floor(time * speed * 6) % 160;
    const lineWidths = [165, 195, 140, 205, 175, 120, 188];
    let remain = totalChars;
    for (let i = 0; i < lineWidths.length; i++) {
      const y = 40 + i * 16;
      const maxW = lineWidths[i];
      const fillW = Math.max(12, Math.min(maxW, remain * 5));
      remain = Math.max(0, remain - Math.ceil(maxW / 5));

      ctx.fillStyle = i === 0 || i === 4 ? '#f59e0b' : i % 2 === 0 ? '#7dd3fc' : '#cbd5e1';
      rrect(ctx, 14, y, fillW, 7, 3);
      ctx.fill();

      // Blinking cursor on current line
      if (remain === 0 && (Math.floor(time * 4) % 2 === 0 || activity > 0.5)) {
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(16 + fillW, y - 1, 5, 9);
        remain = -1;
      }
    }

    tex.needsUpdate = true;
  }

  function drawArt(time, activity) {
    const { ctx, canvas, tex } = art;
    const w = canvas.width;
    const h = canvas.height;

    // Studio canvas backdrop
    ctx.fillStyle = '#121b2d';
    ctx.fillRect(0, 0, w, h);

    // Left tool rail
    ctx.fillStyle = '#1a2740';
    ctx.fillRect(0, 0, 32, h);
    for (let i = 0; i < artColors.length; i++) {
      ctx.fillStyle = artColors[i];
      ctx.beginPath();
      ctx.arc(16, 24 + i * 30, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Artboard
    const ax = 44;
    const ay = 14;
    const aw = w - 58;
    const ah = h - 28;
    const bgGrad = ctx.createLinearGradient(ax, ay, ax + aw, ay + ah);
    bgGrad.addColorStop(0, '#1e293b');
    bgGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrad;
    rrect(ctx, ax, ay, aw, ah, 10);
    ctx.fill();

    // Stylized scenic motion artwork inside artboard
    ctx.save();
    rrect(ctx, ax, ay, aw, ah, 10);
    ctx.clip();

    // Glowing sun/planet + hills
    ctx.fillStyle = 'rgba(251, 113, 133, 0.25)';
    ctx.beginPath();
    ctx.arc(ax + aw * 0.72, ay + ah * 0.34, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fb7185';
    ctx.beginPath();
    ctx.arc(ax + aw * 0.72, ay + ah * 0.34, 21, 0, Math.PI * 2);
    ctx.fill();

    // Stylized waveform mountain silhouette
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.moveTo(ax, ay + ah);
    ctx.quadraticCurveTo(ax + aw * 0.3, ay + ah * 0.42, ax + aw * 0.62, ay + ah * 0.72);
    ctx.quadraticCurveTo(ax + aw * 0.85, ay + ah * 0.5, ax + aw, ay + ah * 0.65);
    ctx.lineTo(ax + aw, ay + ah);
    ctx.closePath();
    ctx.fill();

    // Live animated stylus stroke trail
    const speed = 1.0 + activity * 2.8;
    const t = time * speed;
    const px = ax + aw * (0.5 + 0.34 * Math.sin(t * 1.45));
    const py = ay + ah * (0.48 + 0.28 * Math.sin(t * 2.15 + 0.7));
    const colorIdx = Math.floor(time * 0.5) % artColors.length;

    artStrokes.push({ x: px, y: py, c: artColors[colorIdx] });
    if (artStrokes.length > 26) artStrokes.shift();

    if (artStrokes.length > 1) {
      for (let i = 1; i < artStrokes.length; i++) {
        const p0 = artStrokes[i - 1];
        const p1 = artStrokes[i];
        const alpha = i / artStrokes.length;
        ctx.strokeStyle = p1.c;
        ctx.globalAlpha = alpha * (0.45 + activity * 0.55);
        ctx.lineWidth = 3 + alpha * 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Glowing cursor dot at stylus position
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 5 + activity * 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    tex.needsUpdate = true;
  }

  function drawEdit(time, activity, progressPct) {
    const { ctx, canvas, tex } = edit;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#09121e';
    ctx.fillRect(0, 0, w, h);

    // Split dual-monitor frame: Left = Video Preview, Right = Multi-track Timeline
    const mid = Math.floor(w * 0.44);

    // Left monitor: preview window
    ctx.fillStyle = '#111f33';
    ctx.fillRect(8, 8, mid - 14, h - 16);
    const pGrad = ctx.createLinearGradient(14, 14, mid - 14, h - 38);
    pGrad.addColorStop(0, '#0ea5e9');
    pGrad.addColorStop(0.5, '#6366f1');
    pGrad.addColorStop(1, '#ec4899');
    ctx.fillStyle = pGrad;
    rrect(ctx, 14, 14, mid - 26, h - 54, 8);
    ctx.fill();

    // Animated graphic inside preview
    const cx = 14 + (mid - 26) / 2;
    const cy = 14 + (h - 54) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 22 + Math.sin(time * 4) * 5 * activity, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 10);
    ctx.lineTo(cx + 12, cy);
    ctx.lineTo(cx - 7, cy + 10);
    ctx.closePath();
    ctx.fill();

    // Render progress bar under preview
    const pct = Number.isFinite(progressPct) && progressPct > 0
      ? Math.min(100, progressPct)
      : Math.floor(((time * (8 + activity * 18)) % 100));
    ctx.fillStyle = '#1e293b';
    rrect(ctx, 14, h - 30, mid - 26, 12, 6);
    ctx.fill();
    ctx.fillStyle = '#38bdf8';
    rrect(ctx, 14, h - 30, ((mid - 26) * pct) / 100, 12, 6);
    ctx.fill();
    ctx.fillStyle = '#e0f2fe';
    ctx.font = '700 10px monospace';
    ctx.fillText(`GPU RENDER ${Math.round(pct)}%`, 18, h - 20);

    // Right monitor: Multi-track timeline
    const rx = mid + 6;
    const rw = w - rx - 8;
    ctx.fillStyle = '#0e1929';
    ctx.fillRect(rx, 8, rw, h - 16);

    // Ruler ticks
    ctx.fillStyle = '#1c2f4a';
    ctx.fillRect(rx, 8, rw, 20);
    ctx.fillStyle = '#7dd3fc';
    ctx.font = '600 10px monospace';
    ctx.fillText('REMOTION + FFMPEG TIMELINE · 60FPS', rx + 8, 22);

    const tracks = [
      { color: '#38bdf8', clips: [[0.03, 0.24], [0.29, 0.3], [0.62, 0.34]] },
      { color: '#f59e0b', clips: [[0.08, 0.18], [0.31, 0.22], [0.56, 0.28]] },
      { color: '#a78bfa', clips: [[0.02, 0.44], [0.49, 0.46]] },
      { color: '#10b981', clips: [[0.04, 0.88]] },
    ];
    for (let tIdx = 0; tIdx < tracks.length; tIdx++) {
      const ty = 38 + tIdx * 34;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(rx + 6, ty, rw - 12, 24);
      ctx.fillStyle = tracks[tIdx].color;
      for (const [start, len] of tracks[tIdx].clips) {
        rrect(ctx, rx + 6 + start * (rw - 12), ty + 2, len * (rw - 12), 20, 4);
        ctx.fill();
      }
    }

    // Sweeping playhead
    const playNorm = (time * (0.12 + activity * 0.38)) % 1;
    const playX = rx + 6 + playNorm * (rw - 12);
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(playX, 26);
    ctx.lineTo(playX, h - 12);
    ctx.stroke();
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.moveTo(playX - 6, 24);
    ctx.lineTo(playX + 6, 24);
    ctx.lineTo(playX, 32);
    ctx.closePath();
    ctx.fill();

    tex.needsUpdate = true;
  }

  function drawPublish(time, activity, qcPending, socialQueued) {
    const { ctx, canvas, tex } = publish;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#081520';
    ctx.fillRect(0, 0, w, h);

    // Header
    ctx.fillStyle = '#0f2736';
    ctx.fillRect(0, 0, w, 28);
    ctx.fillStyle = '#34d399';
    ctx.font = '700 13px monospace';
    ctx.fillText('QC GATE & SOCIAL DISPATCH', 12, 19);

    // Left QC Status badge
    const badgeColor = activity > 0.5 ? '#10b981' : qcPending > 0 ? '#f59e0b' : '#38bdf8';
    const badgeLabel = activity > 0.5 ? 'BROADCAST' : qcPending > 0 ? `QC WAIT (${qcPending})` : 'READY';
    ctx.fillStyle = badgeColor;
    rrect(ctx, 14, 42, 134, 52, 10);
    ctx.fill();
    ctx.fillStyle = '#041219';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(badgeLabel, 81, 74);
    ctx.textAlign = 'left';

    // Social platform upload bars
    const platforms = [
      { label: 'YT', color: '#ef4444' },
      { label: 'TT', color: '#22d3ee' },
      { label: 'FB', color: '#3b82f6' },
      { label: 'IG', color: '#a855f7' },
      { label: 'TG', color: '#0ea5e9' },
    ];
    for (let i = 0; i < platforms.length; i++) {
      const py = 40 + i * 28;
      ctx.fillStyle = platforms[i].color;
      rrect(ctx, 164, py, 26, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 10px monospace';
      ctx.fillText(platforms[i].label, 170, py + 13);

      // Animated upload bar
      const fill = activity > 0.4
        ? ((time * 0.45 + i * 0.21) % 1)
        : 0.35 + 0.15 * Math.sin(time + i);
      ctx.fillStyle = '#162c3d';
      rrect(ctx, 198, py + 4, 108, 10, 5);
      ctx.fill();
      ctx.fillStyle = platforms[i].color;
      rrect(ctx, 198, py + 4, Math.max(12, 108 * fill), 10, 5);
      ctx.fill();
    }

    // Bottom info
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 12px monospace';
    ctx.fillText(`QUEUE: ${socialQueued} POSTS`, 14, 124);
    ctx.fillStyle = '#34d399';
    ctx.fillText('MASTER MP4 · SYNC OK', 14, 146);

    // Pulse indicator bar
    const pulseW = 40 + (0.5 + 0.5 * Math.sin(time * 5)) * 90 * Math.max(0.25, activity);
    ctx.fillStyle = '#10b981';
    rrect(ctx, 14, 160, pulseW, 8, 4);
    ctx.fill();

    tex.needsUpdate = true;
  }

  return {
    wall,
    script,
    art,
    edit,
    publish,
    drawWall,
    drawScript,
    drawArt,
    drawEdit,
    drawPublish,
  };
}

// ── 5. Articulated Stylized Chibi 3D Character Builder ───────────────────────

function createChibiCharacter({
  shirtColor,
  pantsColor = 0x1e293b,
  skinColor = 0xffd7ba,
  hairColor = 0x1e1b2e,
  accentColor = 0x38bdf8,
  chairColor = 0x1e293b,
  accessory = 'glasses', // 'glasses' | 'beret' | 'headphones' | 'headset' | 'visor'
  stoolMode = false,
}) {
  const root = new THREE.Group();

  // ── Studio Chair / Stool ──
  const chairGroup = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.65, roughness: 0.3 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: chairColor, roughness: 0.62, metalness: 0.08 });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.28,
    roughness: 0.35,
  });

  // Base star / pedestal
  const baseHub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.08, 12), metalMat);
  baseHub.position.y = 0.05;
  chairGroup.add(baseHub);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.36), metalMat);
    leg.position.set(Math.sin(a) * 0.18, 0.04, Math.cos(a) * 0.18);
    leg.rotation.y = a;
    chairGroup.add(leg);
  }
  const seatH = stoolMode ? 0.56 : 0.44;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, seatH, 10), metalMat);
  stem.position.y = seatH / 2;
  chairGroup.add(stem);

  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 0.09, 18), cushionMat);
  seat.position.y = seatH;
  chairGroup.add(seat);

  if (!stoolMode) {
    const backPost = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.44, 0.05), metalMat);
    backPost.position.set(0, seatH + 0.22, -0.29);
    chairGroup.add(backPost);

    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.46, 0.08), cushionMat);
    backrest.position.set(0, seatH + 0.38, -0.32);
    chairGroup.add(backrest);

    const trimStripe = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.09), accentMat);
    trimStripe.position.set(0, seatH + 0.54, -0.32);
    chairGroup.add(trimStripe);
  } else {
    const footRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.018, 8, 22), metalMat);
    footRing.rotation.x = Math.PI / 2;
    footRing.position.y = 0.24;
    chairGroup.add(footRing);
  }
  root.add(chairGroup);

  // ── Character Body Hierarchy ──
  const skinMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.45, metalness: 0.02 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.52, metalness: 0.05 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.65, metalness: 0.05 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.55, metalness: 0.08 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4, metalness: 0.05 });

  const pelvis = new THREE.Group();
  pelvis.position.set(0, seatH + 0.06, 0.02);
  root.add(pelvis);

  // Seated legs
  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.18, 6, 12), pantsMat);
    thigh.rotation.x = Math.PI / 2 - 0.12;
    thigh.position.set(side * 0.13, 0.03, 0.16);
    pelvis.add(thigh);

    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.22, 6, 12), pantsMat);
    shin.position.set(side * 0.13, -0.15, 0.28);
    pelvis.add(shin);

    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), shoeMat);
    shoe.scale.set(0.9, 0.62, 1.35);
    shoe.position.set(side * 0.13, -0.3, 0.33);
    pelvis.add(shoe);
  }

  // Torso pivot (for lean & sway)
  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, 0.06, 0);
  pelvis.add(torsoPivot);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.24, 8, 16), shirtMat);
  torso.scale.set(1.06, 1.0, 0.86);
  torso.position.y = 0.24;
  torsoPivot.add(torso);

  // Collar / hoodie accent + badge
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.042, 10, 20), accentMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 0.44, 0.01);
  torsoPivot.add(collar);

  const chestBadge = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.02), accentMat);
  chestBadge.position.set(0.09, 0.31, 0.19);
  torsoPivot.add(chestBadge);

  // ── Head Pivot ──
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.5, 0.02);
  torsoPivot.add(headPivot);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 22, 18), skinMat);
  head.scale.set(1.05, 0.98, 1.0);
  head.position.y = 0.28;
  headPivot.add(head);

  // Ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), skinMat);
    ear.position.set(side * 0.32, 0.27, 0.0);
    headPivot.add(ear);
  }

  // Eyes (glossy dark iris + specular catchlight dot, scalable Y for blinking!)
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.12, metalness: 0.2 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const blushMat = new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.36 });

  const eyes = [];
  for (const side of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * 0.115, 0.29, 0.295);

    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.044, 12, 12), eyeMat);
    iris.scale.set(0.95, 1.15, 0.55);
    eyeGroup.add(iris);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), glintMat);
    glint.position.set(side * -0.012, 0.016, 0.022);
    eyeGroup.add(glint);

    headPivot.add(eyeGroup);
    eyes.push(eyeGroup);

    // Cute rosy cheek
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.048, 12), blushMat);
    blush.position.set(side * 0.18, 0.22, 0.275);
    blush.rotation.y = side * 0.38;
    headPivot.add(blush);
  }

  // Cute smile / talking mouth
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x7c2d12 });
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 10), mouthMat);
  mouth.scale.set(1.25, 0.45, 0.5);
  mouth.position.set(0, 0.19, 0.302);
  headPivot.add(mouth);

  // Hair cap (stylized smooth chibi hair)
  const hairCrown = new THREE.Mesh(new THREE.SphereGeometry(0.335, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat);
  hairCrown.scale.set(1.05, 1.0, 1.04);
  hairCrown.position.set(0, 0.31, -0.02);
  headPivot.add(hairCrown);

  // Front bangs
  for (let i = -2; i <= 2; i++) {
    const bang = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 10), hairMat);
    bang.scale.set(0.85, 1.1, 0.65);
    bang.position.set(i * 0.082, 0.44 - Math.abs(i) * 0.02, 0.255 - Math.abs(i) * 0.025);
    headPivot.add(bang);
  }

  // Role-specific Head Accessories
  if (accessory === 'glasses') {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.25 });
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.011, 8, 18), frameMat);
      rim.position.set(side * 0.115, 0.29, 0.325);
      headPivot.add(rim);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.014, 0.014), frameMat);
    bridge.position.set(0, 0.295, 0.325);
    headPivot.add(bridge);
  } else if (accessory === 'beret') {
    const beretMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.58 });
    const beret = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 12), beretMat);
    beret.scale.set(1.2, 0.38, 1.15);
    beret.position.set(-0.06, 0.62, -0.02);
    beret.rotation.z = 0.26;
    headPivot.add(beret);

    const stemTop = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.09, 8), beretMat);
    stemTop.position.set(-0.1, 0.75, -0.02);
    stemTop.rotation.z = 0.26;
    headPivot.add(stemTop);
  } else if (accessory === 'headphones' || accessory === 'headset') {
    const hpMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.45 });
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.032, 10, 24, Math.PI), hpMat);
    band.position.set(0, 0.31, 0);
    headPivot.add(band);

    for (const side of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.075, 16), hpMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.355, 0.29, 0);
      headPivot.add(cup);

      const ledRing = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 18), accentMat);
      ledRing.rotation.y = Math.PI / 2;
      ledRing.position.set(side * 0.395, 0.29, 0);
      headPivot.add(ledRing);
    }

    if (accessory === 'headset') {
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.26, 8), metalMat);
      boom.rotation.z = Math.PI / 2.2;
      boom.rotation.y = 0.5;
      boom.position.set(0.24, 0.21, 0.2);
      headPivot.add(boom);

      const micTip = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), accentMat);
      micTip.position.set(0.12, 0.19, 0.32);
      headPivot.add(micTip);
    }
  } else if (accessory === 'visor') {
    const capMat = new THREE.MeshStandardMaterial({ color: 0x065f46, roughness: 0.5 });
    const capDome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), capMat);
    capDome.position.set(0, 0.36, 0);
    headPivot.add(capDome);

    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.035, 18, 1, false, -0.75, 1.5), accentMat);
    brim.position.set(0, 0.44, 0.16);
    brim.rotation.x = 0.12;
    headPivot.add(brim);
  }

  // ── Articulated Arms (Shoulder -> Upper Arm -> Elbow -> Forearm -> Hand) ──
  function buildArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.27, 0.38, 0.02);

    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.16, 6, 10), shirtMat);
    upperArm.position.y = -0.1;
    shoulder.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.21, 0);
    shoulder.add(elbow);

    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.15, 6, 10), skinMat);
    forearm.position.y = -0.095;
    elbow.add(forearm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.068, 10, 10), skinMat);
    hand.position.y = -0.205;
    elbow.add(hand);

    torsoPivot.add(shoulder);
    return { shoulder, elbow, hand };
  }

  const armL = buildArm(-1);
  const armR = buildArm(1);

  return {
    root,
    pelvis,
    torsoPivot,
    headPivot,
    eyes,
    mouth,
    armL,
    armR,
    blinkTimer: 1.5 + Math.random() * 3.5,
    blinkProgress: 0,
  };
}

function animateBlink(chibi, dt) {
  chibi.blinkTimer -= dt;
  if (chibi.blinkTimer <= 0 && chibi.blinkProgress === 0) {
    chibi.blinkProgress = 0.001;
  }
  if (chibi.blinkProgress > 0) {
    chibi.blinkProgress += dt * 7.5;
    const closeAmt = Math.sin(Math.min(1, chibi.blinkProgress) * Math.PI);
    const sy = Math.max(0.12, 1 - closeAmt * 0.88);
    for (const eye of chibi.eyes) eye.scale.y = sy;
    if (chibi.blinkProgress >= 1) {
      chibi.blinkProgress = 0;
      chibi.blinkTimer = 2.4 + Math.random() * 3.8;
      for (const eye of chibi.eyes) eye.scale.y = 1;
    }
  }
}

// ── 6. Studio Architecture, Partitions & Pipeline Builder ────────────────────

function createStudioArchitecture(wallTexture) {
  const group = new THREE.Group();
  const refs = {};

  // Outer beveled base slab (14.8 x 10.6)
  const slabShape = createRoundedRectShape(14.8, 10.6, 0.85);
  const slabGeo = new THREE.ExtrudeGeometry(slabShape, {
    depth: 0.42,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.09,
    bevelSegments: 3,
  });
  slabGeo.rotateX(Math.PI / 2);

  refs.slabTopMat = new THREE.MeshStandardMaterial({ color: 0x101c2d, roughness: 0.72, metalness: 0.14 });
  refs.slabSideMat = new THREE.MeshStandardMaterial({ color: 0x18293f, roughness: 0.55, metalness: 0.25 });
  const slab = new THREE.Mesh(slabGeo, [refs.slabTopMat, refs.slabSideMat]);
  slab.position.y = -0.02;
  slab.receiveShadow = true;
  group.add(slab);

  // Under-plinth shadow pedestal
  const baseShape = createRoundedRectShape(14.1, 9.9, 0.75);
  const baseGeo = new THREE.ExtrudeGeometry(baseShape, { depth: 0.28, bevelEnabled: false });
  baseGeo.rotateX(Math.PI / 2);
  refs.slabBaseMat = new THREE.MeshStandardMaterial({ color: 0x091322, roughness: 0.85, metalness: 0.2 });
  const baseMesh = new THREE.Mesh(baseGeo, refs.slabBaseMat);
  baseMesh.position.y = -0.5;
  group.add(baseMesh);

  // Glowing perimeter LED trim (cyan front/sides + amber rear)
  const perimPoints = slabShape.getSpacedPoints(80).map((p) => new THREE.Vector3(p.x, 0.025, p.y));
  const perimCurve = new THREE.CatmullRomCurve3(perimPoints, true);
  refs.trimCyanMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const perimTube = new THREE.Mesh(new THREE.TubeGeometry(perimCurve, 96, 0.036, 8, true), refs.trimCyanMat);
  group.add(perimTube);

  // Subtle floor grid
  refs.gridHelper = new THREE.GridHelper(13.6, 20, 0x25486e, 0x172b44);
  refs.gridHelper.position.y = 0.008;
  refs.gridHelper.scale.set(1.02, 1, 0.72);
  refs.gridHelper.material.transparent = true;
  refs.gridHelper.material.opacity = 0.42;
  group.add(refs.gridHelper);

  // Central Holographic Hub Ring (FanRuan Digital Twin focal ring)
  const hubGroup = new THREE.Group();
  hubGroup.position.set(0, 0.02, 0.6);
  refs.hubRingOuterMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.42, side: THREE.DoubleSide });
  const hubOuter = new THREE.Mesh(new THREE.RingGeometry(1.18, 1.28, 48), refs.hubRingOuterMat);
  hubOuter.rotation.x = -Math.PI / 2;
  hubGroup.add(hubOuter);

  refs.hubRingInnerMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.52, side: THREE.DoubleSide });
  const hubInner = new THREE.Mesh(new THREE.RingGeometry(0.68, 0.76, 36, 1, 0, Math.PI * 1.45), refs.hubRingInnerMat);
  hubInner.rotation.x = -Math.PI / 2;
  hubInner.position.y = 0.01;
  hubGroup.add(hubInner);
  refs.hubInner = hubInner;

  const hubCoreMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.65,
    roughness: 0.2,
    metalness: 0.6,
  });
  const hubCore = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.12, 24), hubCoreMat);
  hubCore.position.y = 0.06;
  hubGroup.add(hubCore);
  refs.hubCore = hubCore;
  group.add(hubGroup);

  // Back Architectural Wall with Wall-Mounted Factory Telemetry Screen
  refs.wallMat = new THREE.MeshStandardMaterial({ color: 0x132236, roughness: 0.68, metalness: 0.14 });
  refs.wallTrimMat = new THREE.MeshStandardMaterial({ color: 0x223956, roughness: 0.45, metalness: 0.35 });
  refs.trimAmberMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(13.8, 2.35, 0.18), refs.wallMat);
  backWall.position.set(0, 1.175, -5.05);
  backWall.receiveShadow = true;
  group.add(backWall);

  const wallTopCap = new THREE.Mesh(new THREE.BoxGeometry(13.9, 0.09, 0.24), refs.wallTrimMat);
  wallTopCap.position.set(0, 2.38, -5.05);
  group.add(wallTopCap);

  const wallAmberStrip = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.04, 0.05), refs.trimAmberMat);
  wallAmberStrip.position.set(0, 2.26, -4.93);
  group.add(wallAmberStrip);

  // Giant Wall Telemetry Display (centered above studio)
  const displayFrame = new THREE.Mesh(new THREE.BoxGeometry(4.65, 1.24, 0.12), refs.wallTrimMat);
  displayFrame.position.set(0, 1.54, -4.92);
  group.add(displayFrame);

  const displayScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(4.42, 1.06),
    new THREE.MeshBasicMaterial({ map: wallTexture })
  );
  displayScreen.position.set(0, 1.54, -4.85);
  group.add(displayScreen);

  // Glass zone divider panels (low, transparent, with slim metallic mullions)
  refs.glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.16,
    roughness: 0.1,
    metalness: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  function addGlassDivider(x, z, len, rotY = 0, height = 1.25) {
    const div = new THREE.Group();
    div.position.set(x, 0, z);
    div.rotation.y = rotY;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, height), refs.glassMat);
    pane.position.y = height / 2 + 0.04;
    div.add(pane);

    const topRail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, 0.04, 0.04), refs.wallTrimMat);
    topRail.position.y = height + 0.05;
    div.add(topRail);

    for (const sx of [-len / 2, len / 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, height + 0.06, 8), refs.wallTrimMat);
      post.position.set(sx, height / 2 + 0.03, 0);
      div.add(post);
    }
    group.add(div);
  }

  // Subtle architectural glass dividers separating zones
  addGlassDivider(-4.2, 0.05, 2.7, 0.0, 1.05);   // Between Script & Art
  addGlassDivider(4.2, 0.25, 2.7, 0.0, 1.05);    // Between Edit & Publish

  // Raised Voice Booth Platform (Center Back)
  refs.boothFloorMat = new THREE.MeshStandardMaterial({ color: 0x2a233b, roughness: 0.72, metalness: 0.1 });
  const boothFloor = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.14, 2.65), refs.boothFloorMat);
  boothFloor.position.set(0, 0.07, -2.55);
  boothFloor.receiveShadow = true;
  group.add(boothFloor);

  // Voice Booth Acoustic Glass Walls (left, right, back acoustic foam slats)
  addGlassDivider(-1.6, -2.55, 2.55, Math.PI / 2, 2.05);
  addGlassDivider(1.6, -2.55, 2.55, Math.PI / 2, 2.05);
  const boothRoofFrame = new THREE.Mesh(new THREE.BoxGeometry(3.26, 0.06, 2.62), refs.wallTrimMat);
  boothRoofFrame.position.set(0, 2.18, -2.55);
  // Hollow frame look: make translucent skylight roof
  boothRoofFrame.material = new THREE.MeshStandardMaterial({
    color: 0x2e1f47,
    transparent: true,
    opacity: 0.28,
    roughness: 0.3,
  });
  group.add(boothRoofFrame);

  // Warm wooden/acoustic foam vertical slats inside back of voice booth
  const foamMat = new THREE.MeshStandardMaterial({ color: 0x4c1d95, roughness: 0.9, metalness: 0.02 });
  for (let i = -5; i <= 5; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.75, 0.08), foamMat);
    slat.position.set(i * 0.26, 1.05, -3.78);
    group.add(slat);
  }

  // Minimalist Studio Potted Plants in corners (for cozy modern office charm)
  function addPlant(x, z) {
    const plant = new THREE.Group();
    plant.position.set(x, 0, z);
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.18, 0.38, 12),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 })
    );
    pot.position.y = 0.19;
    plant.add(pot);

    const leafMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.55 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), leafMat);
      leaf.scale.set(0.7, 1.55, 0.45);
      leaf.position.set(Math.cos(a) * 0.14, 0.52 + (i % 2) * 0.12, Math.sin(a) * 0.14);
      leaf.rotation.z = -Math.cos(a) * 0.45;
      leaf.rotation.x = Math.sin(a) * 0.45;
      plant.add(leaf);
    }
    setShadowFlags(plant, true, true);
    group.add(plant);
  }
  addPlant(-6.4, -4.1);
  addPlant(6.4, -4.1);
  addPlant(-6.4, 4.2);
  addPlant(6.4, 4.2);

  return { group, refs };
}

// ── 7. Pipeline Conveyor Tracks & Glowing Data Orbs (1→2→3→4→5) ─────────────

function createPipelineSystem() {
  const group = new THREE.Group();
  const segments = [];

  const waypoints = [
    [
      new THREE.Vector3(-4.2, 0.06, 2.05),
      new THREE.Vector3(-4.5, 0.06, 0.0),
      new THREE.Vector3(-3.95, 0.06, -1.95),
    ],
    [
      new THREE.Vector3(-3.8, 0.06, -2.05),
      new THREE.Vector3(-2.0, 0.06, -2.35),
      new THREE.Vector3(-0.15, 0.16, -2.4),
    ],
    [
      new THREE.Vector3(0.15, 0.16, -2.4),
      new THREE.Vector3(2.1, 0.06, -2.25),
      new THREE.Vector3(3.95, 0.06, -1.75),
    ],
    [
      new THREE.Vector3(4.1, 0.06, -1.6),
      new THREE.Vector3(4.45, 0.06, 0.25),
      new THREE.Vector3(4.15, 0.06, 2.15),
    ],
  ];

  const segColors = [0xf59e0b, 0xfb7185, 0xa78bfa, 0x38bdf8];
  const trackBaseMat = new THREE.MeshStandardMaterial({ color: 0x162b42, roughness: 0.45, metalness: 0.55 });

  for (let i = 0; i < waypoints.length; i++) {
    const curve = new THREE.CatmullRomCurve3(waypoints[i]);
    const color = segColors[i];

    // Base conduit
    const conduit = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.075, 8, false), trackBaseMat);
    group.add(conduit);

    // Neon glowing energy core inside conduit
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
    });
    const glowTube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.032, 8, false), glowMat);
    glowTube.position.y = 0.04;
    group.add(glowTube);

    // 4 flowing data orbs per segment
    const orbs = [];
    const orbCoreGeo = new THREE.SphereGeometry(0.08, 12, 12);
    const orbHaloGeo = new THREE.SphereGeometry(0.16, 12, 12);
    const orbCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const orbHaloMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (let k = 0; k < 4; k++) {
      const orbGroup = new THREE.Group();
      const core = new THREE.Mesh(orbCoreGeo, orbCoreMat);
      const halo = new THREE.Mesh(orbHaloGeo, orbHaloMat);
      orbGroup.add(core);
      orbGroup.add(halo);
      group.add(orbGroup);
      orbs.push({ mesh: orbGroup, offset: k / 4 });
    }

    segments.push({
      fromIdx: i,
      toIdx: i + 1,
      curve,
      glowMat,
      orbHaloMat,
      orbs,
      speed: 0.16,
      energy: 0.25,
      phase: i * 0.25,
    });
  }

  return { group, segments, trackBaseMat };
}

// ── 8. Five Department Stations (Props + Articulated Chibi + Effects) ────────

function createStationSpotlightAndRing(accentHex) {
  const group = new THREE.Group();

  // Floor status ring around station
  const ringMat = new THREE.MeshBasicMaterial({
    color: accentHex,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.36, 1.48, 36), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.025;
  group.add(ring);

  // Soft volumetric spotlight cone overhead
  const coneMat = new THREE.MeshBasicMaterial({
    color: accentHex,
    transparent: true,
    opacity: 0.06,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 1.38, 3.4, 24, 1, true), coneMat);
  cone.position.y = 1.75;
  group.add(cone);

  // Dedicated station point light (brightens smoothly when active)
  const light = new THREE.PointLight(accentHex, 0.35, 5.5, 1.8);
  light.position.set(0, 2.45, 0.2);
  group.add(light);

  return { group, ring, ringMat, cone, coneMat, light };
}

function createDeskBase(width, depth, height, deskTopMat, deskLegMat) {
  const desk = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, depth), deskTopMat);
  top.position.y = height;
  desk.add(top);

  const legGeo = new THREE.CylinderGeometry(0.036, 0.036, height, 8);
  const lx = width / 2 - 0.12;
  const lz = depth / 2 - 0.12;
  for (const sx of [-lx, lx]) {
    for (const sz of [-lz, lz]) {
      const leg = new THREE.Mesh(legGeo, deskLegMat);
      leg.position.set(sx, height / 2, sz);
      desk.add(leg);
    }
  }
  return desk;
}

function createAllStations(displays, sharedMats) {
  const controllers = {};

  function buildHitbox(stationId) {
    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(1.45, 1.45, 2.5, 12),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.y = 1.25;
    hit.userData.stationId = stationId;
    return hit;
  }

  // ── STATION 1: SCRIPT (📝 น้องสคริปต์) ──────────────────────────────────
  {
    const meta = STATION_MAP.script;
    const root = new THREE.Group();
    root.position.set(...meta.pos);

    const fx = createStationSpotlightAndRing(meta.accentHex);
    root.add(fx.group);

    const rig = new THREE.Group();
    rig.rotation.y = meta.rotY;
    root.add(rig);

    // Desk
    const desk = createDeskBase(1.75, 0.92, 0.74, sharedMats.deskTop, sharedMats.deskLeg);
    desk.position.set(0, 0, 0.56);
    rig.add(desk);

    // Sleek laptop
    const laptopBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.035, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.25 })
    );
    laptopBase.position.set(0, 0.8, 0.52);
    rig.add(laptopBase);

    const laptopLid = new THREE.Group();
    laptopLid.position.set(0, 0.81, 0.72);
    laptopLid.rotation.x = -0.32;
    const lidBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.4, 0.025),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.25 })
    );
    lidBack.position.y = 0.2;
    laptopLid.add(lidBack);

    const screenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.34),
      new THREE.MeshBasicMaterial({ map: displays.script.tex })
    );
    screenMesh.position.set(0, 0.2, -0.015);
    screenMesh.rotation.y = Math.PI;
    laptopLid.add(screenMesh);
    rig.add(laptopLid);

    // Coffee mug + rising steam wisps
    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.06, 0.14, 12),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35 })
    );
    mug.position.set(0.58, 0.85, 0.48);
    rig.add(mug);

    const steams = [];
    const steamMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7, transparent: true, opacity: 0.42 });
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 8), steamMat.clone());
      puff.position.set(0.58, 0.98 + i * 0.12, 0.48);
      rig.add(puff);
      steams.push({ mesh: puff, offset: i / 3 });
    }

    // 3 Floating Holographic Script Cards orbiting above desk
    const holoCards = [];
    const cardMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 3; i++) {
      const card = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24), cardMat.clone());
      card.add(plate);
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.36, 0.24)),
        new THREE.LineBasicMaterial({ color: 0xfef08a })
      );
      card.add(border);
      rig.add(card);
      holoCards.push({ mesh: card, angleOffset: (i / 3) * Math.PI * 2 });
    }

    // Chibi Character
    const chibi = createChibiCharacter({
      shirtColor: 0xd97706,
      accentColor: meta.accentHex,
      hairColor: 0x271e1a,
      accessory: 'glasses',
    });
    chibi.root.position.set(0, 0, -0.05);
    rig.add(chibi.root);

    setShadowFlags(rig, true, true);
    root.add(buildHitbox(meta.id));
    tagStationTree(root, meta.id);

    controllers.script = {
      meta,
      root,
      fx,
      chibi,
      update(time, dt, activity) {
        animateBlink(chibi, dt);
        const speed = 2.4 + activity * 9.5;

        // Breathing & subtle forward lean when typing actively
        chibi.pelvis.position.y = 0.5 + Math.sin(time * 2.2) * 0.015;
        chibi.torsoPivot.rotation.x = 0.08 + activity * 0.1 + Math.sin(time * 3.1) * 0.025;
        chibi.torsoPivot.rotation.z = Math.sin(time * 1.8) * 0.03 * (0.3 + activity);

        // Head nods reading holographic cards
        chibi.headPivot.rotation.x = 0.08 + Math.sin(time * (1.8 + activity * 2.6)) * (0.05 + activity * 0.07);
        chibi.headPivot.rotation.y = Math.sin(time * 1.35) * (0.14 + activity * 0.14);

        // Rapid alternating typing hands
        const typeL = Math.sin(time * speed) * (0.06 + activity * 0.22);
        const typeR = Math.sin(time * speed + Math.PI) * (0.06 + activity * 0.22);
        chibi.armL.shoulder.rotation.set(-0.78 + typeL * 0.5, 0.18, 0.16);
        chibi.armL.elbow.rotation.set(-0.85 - typeL, 0, 0);
        chibi.armR.shoulder.rotation.set(-0.78 + typeR * 0.5, -0.18, -0.16);
        chibi.armR.elbow.rotation.set(-0.85 - typeR, 0, 0);

        // Orbiting hologram script cards
        for (const c of holoCards) {
          const a = time * (0.55 + activity * 0.9) + c.angleOffset;
          c.mesh.position.set(
            Math.cos(a) * 0.58,
            1.48 + Math.sin(time * 2.4 + c.angleOffset) * 0.09,
            0.55 + Math.sin(a) * 0.26
          );
          c.mesh.rotation.y = -a + Math.PI / 2;
          c.mesh.children[0].material.opacity = 0.24 + activity * 0.36;
        }

        // Coffee steam rising
        for (const s of steams) {
          const u = (time * 0.45 + s.offset) % 1;
          s.mesh.position.set(0.58 + Math.sin(u * 6 + s.offset) * 0.04, 0.96 + u * 0.38, 0.48);
          s.mesh.scale.setScalar(0.6 + u * 0.9);
          s.mesh.material.opacity = (1 - u) * 0.42;
        }
      },
    };
  }

  // ── STATION 2: ART (🎨 น้องอาร์ต) ────────────────────────────────────────
  {
    const meta = STATION_MAP.art;
    const root = new THREE.Group();
    root.position.set(...meta.pos);

    const fx = createStationSpotlightAndRing(meta.accentHex);
    root.add(fx.group);

    const rig = new THREE.Group();
    rig.rotation.y = meta.rotY;
    root.add(rig);

    // Drafting desk base
    const desk = createDeskBase(1.82, 0.95, 0.72, sharedMats.deskTop, sharedMats.deskLeg);
    desk.position.set(0, 0, 0.52);
    rig.add(desk);

    // Tilted Digital Drawing Display angled upward toward camera so live artwork & artist face are both clear!
    const tabletPivot = new THREE.Group();
    tabletPivot.position.set(0.12, 0.94, 0.58);
    tabletPivot.rotation.set(-0.92, -0.14, 0);

    const tabletBezel = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.78, 0.055),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.45 })
    );
    tabletPivot.add(tabletBezel);

    const tabletScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.06, 0.68),
      new THREE.MeshBasicMaterial({ map: displays.art.tex })
    );
    tabletScreen.position.z = 0.032;
    tabletPivot.add(tabletScreen);
    rig.add(tabletPivot);

    // Color palette swatches & brush cup on desk corner
    const brushCup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.06, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0xfb7185, roughness: 0.4 })
    );
    brushCup.position.set(-0.7, 0.84, 0.56);
    rig.add(brushCup);

    // Floating color sparkle particles near tablet
    const sparkles = [];
    const sparkColors = [0xfb7185, 0xf59e0b, 0x38bdf8, 0xa78bfa, 0x34d399];
    for (let i = 0; i < 7; i++) {
      const sp = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.048, 0),
        new THREE.MeshBasicMaterial({ color: sparkColors[i % sparkColors.length], transparent: true, opacity: 0.8 })
      );
      rig.add(sp);
      sparkles.push({ mesh: sp, seed: i * 1.13 });
    }

    // Chibi Artist Character
    const chibi = createChibiCharacter({
      shirtColor: 0x0f766e,
      accentColor: meta.accentHex,
      hairColor: 0x3b1f2b,
      accessory: 'beret',
    });
    chibi.root.position.set(-0.08, 0, -0.08);
    rig.add(chibi.root);

    // Glowing Stylus Pen attached to right hand
    const stylusGroup = new THREE.Group();
    const stylusBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.012, 0.34, 8),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.5, roughness: 0.3 })
    );
    stylusBody.rotation.x = Math.PI / 2;
    stylusBody.position.z = 0.1;
    stylusGroup.add(stylusBody);

    const stylusTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xfda4af })
    );
    stylusTip.position.z = 0.27;
    stylusGroup.add(stylusTip);
    chibi.armR.hand.add(stylusGroup);

    setShadowFlags(rig, true, true);
    root.add(buildHitbox(meta.id));
    tagStationTree(root, meta.id);

    controllers.art = {
      meta,
      root,
      fx,
      chibi,
      update(time, dt, activity) {
        animateBlink(chibi, dt);
        const speed = 1.6 + activity * 4.4;

        chibi.pelvis.position.y = 0.5 + Math.sin(time * 2.0 + 0.8) * 0.016;
        chibi.torsoPivot.rotation.x = 0.12 + activity * 0.08;
        chibi.torsoPivot.rotation.z = Math.sin(time * 1.5) * (0.04 + activity * 0.06);

        // Artist tilts head thoughtfully while painting
        chibi.headPivot.rotation.z = Math.sin(time * 1.4) * (0.09 + activity * 0.09);
        chibi.headPivot.rotation.x = 0.06 + Math.cos(time * 1.9) * 0.06;
        chibi.headPivot.rotation.y = Math.sin(time * 1.1) * 0.16;

        // Right arm sweeps smooth figure-8 brush strokes
        const sweepX = Math.sin(time * speed) * (0.1 + activity * 0.32);
        const sweepY = Math.cos(time * speed * 1.35) * (0.08 + activity * 0.28);
        chibi.armR.shoulder.rotation.set(-0.98 + sweepY, -0.22 + sweepX, -0.18);
        chibi.armR.elbow.rotation.set(-0.72 + sweepY * 0.6, 0, 0);

        // Left arm steadies tablet edge
        chibi.armL.shoulder.rotation.set(-0.76, 0.26, 0.22);
        chibi.armL.elbow.rotation.set(-0.82, 0, 0);

        // Sparkles burst off the canvas while painting
        for (const sp of sparkles) {
          const u = (time * (0.35 + activity * 0.75) + sp.seed) % 1;
          const angle = sp.seed * 2.3 + time * 1.2;
          sp.mesh.position.set(
            0.05 + Math.cos(angle) * (0.25 + u * 0.42),
            1.15 + u * 0.72,
            0.55 + Math.sin(angle) * 0.25
          );
          sp.mesh.rotation.set(time * 2.5, time * 1.8, 0);
          const sc = (0.35 + activity * 0.85) * Math.sin(u * Math.PI);
          sp.mesh.scale.setScalar(Math.max(0.01, sc));
          sp.mesh.material.opacity = (0.2 + activity * 0.75) * Math.sin(u * Math.PI);
        }
      },
    };
  }

  // ── STATION 3: VOICE (🎙️ น้องพากย์) ─────────────────────────────────────
  {
    const meta = STATION_MAP.voice;
    const root = new THREE.Group();
    root.position.set(...meta.pos);

    const fx = createStationSpotlightAndRing(meta.accentHex);
    root.add(fx.group);

    const rig = new THREE.Group();
    rig.rotation.y = meta.rotY;
    root.add(rig);

    // Compact acoustic voice console desk
    const desk = createDeskBase(1.45, 0.62, 0.78, sharedMats.deskTop, sharedMats.deskLeg);
    desk.position.set(0, 0, 0.56);
    rig.add(desk);

    // Condenser Microphone on sleek boom stand + Pop Filter
    const micMetal = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.22 });
    const micBase = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.04, 14), micMetal);
    micBase.position.set(-0.28, 0.84, 0.52);
    rig.add(micBase);

    const micPole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.58, 8), micMetal);
    micPole.position.set(-0.28, 1.12, 0.52);
    rig.add(micPole);

    const micArm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.36, 8), micMetal);
    micArm.rotation.z = Math.PI / 2.2;
    micArm.position.set(-0.14, 1.38, 0.45);
    rig.add(micArm);

    const micBody = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.045, 0.12, 8, 12),
      new THREE.MeshStandardMaterial({ color: 0x1e1b4b, metalness: 0.6, roughness: 0.25 })
    );
    micBody.position.set(0.02, 1.32, 0.38);
    rig.add(micBody);

    const micGlowRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.052, 0.01, 8, 16),
      new THREE.MeshBasicMaterial({ color: 0xc4b5fd })
    );
    micGlowRing.rotation.x = Math.PI / 2;
    micGlowRing.position.set(0.02, 1.34, 0.38);
    rig.add(micGlowRing);

    // Pop Filter disc
    const popFilter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.095, 0.012, 18),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, transparent: true, opacity: 0.65, roughness: 0.8 })
    );
    popFilter.rotation.x = Math.PI / 2;
    popFilter.position.set(0.02, 1.32, 0.28);
    rig.add(popFilter);

    // 7-Bar 3D Audio Equalizer mounted as glowing studio backdrop behind the vocalist (unobstructed!)
    const eqRack = new THREE.Mesh(
      new THREE.BoxGeometry(1.36, 0.12, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x1e1b4b, roughness: 0.45, metalness: 0.4 })
    );
    eqRack.position.set(0, 0.94, -0.82);
    rig.add(eqRack);

    const eqBars = [];
    const eqColors = [0x38bdf8, 0x60a5fa, 0x818cf8, 0xa78bfa, 0xc084fc, 0xe879f9, 0xf472b6];
    for (let i = 0; i < 7; i++) {
      const barMat = new THREE.MeshStandardMaterial({
        color: eqColors[i],
        emissive: eqColors[i],
        emissiveIntensity: 0.65,
        roughness: 0.22,
      });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.76, 0.11), barMat);
      bar.position.set(-0.54 + i * 0.18, 1.0, -0.82);
      rig.add(bar);
      eqBars.push({ mesh: bar, phase: i * 0.85 });
    }

    // Concentric Sound Wave Rings expanding outward from microphone
    const soundRings = [];
    for (let i = 0; i < 3; i++) {
      const srMat = new THREE.MeshBasicMaterial({
        color: 0xa78bfa,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      });
      const sr = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.18, 28), srMat);
      sr.position.set(0.02, 1.32, 0.42);
      rig.add(sr);
      soundRings.push({ mesh: sr, mat: srMat, offset: i / 3 });
    }

    // Chibi Voice Actor on studio stool
    const chibi = createChibiCharacter({
      shirtColor: 0x6d28d9,
      accentColor: meta.accentHex,
      hairColor: 0x1e1b2e,
      accessory: 'headphones',
      stoolMode: true,
    });
    chibi.root.position.set(0, 0, -0.1);
    rig.add(chibi.root);

    setShadowFlags(rig, true, true);
    root.add(buildHitbox(meta.id));
    tagStationTree(root, meta.id);

    controllers.voice = {
      meta,
      root,
      fx,
      chibi,
      update(time, dt, activity) {
        animateBlink(chibi, dt);
        const talkSpeed = 3.2 + activity * 9.0;

        chibi.pelvis.position.y = 0.62 + Math.sin(time * 2.4) * 0.015;
        chibi.torsoPivot.rotation.x = 0.04 + Math.sin(time * 2.8) * (0.02 + activity * 0.05);
        chibi.torsoPivot.rotation.z = Math.sin(time * 2.1) * (0.03 + activity * 0.06);

        // Expressive head bobbing & mouth opening while speaking
        chibi.headPivot.rotation.x = Math.sin(time * (2.6 + activity * 3.8)) * (0.04 + activity * 0.08);
        chibi.headPivot.rotation.y = Math.sin(time * 1.7) * (0.08 + activity * 0.1);
        const talkAmt = Math.abs(Math.sin(time * talkSpeed)) * activity;
        chibi.mouth.scale.set(1.25 + talkAmt * 0.35, 0.42 + talkAmt * 1.35, 0.55);

        // Expressive hand gestures near chest/headphones
        const gest = Math.sin(time * (2.4 + activity * 3.4));
        chibi.armL.shoulder.rotation.set(-0.62 + gest * (0.06 + activity * 0.24), 0.28, 0.24);
        chibi.armL.elbow.rotation.set(-0.95 - gest * activity * 0.2, 0, 0);
        chibi.armR.shoulder.rotation.set(-0.68 - gest * (0.05 + activity * 0.26), -0.25, -0.22);
        chibi.armR.elbow.rotation.set(-1.02 + gest * activity * 0.22, 0, 0);

        // 7-bar 3D Audio EQ bouncing
        for (const bar of eqBars) {
          const wave =
            0.2 +
            (0.15 + activity * 0.85) *
              (0.5 + 0.5 * Math.sin(time * (3.5 + activity * 6.5) + bar.phase) * Math.cos(time * 2.3 + bar.phase * 0.7));
          const sy = Math.max(0.16, wave * 1.48);
          bar.mesh.scale.y = sy;
          bar.mesh.position.y = 1.0 + (0.76 * sy) / 2;
          bar.mesh.material.emissiveIntensity = 0.28 + activity * 0.9;
        }

        // Expanding sound wave rings
        for (const sr of soundRings) {
          const u = (time * (0.35 + activity * 0.85) + sr.offset) % 1;
          sr.mesh.position.z = 0.42 + u * 0.65;
          sr.mesh.scale.setScalar(0.6 + u * 2.2);
          sr.mat.opacity = (0.08 + activity * 0.62) * (1 - u);
        }
      },
    };
  }

  // ── STATION 4: EDIT & GPU RENDER (🎬 น้องตัดต่อ) ────────────────────────
  {
    const meta = STATION_MAP.edit;
    const root = new THREE.Group();
    root.position.set(...meta.pos);

    const fx = createStationSpotlightAndRing(meta.accentHex);
    root.add(fx.group);

    const rig = new THREE.Group();
    rig.rotation.y = meta.rotY;
    root.add(rig);

    // Wide Editor Desk
    const desk = createDeskBase(2.05, 0.96, 0.74, sharedMats.deskTop, sharedMats.deskLeg);
    desk.position.set(0.05, 0, 0.56);
    rig.add(desk);

    // Curved Dual Wide Monitor Rig (angled slightly so both screens & character read clearly)
    const monStand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.14, 0.32, 12),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 })
    );
    monStand.position.set(-0.1, 0.92, 0.78);
    rig.add(monStand);

    const monitorGroup = new THREE.Group();
    monitorGroup.position.set(-0.1, 1.24, 0.76);
    const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.55 });
    const monitorBack = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.62, 0.06), bezelMat);
    monitorGroup.add(monitorBack);

    // Front screen (facing editor) AND glowing mirrored rear HUD preview so viewer sees live timeline from any angle!
    const screenFront = new THREE.Mesh(
      new THREE.PlaneGeometry(1.48, 0.54),
      new THREE.MeshBasicMaterial({ map: displays.edit.tex })
    );
    screenFront.position.z = -0.034;
    screenFront.rotation.y = Math.PI;
    monitorGroup.add(screenFront);

    const screenRear = new THREE.Mesh(
      new THREE.PlaneGeometry(1.48, 0.54),
      new THREE.MeshBasicMaterial({ map: displays.edit.tex })
    );
    screenRear.position.z = 0.034;
    monitorGroup.add(screenRear);
    rig.add(monitorGroup);

    // Keyboard & Jog-Wheel Editing Controller
    const kb = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.03, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 })
    );
    kb.position.set(-0.22, 0.79, 0.44);
    rig.add(kb);

    const jogWheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.09, 0.04, 16),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.45, roughness: 0.25 })
    );
    jogWheel.position.set(0.24, 0.8, 0.44);
    rig.add(jogWheel);

    // GPU Render Tower with 3 Spinning Glowing Fans + Holographic Render Ring
    const tower = new THREE.Group();
    tower.position.set(0.82, 1.12, 0.56);
    const caseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.68, 0.46),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.32, metalness: 0.65 })
    );
    tower.add(caseMesh);

    const gpuFans = [];
    const fanBladeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    for (let i = 0; i < 3; i++) {
      const fanPivot = new THREE.Group();
      fanPivot.position.set(0, -0.19 + i * 0.19, 0.236);
      const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.01, 8, 16), fanBladeMat);
      fanPivot.add(fanRing);
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.01), fanBladeMat);
        blade.rotation.z = (b / 3) * Math.PI;
        fanPivot.add(blade);
      }
      tower.add(fanPivot);
      gpuFans.push(fanPivot);
    }

    // Floating holographic render ring above GPU tower
    const renderRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.024, 10, 28, Math.PI * 1.5),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 })
    );
    renderRing.position.set(0, 0.52, 0);
    renderRing.rotation.x = Math.PI / 2;
    tower.add(renderRing);
    rig.add(tower);

    // Chibi Video Editor Character
    const chibi = createChibiCharacter({
      shirtColor: 0x0369a1,
      accentColor: meta.accentHex,
      hairColor: 0x0f172a,
      accessory: 'headset',
    });
    chibi.root.position.set(-0.08, 0, -0.06);
    rig.add(chibi.root);

    setShadowFlags(rig, true, true);
    root.add(buildHitbox(meta.id));
    tagStationTree(root, meta.id);

    controllers.edit = {
      meta,
      root,
      fx,
      chibi,
      update(time, dt, activity) {
        animateBlink(chibi, dt);
        const speed = 2.6 + activity * 8.5;

        chibi.pelvis.position.y = 0.5 + Math.sin(time * 2.3 + 1.4) * 0.015;
        chibi.torsoPivot.rotation.x = 0.1 + activity * 0.08;
        chibi.torsoPivot.rotation.y = Math.sin(time * (1.2 + activity * 1.4)) * 0.08;

        // Editor scans head smoothly left-right across dual monitor preview & timeline
        chibi.headPivot.rotation.y = Math.sin(time * (1.1 + activity * 1.8)) * (0.18 + activity * 0.22);
        chibi.headPivot.rotation.x = 0.03 + Math.sin(time * 2.5) * 0.04;

        // Left hand taps shortcuts, right hand scrubs jog-wheel
        const tapL = Math.sin(time * speed) * (0.05 + activity * 0.2);
        const scrubR = Math.cos(time * speed * 0.65) * (0.06 + activity * 0.22);
        chibi.armL.shoulder.rotation.set(-0.82 + tapL * 0.4, 0.2, 0.18);
        chibi.armL.elbow.rotation.set(-0.84 - tapL, 0, 0);
        chibi.armR.shoulder.rotation.set(-0.84, -0.18 + scrubR * 0.6, -0.18);
        chibi.armR.elbow.rotation.set(-0.82 + scrubR * 0.4, 0, 0);

        // GPU fans spin dramatically faster when rendering
        const fanSpeed = 2.5 + activity * 16.0;
        for (const f of gpuFans) f.rotation.z -= dt * fanSpeed;

        // Hologram render ring spins & floats
        renderRing.rotation.z += dt * (1.2 + activity * 4.2);
        renderRing.position.y = 0.52 + Math.sin(time * 3.0) * 0.05;
        renderRing.material.opacity = 0.35 + activity * 0.6;
      },
    };
  }

  // ── STATION 5: PUBLISH & QC (🚀 น้องโปรดิวเซอร์ QC & โพสต์) ─────────────
  {
    const meta = STATION_MAP.publish;
    const root = new THREE.Group();
    root.position.set(...meta.pos);

    const fx = createStationSpotlightAndRing(meta.accentHex);
    root.add(fx.group);

    const rig = new THREE.Group();
    rig.rotation.y = meta.rotY;
    root.add(rig);

    // Command QC Console Desk
    const desk = createDeskBase(1.85, 0.92, 0.74, sharedMats.deskTop, sharedMats.deskLeg);
    desk.position.set(0, 0, 0.56);
    rig.add(desk);

    // Big QC Display Screen (slightly angled to left side so producer & screen both stay unobstructed)
    const qcFrame = new THREE.Group();
    qcFrame.position.set(-0.3, 1.18, 0.74);
    qcFrame.rotation.y = 0.26;
    const qcBack = new THREE.Mesh(
      new THREE.BoxGeometry(1.14, 0.62, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.55 })
    );
    qcFrame.add(qcBack);

    const qcScreenFront = new THREE.Mesh(
      new THREE.PlaneGeometry(1.06, 0.54),
      new THREE.MeshBasicMaterial({ map: displays.publish.tex })
    );
    qcScreenFront.position.z = -0.034;
    qcScreenFront.rotation.y = Math.PI;
    qcFrame.add(qcScreenFront);

    const qcScreenRear = new THREE.Mesh(
      new THREE.PlaneGeometry(1.06, 0.54),
      new THREE.MeshBasicMaterial({ map: displays.publish.tex })
    );
    qcScreenRear.position.z = 0.034;
    qcFrame.add(qcScreenRear);
    rig.add(qcFrame);

    // Glowing Green Launch / Approve Button on Console
    const launchPad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 0.05, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 })
    );
    launchPad.position.set(0.32, 0.8, 0.42);
    rig.add(launchPad);

    const launchBtn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.05, 16),
      new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 0.75, roughness: 0.2 })
    );
    launchBtn.position.set(0.32, 0.835, 0.42);
    rig.add(launchBtn);

    // Broadcast Antenna Mast + Emitting Signal Rings
    const antennaGroup = new THREE.Group();
    antennaGroup.position.set(0.72, 0.78, 0.66);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.045, 1.38, 10),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.75, roughness: 0.25 })
    );
    mast.position.y = 0.69;
    antennaGroup.add(mast);

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x34d399 })
    );
    beacon.position.y = 1.42;
    antennaGroup.add(beacon);

    const signalRings = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      });
      const rMesh = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 24), mat);
      rMesh.rotation.x = Math.PI / 2;
      rMesh.position.y = 1.42;
      antennaGroup.add(rMesh);
      signalRings.push({ mesh: rMesh, mat, offset: i / 3 });
    }
    rig.add(antennaGroup);

    // 5 Rising Social Platform Orbs (YouTube, TikTok, Facebook, Instagram, Telegram)
    const socialDefs = [
      { key: 'youtube', color: 0xef4444 },
      { key: 'tiktok', color: 0x22d3ee },
      { key: 'facebook', color: 0x3b82f6 },
      { key: 'instagram', color: 0xa855f7 },
      { key: 'telegram', color: 0x0ea5e9 },
    ];
    const socialOrbs = [];
    for (let i = 0; i < socialDefs.length; i++) {
      const orbGroup = new THREE.Group();
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.095, 14, 14),
        new THREE.MeshStandardMaterial({
          color: socialDefs[i].color,
          emissive: socialDefs[i].color,
          emissiveIntensity: 0.55,
          roughness: 0.22,
        })
      );
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.13, 0.012, 8, 20),
        new THREE.MeshBasicMaterial({ color: socialDefs[i].color, transparent: true, opacity: 0.7 })
      );
      orbGroup.add(sphere);
      orbGroup.add(halo);
      rig.add(orbGroup);
      socialOrbs.push({ mesh: orbGroup, halo, offset: i / socialDefs.length });
    }

    // Chibi Producer Character
    const chibi = createChibiCharacter({
      shirtColor: 0x047857,
      accentColor: meta.accentHex,
      hairColor: 0x1e293b,
      accessory: 'visor',
    });
    chibi.root.position.set(-0.04, 0, -0.06);
    rig.add(chibi.root);

    setShadowFlags(rig, true, true);
    root.add(buildHitbox(meta.id));
    tagStationTree(root, meta.id);

    controllers.publish = {
      meta,
      root,
      fx,
      chibi,
      update(time, dt, activity) {
        animateBlink(chibi, dt);
        const pulse = Math.sin(time * (2.2 + activity * 3.0));

        chibi.pelvis.position.y = 0.5 + Math.sin(time * 2.1 + 2.2) * 0.015;
        chibi.torsoPivot.rotation.x = 0.06 + activity * 0.06;
        chibi.torsoPivot.rotation.z = Math.sin(time * 1.6) * 0.04;

        // Producer checks QC screen & nods approvingly
        chibi.headPivot.rotation.y = Math.sin(time * 1.45) * 0.2;
        chibi.headPivot.rotation.x = Math.sin(time * 2.6) * (0.04 + activity * 0.07);

        // Right arm presses glowing launch button / raises in celebration!
        const pressWave = Math.sin(time * (1.8 + activity * 2.4));
        const celebrate = activity > 0.5 && pressWave > 0.45 ? (pressWave - 0.45) * 1.8 : 0;
        chibi.armR.shoulder.rotation.set(-0.82 - celebrate * 0.95, -0.18, -0.18 - celebrate * 0.25);
        chibi.armR.elbow.rotation.set(-0.82 + celebrate * 0.55, 0, 0);
        launchBtn.position.y = 0.835 - (pressWave < -0.5 ? 0.018 : 0);

        chibi.armL.shoulder.rotation.set(-0.74, 0.24, 0.2);
        chibi.armL.elbow.rotation.set(-0.88 + pulse * 0.08, 0, 0);

        // Antenna signal rings rising upward
        for (const r of signalRings) {
          const u = (time * (0.38 + activity * 0.72) + r.offset) % 1;
          r.mesh.position.y = 1.42 + u * 0.82;
          r.mesh.scale.setScalar(0.65 + u * 2.4);
          r.mat.opacity = (0.12 + activity * 0.65) * (1 - u);
        }

        // Social platform orbs floating upward along helix above antenna
        for (const o of socialOrbs) {
          const u = (time * (0.18 + activity * 0.34) + o.offset) % 1;
          const a = time * 1.5 + o.offset * Math.PI * 2;
          const radius = 0.32 + Math.sin(u * Math.PI) * 0.22;
          o.mesh.position.set(
            0.72 + Math.cos(a) * radius,
            1.45 + u * 1.35,
            0.66 + Math.sin(a) * radius
          );
          o.halo.rotation.x = time * 2.2;
          o.halo.rotation.y = time * 1.6;
          const sc = (0.45 + activity * 0.62) * Math.sin(u * Math.PI);
          o.mesh.scale.setScalar(Math.max(0.01, sc));
        }
      },
    };
  }

  return controllers;
}

// ── 9. Real Data -> 5-Station Live State Mapper ──────────────────────────────

function detectJobStationIndex(job) {
  const status = String(job?.status || '').toLowerCase();
  const stage = String(job?.stage || job?.currentStep || job?.stepLabel || '').toLowerCase();
  const combined = `${status} ${stage}`;

  if (/(publish|upload|social|telegram|post|qc)/.test(combined)) return 4;
  if (/(render|mix|edit|remotion|ffmpeg|preview|compos|encode)/.test(combined)) return 3;
  if (/(tts|voice|audio|narrat|speech|พากย์|เสียง)/.test(combined)) return 2;
  if (/(art|image|visual|story|scene|draw|extract|download|asset|ภาพ)/.test(combined)) return 1;
  if (/(script|research|plan|draft|analyz|queue|สคริปต์)/.test(combined)) return 0;

  // Fallback by progress percentage when status is generic 'running' / 'building'
  const pct = Number(job?.progress ?? job?.pct ?? 0);
  if (pct >= 88) return 4;
  if (pct >= 58) return 3;
  if (pct >= 38) return 2;
  if (pct >= 18) return 1;
  return 0;
}

function mapLiveDataToStations({ factoryState, overviewData, socialQueue, demoMode }) {
  const jobs = Array.isArray(factoryState?.jobs) ? factoryState.jobs : [];
  const socialItems = Array.isArray(socialQueue)
    ? socialQueue
    : Array.isArray(socialQueue?.items)
    ? socialQueue.items
    : [];
  const analytics = factoryState?.analytics || {};
  const workers = factoryState?.workers || {};
  const onlineWorkers = Array.isArray(workers?.nodes)
    ? workers.nodes.filter((n) => n.online)
    : [];
  const gpuNodeName =
    onlineWorkers.find((n) => n.specs?.hasNvenc)?.name ||
    onlineWorkers[0]?.name ||
    overviewData?.nodes?.find((n) => n.online && n.id !== 'homelab')?.name ||
    'homelab';

  const qcPending = Number(
    analytics.qcPendingJobs ??
      jobs.filter((j) => j.status === 'done' && String(j.qcStatus || 'pending') === 'pending').length
  );
  const socialUploading = socialItems.filter((it) => ['uploading', 'posting', 'running'].includes(String(it.status || '').toLowerCase()));
  const socialScheduled = socialItems.filter((it) => ['scheduled', 'queued', 'pending'].includes(String(it.status || '').toLowerCase()));
  const draftJobs = jobs.filter((j) => j.status === 'draft_ready' || (j.status === 'done' && j.qcStatus === 'rejected'));
  const runningJob = jobs.find(
    (j) =>
      j.alive ||
      j.factoryCol === 'running' ||
      ['researching', 'scripting', 'tts', 'rendering', 'mixing', 'previewing', 'editing', 'building', 'running'].includes(
        String(j.status || '').toLowerCase()
      )
  );
  const latestDoneJob = jobs.find((j) => j.status === 'done');

  const states = {};
  for (const s of STATIONS) {
    states[s.id] = {
      id: s.id,
      index: s.index,
      emoji: s.emoji,
      name: s.name,
      shortName: s.shortName,
      dept: s.dept,
      role: s.role,
      accent: s.accent,
      status: 'idle', // 'active' | 'done' | 'pending' | 'idle' | 'error'
      statusText: 'พร้อม',
      detail: 'สแตนด์บายรับออเดอร์',
      jobTitle: '',
      progress: 0,
      renderNode: s.id === 'edit' ? gpuNodeName : '',
      targetActivity: 0.14,
      demoMode: Boolean(demoMode),
    };
  }

  if (demoMode) {
    for (const s of STATIONS) {
      states[s.id].status = 'active';
      states[s.id].statusText = '⚡ กำลังทำ';
      states[s.id].detail = s.demoDetail;
      states[s.id].jobTitle = s.demoJob;
      states[s.id].progress = s.index === 3 ? 74 : (s.index + 1) * 20;
      states[s.id].targetActivity = 1.0;
    }
    return {
      states,
      summary: {
        demoMode: true,
        anyActive: true,
        activeCount: 5,
        qcPending,
        gpuNodes: Math.max(1, Number(workers.nvencCount ?? onlineWorkers.length ?? 1)),
        socialQueued: Math.max(3, socialScheduled.length + socialUploading.length),
        headline: 'DEMO MODE · ทุกแผนกกำลังผลิต Daily News Broadcast v2',
        progressPct: 74,
      },
    };
  }

  // Live Mode mapping
  if (runningJob) {
    const activeIdx = detectJobStationIndex(runningJob);
    const jobTitle = truncateText(runningJob.topic || runningJob.title || runningJob.slug || runningJob.id, 30);
    const pct = Math.max(0, Math.min(100, Number(runningJob.progress ?? runningJob.pct ?? (activeIdx + 1) * 18)));
    const rNode = runningJob.renderNode || runningJob.outputs?.renderNode || gpuNodeName;

    for (const s of STATIONS) {
      const st = states[s.id];
      st.jobTitle = jobTitle;
      if (s.index < activeIdx) {
        st.status = 'done';
        st.statusText = '✓ เสร็จ';
        st.detail = `ส่งต่องาน "${truncateText(jobTitle, 18)}" แล้ว`;
        st.progress = 100;
        st.targetActivity = 0.28;
      } else if (s.index === activeIdx) {
        st.status = 'active';
        st.statusText = '⚡ กำลังทำ';
        st.progress = pct;
        st.renderNode = s.id === 'edit' ? rNode : '';
        st.detail = s.id === 'edit'
          ? `${pct}% · ${rNode}`
          : `${truncateText(jobTitle, 20)}${pct > 0 ? ` · ${pct}%` : ''}`;
        st.targetActivity = 1.0;
      } else {
        st.status = 'pending';
        st.statusText = 'รอรับช่วง';
        st.detail = `รอคิวต่อจาก${STATIONS[activeIdx].shortName}`;
        st.targetActivity = 0.22;
      }
    }
  } else {
    // No actively rendering job: reflect drafts, QC queue, and social publishing queue!
    if (draftJobs.length > 0) {
      states.script.status = 'pending';
      states.script.statusText = `รอแก้ ${draftJobs.length}`;
      states.script.detail = truncateText(draftJobs[0].topic || 'มีบท/ร่างรอตรวจ', 24);
      states.script.jobTitle = draftJobs[0].topic || '';
      states.script.targetActivity = 0.55;
    } else if (latestDoneJob) {
      states.script.status = 'done';
      states.script.statusText = '✓ เสร็จ';
      states.script.detail = `ล่าสุด: ${truncateText(latestDoneJob.topic || latestDoneJob.id, 18)}`;
      states.art.status = 'done';
      states.art.statusText = '✓ เสร็จ';
      states.art.detail = 'ซีนล่าสุดพร้อมใช้งาน';
      states.voice.status = 'done';
      states.voice.statusText = '✓ เสร็จ';
      states.voice.detail = 'เสียงพากย์ซิงก์ครบ';
      states.edit.status = 'done';
      states.edit.statusText = '✓ เสร็จ';
      states.edit.detail = `พร้อมเรนเดอร์ · ${gpuNodeName}`;
    }

    if (socialUploading.length > 0) {
      states.publish.status = 'active';
      states.publish.statusText = '⚡ กำลังโพสต์';
      states.publish.detail = `ส่งออก ${socialUploading.length} ช่องทาง`;
      states.publish.targetActivity = 0.95;
    } else if (qcPending > 0) {
      states.publish.status = 'pending';
      states.publish.statusText = `รอ QC (${qcPending})`;
      states.publish.detail = `มีคลิปผ่านเรนเดอร์รอตรวจ ${qcPending} รายการ`;
      states.publish.targetActivity = 0.65;
    } else if (socialScheduled.length > 0) {
      states.publish.status = 'pending';
      states.publish.statusText = `คิวโพสต์ (${socialScheduled.length})`;
      states.publish.detail = `ตั้งเวลาโพสต์โซเชียล ${socialScheduled.length} คลิป`;
      states.publish.targetActivity = 0.45;
    } else if (latestDoneJob) {
      states.publish.status = 'done';
      states.publish.statusText = '✓ เสร็จ';
      states.publish.detail = `ส่งแล้ว ${analytics.socialPublishedCount || 0} โพสต์`;
    }
  }

  const activeCount = Object.values(states).filter((s) => s.status === 'active').length;
  const headline = runningJob
    ? `LIVE · ${truncateText(runningJob.topic || runningJob.title || runningJob.id, 34)}`
    : qcPending > 0
    ? `รอตรวจ QC ${qcPending} คลิป · GPU พร้อม ${workers.onlineCount || onlineWorkers.length || 0} โหนด`
    : `พร้อมรับออเดอร์ผลิตวิดีโอ · เสร็จแล้ว ${analytics.doneJobs || 0} คลิป`;

  return {
    states,
    summary: {
      demoMode: false,
      anyActive: activeCount > 0,
      activeCount,
      qcPending,
      gpuNodes: Number(workers.nvencCount ?? workers.onlineCount ?? onlineWorkers.length ?? 0),
      socialQueued: socialScheduled.length + socialUploading.length,
      headline,
      progressPct: Number(runningJob?.progress ?? runningJob?.pct ?? 0),
    },
  };
}

// ── 10. Graceful SVG Fallback Controller (when WebGL is unavailable) ─────────

function createSvgFallback(canvasHostEl, { labelsEl, onSelectStation, theme, demoMode }) {
  ensureInjectedStyles();
  let curTheme = resolveThemeName(theme);
  let curDemo = Boolean(demoMode);
  let selectedId = 'overview';
  let lastPayload = {};
  let mapped = mapLiveDataToStations({ demoMode: curDemo });

  const wrap = document.createElement('div');
  wrap.className = `ws3d-fallback${curTheme === 'light' ? ' is-light' : ''}`;
  canvasHostEl.innerHTML = '';
  canvasHostEl.appendChild(wrap);
  if (labelsEl) labelsEl.innerHTML = '';

  const coords = {
    script:  { x: 115, y: 270 },
    art:     { x: 155, y: 115 },
    voice:   { x: 350, y: 86 },
    edit:    { x: 545, y: 120 },
    publish: { x: 585, y: 270 },
  };

  function render() {
    wrap.className = `ws3d-fallback${curTheme === 'light' ? ' is-light' : ''}`;
    const isLight = curTheme === 'light';
    const cardBg = isLight ? '#ffffff' : '#0f1d32';
    const cardStroke = isLight ? '#cbd5e1' : '#254266';
    const textMain = isLight ? '#0f172a' : '#e2f1ff';
    const textSub = isLight ? '#475569' : '#94a3b8';

    const nodesHtml = STATIONS.map((s) => {
      const st = mapped.states[s.id];
      const p = coords[s.id];
      const active = st.status === 'active';
      const isSel = selectedId === s.id;
      return `
        <g class="ws3d-fb-node" data-station="${s.id}" transform="translate(${p.x}, ${p.y})">
          <rect x="-78" y="-36" width="156" height="72" rx="14"
            fill="${cardBg}" stroke="${active || isSel ? s.accent : cardStroke}"
            stroke-width="${active || isSel ? 2.6 : 1.4}"/>
          <circle cx="-58" cy="-14" r="5" fill="${active ? s.accent : st.status === 'done' ? '#10b981' : '#64748b'}"/>
          <text x="-46" y="-10" font-size="13" font-weight="700" fill="${textMain}">${s.emoji} ${s.name}</text>
          <text x="-66" y="10" font-size="11" font-weight="600" fill="${s.accent}">${st.statusText}</text>
          <text x="-66" y="25" font-size="10" fill="${textSub}">${truncateText(st.detail, 22)}</text>
        </g>
      `;
    }).join('');

    wrap.innerHTML = `
      <svg viewBox="0 0 700 360" role="img" aria-label="Homelab Video Production Office">
        <defs>
          <linearGradient id="ws3dFbPipe" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#f59e0b"/>
            <stop offset="35%" stop-color="#fb7185"/>
            <stop offset="65%" stop-color="#38bdf8"/>
            <stop offset="100%" stop-color="#10b981"/>
          </linearGradient>
        </defs>
        <path class="ws3d-fb-pipe"
          d="M 115 270 Q 115 170 155 115 Q 245 78 350 86 Q 455 82 545 120 Q 585 180 585 270"
          fill="none" stroke="url(#ws3dFbPipe)" stroke-width="4" stroke-linecap="round" opacity="0.85"/>
        <circle cx="350" cy="212" r="38" fill="none" stroke="#38bdf8" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="6 4"/>
        <text x="350" y="208" text-anchor="middle" font-size="11" font-weight="700" fill="#38bdf8">VIDEO FACTORY</text>
        <text x="350" y="224" text-anchor="middle" font-size="10" fill="${textSub}">${curDemo ? 'DEMO MODE' : '2D FALLBACK'}</text>
        ${nodesHtml}
      </svg>
    `;
  }

  wrap.addEventListener('click', (e) => {
    const node = e.target.closest?.('[data-station]');
    const id = node?.getAttribute('data-station') || 'overview';
    selectedId = id;
    render();
    if (typeof onSelectStation === 'function' && mapped.states[id]) {
      onSelectStation({ ...mapped.states[id] });
    }
  });

  render();

  return {
    isFallback: true,
    updateState(payload = {}) {
      lastPayload = payload;
      mapped = mapLiveDataToStations({ ...payload, demoMode: curDemo });
      render();
    },
    focusStation(stationId) {
      selectedId = STATION_MAP[stationId] ? stationId : 'overview';
      render();
      return mapped.states[selectedId] ? { ...mapped.states[selectedId] } : null;
    },
    resetCamera() {
      selectedId = 'overview';
      render();
    },
    setDemoMode(bool) {
      curDemo = Boolean(bool);
      mapped = mapLiveDataToStations({ ...lastPayload, demoMode: curDemo });
      render();
    },
    setTheme(nextTheme) {
      curTheme = resolveThemeName(nextTheme);
      render();
    },
    setActive() {},
    resize() {},
    getState() {
      return {
        selectedStation: selectedId,
        demoMode: curDemo,
        theme: curTheme,
        stations: mapped.states,
        summary: mapped.summary,
        fallback: true,
      };
    },
    destroy() {
      wrap.remove();
    },
  };
}

// ── 11. Main 3D Mount Controller ─────────────────────────────────────────────

export function mount(canvasHostEl, options = {}) {
  if (!canvasHostEl) {
    throw new Error('HomelabWorkshop3D.mount: canvasHostEl is required');
  }
  ensureInjectedStyles();

  const labelsEl = options.labelsEl || null;
  const onSelectStation = typeof options.onSelectStation === 'function' ? options.onSelectStation : null;
  let curTheme = resolveThemeName(
    options.theme || (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : 'dark')
  );
  let curDemo = Boolean(options.demoMode);
  let selectedStation = 'overview';
  let hoveredStation = null;
  let isActive = true;
  let isDestroyed = false;
  let isVisible = true;
  let lastPayload = {};

  // Attempt WebGLRenderer creation — fall back gracefully on failure
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    console.warn('[workshop-3d] WebGL unavailable, using SVG fallback:', err?.message || err);
    return createSvgFallback(canvasHostEl, { labelsEl, onSelectStation, theme: curTheme, demoMode: curDemo });
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvas = renderer.domElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.cursor = 'grab';
  canvasHostEl.innerHTML = '';
  canvasHostEl.appendChild(canvas);

  // Scene & Camera
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07101c, 0.017);

  const initW = Math.max(1, canvasHostEl.clientWidth || 640);
  const initH = Math.max(1, canvasHostEl.clientHeight || 420);
  const camera = new THREE.PerspectiveCamera(36, initW / initH, 0.1, 100);
  camera.position.set(...CAMERA_PRESETS.overview.pos);
  renderer.setSize(initW, initH, false);

  // OrbitControls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.target.set(...CAMERA_PRESETS.overview.target);
  controls.minDistance = 4.2;
  controls.maxDistance = 24.5;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = Math.PI / 2 - 0.12;
  controls.enablePan = true;
  controls.panSpeed = 0.65;
  controls.rotateSpeed = 0.72;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.42;

  // Lighting Setup
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.34);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0x89c4ff, 0x101828, 0.92);
  hemiLight.position.set(0, 14, 0);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff3e0, 1.55);
  keyLight.position.set(9.5, 16.5, 11.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 2;
  keyLight.shadow.camera.far = 42;
  keyLight.shadow.camera.left = -10.5;
  keyLight.shadow.camera.right = 10.5;
  keyLight.shadow.camera.top = 10.5;
  keyLight.shadow.camera.bottom = -10.5;
  keyLight.shadow.bias = -0.0005;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.82);
  rimLight.position.set(-10, 8, -9);
  scene.add(rimLight);

  // Shared themed materials
  const sharedMats = {
    deskTop: new THREE.MeshStandardMaterial({ color: 0x1d2e45, roughness: 0.45, metalness: 0.18 }),
    deskLeg: new THREE.MeshStandardMaterial({ color: 0x2e4562, roughness: 0.38, metalness: 0.6 }),
  };

  // Build Studio World
  const displays = createDynamicDisplays();
  const arch = createStudioArchitecture(displays.wall.tex);
  scene.add(arch.group);

  const pipeline = createPipelineSystem();
  scene.add(pipeline.group);

  const stationCtrls = createAllStations(displays, sharedMats);
  const pickTargets = [];
  for (const s of STATIONS) {
    scene.add(stationCtrls[s.id].root);
    pickTargets.push(stationCtrls[s.id].root);
  }

  // Per-station smooth runtime activity
  const stationActivity = Object.fromEntries(STATION_IDS.map((id) => [id, 0.15]));
  let mapped = mapLiveDataToStations({ demoMode: curDemo });

  // Camera smooth lerp transition state
  const camTargetPos = new THREE.Vector3(...CAMERA_PRESETS.overview.pos);
  const camTargetLook = new THREE.Vector3(...CAMERA_PRESETS.overview.target);
  let isCameraTweening = false;

  // Floating 3D-to-2D Status Badges in labelsEl
  const tagNodes = {};
  if (labelsEl) {
    labelsEl.innerHTML = '';
    for (const s of STATIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ws3d-tag is-idle';
      btn.dataset.station = s.id;
      btn.style.setProperty('--ws3d-accent', s.accent);
      btn.innerHTML = `
        <span class="ws3d-tag__dot" aria-hidden="true"></span>
        <span class="ws3d-tag__body">
          <span class="ws3d-tag__top">
            <span>${s.emoji} ${s.shortName}</span>
            <span class="ws3d-tag__state">พร้อม</span>
          </span>
          <span class="ws3d-tag__sub">สแตนด์บาย</span>
        </span>
      `;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        focusStation(s.id, { notify: true });
      });
      labelsEl.appendChild(btn);
      tagNodes[s.id] = {
        el: btn,
        stateEl: btn.querySelector('.ws3d-tag__state'),
        subEl: btn.querySelector('.ws3d-tag__sub'),
        worldPos: new THREE.Vector3(
          s.pos[0] + s.tagOffset[0],
          s.pos[1] + s.tagOffset[1],
          s.pos[2] + s.tagOffset[2]
        ),
      };
    }
  }

  function syncTagDOM() {
    for (const s of STATIONS) {
      const node = tagNodes[s.id];
      const st = mapped.states[s.id];
      if (!node || !st) continue;
      node.el.className = `ws3d-tag is-${st.status}${selectedStation === s.id ? ' is-selected' : ''}`;
      node.stateEl.textContent = st.statusText;
      node.subEl.textContent = truncateText(st.detail, 24);
    }
  }

  function applyTheme(nextTheme) {
    curTheme = resolveThemeName(nextTheme);
    const pal = THEME_PALETTES[curTheme] || THEME_PALETTES.dark;

    scene.background = new THREE.Color(pal.bg);
    scene.fog.color.setHex(pal.fog);
    scene.fog.density = pal.isLight ? 0.011 : 0.017;

    arch.refs.slabTopMat.color.setHex(pal.slabTop);
    arch.refs.slabSideMat.color.setHex(pal.slabSide);
    arch.refs.slabBaseMat.color.setHex(pal.slabBase);
    arch.refs.wallMat.color.setHex(pal.wallMain);
    arch.refs.wallTrimMat.color.setHex(pal.wallTrim);
    arch.refs.glassMat.color.setHex(pal.glassTint);
    arch.refs.glassMat.opacity = pal.glassOpacity;
    arch.refs.boothFloorMat.color.setHex(pal.boothFloor);
    arch.refs.trimCyanMat.color.setHex(pal.trimCyan);
    arch.refs.trimAmberMat.color.setHex(pal.trimAmber);
    if (arch.refs.gridHelper?.material) {
      arch.refs.gridHelper.material.opacity = pal.isLight ? 0.28 : 0.42;
      arch.refs.gridHelper.material.color.setHex(pal.isLight ? 0x64748b : 0xffffff);
    }

    sharedMats.deskTop.color.setHex(pal.deskTop);
    sharedMats.deskLeg.color.setHex(pal.deskLeg);
    pipeline.trackBaseMat.color.setHex(pal.trackBase);

    hemiLight.color.setHex(pal.hemiSky);
    hemiLight.groundColor.setHex(pal.hemiGround);
    hemiLight.intensity = pal.hemiInt;
    keyLight.color.setHex(pal.keyColor);
    keyLight.intensity = pal.keyInt;
    rimLight.color.setHex(pal.rimColor);
    rimLight.intensity = pal.rimInt;
    ambientLight.intensity = pal.ambientInt;
    renderer.toneMappingExposure = pal.exposure;

    if (labelsEl) {
      labelsEl.classList.toggle('ws3d-theme-light', pal.isLight);
    }
    canvasHostEl.classList.toggle('ws3d-theme-light', pal.isLight);
    displays.drawWall(elapsedTime, mapped.summary, pal.isLight);
  }

  function focusStation(stationId, { notify = false } = {}) {
    const id = CAMERA_PRESETS[stationId] ? stationId : 'overview';
    selectedStation = id;
    const preset = CAMERA_PRESETS[id];
    camTargetPos.set(...preset.pos);
    camTargetLook.set(...preset.target);
    isCameraTweening = true;
    controls.autoRotate = id === 'overview';
    syncTagDOM();

    const metaOut = mapped.states[id] ? { ...mapped.states[id] } : { id: 'overview', name: 'ภาพรวมโรงงาน' };
    if (notify && onSelectStation) {
      onSelectStation(metaOut);
    }
    return metaOut;
  }

  // Stop auto-orbit & camera tween immediately when user drags
  function handleControlStart() {
    controls.autoRotate = false;
    isCameraTweening = false;
    canvas.style.cursor = 'grabbing';
  }
  function handleControlEnd() {
    canvas.style.cursor = hoveredStation ? 'pointer' : 'grab';
  }
  controls.addEventListener('start', handleControlStart);
  controls.addEventListener('end', handleControlEnd);

  // Raycasting for Hover & Click-to-Zoom
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDownPos = null;

  function pickStationAtClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickTargets, true);
    for (const h of hits) {
      const sid = h.object?.userData?.stationId;
      if (sid && STATION_MAP[sid]) return sid;
    }
    return null;
  }

  function onPointerDown(e) {
    pointerDownPos = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e) {
    if (pointerDownPos && (e.buttons & 1)) return;
    const hitId = pickStationAtClient(e.clientX, e.clientY);
    if (hitId !== hoveredStation) {
      hoveredStation = hitId;
      canvas.style.cursor = hitId ? 'pointer' : 'grab';
    }
  }
  function onPointerUp(e) {
    if (!pointerDownPos) return;
    const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
    pointerDownPos = null;
    if (dist < 6) {
      const hitId = pickStationAtClient(e.clientX, e.clientY);
      if (hitId) {
        focusStation(hitId, { notify: true });
      }
    }
  }
  function onDblClick(e) {
    const hitId = pickStationAtClient(e.clientX, e.clientY);
    if (!hitId) {
      focusStation('overview', { notify: true });
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('dblclick', onDblClick);

  // WebGL Context Lost Guard
  function onContextLost(e) {
    e.preventDefault();
    stopLoop();
  }
  function onContextRestored() {
    if (!isDestroyed && isActive) startLoop();
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  // Resize Handling
  let hostWidth = initW;
  let hostHeight = initH;
  function resize() {
    if (isDestroyed) return;
    const w = Math.max(1, canvasHostEl.clientWidth || 0);
    const h = Math.max(1, canvasHostEl.clientHeight || 0);
    if (w <= 1 || h <= 1) return;
    hostWidth = w;
    hostHeight = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvasHostEl);
  }

  let intersectionObserver = null;
  if (typeof IntersectionObserver !== 'undefined') {
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        isVisible = entries.some((en) => en.isIntersecting);
        if (isVisible && isActive && !document.hidden) startLoop();
        else if (!isVisible) stopLoop();
      },
      { threshold: 0.02 }
    );
    intersectionObserver.observe(canvasHostEl);
  }

  function onVisibilityChange() {
    if (document.hidden) stopLoop();
    else if (isActive && isVisible && !isDestroyed) startLoop();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // ── Animation Loop ──
  const projVec = new THREE.Vector3();
  let rafId = 0;
  let lastFrameMs = 0;
  let elapsedTime = 0;
  let canvasTickAccum = 0;

  function updateProjectedTags() {
    if (!labelsEl || hostWidth <= 1 || hostHeight <= 1) return;
    for (const s of STATIONS) {
      const node = tagNodes[s.id];
      if (!node) continue;
      projVec.copy(node.worldPos).project(camera);
      if (projVec.z > 1 || projVec.z < -1) {
        node.el.style.opacity = '0';
        node.el.style.pointerEvents = 'none';
        continue;
      }
      const x = (projVec.x * 0.5 + 0.5) * hostWidth;
      const y = (-projVec.y * 0.5 + 0.5) * hostHeight;
      const inBounds = x > -60 && x < hostWidth + 60 && y > 16 && y < hostHeight + 20;
      node.el.style.opacity = inBounds ? '1' : '0';
      node.el.style.pointerEvents = inBounds ? 'auto' : 'none';
      node.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  }

  function tick(nowMs) {
    rafId = 0;
    if (isDestroyed || !isActive || document.hidden || !isVisible) return;

    const rawDt = lastFrameMs ? (nowMs - lastFrameMs) / 1000 : 0.016;
    lastFrameMs = nowMs;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    elapsedTime += dt;

    // Smooth camera preset tweening
    if (isCameraTweening) {
      camera.position.lerp(camTargetPos, 1 - Math.exp(-6.2 * dt));
      controls.target.lerp(camTargetLook, 1 - Math.exp(-6.2 * dt));
      if (camera.position.distanceTo(camTargetPos) < 0.04 && controls.target.distanceTo(camTargetLook) < 0.03) {
        isCameraTweening = false;
      }
    }
    controls.update();

    const pal = THEME_PALETTES[curTheme] || THEME_PALETTES.dark;

    // Animate central hub ring
    arch.refs.hubInner.rotation.z = elapsedTime * (mapped.summary.anyActive ? 1.15 : 0.35);
    arch.refs.hubCore.position.y = 0.06 + Math.sin(elapsedTime * 2.2) * 0.015;

    // Animate 5 Stations + Spotlight Cones + Floor Rings
    for (const s of STATIONS) {
      const ctrl = stationCtrls[s.id];
      const st = mapped.states[s.id];
      const isHoverOrSel = hoveredStation === s.id || selectedStation === s.id;
      const targetAct = st ? st.targetActivity : 0.14;
      stationActivity[s.id] = damp(stationActivity[s.id], targetAct, 4.5, dt);
      const act = stationActivity[s.id];

      ctrl.update(elapsedTime, dt, act);

      // Spotlight cone & point light intensity smoothly reflect active state
      const targetConeOpacity = (0.025 + act * 0.13 + (isHoverOrSel ? 0.05 : 0)) * pal.coneBoost;
      ctrl.fx.coneMat.opacity = damp(ctrl.fx.coneMat.opacity, targetConeOpacity, 6.0, dt);

      const targetLightInt = (0.2 + act * 1.45 + (isHoverOrSel ? 0.45 : 0)) * (pal.isLight ? 0.65 : 1.0);
      ctrl.fx.light.intensity = damp(ctrl.fx.light.intensity, targetLightInt, 6.0, dt);

      const ringPulse = 1 + Math.sin(elapsedTime * (2.2 + act * 3.5) + s.index) * (0.015 + act * 0.035);
      ctrl.fx.ring.scale.setScalar(ringPulse);
      ctrl.fx.ringMat.opacity = 0.22 + act * 0.56 + (isHoverOrSel ? 0.2 : 0);
    }

    // Animate Pipeline Data Orbs (Segments 1->2->3->4->5)
    for (const seg of pipeline.segments) {
      const aFrom = stationActivity[STATION_IDS[seg.fromIdx]];
      const aTo = stationActivity[STATION_IDS[seg.toIdx]];
      const targetEnergy = curDemo ? 1.0 : Math.max(0.18, Math.max(aFrom, aTo));
      seg.energy = damp(seg.energy, targetEnergy, 4.0, dt);
      seg.speed = 0.14 + seg.energy * 0.48;
      seg.phase = (seg.phase + dt * seg.speed) % 1;

      seg.glowMat.opacity = 0.2 + seg.energy * 0.62;
      seg.orbHaloMat.opacity = 0.22 + seg.energy * 0.65;

      for (const orb of seg.orbs) {
        const u = (seg.phase + orb.offset) % 1;
        seg.curve.getPointAt(u, orb.mesh.position);
        orb.mesh.position.y += 0.06 + Math.sin(u * Math.PI * 2) * 0.025;
        orb.mesh.scale.setScalar(0.55 + seg.energy * 0.65);
      }
    }

    // Throttled Dynamic Canvas Updates (~13 FPS for crisp low-overhead motion screens)
    canvasTickAccum += dt;
    if (canvasTickAccum >= 0.075) {
      canvasTickAccum = 0;
      displays.drawScript(elapsedTime, stationActivity.script);
      displays.drawArt(elapsedTime, stationActivity.art);
      displays.drawEdit(elapsedTime, stationActivity.edit, mapped.summary.progressPct);
      displays.drawPublish(elapsedTime, stationActivity.publish, mapped.summary.qcPending, mapped.summary.socialQueued);
      displays.drawWall(elapsedTime, mapped.summary, pal.isLight);
    }

    renderer.render(scene, camera);
    updateProjectedTags();

    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId || isDestroyed || !isActive || document.hidden || !isVisible) return;
    lastFrameMs = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  // Apply initial theme, displays, tags & start animation loop
  applyTheme(curTheme);
  syncTagDOM();
  displays.drawScript(0, 0.2);
  displays.drawArt(0, 0.2);
  displays.drawEdit(0, 0.2, 0);
  displays.drawPublish(0, 0.2, 0, 0);
  startLoop();

  return {
    isFallback: false,
    updateState(payload = {}) {
      lastPayload = payload || {};
      mapped = mapLiveDataToStations({ ...lastPayload, demoMode: curDemo });
      syncTagDOM();
    },
    focusStation(stationId) {
      return focusStation(stationId, { notify: false });
    },
    resetCamera() {
      return focusStation('overview', { notify: false });
    },
    setDemoMode(bool) {
      curDemo = Boolean(bool);
      mapped = mapLiveDataToStations({ ...lastPayload, demoMode: curDemo });
      syncTagDOM();
    },
    setTheme(nextTheme) {
      applyTheme(nextTheme);
    },
    setActive(active) {
      isActive = Boolean(active);
      if (isActive && !document.hidden && isVisible) {
        resize();
        startLoop();
      } else {
        stopLoop();
      }
    },
    resize,
    getState() {
      return {
        selectedStation,
        demoMode: curDemo,
        theme: curTheme,
        stations: mapped.states,
        summary: mapped.summary,
        fallback: false,
      };
    },
    destroy() {
      if (isDestroyed) return;
      isDestroyed = true;
      stopLoop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (resizeObserver) resizeObserver.disconnect();
      if (intersectionObserver) intersectionObserver.disconnect();
      controls.removeEventListener('start', handleControlStart);
      controls.removeEventListener('end', handleControlEnd);
      controls.dispose();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      disposeObject3D(scene);
      displays.wall.tex.dispose();
      displays.script.tex.dispose();
      displays.art.tex.dispose();
      displays.edit.tex.dispose();
      displays.publish.tex.dispose();
      renderer.dispose();
      canvas.remove();
      if (labelsEl) labelsEl.innerHTML = '';
    },
  };
}

// ── 12. Global API Binding & Ready Event ─────────────────────────────────────

const HomelabWorkshop3D = {
  version: '1.0.0',
  STATIONS,
  STATION_MAP,
  STATION_IDS,
  mount,
};

if (typeof window !== 'undefined') {
  window.HomelabWorkshop3D = HomelabWorkshop3D;
  window.dispatchEvent(new Event('homelab:workshop3d-ready'));
}

export default HomelabWorkshop3D;

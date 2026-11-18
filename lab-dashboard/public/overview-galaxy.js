/* ── 3D Deep-Space Galaxy, Zodiac Astrolabe & Interactive Camera Explorer ─── */
(function initOverviewGalaxy() {
  const hero = document.getElementById('ov-galaxy-hero');
  const canvas = document.getElementById('ov-galaxy-canvas');
  const stage = document.getElementById('ov-reactor-stage');
  const svgEl = document.getElementById('ov-reactor-svg');
  const zodiacSvg = document.getElementById('ov-zodiac-svg');
  const planetsLayer = document.getElementById('ov-orbit-planets');
  const popoverEl = document.getElementById('ov-planet-popover');
  const searchInput = document.getElementById('ov-space-search');
  const searchResults = document.getElementById('ov-search-results');
  const zoomValEl = document.getElementById('ov-zoom-val');
  const coreVoiceBtn = document.getElementById('ov-core-voice-btn');
  if (!hero || !canvas || !stage || !planetsLayer) return;

  // Double-click / double-tap center core orb -> Switch to AI Chat + Start New Chat + Open Mic!
  if (coreVoiceBtn) {
    let lastTapTs = 0;
    const launchVoiceAiChat = () => {
      if (typeof window.switchView === 'function') window.switchView('terminal');
      const geminiTab = document.querySelector('[data-term-subtab="gemini"]');
      if (geminiTab) geminiTab.click();
      const iframe = document.querySelector('#term-subpanel-gemini iframe');
      if (iframe && iframe.contentWindow) {
        setTimeout(() => {
          iframe.contentWindow.postMessage({ type: 'start_voice_new_chat' }, '*');
        }, 120);
      }
    };
    coreVoiceBtn.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      launchVoiceAiChat();
    });
    coreVoiceBtn.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') return; // mouse uses native dblclick
      const now = performance.now();
      if (now - lastTapTs < 380) {
        lastTapTs = 0;
        e.stopPropagation();
        launchVoiceAiChat();
      } else {
        lastTapTs = now;
      }
    });
    coreVoiceBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        launchVoiceAiChat();
      }
    });
  }

  const ctx = canvas.getContext('2d');
  let latestSummary = null;
  let latestRate = null;
  const trendHistory = { cpu: [], mem: [], rx: [], tx: [] };

  // ── 1. 12-Sign Celestial Zodiac Astrolabe (จักรราศี) ──────────────────────
  const ZODIAC_SIGNS = [
    { sym: '♈', th: 'เมษ', en: 'Aries', start: [3, 21] },
    { sym: '♉', th: 'พฤษภ', en: 'Taurus', start: [4, 20] },
    { sym: '♊', th: 'เมถุน', en: 'Gemini', start: [5, 21] },
    { sym: '♋', th: 'กรกฎ', en: 'Cancer', start: [6, 21] },
    { sym: '♌', th: 'สิงห์', en: 'Leo', start: [7, 23] },
    { sym: '♍', th: 'กันย์', en: 'Virgo', start: [8, 23] },
    { sym: '♎', th: 'ตุลย์', en: 'Libra', start: [9, 23] },
    { sym: '♏', th: 'พิจิก', en: 'Scorpio', start: [10, 23] },
    { sym: '♐', th: 'ธนู', en: 'Sagittarius', start: [11, 22] },
    { sym: '♑', th: 'มังกร', en: 'Capricorn', start: [12, 22] },
    { sym: '♒', th: 'กุมภ์', en: 'Aquarius', start: [1, 20] },
    { sym: '♓', th: 'มีน', en: 'Pisces', start: [2, 19] }
  ];

  (function renderZodiacWheel() {
    if (!zodiacSvg) return;
    const now = new Date();
    const md = (now.getMonth() + 1) * 100 + now.getDate();
    let activeIdx = 9;
    for (let i = 0; i < ZODIAC_SIGNS.length; i++) {
      const cur = ZODIAC_SIGNS[i].start[0] * 100 + ZODIAC_SIGNS[i].start[1];
      const next = ZODIAC_SIGNS[(i + 1) % 12].start[0] * 100 + ZODIAC_SIGNS[(i + 1) % 12].start[1];
      if (cur < next ? (md >= cur && md < next) : (md >= cur || md < next)) {
        activeIdx = i;
        break;
      }
    }

    const activeSign = ZODIAC_SIGNS[activeIdx];
    const badgeEl = document.getElementById('ov-zodiac-badge');
    if (badgeEl) badgeEl.textContent = `${activeSign.sym} ${activeSign.en.toUpperCase()} (${activeSign.th})`;

    // Thai Astrological Date (วันที่ พ.ศ. · ดิถีจันทร์ ขึ้น/แรม · นักษัตร · จ.ศ.)
    const astroDateEl = document.getElementById('ov-astro-date-badge');
    if (astroDateEl) {
      const DAYS_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
      const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      const ZODIAC_ANIMALS = ['ชวด', 'ฉลู', 'ขาล', 'เถาะ', 'มะโรง', 'มะเส็ง', 'มะเมีย', 'มะแม', 'วอก', 'ระกา', 'จอ', 'กุน'];
      const epoch = Date.UTC(2000, 0, 6, 18, 14, 0);
      const synodic = 29.53058867;
      const age = (((now.getTime() - epoch) / 86400000) % synodic + synodic) % synodic;
      const lunarDay = Math.floor(age) + 1;
      const phaseLabel = lunarDay <= 15 ? `ขึ้น ${lunarDay} ค่ำ` : `แรม ${lunarDay - 15} ค่ำ`;
      const ceYear = now.getFullYear();
      const beYear = ceYear + 543;
      const afterSongkran = (now.getMonth() > 3) || (now.getMonth() === 3 && now.getDate() >= 14);
      const csYear = afterSongkran ? ceYear - 638 : ceYear - 639;
      const animal = ZODIAC_ANIMALS[(ceYear + 8) % 12];
      astroDateEl.textContent = `วัน${DAYS_TH[now.getDay()]}ที่ ${now.getDate()} ${MONTHS_TH[now.getMonth()]} ${beYear} · ${phaseLabel} · ปี${animal} จ.ศ. ${csYear}`;
    }

    const cx = 180, cy = 180;
    let html = `
      <circle cx="${cx}" cy="${cy}" r="172" fill="none" stroke="rgba(245, 208, 97, 0.42)" stroke-width="1.3" />
      <circle cx="${cx}" cy="${cy}" r="168" fill="none" stroke="rgba(0, 229, 255, 0.25)" stroke-width="0.7" stroke-dasharray="3 5" />
      <circle cx="${cx}" cy="${cy}" r="142" fill="none" stroke="rgba(245, 208, 97, 0.32)" stroke-width="1" />
      <circle cx="${cx}" cy="${cy}" r="136" fill="none" stroke="rgba(168, 85, 247, 0.26)" stroke-width="0.8" stroke-dasharray="2 6" />
    `;
    for (let d = 0; d < 360; d += 5) {
      const rad = (d - 90) * Math.PI / 180;
      const isMajor = d % 30 === 0;
      const r1 = isMajor ? 142 : 165;
      const r2 = 172;
      const x1 = cx + Math.cos(rad) * r1, y1 = cy + Math.sin(rad) * r1;
      const x2 = cx + Math.cos(rad) * r2, y2 = cy + Math.sin(rad) * r2;
      html += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${isMajor ? 'rgba(245, 208, 97, 0.55)' : 'rgba(0, 229, 255, 0.24)'}" stroke-width="${isMajor ? 1.15 : 0.6}" />`;
    }
    ZODIAC_SIGNS.forEach((s, i) => {
      const deg = i * 30 + 15;
      const rad = (deg - 90) * Math.PI / 180;
      const tx = cx + Math.cos(rad) * 157, ty = cy + Math.sin(rad) * 157;
      const isAct = i === activeIdx;
      const sx = cx + Math.cos(rad) * 139, sy = cy + Math.sin(rad) * 139;
      if (isAct) {
        html += `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="10.5" fill="rgba(245, 208, 97, 0.2)" stroke="rgba(245, 208, 97, 0.9)" stroke-width="1.1" />`;
      }
      html += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${isAct ? 2.4 : 1.4}" fill="${isAct ? '#f5d061' : 'rgba(0, 229, 255, 0.7)'}" />`;
      html += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${isAct ? 13.5 : 11}" fill="${isAct ? '#fde68a' : 'rgba(245, 208, 97, 0.85)'}" font-family="serif" transform="rotate(${deg} ${tx.toFixed(1)} ${ty.toFixed(1)})">${s.sym}</text>`;
    });
    zodiacSvg.innerHTML = html;
  })();

  // ── 2. 3D Deep-Space Starfield, Nebula Clouds & Shooting Stars ───────────
  const stars = Array.from({ length: 240 }, () => {
    const a = Math.random() * Math.PI * 2;
    const r = 40 + Math.random() * 680;
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      z: 80 + Math.random() * 920,
      speed: 0.25 + Math.random() * 0.75,
      size: 0.9 + Math.random() * 2.0,
      hue: [190, 270, 45, 158, 28][Math.floor(Math.random() * 5)],
      twinkle: Math.random() * Math.PI * 2,
      constellation: Math.random() < 0.22
    };
  });
  const shootingStars = [];

  // 3D Camera & Physics State
  let camZoom = 1.0, targetZoom = 1.0;
  let camPanX = 0, camPanY = 0, targetPanX = 0, targetPanY = 0;
  let focusedState = null;
  let ox = 0, oy = 0, vx = 0, vy = 0;
  let hoverTiltX = 0, hoverTiltY = 0, targetHoverX = 0, targetHoverY = 0;
  let spinAngle = 0, spinVel = 0;
  let dragging = false;
  let lastClientX = 0, lastClientY = 0;

  function setTargetZoom(z) {
    targetZoom = Math.max(0.65, Math.min(2.6, z));
    if (zoomValEl) zoomValEl.textContent = `${targetZoom.toFixed(1)}x`;
  }
  function resetCamera() {
    focusedState = null;
    targetPanX = 0;
    targetPanY = 0;
    setTargetZoom(1.0);
    if (popoverEl) popoverEl.classList.remove('is-open');
  }

  document.getElementById('ov-zoom-in')?.addEventListener('click', () => setTargetZoom(targetZoom + 0.3));
  document.getElementById('ov-zoom-out')?.addEventListener('click', () => {
    setTargetZoom(targetZoom - 0.3);
    if (targetZoom <= 1.05) { focusedState = null; targetPanX = 0; targetPanY = 0; }
  });
  document.getElementById('ov-zoom-reset')?.addEventListener('click', resetCamera);

  // Mouse wheel 3D fly-in/out zoom over the galaxy hero
  hero.addEventListener('wheel', (e) => {
    if (e.target.closest('#ov-planet-popover') || e.target.closest('.ov-hud-wing') || e.target.closest('#ov-search-results')) return;
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 0.16;
    setTargetZoom(targetZoom + delta);
    if (targetZoom <= 1.05 && delta < 0) {
      focusedState = null;
      targetPanX = 0;
      targetPanY = 0;
    }
  }, { passive: false });

  hero.addEventListener('pointermove', (e) => {
    if (dragging) return;
    const rect = hero.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
    const ny = ((e.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
    targetHoverY = nx * 11;
    targetHoverX = -ny * 11;
  });
  hero.addEventListener('pointerleave', () => { targetHoverX = 0; targetHoverY = 0; });

  stage.addEventListener('pointerdown', (e) => {
    if (e.target?.closest?.('.orbit-planet') || e.target?.closest?.('#ov-core-voice-btn')) return;
    dragging = true;
    stage.classList.add('is-dragging');
    stage.setPointerCapture(e.pointerId);
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    vx = 0; vy = 0;
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastClientX;
    const dy = e.clientY - lastClientY;
    lastClientX = e.clientX; lastClientY = e.clientY;
    ox += dx; oy += dy;
    vx = dx * 0.85; vy = dy * 0.85;
    const torque = (ox * dy - oy * dx) * 0.0022;
    spinVel = Math.max(-22, Math.min(22, spinVel + torque + (dx - dy) * 0.04));
  });
  function releaseDrag() {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-dragging');
  }
  stage.addEventListener('pointerup', releaseDrag);
  stage.addEventListener('pointercancel', releaseDrag);

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = hero.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resizeCanvas).observe(hero);
  }

  // ── 3. Formatters & Sparkline Helper ─────────────────────────────────────
  function fmtB(bytes) {
    if (!bytes && bytes !== 0) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
  }
  function fmtRateShort(bps) {
    if (!bps) return '0 B/s';
    const u = ['B/s', 'K/s', 'M/s', 'G/s'];
    let v = bps, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 ? 0 : 1)}${u[i]}`;
  }
  function fmtUpShort(sec) {
    if (!sec) return '—';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`;
  }
  function buildSparkSvg(arr, color, maxVal) {
    const data = arr.length ? arr : [0, 0];
    const w = 180, h = 42, pad = 3;
    const peak = maxVal || Math.max(1, ...data);
    const pts = data.map((v, i) => {
      const x = pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
      const y = h - pad - (Math.min(peak, Math.max(0, v)) / peak) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" class="ov-spark-svg"><polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/></svg>`;
  }

  // ── 4. Planets, Space Stations, Meteors & Dynamic Service Satellites ─────
  const planetStates = [];

  const CORE_PLANET_DEFS = [
    // Tier 1 (r=115): Core Linux Compute
    {
      id: 'cpu', label: 'CPU', keywords: 'cpu processor load core linux', icon: '⚡', ring: 115, speed: 0.0064, angle: 0.2, size: 24, color: '#38bdf8',
      getTag: () => latestSummary?.host?.cpu ? `CPU ${Math.round(latestSummary.host.cpu.pct)}%` : 'CPU',
      getInfo: () => {
        const h = latestSummary?.host || {};
        const cpu = h.cpu || {};
        const load = (h.load || []).slice(0, 3).map(n => n.toFixed(2)).join(' · ');
        return {
          title: 'Linux CPU Compute',
          status: `${(cpu.pct ?? 0).toFixed(1)}%`,
          statusClass: cpu.pct > 80 ? 'is-warn' : '',
          body: `Cores: <strong>${cpu.cores?.length || 0}</strong><br>Load Avg (1/5/15m): <code>${load || '—'}</code>`,
          actions: [{ label: '🛰️ เปิดสถานีกราฟ Trends', cosmic: 'trends' }]
        };
      }
    },
    {
      id: 'ram', label: 'RAM', keywords: 'ram memory หน่วยความจำ', icon: '🧠', ring: 115, speed: 0.0064, angle: 2.3, size: 23, color: '#34d399',
      getTag: () => latestSummary?.host?.mem ? `RAM ${Math.round(latestSummary.host.mem.pct)}%` : 'RAM',
      getInfo: () => {
        const mem = latestSummary?.host?.mem || {};
        return {
          title: 'System Memory (RAM)',
          status: `${(mem.pct ?? 0).toFixed(1)}%`,
          statusClass: mem.pct > 85 ? 'is-warn' : '',
          body: `Used: <strong>${fmtB(mem.used)}</strong> / ${fmtB(mem.total)}<br>Free: <code>${fmtB(mem.free)}</code>`,
          actions: [{ label: '🛰️ เปิดสถานีกราฟ Trends', cosmic: 'trends' }]
        };
      }
    },
    {
      id: 'temp', label: 'TEMP', keywords: 'temp thermal อุณหภูมิ ความร้อน', icon: '🌡️', ring: 115, speed: 0.0064, angle: 4.4, size: 20, color: '#fb7185',
      getTag: () => {
        const temps = latestSummary?.host?.temps || [];
        const maxT = temps.reduce((m, t) => Math.max(m, t.celsius || 0), 0);
        return maxT ? `${Math.round(maxT)}°C` : 'TEMP';
      },
      getInfo: () => {
        const temps = latestSummary?.host?.temps || [];
        const maxT = temps.reduce((m, t) => Math.max(m, t.celsius || 0), 0);
        const list = temps.slice(0, 6).map(t => `${t.label || 'Sensor'}: <strong>${t.celsius?.toFixed(1)}°C</strong>`).join('<br>');
        return {
          title: 'Thermal Sensors',
          status: maxT ? `${maxT.toFixed(1)}°C` : 'N/A',
          statusClass: maxT > 75 ? 'is-warn' : '',
          body: list || 'กำลังอ่านค่าอุณหภูมิ...',
          actions: [{ label: '🪨 ดู Host & DB ทั้งหมด', cosmic: 'hostdb' }]
        };
      }
    },
    // Tier 2 (r=172): Storage, Containers & Network
    {
      id: 'disk', label: 'DISK', keywords: 'disk storage nvme ssd พื้นที่', icon: '💾', ring: 172, speed: -0.0044, angle: 0.6, size: 23, color: '#a855f7',
      getTag: () => {
        const root = (latestSummary?.host?.disks || []).find(d => d.mount === '/') || (latestSummary?.host?.disks || [])[0];
        return root ? `DISK ${Math.round(root.usedPct)}%` : 'DISK';
      },
      getInfo: () => {
        const disks = latestSummary?.host?.disks || [];
        const rows = disks.slice(0, 4).map(d => `<code>${d.mount}</code>: <strong>${d.usedPct?.toFixed(0)}%</strong> (${fmtB(d.used)} / ${fmtB(d.size)})`).join('<br>');
        return {
          title: 'NVMe / Disk Partitions',
          status: `${disks.length} Mounts`,
          body: rows || 'กำลังโหลดข้อมูล Disk...',
          actions: [{ label: '🪨 ดูรายละเอียด Host & Disk', cosmic: 'hostdb' }]
        };
      }
    },
    {
      id: 'dck', label: 'DCK', keywords: 'docker container คอนเทนเนอร์', icon: '🐳', ring: 172, speed: -0.0044, angle: 2.15, size: 25, color: '#60a5fa',
      getTag: () => latestSummary?.docker ? `DCK ${latestSummary.docker.running}/${latestSummary.docker.total}` : 'DCK',
      getInfo: () => {
        const d = latestSummary?.docker || {};
        return {
          title: 'Docker Containers',
          status: `${d.running || 0}/${d.total || 0} UP`,
          statusClass: d.stopped > 0 ? 'is-warn' : '',
          body: `Running: <strong>${d.running || 0}</strong> · Stopped: <strong>${d.stopped || 0}</strong>`,
          actions: [{ label: '🐳 จัดการ Docker', view: 'services' }]
        };
      }
    },
    {
      id: 'net', label: 'NET', keywords: 'network traffic rx tx เครือข่าย', icon: '🌐', ring: 172, speed: -0.0044, angle: 3.7, size: 22, color: '#2dd4bf',
      getTag: () => latestRate ? `↓${fmtRateShort(latestRate.rx)}` : 'NET',
      getInfo: () => {
        const rx = latestRate ? fmtRateShort(latestRate.rx) : '—';
        const tx = latestRate ? fmtRateShort(latestRate.tx) : '—';
        return {
          title: 'Network I/O Throughput',
          status: 'LIVE',
          body: `Download (RX): <strong>${rx}</strong><br>Upload (TX): <strong>${tx}</strong>`,
          actions: [{ label: '🛰️ เปิดกราฟ Traffic', cosmic: 'trends' }]
        };
      }
    },
    {
      id: 'pm2', label: 'PM2', keywords: 'pm2 process node app', icon: '⚙️', ring: 172, speed: -0.0044, angle: 5.2, size: 21, color: '#22d3ee',
      getTag: () => latestSummary?.pm2 ? `PM2 ${latestSummary.pm2.online ?? latestSummary.pm2.total ?? 0}` : 'PM2',
      getInfo: () => {
        const p = latestSummary?.pm2 || {};
        return {
          title: 'PM2 Process Manager',
          status: `${p.total || 0} APPS`,
          body: `จัดการ Node/Python Services เช่น lab-dashboard, iot-dashboard, OnePercentBotTrade`,
          actions: [{ label: '⚡ เปิดแท็บ Services', view: 'services' }]
        };
      }
    },
    // Tier 3 (r=228): Power, Services, Infra & Uptime
    {
      id: 'pzem', label: 'PZEM', keywords: 'pzem power watt ไฟฟ้า ค่าไฟ', icon: '⚡', ring: 228, speed: 0.0032, angle: 0.4, size: 25, color: '#facc15',
      getTag: () => latestSummary?.energy?.realtime?.power_watts != null ? `${Math.round(latestSummary.energy.realtime.power_watts)}W` : 'PZEM',
      getInfo: () => {
        const rt = latestSummary?.energy?.realtime || {};
        return {
          title: 'PZEM-01 Active Power',
          status: rt.power_watts != null ? `${Math.round(rt.power_watts)} W` : 'SYNC',
          body: `แรงดัน: <strong>${rt.voltage_volts || '—'} V</strong> · กระแส: <strong>${rt.current_amps || '—'} A</strong>`,
          actions: [{ label: '☄️ ดูมิเตอร์ & ค่าไฟเต็มรูปแบบ', cosmic: 'energy' }]
        };
      }
    },
    {
      id: 'svc', label: 'SVC', keywords: 'services health kuma uptime', icon: '🩺', ring: 228, speed: 0.0032, angle: 1.7, size: 21, color: '#34d399',
      getTag: () => latestSummary?.services ? `SVC ${latestSummary.services.up}/${latestSummary.services.total}` : 'SVC',
      getInfo: () => {
        const s = latestSummary?.services || {};
        return {
          title: 'Homelab Services Health',
          status: `${s.up || 0}/${s.total || 0} UP`,
          statusClass: s.down > 0 ? 'is-warn' : '',
          body: s.down > 0 ? `พบ ${s.down} บริการมีปัญหา` : 'บริการทั้งหมดทำงานปกติ',
          actions: [{ label: '🩺 ดูสถานะบริการ', view: 'services' }]
        };
      }
    },
    {
      id: 'vpn', label: 'VPN', keywords: 'vpn wireguard tailscale ufw firewall port', icon: '🛡️', ring: 228, speed: 0.0032, angle: 3.0, size: 20, color: '#818cf8',
      getTag: () => 'VPN',
      getInfo: () => ({
        title: 'WireGuard / Tailscale & UFW',
        status: 'ARMED',
        body: 'ตรวจสอบพอร์ตที่เปิดใช้งาน ไฟร์วอลล์ UFW และ VPN Peers',
        actions: [{ label: '🛡️ เปิดพอร์ต & VPN', view: 'ports' }]
      })
    },
    {
      id: 'db', label: 'DB', keywords: 'mongo mongodb database ฐานข้อมูล', icon: '🗄️', ring: 228, speed: 0.0032, angle: 4.3, size: 20, color: '#c084fc',
      getTag: () => 'MONGO',
      getInfo: () => {
        const m = latestSummary?.mongo || {};
        return {
          title: 'MongoDB Database',
          status: m.ok === false ? 'DOWN' : 'ONLINE',
          statusClass: m.ok === false ? 'is-warn' : '',
          body: m.version ? `Version: <code>${m.version}</code>` : 'ฐานข้อมูลหลักของ Homelab',
          actions: [{ label: '🪨 ดู Host & DB ทั้งหมด', cosmic: 'hostdb' }]
        };
      }
    },
    {
      id: 'up', label: 'UP', keywords: 'uptime linux kernel os host', icon: '⏱️', ring: 228, speed: 0.0032, angle: 5.5, size: 20, color: '#f5d061',
      getTag: () => latestSummary?.host?.uptimeSec ? fmtUpShort(latestSummary.host.uptimeSec) : 'UP',
      getInfo: () => {
        const h = latestSummary?.host || {};
        return {
          title: 'Linux Kernel & Uptime',
          status: fmtUpShort(h.uptimeSec),
          body: `Host: <strong>${h.hostname || 'homelab'}</strong><br>OS: <code>${h.platform || 'Linux'}</code>`,
          actions: [{ label: '💻 เปิด Terminal & AI', view: 'terminal' }]
        };
      }
    },
    // Tier 4 (r=278): 3 Primary Cosmic Stations & Energy Comet
    {
      id: 'trends', label: 'TRENDS', keywords: 'trends chart graph กราฟ ย้อนหลัง', icon: '🛰️', kind: 'station', ring: 278, speed: 0.0020, angle: 0.85, size: 32, color: '#00e5ff',
      getTag: () => '🛰️ TRENDS',
      getInfo: () => {
        const cpuNow = Math.round(latestSummary?.host?.cpu?.pct || 0);
        const memNow = Math.round(latestSummary?.host?.mem?.pct || 0);
        const rxNow = latestRate ? fmtRateShort(latestRate.rx) : '—';
        const txNow = latestRate ? fmtRateShort(latestRate.tx) : '—';
        return {
          title: 'สถานีอวกาศ: Resource Trends',
          status: `${trendHistory.cpu.length} SAMPLES`,
          body: `
            <div class="ov-spark-grid">
              <div class="ov-spark-card"><div class="ov-spark-head"><span>CPU Usage</span><strong>${cpuNow}%</strong></div>${buildSparkSvg(trendHistory.cpu, '#38bdf8', 100)}</div>
              <div class="ov-spark-card"><div class="ov-spark-head"><span>Memory RAM</span><strong>${memNow}%</strong></div>${buildSparkSvg(trendHistory.mem, '#34d399', 100)}</div>
              <div class="ov-spark-card"><div class="ov-spark-head"><span>Network RX</span><strong>${rxNow}</strong></div>${buildSparkSvg(trendHistory.rx, '#2dd4bf')}</div>
              <div class="ov-spark-card"><div class="ov-spark-head"><span>Network TX</span><strong>${txNow}</strong></div>${buildSparkSvg(trendHistory.tx, '#a855f7')}</div>
            </div>
          `,
          actions: []
        };
      }
    },
    {
      id: 'energy', label: 'ENERGY', keywords: 'energy pzem electricity cost ค่าไฟ พลังงาน', icon: '☄️', kind: 'meteor', ring: 278, speed: 0.0020, angle: 2.95, size: 30, color: '#facc15',
      getTag: () => latestSummary?.energy?.today?.cost_thb != null ? `☄️ ${latestSummary.energy.today.cost_thb.toFixed(0)}฿` : '☄️ ENERGY',
      getInfo: () => {
        const en = latestSummary?.energy || {};
        const rt = en.realtime || {};
        const td = en.today || {};
        const tm = en.this_month || {};
        const proj = en.projected_month || en.estimated_month || {};
        const estThb = proj.cost_thb != null ? Math.round(proj.cost_thb) : (tm.cost_thb != null ? Math.round((tm.cost_thb / Math.max(1, new Date().getDate())) * 30) : '—');
        return {
          title: 'อุกกาบาตพลังงาน: PZEM-01 Grid',
          status: rt.power_watts != null ? `${Math.round(rt.power_watts)} W` : 'SYNC',
          body: `
            <div class="ov-spark-grid">
              <div class="ov-spark-card"><span>🔌 โหลดขณะนี้</span><strong>${rt.power_watts != null ? Math.round(rt.power_watts) + ' W' : '—'}</strong><small>${rt.voltage_volts || '—'}V · ${rt.current_amps || '—'}A · PF ${rt.power_factor || '—'}</small></div>
              <div class="ov-spark-card"><span>📅 ค่าไฟวันนี้</span><strong style="color:#ff794d">${td.cost_thb != null ? td.cost_thb.toFixed(2) + ' ฿' : '—'}</strong><small>${td.energy_kwh != null ? td.energy_kwh.toFixed(3) : '—'} kWh</small></div>
              <div class="ov-spark-card"><span>📊 สะสมเดือนนี้</span><strong style="color:#00d2f0">${tm.cost_thb != null ? Math.round(tm.cost_thb).toLocaleString() + ' ฿' : '—'}</strong><small>${tm.energy_kwh != null ? tm.energy_kwh.toFixed(1) : '—'} kWh</small></div>
              <div class="ov-spark-card"><span>📈 ประมาณการทั้งเดือน</span><strong style="color:#00e5a3">~${estThb} ฿</strong><small>คำนวณจากค่าเฉลี่ยรายวัน</small></div>
            </div>
          `,
          actions: []
        };
      }
    },
    {
      id: 'hostdb', label: 'HOST/DB', keywords: 'host db disk sensor core os รายละเอียด', icon: '🪨', kind: 'asteroid', ring: 278, speed: 0.0020, angle: 5.05, size: 30, color: '#94a3b8',
      getTag: () => '🪨 HOST/DB',
      getInfo: () => {
        const h = latestSummary?.host || {};
        const disks = (h.disks || []).slice(0, 3).map(d => `<code>${d.mount}</code> ${d.usedPct?.toFixed(0)}% (${fmtB(d.used)}/${fmtB(d.size)})`).join('<br>');
        const temps = (h.temps || []).slice(0, 4).map(t => `${t.label}: <strong>${t.celsius?.toFixed(0)}°C</strong>`).join(' · ');
        const m = latestSummary?.mongo || {};
        return {
          title: 'แถบอุกกาบาต: Host & Database Details',
          status: h.hostname || 'homelab',
          body: `
            <strong>OS:</strong> <code>${h.platform || 'Linux'}</code> · <strong>Cores:</strong> ${h.cpu?.cores?.length || 0}<br>
            <strong>MongoDB:</strong> ${m.ok === false ? 'DOWN' : 'ONLINE'} ${m.version ? `(${m.version})` : ''}<br>
            <strong>Thermal:</strong> ${temps || '—'}<br>
            <strong>Disks:</strong><br>${disks || '—'}
          `,
          actions: [{ label: '💻 เปิด Terminal & AI', view: 'terminal' }]
        };
      }
    }
  ];

  function createCosmicNode(def) {
    const el = document.createElement('div');
    const kindClass = def.kind === 'station' ? 'ov-cosmic-station'
      : (def.kind === 'meteor' ? 'ov-cosmic-meteor'
        : (def.kind === 'asteroid' ? 'ov-cosmic-asteroid'
          : (def.kind === 'relay' ? 'ov-cosmic-relay' : '')));
    el.className = `orbit-planet ov-orbit-planet ${kindClass}`.trim();
    el.style.width = `${def.size}px`;
    el.style.height = `${def.size}px`;
    if (def.kind) {
      el.innerHTML = `<span class="ov-cosmic-glyph">${def.icon}</span><span class="orbit-planet__tag">${def.label}</span>`;
    } else {
      el.style.background = `radial-gradient(circle at 35% 35%, #ffffff 0%, ${def.color} 55%, rgba(0,0,0,0.45) 100%)`;
      el.style.boxShadow = `0 0 ${def.size}px ${def.color}, 0 0 ${def.size * 1.6}px rgba(255,255,255,0.22)`;
      el.innerHTML = `<span class="orbit-planet__tag">${def.label}</span>`;
    }
    el.title = `${def.icon} ${def.label} (คลิกเพื่อบินเข้าไปดู / ลากเหวี่ยงได้)`;
    planetsLayer.appendChild(el);

    const st = {
      def, el,
      tagEl: el.querySelector('.orbit-planet__tag'),
      angle: def.angle,
      ox: 0, oy: 0, vx: 0, vy: 0,
      radius: Math.max(12, def.size * 0.65),
      mass: def.size * def.size,
      grabbed: false, dragDist: 0,
      lastX: 0, lastY: 0, lastMoveTs: 0,
      lastProjX: 0, lastProjY: 0
    };

    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      st.grabbed = true; st.dragDist = 0;
      st.lastX = e.clientX; st.lastY = e.clientY;
      st.lastMoveTs = performance.now();
      st.vx = 0; st.vy = 0;
      el.classList.add('is-grabbed');
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!st.grabbed) return;
      const dx = e.clientX - st.lastX, dy = e.clientY - st.lastY;
      st.lastX = e.clientX; st.lastY = e.clientY;
      st.lastMoveTs = performance.now();
      st.dragDist += Math.hypot(dx, dy);
      st.ox += dx; st.oy += dy;
      st.vx = Math.max(-45, Math.min(45, st.vx * 0.3 + dx * 0.85));
      st.vy = Math.max(-45, Math.min(45, st.vy * 0.3 + dy * 0.85));
    });
    const onDrop = () => {
      if (!st.grabbed) return;
      st.grabbed = false;
      el.classList.remove('is-grabbed');
      if (st.dragDist < 6) focusAndOpenCosmic(st);
    };
    el.addEventListener('pointerup', onDrop);
    el.addEventListener('pointercancel', onDrop);
    planetStates.push(st);
    return st;
  }

  CORE_PLANET_DEFS.forEach(createCosmicNode);

  // Dynamically spawn every service in s.links as floating Satellites / Relays / Asteroids in deep space!
  let dynamicServicesSpawned = false;
  function syncDynamicServiceSatellites(links) {
    if (dynamicServicesSpawned || !Array.isArray(links) || !links.length) return;
    dynamicServicesSpawned = true;
    const kinds = [
      { kind: 'relay', icon: '🛸', color: '#a855f7' },
      { kind: 'station', icon: '🛰️', color: '#00e5ff' },
      { kind: 'asteroid', icon: '🪨', color: '#94a3b8' },
      { kind: 'meteor', icon: '☄️', color: '#f5d061' }
    ];
    links.forEach((l, idx) => {
      const label = String(l.label || l.name || 'Service').replace('เวอร์ชันเดิม', 'Legacy');
      const shortTag = label.length > 14 ? label.slice(0, 13) + '…' : label;
      const k = kinds[idx % kinds.length];
      const beltRing = 325 + (idx % 3) * 32;
      const speed = (idx % 2 === 0 ? 1 : -1) * (0.0012 + (idx % 4) * 0.0003);
      const angle = (idx / links.length) * Math.PI * 2;
      const tiltX = ((idx % 5) - 2) * 0.22;
      const tiltY = (((idx + 2) % 5) - 2) * 0.2;

      createCosmicNode({
        id: `svc-link-${idx}`,
        label: shortTag,
        keywords: `${label} ${l.url || ''} service`,
        icon: k.icon,
        kind: k.kind,
        ring: beltRing,
        speed,
        angle,
        tiltX,
        tiltY,
        size: 26,
        color: k.color,
        getTag: () => `${k.icon} ${shortTag}`,
        getInfo: () => {
          const url = String(l.url || '');
          let action = { label: `🚀 เปิด ${label}`, href: url };
          if (url === '#sec-ports' || url === '#ports' || url === '#vpn') action = { label: `🛡️ เปิด ${label}`, view: 'ports' };
          else if (url === '/terminal' || url === '#sec-terminal' || url === '#terminal') action = { label: `💻 เปิด ${label}`, view: 'terminal' };
          else if (url === '#services') action = { label: `🐳 เปิด ${label}`, view: 'services' };
          return {
            title: label,
            status: 'SERVICE',
            body: `ปลายทาง: <code>${url || 'Internal'}</code><br>คลิกปุ่มด้านล่างเพื่อเข้าใช้งานบริการนี้ทันที`,
            actions: [action]
          };
        }
      });
    });
  }

  function focusAndOpenCosmic(st) {
    focusedState = st;
    if (targetZoom < 1.45) setTargetZoom(1.55);
    openPlanetPopover(st.def);
  }

  function openPlanetPopover(def) {
    if (!popoverEl || !def) return;
    const info = def.getInfo();
    const actionsHtml = (info.actions || []).map((a, idx) => {
      if (a.href) {
        return `<a class="planet-pop__btn" href="${a.href}" target="_blank" rel="noopener noreferrer">${a.label}</a>`;
      }
      return `<button type="button" class="planet-pop__btn" data-ov-act="${idx}">${a.label}</button>`;
    }).join('');

    popoverEl.innerHTML = `
      <div class="planet-pop__head">
        <div class="planet-pop__title">
          <span>${def.icon} ${info.title}</span>
          <span class="planet-pop__badge ${info.statusClass || ''}">${info.status}</span>
        </div>
        <button type="button" class="planet-pop__close" id="ov-pop-close" title="ปิด (Esc)">✕</button>
      </div>
      <div class="planet-pop__body">${info.body}</div>
      ${actionsHtml ? `<div class="planet-pop__actions">${actionsHtml}</div>` : ''}
    `;
    popoverEl.classList.add('is-open');

    popoverEl.querySelector('#ov-pop-close')?.addEventListener('click', resetCamera);
    popoverEl.querySelectorAll('[data-ov-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = info.actions[Number(btn.dataset.ovAct)];
        popoverEl.classList.remove('is-open');
        if (act?.view && typeof window.switchView === 'function') {
          window.switchView(act.view);
        } else if (act?.cosmic) {
          window.openOverviewCosmic(act.cosmic);
        }
      });
    });
  }

  window.openOverviewCosmic = function openOverviewCosmic(id) {
    const st = planetStates.find(s => s.def.id === id);
    if (st) focusAndOpenCosmic(st);
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (focusedState || popoverEl?.classList.contains('is-open'))) {
      resetCamera();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (popoverEl?.classList.contains('is-open') && !e.target.closest('#ov-planet-popover') && !e.target.closest('.ov-orbit-planet') && !e.target.closest('#ov-space-nav')) {
      popoverEl.classList.remove('is-open');
      focusedState = null;
      targetPanX = 0;
      targetPanY = 0;
      if (targetZoom > 1.2) setTargetZoom(1.0);
    }
  });

  // ── 5. Live Search & Radar Highlight ─────────────────────────────────────
  if (searchInput && searchResults) {
    // Prevent browser credential autofill (e.g. "admin") from sticking in the radar input
    searchInput.value = '';
    setTimeout(() => {
      if (document.activeElement !== searchInput && searchInput.value) {
        searchInput.value = '';
      }
    }, 250);

    function updateSearch() {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) {
        searchResults.innerHTML = '';
        searchResults.classList.remove('is-open');
        planetStates.forEach(st => st.el.classList.remove('is-search-match', 'is-search-dim'));
        return;
      }
      const matches = planetStates.filter(st =>
        (st.def.label + ' ' + (st.def.keywords || '')).toLowerCase().includes(q)
      );
      planetStates.forEach(st => {
        const hit = matches.includes(st);
        st.el.classList.toggle('is-search-match', hit);
        st.el.classList.toggle('is-search-dim', !hit);
      });
      if (matches.length) {
        searchResults.innerHTML = matches.slice(0, 7).map(st =>
          `<button type="button" class="ov-search-item" data-find-id="${st.def.id}"><span>${st.def.icon} ${st.def.label}</span><small>Fly →</small></button>`
        ).join('');
        searchResults.classList.add('is-open');
        searchResults.querySelectorAll('[data-find-id]').forEach(btn => {
          btn.addEventListener('click', () => {
            const target = planetStates.find(s => s.def.id === btn.dataset.findId);
            if (target) {
              searchResults.classList.remove('is-open');
              focusAndOpenCosmic(target);
            }
          });
        });
      } else {
        searchResults.innerHTML = '<div class="ov-search-empty">ไม่พบดาวหรือเซอร์วิสที่ค้นหา</div>';
        searchResults.classList.add('is-open');
      }
    }
    searchInput.addEventListener('input', updateSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = searchResults.querySelector('[data-find-id]');
        if (first) first.click();
      } else if (e.key === 'Escape') {
        searchInput.value = '';
        updateSearch();
      }
    });
  }

  // ── 6. 3D Projection & Elastic Collisions ─────────────────────────────────
  function projectPlanet3D(st, stageScale) {
    const r = st.def.ring * stageScale;
    const x0 = Math.cos(st.angle) * r;
    const y0 = Math.sin(st.angle) * r;
    const tiltX = st.def.tiltX ?? (st.def.ring <= 125 ? 0.44 : (st.def.ring <= 185 ? -0.46 : (st.def.ring <= 240 ? 0.28 : -0.34)));
    const tiltY = st.def.tiltY ?? (st.def.ring <= 125 ? -0.26 : (st.def.ring <= 185 ? 0.34 : (st.def.ring <= 240 ? -0.38 : 0.24)));

    const y1 = y0 * Math.cos(tiltX);
    const z1 = y0 * Math.sin(tiltX);
    const x2 = x0 * Math.cos(tiltY) + z1 * Math.sin(tiltY);
    const z2 = -x0 * Math.sin(tiltY) + z1 * Math.cos(tiltY);

    const scale = Math.max(0.76, Math.min(1.25, 680 / (680 - z2)));
    return { x: x2 * scale, y: y1 * scale, z: z2, scale };
  }

  function resolveCollisions(stageScale) {
    for (let i = 0; i < planetStates.length; i++) {
      const a = planetStates[i];
      const aAct = a.grabbed || Math.hypot(a.ox, a.oy) > 0.4 || Math.hypot(a.vx, a.vy) > 0.4;
      for (let j = i + 1; j < planetStates.length; j++) {
        const b = planetStates[j];
        const bAct = b.grabbed || Math.hypot(b.ox, b.oy) > 0.4 || Math.hypot(b.vx, b.vy) > 0.4;
        if (!aAct && !bAct) continue;

        const pa = projectPlanet3D(a, stageScale), pb = projectPlanet3D(b, stageScale);
        const dx = (pb.x + b.ox) - (pa.x + a.ox);
        const dy = (pb.y + b.oy) - (pa.y + a.oy);
        let dist = Math.hypot(dx, dy);
        const minDist = a.radius + b.radius;
        if (dist >= minDist) continue;
        if (dist < 0.001) dist = 0.001;
        const nx = dx / dist, ny = dy / dist;
        const overlap = minDist - dist;

        if (a.grabbed && !b.grabbed) {
          b.ox += nx * (overlap + 0.5); b.oy += ny * (overlap + 0.5);
          b.vx += nx * 1.8; b.vy += ny * 1.8;
        } else if (b.grabbed && !a.grabbed) {
          a.ox -= nx * (overlap + 0.5); a.oy -= ny * (overlap + 0.5);
          a.vx -= nx * 1.8; a.vy -= ny * 1.8;
        } else {
          a.ox -= nx * overlap * 0.5; a.oy -= ny * overlap * 0.5;
          b.ox += nx * overlap * 0.5; b.oy += ny * overlap * 0.5;
        }
      }
    }
  }

  // ── 7. Main 3D Render Loop ───────────────────────────────────────────────
  function frame() {
    const viewOv = document.getElementById('view-overview');
    if (viewOv && viewOv.style.display !== 'none') {
      const rect = hero.getBoundingClientRect();
      const w = rect.width || 1100;
      const h = rect.height || 720;
      const stageW = stage.clientWidth || 540;
      const stageScale = Math.max(0.55, Math.min(1.25, stageW / 520));
      const cpuPct = latestSummary?.host?.cpu?.pct || 0;
      const highLoad = cpuPct > 75;

      // Smooth 3D camera zoom & pan
      const prevZoom = camZoom;
      camZoom += (targetZoom - camZoom) * 0.09;
      const zoomDelta = camZoom - prevZoom;

      if (focusedState) {
        targetPanX = -focusedState.lastProjX * 0.65;
        targetPanY = -focusedState.lastProjY * 0.65 - 45;
      }
      camPanX += (targetPanX - camPanX) * 0.08;
      camPanY += (targetPanY - camPanY) * 0.08;

      if (!dragging) {
        vx = (vx - ox * 0.085) * 0.85;
        vy = (vy - oy * 0.085) * 0.85;
        ox += vx; oy += vy;
        if (Math.abs(ox) < 0.05 && Math.abs(vx) < 0.05) { ox = 0; vx = 0; }
        if (Math.abs(oy) < 0.05 && Math.abs(vy) < 0.05) { oy = 0; vy = 0; }
      }
      spinAngle = (spinAngle + spinVel) % 360;
      spinVel *= dragging ? 0.94 : 0.975;
      if (Math.abs(spinVel) < 0.01) spinVel = 0;

      hoverTiltX += (targetHoverX - hoverTiltX) * 0.08;
      hoverTiltY += (targetHoverY - hoverTiltY) * 0.08;

      const tiltX = Math.max(-24, Math.min(24, -oy * 0.14 + hoverTiltX));
      const tiltY = Math.max(-24, Math.min(24, ox * 0.14 + hoverTiltY));
      stage.style.transform = `translate3d(${(ox + camPanX).toFixed(1)}px, ${(oy + camPanY).toFixed(1)}px, 0) scale(${camZoom.toFixed(3)}) perspective(1100px) rotateX(${tiltX.toFixed(1)}deg) rotateY(${tiltY.toFixed(1)}deg)`;
      if (svgEl) svgEl.style.transform = `rotate(${spinAngle.toFixed(2)}deg)`;

      // 3D Starfield + Volumetric Nebula + Shooting Stars
      const cx = w * 0.5 + (ox + camPanX) * 0.35 + hoverTiltY * 1.4;
      const cy = h * 0.48 + (oy + camPanY) * 0.35 - hoverTiltX * 1.4;
      const energyBoost = Math.min(3.5, Math.abs(spinVel) * 0.16 + Math.hypot(vx, vy) * 0.06 + Math.abs(zoomDelta) * 28);
      const focal = 420 * camZoom;
      const rotStep = (highLoad ? 0.0024 : 0.0007) + spinVel * 0.0014;
      const cosR = Math.cos(rotStep), sinR = Math.sin(rotStep);
      const zSpeed = (highLoad ? 3.2 : (energyBoost > 0.6 ? energyBoost * 2.2 : 0.35)) + zoomDelta * 420;

      ctx.clearRect(0, 0, w, h);

      // Subtle drifting 3D Nebula Clouds
      const nebGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.55);
      nebGrad.addColorStop(0, `rgba(0, 229, 255, ${0.07 * Math.min(1.5, camZoom)})`);
      nebGrad.addColorStop(0.45, 'rgba(79, 70, 229, 0.05)');
      nebGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = nebGrad;
      ctx.fillRect(0, 0, w, h);

      const constPts = [];
      stars.forEach((s) => {
        s.twinkle += highLoad ? 0.09 : (0.025 + energyBoost * 0.03);
        const nx = s.x * cosR - s.y * sinR;
        const ny = s.x * sinR + s.y * cosR;
        s.x = nx; s.y = ny;

        const prevZ = s.z;
        s.z -= s.speed * zSpeed;
        if (s.z < 55) s.z = 920 + Math.random() * 60;
        if (s.z > 980) s.z = 65 + Math.random() * 40;

        const proj = focal / s.z;
        const sx = cx + s.x * proj;
        const sy = cy + s.y * proj;
        const depthAlpha = Math.min(1, Math.max(0.14, 1.15 - s.z / 980));
        const alpha = depthAlpha * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.twinkle)));
        const radius = Math.max(0.5, s.size * proj * 1.15);

        if ((highLoad || energyBoost > 0.7) && prevZ > s.z) {
          const streakProj = focal / Math.min(990, s.z + (highLoad ? 32 : energyBoost * 18) * s.speed);
          ctx.beginPath();
          ctx.moveTo(cx + s.x * streakProj, cy + s.y * streakProj);
          ctx.lineTo(sx, sy);
          ctx.strokeStyle = `hsla(${s.hue}, 95%, 74%, ${alpha * 0.75})`;
          ctx.lineWidth = radius * 0.85;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${s.hue}, 95%, 84%, ${alpha})`;
        ctx.fill();

        if (s.constellation && sx > -20 && sx < w + 20 && sy > -20 && sy < h + 20) {
          constPts.push({ x: sx, y: sy, alpha });
        }
      });

      if (constPts.length > 1) {
        ctx.lineWidth = 0.65;
        for (let i = 0; i < constPts.length; i++) {
          for (let j = i + 1; j < constPts.length; j++) {
            const d = Math.hypot(constPts[i].x - constPts[j].x, constPts[i].y - constPts[j].y);
            if (d < 95 * camZoom) {
              const la = (1 - d / (95 * camZoom)) * 0.16 * Math.min(constPts[i].alpha, constPts[j].alpha);
              ctx.beginPath();
              ctx.moveTo(constPts[i].x, constPts[i].y);
              ctx.lineTo(constPts[j].x, constPts[j].y);
              ctx.strokeStyle = `rgba(245, 208, 97, ${la.toFixed(3)})`;
              ctx.stroke();
            }
          }
        }
      }

      // Occasional Shooting Stars
      if (Math.random() < 0.015 && shootingStars.length < 3) {
        shootingStars.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.5,
          vx: (Math.random() > 0.5 ? 1 : -1) * (6 + Math.random() * 7),
          vy: 2.5 + Math.random() * 4,
          life: 1.0
        });
      }
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const m = shootingStars[i];
        m.x += m.vx; m.y += m.vy; m.life -= 0.028;
        if (m.life <= 0) { shootingStars.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.moveTo(m.x - m.vx * 5, m.y - m.vy * 5);
        ctx.lineTo(m.x, m.y);
        ctx.strokeStyle = `rgba(253, 230, 138, ${m.life * 0.85})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // 3D Planet & Satellite Orbits
      const now = performance.now();
      const speedMult = (highLoad ? 2.1 : 1) * (focusedState ? 0.35 : 1);
      for (const st of planetStates) {
        if (!st.grabbed) {
          st.angle += st.def.speed * speedMult + spinVel * 0.0025;
          st.vx = (st.vx - st.ox * 0.025) * 0.94;
          st.vy = (st.vy - st.oy * 0.025) * 0.94;
          st.ox += st.vx; st.oy += st.vy;
          if (Math.abs(st.ox) < 0.05 && Math.abs(st.vx) < 0.05) { st.ox = 0; st.vx = 0; }
          if (Math.abs(st.oy) < 0.05 && Math.abs(st.vy) < 0.05) { st.oy = 0; st.vy = 0; }
        } else if (now - st.lastMoveTs > 45) {
          st.vx *= 0.7; st.vy *= 0.7;
        }
      }
      resolveCollisions(stageScale);

      for (const st of planetStates) {
        const p = projectPlanet3D(st, stageScale);
        st.lastProjX = p.x + st.ox;
        st.lastProjY = p.y + st.oy;
        const pz = st.grabbed ? 45 : p.z;
        const pScale = st.grabbed ? 1.2 : (focusedState === st ? p.scale * 1.25 : p.scale);
        st.el.style.transform = `translate3d(calc(-50% + ${st.lastProjX.toFixed(1)}px), calc(-50% + ${st.lastProjY.toFixed(1)}px), ${pz.toFixed(1)}px) scale(${pScale.toFixed(3)})`;
        st.el.style.zIndex = (st.grabbed || focusedState === st) ? '32' : (pz >= 0 ? '14' : '3');
        st.el.style.opacity = (st.grabbed || focusedState === st) ? '1' : (pz < -15 ? (0.64 + (pz + 200) / 500).toFixed(2) : '1');
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ── 8. Live Linux Telemetry Updater (called by app.js every 5s) ──────────
  window.updateOverviewGalaxy = function updateOverviewGalaxy(s, rate) {
    latestSummary = s;
    latestRate = rate;
    if (!s) return;

    if (s.links) syncDynamicServiceSatellites(s.links);

    const h = s.host || {};
    const cpu = h.cpu || {};
    const mem = h.mem || {};
    const root = (h.disks || []).find(d => d.mount === '/') || (h.disks || [])[0] || {};
    const maxTemp = (h.temps || []).reduce((m, t) => Math.max(m, t.celsius || 0), 0);
    const dck = s.docker || {};
    const svc = s.services || {};
    const pm2 = s.pm2 || {};
    const en = s.energy || {};
    const rt = en.realtime || {};
    const td = en.today || {};
    const tm = en.this_month || {};

    const pushSample = (arr, val) => { arr.push(val || 0); if (arr.length > 40) arr.shift(); };
    pushSample(trendHistory.cpu, cpu.pct || 0);
    pushSample(trendHistory.mem, mem.pct || 0);
    pushSample(trendHistory.rx, rate?.rx || 0);
    pushSample(trendHistory.tx, rate?.tx || 0);

    planetStates.forEach((st) => {
      if (st.tagEl && st.def.getTag) st.tagEl.textContent = st.def.getTag();
    });

    const cpuPct = Math.round(cpu.pct || 0);
    const statusEl = document.getElementById('ov-reactor-status');
    if (statusEl) {
      statusEl.textContent = cpuPct > 80
        ? `HIGH LOAD (${cpuPct}%) · ${h.hostname || 'homelab'}`
        : `SYSTEM NOMINAL · ${h.hostname || 'homelab'}`;
    }
    hero.classList.toggle('is-high-load', cpuPct > 80);

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setBar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = `${Math.min(100, Math.max(0, pct || 0)).toFixed(1)}%`; };

    setText('ov-wing-host', `${h.hostname || 'homelab'} · ${h.platform || 'Linux'}`);
    setText('ov-wing-cpu', `${cpuPct}%`);
    setBar('ov-wing-cpu-bar', cpu.pct || 0);
    setText('ov-wing-load', `Load: ${(h.load || []).slice(0, 3).map(n => n.toFixed(2)).join(' / ') || '—'} · ${cpu.cores?.length || 0} cores`);

    setText('ov-wing-mem', `${Math.round(mem.pct || 0)}%`);
    setBar('ov-wing-mem-bar', mem.pct || 0);
    setText('ov-wing-mem-meta', `${fmtB(mem.used)} / ${fmtB(mem.total)}`);

    setText('ov-wing-disk', `${Math.round(root.usedPct || 0)}%`);
    setBar('ov-wing-disk-bar', root.usedPct || 0);
    setText('ov-wing-disk-meta', `${root.mount || '/'} · ${fmtB(root.used || 0)} / ${fmtB(root.size || 0)}`);

    setText('ov-wing-temp', maxTemp ? `${maxTemp.toFixed(1)}°C` : '—');
    setText('ov-wing-uptime', fmtUpShort(h.uptimeSec));

    setText('ov-wing-watts', rt.power_watts != null ? `${Math.round(rt.power_watts)} W` : '— W');
    setText('ov-wing-ac', `${rt.voltage_volts || '—'} V · ${rt.current_amps || '—'} A · วันนี้ ${td.cost_thb != null ? td.cost_thb.toFixed(0) : '—'}฿ · เดือนนี้ ${tm.cost_thb != null ? Math.round(tm.cost_thb) : '—'}฿`);
    setText('ov-wing-docker', `${dck.running ?? 0}/${dck.total ?? 0}`);
    setText('ov-wing-pm2', `${pm2.total ?? 0} apps`);
    setText('ov-wing-svc', `${svc.up ?? 0}/${svc.total ?? 0}`);
    setText('ov-wing-net', rate ? `↓ ${fmtRateShort(rate.rx)}  ↑ ${fmtRateShort(rate.tx)}` : '—');
  };

  // ── 9. Overview Cards Collapse/Expand (Default: Expanded) ────────────────────
  (function initOverviewCardToggles() {
    const cards = document.querySelectorAll('[data-ov-card]');
    cards.forEach((card) => {
      const id = card.getAttribute('data-ov-card');
      const btn = card.querySelector('.ov-card-toggle');
      if (!id || !btn) return;
      const isCollapsed = localStorage.getItem(`ov_card_collapsed_${id}`) === '1';
      card.classList.toggle('is-collapsed', isCollapsed);
      btn.setAttribute('aria-expanded', String(!isCollapsed));

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextCollapsed = !card.classList.contains('is-collapsed');
        card.classList.toggle('is-collapsed', nextCollapsed);
        btn.setAttribute('aria-expanded', String(!nextCollapsed));
        try {
          localStorage.setItem(`ov_card_collapsed_${id}`, nextCollapsed ? '1' : '0');
        } catch (_) {}
      });
    });

    const gearBtn = document.getElementById('ov-prayer-gear-btn');
    if (gearBtn) {
      gearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.switchView === 'function') {
          window.switchView('settings');
          setTimeout(() => {
            document.getElementById('card-prayer-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 120);
        }
      });
    }
  })();

  // ── 10. Celestial Prayer Times Engine (Aladhan API + Offline Astronomical Fallback) ─
  (function initPrayerTimesWidget() {
    const card = document.getElementById('ov-prayer-card');
    if (!card) return;

    const CITIES = [
      { name: 'Bangkok', lat: 13.7563, lon: 100.5018 },
      { name: 'Nonthaburi', lat: 13.8621, lon: 100.5144 },
      { name: 'Pathum Thani', lat: 14.0208, lon: 100.5250 },
      { name: 'Chonburi', lat: 13.3611, lon: 100.9847 },
      { name: 'Chiang Mai', lat: 18.7883, lon: 98.9853 },
      { name: 'Phuket', lat: 7.8804, lon: 98.3923 },
      { name: 'Hat Yai', lat: 7.0086, lon: 100.4747 },
      { name: 'Pattani', lat: 6.8695, lon: 101.2505 },
      { name: 'Yala', lat: 6.5411, lon: 101.2804 },
      { name: 'Narathiwat', lat: 6.4255, lon: 101.8253 },
      { name: 'Nakhon Si Thammarat', lat: 8.4304, lon: 99.9631 },
      { name: 'Krabi', lat: 8.0863, lon: 98.9063 },
      { name: 'Satun', lat: 6.6238, lon: 100.0674 }
    ];
    const METHOD_LABELS = {
      0: 'Jafari', 1: 'Karachi', 2: 'ISNA', 3: 'MWL', 4: 'Makkah',
      5: 'Egypt', 11: 'MUIS', 13: 'Diyanet', 15: 'Moonsighting',
      17: 'JAKIM', 20: 'KEMENAG', 99: 'Custom'
    };
    const METHOD_ANGLES = {
      0: [16, 14], 1: [18, 18], 2: [15, 15], 3: [18, 17], 4: [18.5, 17],
      5: [19.5, 17.5], 11: [20, 18], 13: [18, 17], 15: [18, 18],
      17: [20, 18], 20: [20, 18]
    };
    const PRAYERS = [
      { key: 'Fajr', th: 'ซุบฮิ', en: 'Fajr' },
      { key: 'Dhuhr', th: 'ซุฮ์ริ', en: 'Dhuhr' },
      { key: 'Asr', th: 'อัศริ', en: 'Asr' },
      { key: 'Maghrib', th: 'มัฆริบ', en: 'Maghrib' },
      { key: 'Isha', th: 'อิชาอ์', en: 'Isha' }
    ];

    const cityBtn = document.getElementById('ov-prayer-city-btn');
    const hijriEl = document.getElementById('ov-prayer-hijri');
    const nextNameEl = document.getElementById('ov-prayer-next-name');
    const nextTimeEl = document.getElementById('ov-prayer-next-time');
    const countdownEl = document.getElementById('ov-prayer-countdown');
    const progEl = document.getElementById('ov-prayer-prog');
    const metaStrip = document.getElementById('ov-prayer-meta-strip');
    const sunriseInfoEl = document.getElementById('ov-prayer-sunrise-info');
    const methodBadgeEl = document.getElementById('ov-prayer-method-badge');

    let currentTimings = null;
    let currentSunrise = '--:--';

    function getSettings() {
      const defaults = {
        city: localStorage.getItem('ov_prayer_city') || 'Bangkok',
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
      try {
        const raw = localStorage.getItem('ov_prayer_settings_v1');
        if (!raw) {
          const c = CITIES.find(x => x.name === defaults.city) || CITIES[0];
          defaults.lat = c.lat;
          defaults.lon = c.lon;
          return defaults;
        }
        const parsed = JSON.parse(raw);
        return {
          ...defaults,
          ...parsed,
          tune: { ...defaults.tune, ...(parsed.tune || {}) }
        };
      } catch (_) {
        return defaults;
      }
    }

    function formatDisplayTime(hhmm, fmt) {
      if (!hhmm || !hhmm.includes(':')) return hhmm || '--:--';
      if (fmt !== '12h') return hhmm;
      const [hStr, mStr] = hhmm.split(':');
      const h = parseInt(hStr, 10);
      if (isNaN(h)) return hhmm;
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${mStr} ${ampm}`;
    }

    // Offline astronomical prayer calculator (supports custom TZ, angles, Shafi/Hanafi, and tune)
    function computeOfflineTimings(date, cfg) {
      const lat = Number(cfg.lat) || 13.7563;
      const lon = Number(cfg.lon) || 100.5018;
      const tz = Number(cfg.tz) || 7;
      const rad = Math.PI / 180;
      const start = new Date(date.getFullYear(), 0, 0);
      const dayOfYear = Math.floor((date - start) / 86400000);
      const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
      const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
      const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma);
      const solarNoonMin = 720 - 4 * lon - eqTime + tz * 60;

      const hourAngle = (angleDeg) => {
        const cosH = (Math.sin(angleDeg * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
        return Math.acos(Math.max(-1, Math.min(1, cosH))) / rad * 4;
      };
      const shadowFactor = Number(cfg.school) === 1 ? 2 : 1;
      const asrAngle = Math.atan(1 / (shadowFactor + Math.tan(Math.abs(lat * rad - decl)))) / rad;
      const [defFajr, defIsha] = METHOD_ANGLES[cfg.method] || [18, 17];
      const fajrAng = Number(cfg.method) === 99 ? (Number(cfg.fajrAngle) || 18) : defFajr;
      const ishaAng = Number(cfg.method) === 99 ? (Number(cfg.ishaAngle) || 17) : defIsha;
      const tune = cfg.tune || {};

      const fmtMin = (m) => {
        const tot = ((Math.round(m) % 1440) + 1440) % 1440;
        return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
      };

      const maghribMin = solarNoonMin + hourAngle(-0.833);
      const ishaMin = Number(cfg.method) === 4 ? (maghribMin + 90) : (solarNoonMin + hourAngle(-ishaAng));

      return {
        Sunrise: fmtMin(solarNoonMin - hourAngle(-0.833)),
        Fajr: fmtMin(solarNoonMin - hourAngle(-fajrAng) + (Number(tune.Fajr) || 0)),
        Dhuhr: fmtMin(solarNoonMin + 2 + (Number(tune.Dhuhr) || 0)),
        Asr: fmtMin(solarNoonMin + hourAngle(asrAngle) + (Number(tune.Asr) || 0)),
        Maghrib: fmtMin(maghribMin + (Number(tune.Maghrib) || 0)),
        Isha: fmtMin(ishaMin + (Number(tune.Isha) || 0))
      };
    }

    function formatHijriFallback(date, hijriAdj) {
      const d = new Date(date.getTime() + (Number(hijriAdj) || 0) * 86400000);
      try {
        return new Intl.DateTimeFormat('th-TH-u-ca-islamic', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
      } catch (_) {
        return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }

    async function loadPrayerTimes(forceRefresh = false) {
      const cfg = getSettings();
      const cityLabel = cfg.city === 'custom'
        ? `${Number(cfg.lat).toFixed(2)}, ${Number(cfg.lon).toFixed(2)}`
        : cfg.city;
      if (cityBtn) cityBtn.textContent = `📍 ${cityLabel}`;

      if (metaStrip) {
        metaStrip.style.display = cfg.showSunrise ? 'flex' : 'none';
      }
      if (methodBadgeEl) {
        const mName = METHOD_LABELS[cfg.method] || 'MWL';
        const sName = Number(cfg.school) === 1 ? 'Hanafi' : 'Shafi';
        methodBadgeEl.textContent = `${mName} · ${sName}`;
      }

      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const dateKey = `${yyyy}-${mm}-${dd}`;
      const t = cfg.tune || {};
      const tuneStr = `0,${Number(t.Fajr) || 0},0,${Number(t.Dhuhr) || 0},${Number(t.Asr) || 0},${Number(t.Maghrib) || 0},0,${Number(t.Isha) || 0},0`;
      const cfgHash = `${Number(cfg.lat).toFixed(3)}_${Number(cfg.lon).toFixed(3)}_m${cfg.method}_s${cfg.school}_h${cfg.highLat}_mn${cfg.midnightMode}_ha${cfg.hijriAdj}_fa${cfg.fajrAngle}_ia${cfg.ishaAngle}_t${tuneStr}`;
      const cacheKey = `ov_prayer_cache_v2_${dateKey}_${cfgHash}`;

      if (!forceRefresh) {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            currentTimings = parsed.timings;
            currentSunrise = parsed.sunrise || '--:--';
            if (hijriEl) hijriEl.textContent = parsed.hijri || formatHijriFallback(now, cfg.hijriAdj);
            updateCountdown();
            return;
          }
        } catch (_) {}
      }

      // Show offline astronomical estimate immediately while fetching exact API
      const offline = computeOfflineTimings(now, cfg);
      currentTimings = offline;
      currentSunrise = offline.Sunrise || '--:--';
      if (hijriEl) hijriEl.textContent = formatHijriFallback(now, cfg.hijriAdj);
      updateCountdown();

      try {
        let url = `https://api.aladhan.com/v1/timings/${dd}-${mm}-${yyyy}?latitude=${encodeURIComponent(cfg.lat)}&longitude=${encodeURIComponent(cfg.lon)}&method=${encodeURIComponent(cfg.method)}&school=${encodeURIComponent(cfg.school)}&tune=${encodeURIComponent(tuneStr)}&latitudeAdjustmentMethod=${encodeURIComponent(cfg.highLat)}&midnightMode=${encodeURIComponent(cfg.midnightMode)}`;
        if (Number(cfg.method) === 99) {
          url += `&methodSettings=${encodeURIComponent(`${cfg.fajrAngle},null,${cfg.ishaAngle}`)}`;
        }
        if (Number(cfg.hijriAdj)) {
          url += `&adjustment=${encodeURIComponent(cfg.hijriAdj)}`;
        }
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        const data = json?.data;
        if (data?.timings) {
          const clean = {};
          PRAYERS.forEach(p => {
            clean[p.key] = String(data.timings[p.key] || '').slice(0, 5);
          });
          const sunrise = String(data.timings.Sunrise || offline.Sunrise || '--:--').slice(0, 5);
          const hijri = data.date?.hijri
            ? `${data.date.hijri.day} ${data.date.hijri.month?.en || ''} ${data.date.hijri.year} AH`
            : formatHijriFallback(now, cfg.hijriAdj);
          currentTimings = clean;
          currentSunrise = sunrise;
          if (hijriEl) hijriEl.textContent = hijri;
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ timings: clean, sunrise, hijri }));
          } catch (_) {}
          updateCountdown();
        }
      } catch (_) {}
    }

    function toSeconds(hhmm) {
      const [h, m] = String(hhmm || '00:00').split(':').map(Number);
      return (h || 0) * 3600 + (m || 0) * 60;
    }

    function updateCountdown() {
      if (!currentTimings) return;
      const cfg = getSettings();
      const now = new Date();
      const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

      let nextIdx = PRAYERS.findIndex(p => toSeconds(currentTimings[p.key]) > nowSec);
      const isTomorrow = nextIdx === -1;
      if (isTomorrow) nextIdx = 0;

      const nextP = PRAYERS[nextIdx];
      const prevP = PRAYERS[(nextIdx + PRAYERS.length - 1) % PRAYERS.length];
      let nextSec = toSeconds(currentTimings[nextP.key]);
      let prevSec = toSeconds(currentTimings[prevP.key]);

      if (isTomorrow) nextSec += 86400;
      if (prevSec > nextSec) prevSec -= 86400;
      const curForProg = (isTomorrow && nowSec < prevSec) ? nowSec + 86400 : nowSec;

      const diff = Math.max(0, nextSec - nowSec);
      const hh = String(Math.floor(diff / 3600)).padStart(2, '0');
      const mm = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
      const ss = String(diff % 60).padStart(2, '0');

      if (nextNameEl) nextNameEl.textContent = `${nextP.th} (${nextP.en})`;
      if (nextTimeEl) nextTimeEl.textContent = formatDisplayTime(currentTimings[nextP.key], cfg.timeFormat);
      if (countdownEl) countdownEl.textContent = `อีก ${hh}:${mm}:${ss}`;
      if (sunriseInfoEl) sunriseInfoEl.textContent = `🌅 ชูรูก ${formatDisplayTime(currentSunrise, cfg.timeFormat)}`;

      const span = Math.max(1, nextSec - prevSec);
      const pct = Math.max(0, Math.min(100, ((curForProg - prevSec) / span) * 100));
      if (progEl) progEl.style.width = `${pct.toFixed(1)}%`;

      PRAYERS.forEach((p, idx) => {
        const pill = card.querySelector(`.ov-prayer-pill[data-prayer="${p.key}"]`);
        if (!pill) return;
        const strong = pill.querySelector('strong');
        if (strong) strong.textContent = formatDisplayTime(currentTimings[p.key], cfg.timeFormat);
        pill.classList.toggle('is-next', idx === nextIdx);
        pill.classList.toggle('is-passed', !isTomorrow && idx < nextIdx);
      });
    }

    if (cityBtn) {
      cityBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cfg = getSettings();
        const curIdx = Math.max(-1, CITIES.findIndex(c => c.name === cfg.city));
        const nextCity = CITIES[(curIdx + 1) % CITIES.length];
        cfg.city = nextCity.name;
        cfg.lat = nextCity.lat;
        cfg.lon = nextCity.lon;
        try {
          localStorage.setItem('ov_prayer_city', nextCity.name);
          localStorage.setItem('ov_prayer_settings_v1', JSON.stringify(cfg));
        } catch (_) {}
        window.dispatchEvent(new CustomEvent('prayer-settings-updated'));
      });
    }

    window.addEventListener('prayer-settings-updated', () => loadPrayerTimes(true));

    loadPrayerTimes();
    setInterval(updateCountdown, 1000);
  })();
})();

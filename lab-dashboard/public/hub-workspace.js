/* ============================================================================
   Homelab Hub Workspace, Split-View, Kiosk Wall-Display & Family Role (IIFE)
   Exposes:
     - window.LabWorkspace: { open(app), openSplit(app), close(), isOpen() }
     - window.LabKiosk:     { enter(), exit(), toggle(), isActive() }
     - window.LabRole:      { getRole(), isFamily() }
   XSS-safe: uses document.createElement + textContent exclusively.
   ========================================================================== */
(function () {
    'use strict';

    const MAX_TABS = 8;

    // ── Shared Helpers ───────────────────────────────────────────────────────
    function safeUrl(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        if (s.startsWith('/') && !s.startsWith('//')) return s;
        if (/^https?:\/\//i.test(s)) return s;
        return '';
    }

    function getEmbeddableApps() {
        const list = (window.LabLauncher && typeof window.LabLauncher.getApps === 'function')
            ? window.LabLauncher.getApps()
            : [];
        return list.filter((a) => a && a.embed !== false && safeUrl(a.url));
    }

    function isTypingTarget(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 1. Multi-App Tabbed Workspace / Split-View
    // ═════════════════════════════════════════════════════════════════════════
    const ws = {
        open: false,
        split: false,
        tabs: [],          // [{ id, label, emoji, url }]
        activeId: null,
        splitId: null,
        els: {},
    };

    function ensureWorkspaceDom() {
        if (ws.els.root) return;

        const root = document.createElement('div');
        root.className = 'lab-ws';
        root.id = 'lab-workspace';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', 'Multi-App Workspace');
        root.hidden = true;

        const header = document.createElement('div');
        header.className = 'lab-ws__bar';

        const tabsWrap = document.createElement('div');
        tabsWrap.className = 'lab-ws__tabs';
        tabsWrap.setAttribute('role', 'tablist');

        const controls = document.createElement('div');
        controls.className = 'lab-ws__controls';

        const picker = document.createElement('select');
        picker.className = 'lab-ws__picker';
        picker.setAttribute('aria-label', 'เพิ่มแท็บแอปใน Workspace');
        picker.addEventListener('change', () => {
            const pickedId = picker.value;
            picker.value = '';
            if (!pickedId) return;
            const app = getEmbeddableApps().find((a) => a.id === pickedId);
            if (app) openWorkspace(app);
        });

        const splitBtn = document.createElement('button');
        splitBtn.type = 'button';
        splitBtn.className = 'lab-ws__btn';
        splitBtn.textContent = '⊞ แบ่ง 2 จอ';
        splitBtn.title = 'สลับโหมด Split-View (2 หน้าต่างเคียงกัน)';
        splitBtn.addEventListener('click', () => {
            ws.split = !ws.split;
            if (ws.split && !ws.splitId) {
                const other = ws.tabs.find((t) => t.id !== ws.activeId);
                ws.splitId = other ? other.id : ws.activeId;
            }
            renderWorkspace();
        });

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'lab-ws__btn lab-ws__btn--danger';
        closeBtn.textContent = '✕ ปิด';
        closeBtn.title = 'ปิด Workspace (Esc)';
        closeBtn.addEventListener('click', closeWorkspace);

        controls.appendChild(picker);
        controls.appendChild(splitBtn);
        controls.appendChild(closeBtn);

        header.appendChild(tabsWrap);
        header.appendChild(controls);

        const stage = document.createElement('div');
        stage.className = 'lab-ws__stage';

        root.appendChild(header);
        root.appendChild(stage);
        document.body.appendChild(root);

        ws.els = { root, tabsWrap, picker, splitBtn, stage };
    }

    function refreshWorkspacePicker() {
        if (!ws.els.picker) return;
        const picker = ws.els.picker;
        picker.textContent = '';

        const defOpt = document.createElement('option');
        defOpt.value = '';
        defOpt.textContent = '+ เปิดแอปเพิ่ม...';
        picker.appendChild(defOpt);

        getEmbeddableApps().forEach((app) => {
            const opt = document.createElement('option');
            opt.value = app.id;
            opt.textContent = `${app.emoji || '🔗'} ${app.label}`;
            picker.appendChild(opt);
        });
    }

    function upsertTab(app) {
        if (!app) return null;
        const url = safeUrl(app.url);
        if (!url) return null;
        const existing = ws.tabs.find((t) => t.id === app.id);
        if (existing) {
            existing.url = url;
            existing.label = String(app.label || app.id);
            existing.emoji = String(app.emoji || '🔗');
            return existing;
        }
        if (ws.tabs.length >= MAX_TABS) {
            ws.tabs.shift();
        }
        const tab = {
            id: String(app.id),
            label: String(app.label || app.id),
            emoji: String(app.emoji || '🔗'),
            url,
        };
        ws.tabs.push(tab);
        return tab;
    }

    function closeTab(id) {
        ws.tabs = ws.tabs.filter((t) => t.id !== id);
        if (ws.activeId === id) {
            ws.activeId = ws.tabs.length ? ws.tabs[0].id : null;
        }
        if (ws.splitId === id) {
            const other = ws.tabs.find((t) => t.id !== ws.activeId);
            ws.splitId = other ? other.id : null;
            if (!ws.splitId) ws.split = false;
        }
        if (!ws.tabs.length) {
            closeWorkspace();
            return;
        }
        renderWorkspace();
    }

    function createPaneEl(tab, slotName) {
        const pane = document.createElement('div');
        pane.className = 'lab-ws__pane';
        pane.dataset.slot = slotName;

        const bar = document.createElement('div');
        bar.className = 'lab-ws__pane-bar';

        const title = document.createElement('div');
        title.className = 'lab-ws__pane-title';
        title.textContent = `${tab.emoji || '🔗'} ${tab.label}`;

        const urlLbl = document.createElement('span');
        urlLbl.className = 'lab-ws__pane-url';
        urlLbl.textContent = tab.url;

        const acts = document.createElement('div');
        acts.className = 'lab-ws__pane-acts';

        if (ws.split && ws.tabs.length > 1) {
            const sel = document.createElement('select');
            sel.className = 'lab-ws__pane-sel';
            sel.setAttribute('aria-label', 'เลือกแอปในหน้าต่างนี้');
            ws.tabs.forEach((t) => {
                const o = document.createElement('option');
                o.value = t.id;
                o.textContent = `${t.emoji} ${t.label}`;
                o.selected = t.id === tab.id;
                sel.appendChild(o);
            });
            sel.addEventListener('change', () => {
                if (slotName === 'left') ws.activeId = sel.value;
                else ws.splitId = sel.value;
                renderWorkspace();
            });
            acts.appendChild(sel);
        }

        const reloadBtn = document.createElement('button');
        reloadBtn.type = 'button';
        reloadBtn.className = 'lab-ws__mini-btn';
        reloadBtn.textContent = '🔄';
        reloadBtn.title = 'โหลดหน้านี้ใหม่';

        const extLink = document.createElement('a');
        extLink.className = 'lab-ws__mini-btn';
        extLink.href = tab.url;
        extLink.target = '_blank';
        extLink.rel = 'noopener noreferrer';
        extLink.textContent = '↗ แท็บใหม่';
        extLink.title = 'เปิดในแท็บเบราว์เซอร์ใหม่ (ใช้กรณีเว็บปลายทางบล็อก iframe)';

        acts.appendChild(reloadBtn);
        acts.appendChild(extLink);

        bar.appendChild(title);
        bar.appendChild(urlLbl);
        bar.appendChild(acts);

        const frameWrap = document.createElement('div');
        frameWrap.className = 'lab-ws__frame-wrap';

        const frame = document.createElement('iframe');
        frame.className = 'lab-ws__frame';
        frame.src = tab.url;
        frame.title = tab.label;
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('allow', 'fullscreen; clipboard-read; clipboard-write');

        reloadBtn.addEventListener('click', () => {
            frame.src = tab.url;
        });

        const hint = document.createElement('div');
        hint.className = 'lab-ws__hint';
        hint.textContent = '💡 หากเว็บปลายทางไม่แสดง (X-Frame-Options) กดปุ่ม "↗ แท็บใหม่" ด้านบนขวาได้ทันที';

        frameWrap.appendChild(frame);
        pane.appendChild(bar);
        pane.appendChild(frameWrap);
        pane.appendChild(hint);
        return pane;
    }

    function renderWorkspace() {
        ensureWorkspaceDom();
        refreshWorkspacePicker();

        ws.els.splitBtn.classList.toggle('is-active', ws.split);
        ws.els.splitBtn.textContent = ws.split ? '▢ จอเดี่ยว' : '⊞ แบ่ง 2 จอ';

        // Render tab strip
        ws.els.tabsWrap.textContent = '';
        ws.tabs.forEach((t) => {
            const btn = document.createElement('div');
            btn.className = 'lab-ws__tab' + (t.id === ws.activeId ? ' is-active' : '');
            btn.setAttribute('role', 'tab');
            btn.setAttribute('tabindex', '0');
            btn.setAttribute('aria-selected', t.id === ws.activeId ? 'true' : 'false');

            const lbl = document.createElement('span');
            lbl.className = 'lab-ws__tab-lbl';
            lbl.textContent = `${t.emoji} ${t.label}`;

            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'lab-ws__tab-x';
            x.textContent = '✕';
            x.setAttribute('aria-label', `ปิดแท็บ ${t.label}`);
            x.addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(t.id);
            });

            btn.appendChild(lbl);
            btn.appendChild(x);
            btn.addEventListener('click', () => {
                ws.activeId = t.id;
                renderWorkspace();
            });
            ws.els.tabsWrap.appendChild(btn);
        });

        // Render stage panes
        ws.els.stage.textContent = '';
        ws.els.stage.classList.toggle('is-split', ws.split);

        const primaryTab = ws.tabs.find((t) => t.id === ws.activeId) || ws.tabs[0];
        if (!primaryTab) {
            const empty = document.createElement('div');
            empty.className = 'lab-ws__empty';
            empty.textContent = 'เลือกแอปจากเมนู "+ เปิดแอปเพิ่ม..." ด้านบนเพื่อเริ่มใช้งาน Multi-App Workspace';
            ws.els.stage.appendChild(empty);
            return;
        }

        ws.els.stage.appendChild(createPaneEl(primaryTab, 'left'));

        if (ws.split) {
            const secondTab = ws.tabs.find((t) => t.id === ws.splitId)
                || ws.tabs.find((t) => t.id !== primaryTab.id)
                || primaryTab;
            ws.splitId = secondTab.id;
            ws.els.stage.appendChild(createPaneEl(secondTab, 'right'));
        }
    }

    function openWorkspace(app) {
        ensureWorkspaceDom();
        if (app) {
            const tab = upsertTab(app);
            if (tab) ws.activeId = tab.id;
        } else if (!ws.tabs.length) {
            const embeddables = getEmbeddableApps();
            if (embeddables.length) {
                const first = upsertTab(embeddables[0]);
                if (first) ws.activeId = first.id;
            }
        }
        ws.open = true;
        ws.els.root.hidden = false;
        document.body.classList.add('lab-ws-open');
        renderWorkspace();
    }

    function openWorkspaceSplit(app) {
        ensureWorkspaceDom();
        if (app) {
            const tab = upsertTab(app);
            if (tab) {
                if (!ws.activeId || ws.activeId === tab.id) {
                    ws.activeId = tab.id;
                } else {
                    ws.splitId = tab.id;
                }
            }
        }
        ws.split = true;
        ws.open = true;
        ws.els.root.hidden = false;
        document.body.classList.add('lab-ws-open');
        renderWorkspace();
    }

    function closeWorkspace() {
        if (!ws.els.root) return;
        ws.open = false;
        ws.els.root.hidden = true;
        document.body.classList.remove('lab-ws-open');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 2. Kiosk / Wall-Display Mode
    // ═════════════════════════════════════════════════════════════════════════
    const kiosk = {
        active: false,
        clockTimer: null,
        dataTimer: null,
        els: {},
    };

    function ensureKioskDom() {
        if (kiosk.els.root) return;

        const root = document.createElement('div');
        root.className = 'lab-kiosk';
        root.id = 'lab-kiosk-overlay';
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', 'โหมด Kiosk แสดงผลผนัง');
        root.hidden = true;

        const top = document.createElement('header');
        top.className = 'lab-kiosk__top';

        const clockWrap = document.createElement('div');
        clockWrap.className = 'lab-kiosk__clock-wrap';
        const clock = document.createElement('div');
        clock.className = 'lab-kiosk__clock';
        clock.textContent = '--:--:--';
        const dateEl = document.createElement('div');
        dateEl.className = 'lab-kiosk__date';
        dateEl.textContent = '';
        clockWrap.appendChild(clock);
        clockWrap.appendChild(dateEl);

        const topRight = document.createElement('div');
        topRight.className = 'lab-kiosk__top-right';

        const hostPill = document.createElement('span');
        hostPill.className = 'lab-kiosk__host';
        hostPill.textContent = 'HOMELAB WALL DISPLAY';

        const exitBtn = document.createElement('button');
        exitBtn.type = 'button';
        exitBtn.className = 'lab-kiosk__exit';
        exitBtn.textContent = '✕ ออกจากโหมด Kiosk';
        exitBtn.title = 'ออกจากโหมด Kiosk (Esc)';
        exitBtn.addEventListener('click', exitKiosk);

        topRight.appendChild(hostPill);
        topRight.appendChild(exitBtn);

        top.appendChild(clockWrap);
        top.appendChild(topRight);

        const grid = document.createElement('div');
        grid.className = 'lab-kiosk__grid';

        const mkTile = (id, titleText) => {
            const tile = document.createElement('section');
            tile.className = 'lab-kiosk__tile';
            tile.id = id;
            const h = document.createElement('h2');
            h.className = 'lab-kiosk__tile-title';
            h.textContent = titleText;
            const body = document.createElement('div');
            body.className = 'lab-kiosk__tile-body';
            tile.appendChild(h);
            tile.appendChild(body);
            return { tile, body };
        };

        const weatherTile = mkTile('lab-kiosk-weather', '🌤️ สภาพอากาศ อ.รือเสาะ จ.นราธิวาส');
        const energyTile = mkTile('lab-kiosk-energy', '⚡ พลังงานไฟฟ้าบ้าน (PZEM-01)');
        const prayerTile = mkTile('lab-kiosk-prayer', '🕌 เวลาละหมาดประจำวัน');
        const systemTile = mkTile('lab-kiosk-system', '🖥️ สถานะเซิร์ฟเวอร์ & บริการ');

        grid.appendChild(weatherTile.tile);
        grid.appendChild(energyTile.tile);
        grid.appendChild(prayerTile.tile);
        grid.appendChild(systemTile.tile);

        root.appendChild(top);
        root.appendChild(grid);
        document.body.appendChild(root);

        kiosk.els = {
            root,
            clock,
            dateEl,
            weatherBody: weatherTile.body,
            energyBody: energyTile.body,
            prayerBody: prayerTile.body,
            systemBody: systemTile.body,
        };
    }

    function updateKioskClock() {
        if (!kiosk.active || !kiosk.els.clock) return;
        const now = new Date();
        kiosk.els.clock.textContent = now.toLocaleTimeString('th-TH', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });
        kiosk.els.dateEl.textContent = now.toLocaleDateString('th-TH', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });

        // Also refresh prayer countdown every second from existing overview prayer DOM
        renderKioskPrayer();
    }

    function renderKioskWeather(w) {
        const body = kiosk.els.weatherBody;
        if (!body) return;
        body.textContent = '';

        if (!w || !w.current) {
            const empty = document.createElement('div');
            empty.className = 'lab-kiosk__muted';
            empty.textContent = 'กำลังโหลดสภาพอากาศ อ.รือเสาะ…';
            body.appendChild(empty);
            return;
        }

        const hero = document.createElement('div');
        hero.className = 'lab-kiosk__hero';

        const ico = document.createElement('span');
        ico.className = 'lab-kiosk__big-ico';
        ico.textContent = w.current.emoji || '🌤️';

        const temp = document.createElement('span');
        temp.className = 'lab-kiosk__big-num';
        temp.textContent = w.current.tempC != null ? `${Math.round(w.current.tempC)}°C` : '—';

        hero.appendChild(ico);
        hero.appendChild(temp);

        const cond = document.createElement('div');
        cond.className = 'lab-kiosk__cond';
        cond.textContent = w.current.conditionTh || 'สภาพอากาศทั่วไป';

        const meta = document.createElement('div');
        meta.className = 'lab-kiosk__meta';
        meta.textContent = `รู้สึกเหมือน ${w.current.feelsLikeC != null ? Math.round(w.current.feelsLikeC) : '—'}°C · ความชื้น ${w.current.humidityPct != null ? Math.round(w.current.humidityPct) : '—'}% · ลม ${w.current.windKmh != null ? Math.round(w.current.windKmh) : '—'} กม./ชม.`;

        body.appendChild(hero);
        body.appendChild(cond);
        body.appendChild(meta);

        const daily = Array.isArray(w.daily) ? w.daily.slice(0, 3) : [];
        if (daily.length) {
            const row = document.createElement('div');
            row.className = 'lab-kiosk__forecast';
            daily.forEach((d, idx) => {
                const chip = document.createElement('div');
                chip.className = 'lab-kiosk__fchip';
                const dayLbl = idx === 0 ? 'วันนี้' : (idx === 1 ? 'พรุ่งนี้' : String(d.date || '').slice(5));
                const a = document.createElement('span');
                a.textContent = `${dayLbl} ${d.emoji || ''}`;
                const b = document.createElement('strong');
                b.textContent = `${d.tempMinC != null ? Math.round(d.tempMinC) : '—'}°–${d.tempMaxC != null ? Math.round(d.tempMaxC) : '—'}°`;
                const c = document.createElement('small');
                c.textContent = `ฝน ${d.precipProbPct != null ? Math.round(d.precipProbPct) : 0}%`;
                chip.appendChild(a);
                chip.appendChild(b);
                chip.appendChild(c);
                row.appendChild(chip);
            });
            body.appendChild(row);
        }
    }

    function renderKioskEnergy(ov, badges) {
        const body = kiosk.els.energyBody;
        if (!body) return;
        body.textContent = '';

        const en = (ov && ov.infra && ov.infra.energy) || null;
        const enBadge = badges && badges.energy;
        const watts = (en && en.realtime && en.realtime.power_watts != null)
            ? Math.round(Number(en.realtime.power_watts))
            : (enBadge && enBadge.watts != null ? enBadge.watts : null);

        const hero = document.createElement('div');
        hero.className = 'lab-kiosk__hero';
        const num = document.createElement('span');
        num.className = 'lab-kiosk__big-num';
        num.textContent = watts != null ? `${watts.toLocaleString('en-US')} W` : '— W';
        hero.appendChild(num);
        body.appendChild(hero);

        const stats = document.createElement('div');
        stats.className = 'lab-kiosk__kv-grid';

        const addKv = (label, val) => {
            const box = document.createElement('div');
            box.className = 'lab-kiosk__kv';
            const l = document.createElement('span');
            l.textContent = label;
            const v = document.createElement('strong');
            v.textContent = val;
            box.appendChild(l);
            box.appendChild(v);
            stats.appendChild(box);
        };

        const todayThb = en && en.today && en.today.cost_thb != null
            ? `฿${Number(en.today.cost_thb).toFixed(2)}`
            : (enBadge && enBadge.todayCostThb != null ? `฿${Number(enBadge.todayCostThb).toFixed(2)}` : '—');
        const todayKwh = en && en.today && en.today.energy_kwh != null
            ? `${Number(en.today.energy_kwh).toFixed(2)} kWh`
            : (enBadge && enBadge.todayKwh != null ? `${Number(enBadge.todayKwh).toFixed(2)} kWh` : '—');
        const monthThb = en && en.this_month && en.this_month.cost_thb != null
            ? `฿${Math.round(Number(en.this_month.cost_thb)).toLocaleString('th-TH')}`
            : (enBadge && enBadge.monthCostThb != null ? `฿${Math.round(Number(enBadge.monthCostThb)).toLocaleString('th-TH')}` : '—');
        const volt = en && en.realtime && en.realtime.voltage != null
            ? `${Number(en.realtime.voltage).toFixed(0)} V`
            : '—';

        addKv('ค่าไฟวันนี้', todayThb);
        addKv('หน่วยวันนี้', todayKwh);
        addKv('สะสมเดือนนี้', monthThb);
        addKv('แรงดันไฟฟ้า', volt);

        body.appendChild(stats);
    }

    function renderKioskPrayer() {
        const body = kiosk.els.prayerBody;
        if (!body) return;
        body.textContent = '';

        const nextName = document.getElementById('ov-prayer-next-name')?.textContent || '—';
        const nextTime = document.getElementById('ov-prayer-next-time')?.textContent || '--:--';
        const countdown = document.getElementById('ov-prayer-countdown')?.textContent || '';
        const hijri = document.getElementById('ov-prayer-hijri')?.textContent || '';

        const hero = document.createElement('div');
        hero.className = 'lab-kiosk__hero';
        const t = document.createElement('span');
        t.className = 'lab-kiosk__big-num';
        t.textContent = nextTime;
        hero.appendChild(t);

        const nameEl = document.createElement('div');
        nameEl.className = 'lab-kiosk__cond';
        nameEl.textContent = `${nextName} ${countdown ? `· ${countdown}` : ''}`;

        const meta = document.createElement('div');
        meta.className = 'lab-kiosk__meta';
        meta.textContent = hijri;

        body.appendChild(hero);
        body.appendChild(nameEl);
        body.appendChild(meta);

        const pills = document.querySelectorAll('#ov-prayer-grid .ov2-prayer-pill');
        if (pills.length) {
            const row = document.createElement('div');
            row.className = 'lab-kiosk__prayer-row';
            pills.forEach((p) => {
                const item = document.createElement('div');
                item.className = 'lab-kiosk__prayer-pill' + (p.classList.contains('is-next') ? ' is-next' : '');
                const s = document.createElement('span');
                s.textContent = p.querySelector('span')?.textContent || '';
                const st = document.createElement('strong');
                st.textContent = p.querySelector('strong')?.textContent || '--:--';
                item.appendChild(s);
                item.appendChild(st);
                row.appendChild(item);
            });
            body.appendChild(row);
        }
    }

    function renderKioskSystem(ov, badges) {
        const body = kiosk.els.systemBody;
        if (!body) return;
        body.textContent = '';

        const grid = document.createElement('div');
        grid.className = 'lab-kiosk__kv-grid';

        const addKv = (label, val) => {
            const box = document.createElement('div');
            box.className = 'lab-kiosk__kv';
            const l = document.createElement('span');
            l.textContent = label;
            const v = document.createElement('strong');
            v.textContent = val;
            box.appendChild(l);
            box.appendChild(v);
            grid.appendChild(box);
        };

        const host = ov && ov.host;
        addKv('CPU', host && host.cpu && host.cpu.pct != null ? `${Math.round(host.cpu.pct)}%` : '—');
        addKv('RAM', host && host.mem && host.mem.pct != null ? `${Math.round(host.mem.pct)}%` : '—');
        addKv('อุณหภูมิเครื่อง', host && host.peakTempC != null ? `${Math.round(host.peakTempC)}°C` : '—');
        addKv('Docker', badges && badges.portainer ? badges.portainer.text : '—');
        addKv('Uptime Kuma', badges && badges.kuma ? badges.kuma.text : '—');
        addKv('Agent Hub', badges && badges['agent-hub'] ? badges['agent-hub'].text : '—');

        if (!roleState.isFamily) {
            addKv('OnePercent Bot', badges && badges.onepercentbot ? badges.onepercentbot.text : '—');
            addKv('PM2', badges && badges.pm2 ? badges.pm2.text : '—');
        }

        body.appendChild(grid);
    }

    async function refreshKioskData() {
        if (!kiosk.active) return;

        let weather = window.__labWeatherCache || null;
        if (!weather) {
            try {
                const r = await fetch('/api/weather', { cache: 'no-store' });
                if (r.ok) {
                    weather = await r.json();
                    window.__labWeatherCache = weather;
                }
            } catch (_) {}
        }

        const ov = window.__labOverviewCache || null;
        const badges = (window.LabLauncher && typeof window.LabLauncher.getBadges === 'function')
            ? window.LabLauncher.getBadges()
            : {};

        renderKioskWeather(weather);
        renderKioskEnergy(ov, badges);
        renderKioskPrayer();
        renderKioskSystem(ov, badges);
    }

    function enterKiosk() {
        ensureKioskDom();
        if (ws.open) closeWorkspace();
        kiosk.active = true;
        kiosk.els.root.hidden = false;
        document.body.classList.add('lab-kiosk-active');

        updateKioskClock();
        refreshKioskData();

        clearInterval(kiosk.clockTimer);
        clearInterval(kiosk.dataTimer);
        kiosk.clockTimer = setInterval(updateKioskClock, 1000);
        kiosk.dataTimer = setInterval(refreshKioskData, 10000);

        if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    }

    function exitKiosk() {
        if (!kiosk.els.root) return;
        kiosk.active = false;
        kiosk.els.root.hidden = true;
        document.body.classList.remove('lab-kiosk-active');
        clearInterval(kiosk.clockTimer);
        clearInterval(kiosk.dataTimer);
        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        }
    }

    function toggleKiosk() {
        if (kiosk.active) exitKiosk();
        else enterKiosk();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 3. Opt-in Family / Guest Role Detection
    // ═════════════════════════════════════════════════════════════════════════
    const roleState = {
        role: 'admin',
        isFamily: false,
    };

    function applyRoleUi(role) {
        roleState.role = role === 'family' ? 'family' : 'admin';
        roleState.isFamily = roleState.role === 'family';
        document.body.classList.toggle('lab-role-family', roleState.isFamily);

        if (roleState.isFamily) {
            const actions = document.querySelector('.topbar__actions');
            if (actions && !document.getElementById('lab-family-pill')) {
                const pill = document.createElement('span');
                pill.id = 'lab-family-pill';
                pill.className = 'lab-family-pill';
                pill.textContent = '👨‍👩‍👧‍👦 โหมดครอบครัว';
                pill.title = 'สิทธิ์แบบอ่านอย่างเดียว (Family / Guest Role)';
                actions.prepend(pill);
            }
        }

        window.dispatchEvent(new CustomEvent('lab:role-ready', {
            detail: { role: roleState.role, isFamily: roleState.isFamily },
        }));
    }

    async function detectSessionRole() {
        try {
            const res = await fetch('/api/session', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                applyRoleUi(data && data.role === 'family' ? 'family' : 'admin');
                return;
            }
        } catch (_) {}
        applyRoleUi('admin');
    }

    // ── Global Shortcuts & Boot ──────────────────────────────────────────────
    function bindGlobalKeys() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (kiosk.active) {
                    e.preventDefault();
                    exitKiosk();
                } else if (ws.open) {
                    e.preventDefault();
                    closeWorkspace();
                }
                return;
            }
            if (isTypingTarget(document.activeElement)) return;
            if (e.altKey && !e.ctrlKey && !e.metaKey) {
                const k = String(e.key || '').toLowerCase();
                if (k === 'w') {
                    e.preventDefault();
                    if (ws.open) closeWorkspace();
                    else openWorkspace();
                } else if (k === 'k') {
                    e.preventDefault();
                    toggleKiosk();
                }
            }
        });

        window.addEventListener('lab:launcher-updated', () => {
            if (ws.open) refreshWorkspacePicker();
            if (kiosk.active) refreshKioskData();
        });
    }

    function init() {
        bindGlobalKeys();
        detectSessionRole();
        try {
            const params = new URLSearchParams(window.location.search);
            if (params.get('kiosk') === '1') {
                setTimeout(enterKiosk, 350);
            }
        } catch (_) {}
    }

    window.LabWorkspace = {
        open: openWorkspace,
        openSplit: openWorkspaceSplit,
        close: closeWorkspace,
        isOpen: () => ws.open,
    };

    window.LabKiosk = {
        enter: enterKiosk,
        exit: exitKiosk,
        toggle: toggleKiosk,
        isActive: () => kiosk.active,
    };

    window.LabRole = {
        getRole: () => roleState.role,
        isFamily: () => roleState.isFamily,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

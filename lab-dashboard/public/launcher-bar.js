/* ============================================================================
   Homelab Launcher Bar + Command Palette + Shortcut Editor (Vanilla IIFE)
   XSS-safe: builds all dynamic nodes with document.createElement + textContent
   ========================================================================== */
(function () {
    'use strict';

    const STORAGE_PINNED = 'lab_launcher_pinned_v1';
    const STORAGE_RECENT = 'lab_launcher_recent_v1';
    const DEFAULT_PINNED = ['agent-hub', 'video-studio', 'chat', 'energy', 'terminal'];
    const MAX_PINNED = 12;
    const MAX_RECENT = 6;

    const EXTRA_APPS = [
        { id: 'chat', label: 'AI Chat (แชท)', icon: 'auto', url: '/gemini' },
        { id: 'energy', label: 'Energy (ค่าไฟ)', icon: 'activity', url: '#energy' },
        { id: 'cron', label: 'Cron อัตโนมัติ', icon: 'activity', url: '/cron' },
        { id: 'quota', label: 'AI Quota', icon: 'activity', url: '/quota' },
    ];

    const FALLBACK_CORE_APPS = [
        { id: 'agent-hub', label: 'Homelab Agent Hub (ศูนย์ควบคุม PC)', icon: 'server', url: '/agent-hub' },
        { id: 'video-studio', label: 'Video Studio (สร้างวิดีโอ AI)', icon: 'auto', url: '/video-studio' },
        { id: 'terminal', label: 'Web Terminal (Cockpit)', icon: 'terminal', url: '/terminal' },
        { id: 'bg-remove', label: 'BG Studio (ลบพื้นหลัง)', icon: 'auto', url: '/bg-remove' },
        { id: 'ports', label: 'Port & Firewall Manager', icon: 'shield', url: '#sec-ports' },
    ];

    const INTERNAL_VIEWS = [
        { id: 'view-overview', label: 'Overview (หน้าหลัก)', url: '#overview', isView: true, view: 'overview' },
        { id: 'view-energy', label: 'Energy (พลังงาน / ค่าไฟ)', url: '#energy', isView: true, view: 'energy' },
        { id: 'view-services', label: 'Services (บริการ / Docker / PM2)', url: '#services', isView: true, view: 'services' },
        { id: 'view-ports', label: 'Ports & Firewall (พอร์ต / VPN)', url: '#ports', isView: true, view: 'ports' },
        { id: 'view-terminal', label: 'Terminal (เทอร์มินัล)', url: '#terminal', isView: true, view: 'terminal' },
        { id: 'view-settings', label: 'Settings (ตั้งค่าระบบ)', url: '#settings', isView: true, view: 'settings' },
    ];

    const EMOJI_MAP = {
        'agent-hub': '🛰️',
        'video-studio': '🎬',
        'chat': '💬',
        'energy': '⚡',
        'terminal': '💻',
        'bg-remove': '✂️',
        'homeassistant': '🏠',
        'ports': '🛡️',
        'cron': '⏰',
        'quota': '📊',
        'wireguard': '🔐',
        'emqx': '📡',
        'cockpit': '🖥️',
        'portainer': '🐳',
        'mongo': '🍃',
        'kuma': '📈',
        'pm2': '⚙️',
        'filebrowser': '📁',
        'samba': '💾',
        'zigbee2mqtt': '💡',
        'onepercentbot': '💹',
        'ddpm': '🛰️',
        'view-overview': '🌌',
        'view-energy': '⚡',
        'view-services': '📦',
        'view-ports': '🛡️',
        'view-terminal': '💻',
        'view-settings': '🛠️',
    };

    const state = {
        apps: [],
        pinned: DEFAULT_PINNED.slice(),
        recent: [],
        paletteOpen: false,
        paletteItems: [],
        paletteSelected: 0,
        editorOpen: false,
        editorDraft: [],
        editorFilter: '',
    };

    let els = {};
    let toastTimer = null;

    function getEmoji(id) {
        return EMOJI_MAP[id] || '🔗';
    }

    function shortLabel(label) {
        const s = String(label || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        return s || String(label || '');
    }

    function readJsonStorage(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function writeJsonStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (_) { /* ignore storage quota errors */ }
    }

    function mergeApps(baseList) {
        const map = new Map();
        const add = (item) => {
            if (!item || !item.id || !item.url) return;
            const id = String(item.id);
            if (!map.has(id)) {
                map.set(id, {
                    id,
                    label: String(item.label || id),
                    icon: String(item.icon || 'link'),
                    url: String(item.url),
                });
            }
        };
        (Array.isArray(baseList) ? baseList : []).forEach(add);
        EXTRA_APPS.forEach(add);
        if (map.size <= EXTRA_APPS.length) {
            FALLBACK_CORE_APPS.forEach(add);
        }
        return Array.from(map.values());
    }

    function findAppById(id) {
        return state.apps.find((a) => a.id === id) || INTERNAL_VIEWS.find((v) => v.id === id) || null;
    }

    function sanitizePinned(list) {
        const validIds = new Set(state.apps.map((a) => a.id));
        const seen = new Set();
        const out = [];
        for (const raw of (Array.isArray(list) ? list : [])) {
            const id = String(raw || '');
            if (!id || seen.has(id) || !validIds.has(id)) continue;
            seen.add(id);
            out.push(id);
            if (out.length >= MAX_PINNED) break;
        }
        return out.length ? out : DEFAULT_PINNED.filter((id) => validIds.has(id));
    }

    function showToast(msg) {
        if (!els.toast) {
            const t = document.createElement('div');
            t.className = 'lab-launcher-toast';
            t.setAttribute('role', 'status');
            t.setAttribute('aria-live', 'polite');
            document.body.appendChild(t);
            els.toast = t;
        }
        els.toast.textContent = String(msg || '');
        els.toast.classList.add('is-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            if (els.toast) els.toast.classList.remove('is-show');
        }, 2600);
    }

    function switchView(viewName) {
        const btn = document.querySelector(`.sidebar__item[data-view="${viewName}"]`)
            || document.querySelector(`.mobile-nav-btn[data-view="${viewName}"]`);
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    }

    function recordRecent(id) {
        const clean = String(id || '');
        if (!clean) return;
        state.recent = [clean].concat(state.recent.filter((x) => x !== clean)).slice(0, MAX_RECENT);
        writeJsonStorage(STORAGE_RECENT, state.recent);
    }

    function openApp(app) {
        if (!app) return;
        recordRecent(app.id);

        if (app.view) {
            switchView(app.view);
            return;
        }

        const url = String(app.url || '');
        if (url === '#energy') {
            switchView('energy');
        } else if (url === '#sec-ports' || url === '#ports' || url === '#vpn') {
            switchView('ports');
        } else if (url === '#services') {
            switchView('services');
        } else if (url === '#overview') {
            switchView('overview');
        } else if (url === '#settings') {
            switchView('settings');
        } else if (url === '#terminal' || url === '#sec-terminal' || url === '/terminal') {
            if (!switchView('terminal')) {
                window.location.href = '/terminal';
            }
        } else if (url.startsWith('/')) {
            window.location.href = url;
        } else if (url.startsWith('\\\\')) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(
                    () => showToast(`คัดลอกพาธแล้ว: ${url}`),
                    () => showToast(`SMB: ${url}`)
                );
            } else {
                showToast(`SMB: ${url}`);
            }
        } else if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }

    // ── Fuzzy search (case-insensitive subsequence + relevance scoring) ─────
    function fuzzyScore(query, item) {
        const q = String(query || '').toLowerCase().trim();
        if (!q) return 1;
        const label = String(item.label || '').toLowerCase();
        const id = String(item.id || '').toLowerCase();
        const url = String(item.url || '').toLowerCase();
        const hay = `${label} ${id} ${url}`;

        if (label === q || id === q) return 1000;
        if (label.startsWith(q) || id.startsWith(q)) return 600;
        const idx = hay.indexOf(q);
        if (idx !== -1) return 350 - Math.min(idx, 200);

        let qi = 0;
        let streak = 0;
        let score = 0;
        for (let i = 0; i < hay.length && qi < q.length; i++) {
            if (hay[i] === q[qi]) {
                qi++;
                streak++;
                score += 10 + streak * 4;
            } else {
                streak = 0;
            }
        }
        return qi === q.length ? score : 0;
    }

    // ── Render Top Launcher Bar ──────────────────────────────────────────────
    function renderBar() {
        const host = document.getElementById('lab-launcher');
        if (!host) return;

        host.textContent = '';

        const pinsWrap = document.createElement('div');
        pinsWrap.className = 'lab-launcher__pins';
        pinsWrap.setAttribute('role', 'list');

        state.pinned.forEach((id, idx) => {
            const app = findAppById(id);
            if (!app) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lab-launcher__pin';
            btn.setAttribute('role', 'listitem');
            btn.title = idx < 9 ? `${app.label} (กด ${idx + 1})` : app.label;

            const ico = document.createElement('span');
            ico.className = 'lab-launcher__ico';
            ico.setAttribute('aria-hidden', 'true');
            ico.textContent = getEmoji(app.id);

            const lbl = document.createElement('span');
            lbl.className = 'lab-launcher__lbl';
            lbl.textContent = shortLabel(app.label);

            btn.appendChild(ico);
            btn.appendChild(lbl);

            if (idx < 9) {
                const kbd = document.createElement('kbd');
                kbd.className = 'lab-launcher__kbd';
                kbd.textContent = String(idx + 1);
                btn.appendChild(kbd);
            }

            btn.addEventListener('click', () => openApp(app));
            pinsWrap.appendChild(btn);
        });

        const actions = document.createElement('div');
        actions.className = 'lab-launcher__actions';

        const searchBtn = document.createElement('button');
        searchBtn.type = 'button';
        searchBtn.className = 'lab-launcher__search-btn';
        searchBtn.setAttribute('aria-label', 'ค้นหาแอปทั้งหมด');
        searchBtn.title = 'ค้นหาแอปทั้งหมด (Ctrl+K หรือ /)';

        const sIco = document.createElement('span');
        sIco.setAttribute('aria-hidden', 'true');
        sIco.textContent = '🔎';

        const sLbl = document.createElement('span');
        sLbl.className = 'lab-launcher__search-lbl';
        sLbl.textContent = 'ค้นหาแอป...';

        const sKbd = document.createElement('kbd');
        sKbd.className = 'lab-launcher__kbd lab-launcher__search-kbd';
        sKbd.textContent = '⌘K';

        searchBtn.appendChild(sIco);
        searchBtn.appendChild(sLbl);
        searchBtn.appendChild(sKbd);
        searchBtn.addEventListener('click', openPalette);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'lab-launcher__edit-btn';
        editBtn.setAttribute('aria-label', 'แก้ไขปุ่มลัด');
        editBtn.title = 'แก้ไขปุ่มลัด (สูงสุด 12 แอป)';
        editBtn.textContent = '⚙️';
        editBtn.addEventListener('click', openEditor);

        actions.appendChild(searchBtn);
        actions.appendChild(editBtn);

        host.appendChild(pinsWrap);
        host.appendChild(actions);
    }

    // ── Command Palette Modal ────────────────────────────────────────────────
    function ensurePaletteDom() {
        if (els.paletteBackdrop) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'lab-modal-backdrop';
        backdrop.id = 'lab-palette-backdrop';
        backdrop.hidden = true;

        const dialog = document.createElement('div');
        dialog.className = 'lab-palette';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', 'Command Palette ค้นหาแอป');

        const handle = document.createElement('div');
        handle.className = 'lab-palette__handle';
        handle.setAttribute('aria-hidden', 'true');

        const head = document.createElement('div');
        head.className = 'lab-palette__head';

        const sIco = document.createElement('span');
        sIco.className = 'lab-palette__search-ico';
        sIco.setAttribute('aria-hidden', 'true');
        sIco.textContent = '🔎';

        const input = document.createElement('input');
        input.type = 'search';
        input.className = 'lab-palette__input';
        input.placeholder = 'พิมพ์ชื่อแอป หรือมุมมอง (ไทย / English)...';
        input.autocomplete = 'off';
        input.spellcheck = false;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'lab-palette__close';
        closeBtn.textContent = 'Esc';
        closeBtn.setAttribute('aria-label', 'ปิดหน้าต่างค้นหา');
        closeBtn.addEventListener('click', closePalette);

        head.appendChild(sIco);
        head.appendChild(input);
        head.appendChild(closeBtn);

        const list = document.createElement('div');
        list.className = 'lab-palette__list';
        list.setAttribute('role', 'listbox');

        const foot = document.createElement('div');
        foot.className = 'lab-palette__foot';

        const fLeft = document.createElement('span');
        fLeft.textContent = '↑↓ เลือก · Enter เปิด · Esc ปิด';
        const fRight = document.createElement('span');
        fRight.textContent = 'กด 1–9 เปิดปุ่มลัดทันที';
        foot.appendChild(fLeft);
        foot.appendChild(fRight);

        dialog.appendChild(handle);
        dialog.appendChild(head);
        dialog.appendChild(list);
        dialog.appendChild(foot);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closePalette();
        });

        input.addEventListener('input', () => {
            state.paletteSelected = 0;
            renderPaletteList(input.value);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (state.paletteItems.length) {
                    state.paletteSelected = (state.paletteSelected + 1) % state.paletteItems.length;
                    updatePaletteSelection();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (state.paletteItems.length) {
                    state.paletteSelected = (state.paletteSelected - 1 + state.paletteItems.length) % state.paletteItems.length;
                    updatePaletteSelection();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const picked = state.paletteItems[state.paletteSelected];
                if (picked) {
                    closePalette();
                    openApp(picked);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closePalette();
            }
        });

        els.paletteBackdrop = backdrop;
        els.paletteInput = input;
        els.paletteList = list;
    }

    function updatePaletteSelection() {
        if (!els.paletteList) return;
        const buttons = els.paletteList.querySelectorAll('.lab-palette__item');
        buttons.forEach((btn, idx) => {
            const active = idx === state.paletteSelected;
            btn.classList.toggle('is-selected', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
            if (active && typeof btn.scrollIntoView === 'function') {
                btn.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function renderPaletteList(query) {
        if (!els.paletteList) return;
        const q = String(query || '').trim();
        els.paletteList.textContent = '';
        state.paletteItems = [];

        const appendGroup = (title, items, tagText) => {
            if (!items.length) return;
            const grp = document.createElement('div');
            grp.className = 'lab-palette__group';
            grp.textContent = title;
            els.paletteList.appendChild(grp);

            items.forEach((item) => {
                const idx = state.paletteItems.length;
                state.paletteItems.push(item);

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'lab-palette__item' + (idx === state.paletteSelected ? ' is-selected' : '');
                btn.setAttribute('role', 'option');
                btn.setAttribute('aria-selected', idx === state.paletteSelected ? 'true' : 'false');

                const ico = document.createElement('span');
                ico.className = 'lab-palette__item-ico';
                ico.setAttribute('aria-hidden', 'true');
                ico.textContent = getEmoji(item.id);

                const main = document.createElement('span');
                main.className = 'lab-palette__item-main';

                const lbl = document.createElement('span');
                lbl.className = 'lab-palette__item-lbl';
                lbl.textContent = item.label;

                const sub = document.createElement('span');
                sub.className = 'lab-palette__item-sub';
                sub.textContent = item.url;

                main.appendChild(lbl);
                main.appendChild(sub);
                btn.appendChild(ico);
                btn.appendChild(main);

                if (tagText) {
                    const tag = document.createElement('span');
                    tag.className = 'lab-palette__item-tag';
                    tag.textContent = tagText;
                    btn.appendChild(tag);
                }

                btn.addEventListener('mouseenter', () => {
                    state.paletteSelected = idx;
                    updatePaletteSelection();
                });

                btn.addEventListener('click', () => {
                    closePalette();
                    openApp(item);
                });

                els.paletteList.appendChild(btn);
            });
        };

        if (!q) {
            const recentApps = state.recent
                .map((id) => findAppById(id))
                .filter(Boolean);
            const recentIds = new Set(recentApps.map((a) => a.id));
            appendGroup('ล่าสุด', recentApps, 'ล่าสุด');
            appendGroup('แอปทั้งหมด', state.apps.filter((a) => !recentIds.has(a.id)), '');
            appendGroup('มุมมองภายใน', INTERNAL_VIEWS.filter((v) => !recentIds.has(v.id)), 'มุมมอง');
        } else {
            const combined = state.apps.concat(INTERNAL_VIEWS);
            const seen = new Set();
            const matched = [];
            for (const item of combined) {
                if (seen.has(item.id)) continue;
                seen.add(item.id);
                const sc = fuzzyScore(q, item);
                if (sc > 0) matched.push({ item, sc });
            }
            matched.sort((a, b) => b.sc - a.sc);
            appendGroup(`ผลการค้นหา (${matched.length})`, matched.map((m) => m.item), '');
        }

        if (!state.paletteItems.length) {
            const empty = document.createElement('div');
            empty.className = 'lab-palette__empty';
            empty.textContent = `ไม่พบแอปที่ตรงกับ "${q}"`;
            els.paletteList.appendChild(empty);
        } else if (state.paletteSelected >= state.paletteItems.length) {
            state.paletteSelected = 0;
            updatePaletteSelection();
        }
    }

    function openPalette() {
        if (state.editorOpen) closeEditor();
        ensurePaletteDom();
        state.paletteOpen = true;
        state.paletteSelected = 0;
        els.paletteInput.value = '';
        renderPaletteList('');
        els.paletteBackdrop.hidden = false;
        requestAnimationFrame(() => {
            els.paletteInput.focus();
        });
    }

    function closePalette() {
        if (!els.paletteBackdrop) return;
        state.paletteOpen = false;
        els.paletteBackdrop.hidden = true;
    }

    // ── Shortcut Editor Modal (⚙️) ───────────────────────────────────────────
    function ensureEditorDom() {
        if (els.editorBackdrop) return;

        const backdrop = document.createElement('div');
        backdrop.className = 'lab-modal-backdrop';
        backdrop.id = 'lab-editor-backdrop';
        backdrop.hidden = true;

        const dialog = document.createElement('div');
        dialog.className = 'lab-editor';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', 'แก้ไขปุ่มลัด Launcher');

        const head = document.createElement('div');
        head.className = 'lab-editor__head';

        const titleWrap = document.createElement('div');
        const h3 = document.createElement('h3');
        h3.className = 'lab-editor__title';
        h3.textContent = '⚙️ แก้ไขปุ่มลัดแอป (Launcher Bar)';
        const sub = document.createElement('p');
        sub.className = 'lab-editor__sub';
        sub.textContent = 'เลือกปักหมุดได้สูงสุด 12 แอป · ลากวางหรือกด ↑ ↓ เพื่อจัดลำดับ';
        titleWrap.appendChild(h3);
        titleWrap.appendChild(sub);

        const xBtn = document.createElement('button');
        xBtn.type = 'button';
        xBtn.className = 'lab-palette__close';
        xBtn.textContent = '✕';
        xBtn.setAttribute('aria-label', 'ปิดหน้าต่าง');
        xBtn.addEventListener('click', closeEditor);

        head.appendChild(titleWrap);
        head.appendChild(xBtn);

        const body = document.createElement('div');
        body.className = 'lab-editor__body';

        // Left column: pinned
        const leftCol = document.createElement('div');
        leftCol.className = 'lab-editor__col';
        const leftHead = document.createElement('div');
        leftHead.className = 'lab-editor__col-head';
        const leftTitle = document.createElement('span');
        leftTitle.textContent = 'ปักหมุดอยู่';
        const leftCount = document.createElement('span');
        leftHead.appendChild(leftTitle);
        leftHead.appendChild(leftCount);

        const pinnedList = document.createElement('div');
        pinnedList.className = 'lab-editor__list';
        leftCol.appendChild(leftHead);
        leftCol.appendChild(pinnedList);

        // Right column: all apps
        const rightCol = document.createElement('div');
        rightCol.className = 'lab-editor__col';
        const rightHead = document.createElement('div');
        rightHead.className = 'lab-editor__col-head';
        const rightTitle = document.createElement('span');
        rightTitle.textContent = 'แอปทั้งหมด';
        rightHead.appendChild(rightTitle);

        const filterInput = document.createElement('input');
        filterInput.type = 'search';
        filterInput.className = 'lab-editor__filter';
        filterInput.placeholder = 'กรองรายชื่อแอป...';
        filterInput.addEventListener('input', () => {
            state.editorFilter = filterInput.value;
            renderEditorLists();
        });

        const allList = document.createElement('div');
        allList.className = 'lab-editor__list';
        rightCol.appendChild(rightHead);
        rightCol.appendChild(filterInput);
        rightCol.appendChild(allList);

        body.appendChild(leftCol);
        body.appendChild(rightCol);

        // Footer
        const foot = document.createElement('div');
        foot.className = 'lab-editor__foot';

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'lab-editor__btn';
        resetBtn.textContent = 'คืนค่าเริ่มต้น';
        resetBtn.addEventListener('click', () => {
            state.editorDraft = sanitizePinned(DEFAULT_PINNED);
            renderEditorLists();
        });

        const rightBtns = document.createElement('div');
        rightBtns.className = 'lab-editor__foot-right';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'lab-editor__btn';
        cancelBtn.textContent = 'ยกเลิก';
        cancelBtn.addEventListener('click', closeEditor);

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'lab-editor__btn lab-editor__btn--primary';
        saveBtn.textContent = 'บันทึก';
        saveBtn.addEventListener('click', saveEditor);

        rightBtns.appendChild(cancelBtn);
        rightBtns.appendChild(saveBtn);
        foot.appendChild(resetBtn);
        foot.appendChild(rightBtns);

        dialog.appendChild(head);
        dialog.appendChild(body);
        dialog.appendChild(foot);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeEditor();
        });

        els.editorBackdrop = backdrop;
        els.editorCount = leftCount;
        els.editorPinnedList = pinnedList;
        els.editorAllList = allList;
        els.editorFilter = filterInput;
    }

    let dragFromIdx = -1;

    function renderEditorLists() {
        if (!els.editorPinnedList || !els.editorAllList) return;

        els.editorCount.textContent = `${state.editorDraft.length}/${MAX_PINNED}`;
        els.editorPinnedList.textContent = '';

        if (!state.editorDraft.length) {
            const empty = document.createElement('div');
            empty.className = 'lab-palette__empty';
            empty.textContent = 'ยังไม่มีปุ่มลัด กด + จากด้านขวาเพื่อเพิ่ม';
            els.editorPinnedList.appendChild(empty);
        }

        state.editorDraft.forEach((id, idx) => {
            const app = findAppById(id);
            if (!app) return;

            const row = document.createElement('div');
            row.className = 'lab-editor__row';
            row.draggable = true;
            row.dataset.idx = String(idx);

            row.addEventListener('dragstart', (e) => {
                dragFromIdx = idx;
                row.classList.add('is-dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(idx));
                }
            });
            row.addEventListener('dragend', () => {
                dragFromIdx = -1;
                row.classList.remove('is-dragging');
                els.editorPinnedList.querySelectorAll('.is-drag-over').forEach((n) => n.classList.remove('is-drag-over'));
            });
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (dragFromIdx !== -1 && dragFromIdx !== idx) {
                    row.classList.add('is-drag-over');
                }
            });
            row.addEventListener('dragleave', () => {
                row.classList.remove('is-drag-over');
            });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('is-drag-over');
                if (dragFromIdx === -1 || dragFromIdx === idx) return;
                const moved = state.editorDraft.splice(dragFromIdx, 1)[0];
                state.editorDraft.splice(idx, 0, moved);
                dragFromIdx = -1;
                renderEditorLists();
            });

            const ico = document.createElement('span');
            ico.className = 'lab-editor__row-ico';
            ico.setAttribute('aria-hidden', 'true');
            ico.textContent = getEmoji(app.id);

            const lbl = document.createElement('span');
            lbl.className = 'lab-editor__row-lbl';
            lbl.textContent = app.label;

            const btns = document.createElement('div');
            btns.className = 'lab-editor__row-btns';

            const upBtn = document.createElement('button');
            upBtn.type = 'button';
            upBtn.className = 'lab-editor__mini-btn';
            upBtn.textContent = '↑';
            upBtn.title = 'เลื่อนขึ้น';
            upBtn.disabled = idx === 0;
            upBtn.addEventListener('click', () => {
                if (idx <= 0) return;
                const tmp = state.editorDraft[idx - 1];
                state.editorDraft[idx - 1] = state.editorDraft[idx];
                state.editorDraft[idx] = tmp;
                renderEditorLists();
            });

            const dnBtn = document.createElement('button');
            dnBtn.type = 'button';
            dnBtn.className = 'lab-editor__mini-btn';
            dnBtn.textContent = '↓';
            dnBtn.title = 'เลื่อนลง';
            dnBtn.disabled = idx === state.editorDraft.length - 1;
            dnBtn.addEventListener('click', () => {
                if (idx >= state.editorDraft.length - 1) return;
                const tmp = state.editorDraft[idx + 1];
                state.editorDraft[idx + 1] = state.editorDraft[idx];
                state.editorDraft[idx] = tmp;
                renderEditorLists();
            });

            const rmBtn = document.createElement('button');
            rmBtn.type = 'button';
            rmBtn.className = 'lab-editor__mini-btn lab-editor__mini-btn--danger';
            rmBtn.textContent = '✕';
            rmBtn.title = 'นำออก';
            rmBtn.addEventListener('click', () => {
                state.editorDraft.splice(idx, 1);
                renderEditorLists();
            });

            btns.appendChild(upBtn);
            btns.appendChild(dnBtn);
            btns.appendChild(rmBtn);

            row.appendChild(ico);
            row.appendChild(lbl);
            row.appendChild(btns);
            els.editorPinnedList.appendChild(row);
        });

        // Right column: all apps
        els.editorAllList.textContent = '';
        const pinnedSet = new Set(state.editorDraft);
        const q = String(state.editorFilter || '').trim();
        const filtered = q
            ? state.apps.filter((a) => fuzzyScore(q, a) > 0)
            : state.apps;

        filtered.forEach((app) => {
            const row = document.createElement('div');
            row.className = 'lab-editor__row';

            const ico = document.createElement('span');
            ico.className = 'lab-editor__row-ico';
            ico.setAttribute('aria-hidden', 'true');
            ico.textContent = getEmoji(app.id);

            const lbl = document.createElement('span');
            lbl.className = 'lab-editor__row-lbl';
            lbl.textContent = app.label;

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'lab-editor__mini-btn lab-editor__mini-btn--add';
            const already = pinnedSet.has(app.id);
            const full = state.editorDraft.length >= MAX_PINNED;
            addBtn.textContent = already ? '✓' : '+';
            addBtn.disabled = already || full;
            addBtn.title = already ? 'ปักหมุดแล้ว' : (full ? 'ครบ 12 แอปแล้ว' : 'เพิ่มลงปุ่มลัด');
            addBtn.addEventListener('click', () => {
                if (pinnedSet.has(app.id) || state.editorDraft.length >= MAX_PINNED) return;
                state.editorDraft.push(app.id);
                renderEditorLists();
            });

            row.appendChild(ico);
            row.appendChild(lbl);
            row.appendChild(addBtn);
            els.editorAllList.appendChild(row);
        });
    }

    function openEditor() {
        if (state.paletteOpen) closePalette();
        ensureEditorDom();
        state.editorOpen = true;
        state.editorDraft = state.pinned.slice();
        state.editorFilter = '';
        els.editorFilter.value = '';
        renderEditorLists();
        els.editorBackdrop.hidden = false;
    }

    function closeEditor() {
        if (!els.editorBackdrop) return;
        state.editorOpen = false;
        els.editorBackdrop.hidden = true;
    }

    async function saveEditor() {
        const nextPinned = sanitizePinned(state.editorDraft);
        state.pinned = nextPinned;
        writeJsonStorage(STORAGE_PINNED, nextPinned);
        renderBar();
        closeEditor();

        try {
            const res = await fetch('/api/launcher', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pinned: nextPinned }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            showToast('บันทึกปุ่มลัดเรียบร้อย');
        } catch (_) {
            showToast('บันทึกในเครื่องนี้');
        }
    }

    // ── Global Keyboard & Trigger Listeners ──────────────────────────────────
    function isTypingTarget(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    function bindGlobalEvents() {
        document.addEventListener('click', (e) => {
            const trigger = e.target && e.target.closest ? e.target.closest('[data-launcher-open]') : null;
            if (trigger) {
                e.preventDefault();
                openPalette();
            }
        });

        document.addEventListener('keydown', (e) => {
            const key = e.key || '';

            // Ctrl/Cmd + K toggles Command Palette
            if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'k') {
                e.preventDefault();
                if (state.paletteOpen) closePalette();
                else openPalette();
                return;
            }

            if (key === 'Escape') {
                if (state.paletteOpen) {
                    e.preventDefault();
                    closePalette();
                } else if (state.editorOpen) {
                    e.preventDefault();
                    closeEditor();
                }
                return;
            }

            if (state.paletteOpen || state.editorOpen) return;
            if (isTypingTarget(document.activeElement)) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            if (key === '/') {
                e.preventDefault();
                openPalette();
                return;
            }

            if (key >= '1' && key <= '9') {
                const idx = Number(key) - 1;
                const id = state.pinned[idx];
                const app = id ? findAppById(id) : null;
                if (app) {
                    e.preventDefault();
                    openApp(app);
                }
            }
        });
    }

    // ── Initial Load with Server + localStorage Fallback ─────────────────────
    async function loadLauncher() {
        state.recent = readJsonStorage(STORAGE_RECENT, []).slice(0, MAX_RECENT);

        try {
            const res = await fetch('/api/launcher', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data || !Array.isArray(data.apps)) throw new Error('Invalid payload');
            state.apps = mergeApps(data.apps);
            state.pinned = sanitizePinned(data.pinned);
            writeJsonStorage(STORAGE_PINNED, state.pinned);
            renderBar();
            return;
        } catch (_) {
            // Fallback before server restart or when offline
        }

        let summaryLinks = [];
        try {
            const r2 = await fetch('/api/summary', { cache: 'no-store' });
            if (r2.ok) {
                const s = await r2.json();
                if (s && Array.isArray(s.links)) summaryLinks = s.links;
            }
        } catch (_) { /* fallback to built-in list */ }

        state.apps = mergeApps(summaryLinks);
        const savedPinned = readJsonStorage(STORAGE_PINNED, DEFAULT_PINNED);
        state.pinned = sanitizePinned(savedPinned);
        renderBar();
    }

    function init() {
        bindGlobalEvents();
        loadLauncher();
    }

    window.LabLauncher = {
        openPalette,
        closePalette,
        openEditor,
        closeEditor,
        openApp,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

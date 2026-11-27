/* ============================================================================
   Homelab Launcher Bar + Command Palette + Shortcut & Bookmarks Editor (IIFE)
   Features: Live API Badges, Docker Auto-Discovery (🐳 Auto), Custom Bookmarks
   CRUD, Workspace / Split-View launch hooks, Family Role awareness.
   XSS-safe: builds all dynamic nodes with document.createElement + textContent
   ========================================================================== */
(function () {
    'use strict';

    const STORAGE_PINNED = 'lab_launcher_pinned_v1';
    const STORAGE_RECENT = 'lab_launcher_recent_v1';
    const STORAGE_LOCAL_BM = 'lab_custom_bookmarks_v1';
    const DEFAULT_PINNED = ['agent-hub', 'video-studio', 'chat', 'energy', 'terminal'];
    const MAX_PINNED = 12;
    const MAX_RECENT = 6;
    const BADGE_POLL_MS = 15000;

    const EXTRA_APPS = [
        { id: 'chat', label: 'AI Chat (แชท)', icon: 'auto', emoji: '💬', url: '/gemini', group: 'AI & Media', embed: true, family: false },
        { id: 'energy', label: 'Energy (ค่าไฟ)', icon: 'activity', emoji: '⚡', url: '#energy', group: 'Smart Home', embed: false, family: true },
        { id: 'cron', label: 'Cron อัตโนมัติ', icon: 'activity', emoji: '⏰', url: '/cron', group: 'System', embed: true, family: false },
        { id: 'quota', label: 'AI Quota', icon: 'activity', emoji: '📊', url: '/quota', group: 'AI & Media', embed: true, family: false },
    ];

    const FALLBACK_CORE_APPS = [
        { id: 'agent-hub', label: 'Homelab Agent Hub (ศูนย์ควบคุม PC)', icon: 'server', emoji: '🛰️', url: '/agent-hub', group: 'Homelab', embed: true, family: false },
        { id: 'video-studio', label: 'Video Studio (สร้างวิดีโอ AI)', icon: 'auto', emoji: '🎬', url: '/video-studio', group: 'AI & Media', embed: true, family: true },
        { id: 'terminal', label: 'Web Terminal (Cockpit)', icon: 'terminal', emoji: '💻', url: '/terminal', group: 'System', embed: true, family: false },
        { id: 'bg-remove', label: 'BG Studio (ลบพื้นหลัง)', icon: 'auto', emoji: '✂️', url: '/bg-remove', group: 'AI & Media', embed: true, family: false },
        { id: '3d-vault', label: '3D Vault (คลังโมเดล 3D)', icon: 'box', emoji: '🧊', url: '/3d-vault', group: 'AI & Media', embed: true, family: false },
        { id: 'ports', label: 'Port & Firewall Manager', icon: 'shield', emoji: '🛡️', url: '#sec-ports', group: 'System', embed: false, family: false },
    ];

    const INTERNAL_VIEWS = [
        { id: 'view-overview', label: 'Overview (หน้าหลัก)', emoji: '🌌', url: '#overview', isView: true, view: 'overview', family: true },
        { id: 'view-energy', label: 'Energy (พลังงาน / ค่าไฟ)', emoji: '⚡', url: '#energy', isView: true, view: 'energy', family: true },
        { id: 'view-services', label: 'Services (บริการ / Docker / PM2)', emoji: '📦', url: '#services', isView: true, view: 'services', family: false },
        { id: 'view-ports', label: 'Ports & Firewall (พอร์ต / VPN)', emoji: '🛡️', url: '#ports', isView: true, view: 'ports', family: false },
        { id: 'view-terminal', label: 'Terminal (เทอร์มินัล)', emoji: '💻', url: '#terminal', isView: true, view: 'terminal', family: false },
        { id: 'view-settings', label: 'Settings (ตั้งค่าระบบ)', emoji: '🛠️', url: '#settings', isView: true, view: 'settings', family: false },
    ];

    const EMOJI_MAP = {
        'agent-hub': '🛰️',
        'video-studio': '🎬',
        'chat': '💬',
        'energy': '⚡',
        'terminal': '💻',
        'bg-remove': '✂️',
        '3d-vault': '🧊',
        'lab-browser': '🌐',
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
        'obsidian': '📚',
        'samba': '💾',
        'zigbee2mqtt': '💡',
        'onepercentbot': '💹',
        'view-overview': '🌌',
        'view-energy': '⚡',
        'view-services': '📦',
        'view-ports': '🛡️',
        'view-terminal': '💻',
        'view-settings': '🛠️',
    };

    const state = {
        apps: [],
        bookmarks: [],
        discovered: [],
        badges: {},
        role: 'admin',
        pinned: DEFAULT_PINNED.slice(),
        recent: [],
        paletteOpen: false,
        paletteItems: [],
        paletteSelected: 0,
        editorOpen: false,
        editorTab: 'pinned', // 'pinned' | 'bookmarks'
        editorDraft: [],
        editorFilter: '',
        editingBmId: null,
        badgesApiDisabledUntil: 0,
        serverSupportsHub: false,
    };

    let els = {};
    let toastTimer = null;
    let badgePollTimer = null;

    function getEmoji(item) {
        if (item && typeof item === 'object') {
            if (item.emoji) return String(item.emoji);
            return EMOJI_MAP[item.id] || (item.source === 'docker' ? '🐳' : (item.source === 'bookmark' ? '🔖' : '🔗'));
        }
        return EMOJI_MAP[item] || '🔗';
    }

    function shortLabel(label) {
        const s = String(label || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        return s || String(label || '');
    }

    function isEmbeddableApp(app) {
        if (!app || app.isView || app.embed === false) return false;
        const url = String(app.url || '');
        if (!url || url.startsWith('#') || url.startsWith('\\\\')) return false;
        return url.startsWith('/') || /^https?:\/\//i.test(url);
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

    function normalizeApp(item) {
        if (!item || !item.id || !item.url) return null;
        const id = String(item.id);
        return {
            id,
            label: String(item.label || id),
            icon: String(item.icon || 'link'),
            emoji: item.emoji ? String(item.emoji) : getEmoji(id),
            url: String(item.url),
            source: item.source ? String(item.source) : 'builtin',
            group: item.group ? String(item.group) : '',
            description: item.description ? String(item.description) : '',
            embed: item.embed !== undefined ? Boolean(item.embed) : true,
            openInWorkspace: Boolean(item.openInWorkspace),
            family: Boolean(item.family),
            containerName: item.containerName ? String(item.containerName) : '',
            containerState: item.containerState ? String(item.containerState) : '',
        };
    }

    function mergeApps(baseList, isFamily) {
        const map = new Map();
        const add = (item) => {
            const norm = normalizeApp(item);
            if (!norm) return;
            if (!map.has(norm.id)) map.set(norm.id, norm);
        };
        (Array.isArray(baseList) ? baseList : []).forEach(add);
        if (!isFamily) {
            EXTRA_APPS.forEach(add);
            if (map.size <= EXTRA_APPS.length) {
                FALLBACK_CORE_APPS.forEach(add);
            }
        }
        return Array.from(map.values());
    }

    function getVisibleInternalViews() {
        if (state.role === 'family') {
            return INTERNAL_VIEWS.filter((v) => v.family);
        }
        return INTERNAL_VIEWS;
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

    function openApp(app, opts = {}) {
        if (!app) return;
        recordRecent(app.id);

        if ((opts.inWorkspace || (app.openInWorkspace && !opts.forceDirect)) && isEmbeddableApp(app) && window.LabWorkspace) {
            if (opts.split && typeof window.LabWorkspace.openSplit === 'function') {
                window.LabWorkspace.openSplit(app);
            } else if (typeof window.LabWorkspace.open === 'function') {
                window.LabWorkspace.open(app);
            }
            return;
        }

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

    // ── Fuzzy search ─────────────────────────────────────────────────────────
    function fuzzyScore(query, item) {
        const q = String(query || '').toLowerCase().trim();
        if (!q) return 1;
        const label = String(item.label || '').toLowerCase();
        const id = String(item.id || '').toLowerCase();
        const url = String(item.url || '').toLowerCase();
        const grp = String(item.group || '').toLowerCase();
        const hay = `${label} ${id} ${url} ${grp}`;

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

    function createBadgeEl(badge, extraClass) {
        if (!badge || !badge.text) return null;
        const tone = ['ok', 'warn', 'err', 'info', 'neutral'].includes(badge.tone) ? badge.tone : 'neutral';
        const span = document.createElement('span');
        span.className = `lab-launcher__badge lab-launcher__badge--${tone}` + (extraClass ? ` ${extraClass}` : '');
        span.textContent = String(badge.text);
        return span;
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
            btn.dataset.appId = app.id;
            btn.setAttribute('role', 'listitem');
            const badge = state.badges[app.id];
            const tipParts = [app.label];
            if (badge && badge.text) tipParts.push(`[${badge.text}]`);
            if (idx < 9) tipParts.push(`กด ${idx + 1}`);
            if (isEmbeddableApp(app)) tipParts.push('Shift+คลิก เปิดใน Workspace');
            btn.title = tipParts.join(' · ');

            const ico = document.createElement('span');
            ico.className = 'lab-launcher__ico';
            ico.setAttribute('aria-hidden', 'true');
            ico.textContent = getEmoji(app);

            const lbl = document.createElement('span');
            lbl.className = 'lab-launcher__lbl';
            lbl.textContent = shortLabel(app.label);

            btn.appendChild(ico);
            btn.appendChild(lbl);

            const badgeEl = createBadgeEl(badge);
            if (badgeEl) {
                btn.appendChild(badgeEl);
            } else if (idx < 9) {
                const kbd = document.createElement('kbd');
                kbd.className = 'lab-launcher__kbd';
                kbd.textContent = String(idx + 1);
                btn.appendChild(kbd);
            }

            btn.addEventListener('click', (e) => {
                openApp(app, { inWorkspace: Boolean(e.shiftKey) });
            });
            pinsWrap.appendChild(btn);
        });

        const actions = document.createElement('div');
        actions.className = 'lab-launcher__actions';

        // Workspace button
        const wsBtn = document.createElement('button');
        wsBtn.type = 'button';
        wsBtn.className = 'lab-launcher__tool-btn';
        wsBtn.setAttribute('aria-label', 'เปิด Multi-App Workspace');
        wsBtn.title = 'Multi-App Workspace / Split-View (Alt+W)';
        wsBtn.textContent = '🪟';
        wsBtn.addEventListener('click', () => {
            if (window.LabWorkspace && typeof window.LabWorkspace.open === 'function') {
                window.LabWorkspace.open();
            } else {
                showToast('Workspace กำลังโหลด…');
            }
        });

        // Kiosk button
        const kioskBtn = document.createElement('button');
        kioskBtn.type = 'button';
        kioskBtn.className = 'lab-launcher__tool-btn';
        kioskBtn.setAttribute('aria-label', 'โหมด Kiosk Wall-Display');
        kioskBtn.title = 'โหมด Kiosk / Wall-Display (Alt+K)';
        kioskBtn.textContent = '📺';
        kioskBtn.addEventListener('click', () => {
            if (window.LabKiosk && typeof window.LabKiosk.toggle === 'function') {
                window.LabKiosk.toggle();
            } else {
                showToast('Kiosk กำลังโหลด…');
            }
        });

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

        actions.appendChild(wsBtn);
        actions.appendChild(kioskBtn);
        actions.appendChild(searchBtn);

        if (state.role !== 'family') {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'lab-launcher__edit-btn';
            editBtn.setAttribute('aria-label', 'แก้ไขปุ่มลัดและบุ๊กมาร์ก');
            editBtn.title = 'แก้ไขปุ่มลัด & บุ๊กมาร์ก (สูงสุด 12 แอป)';
            editBtn.textContent = '⚙️';
            editBtn.addEventListener('click', () => openEditor('pinned'));
            actions.appendChild(editBtn);
        }

        host.appendChild(pinsWrap);
        host.appendChild(actions);
    }

    function updateBarBadgesInPlace() {
        const host = document.getElementById('lab-launcher');
        if (!host) return;
        const buttons = host.querySelectorAll('.lab-launcher__pin[data-app-id]');
        buttons.forEach((btn) => {
            const id = btn.dataset.appId;
            const badge = state.badges[id];
            const existing = btn.querySelector('.lab-launcher__badge');
            if (badge && badge.text) {
                const kbd = btn.querySelector('.lab-launcher__kbd');
                if (kbd) kbd.remove();
                const tone = ['ok', 'warn', 'err', 'info', 'neutral'].includes(badge.tone) ? badge.tone : 'neutral';
                if (existing) {
                    existing.className = `lab-launcher__badge lab-launcher__badge--${tone}`;
                    existing.textContent = String(badge.text);
                } else {
                    const nextEl = createBadgeEl(badge);
                    if (nextEl) btn.appendChild(nextEl);
                }
            } else if (existing) {
                existing.remove();
            }
        });
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
        input.placeholder = 'พิมพ์ชื่อแอป, Docker, บุ๊กมาร์ก หรือมุมมอง...';
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
        fLeft.textContent = '↑↓ เลือก · Enter เปิด · Shift+Enter เปิดใน Workspace';
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
                    openApp(picked, { inWorkspace: Boolean(e.shiftKey) });
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
        const rows = els.paletteList.querySelectorAll('.lab-palette__item');
        rows.forEach((row, idx) => {
            const active = idx === state.paletteSelected;
            row.classList.toggle('is-selected', active);
            row.setAttribute('aria-selected', active ? 'true' : 'false');
            if (active && typeof row.scrollIntoView === 'function') {
                row.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function renderPaletteList(query) {
        if (!els.paletteList) return;
        const q = String(query || '').trim();
        els.paletteList.textContent = '';
        state.paletteItems = [];

        const appendGroup = (title, items, defaultTag) => {
            if (!items.length) return;
            const grp = document.createElement('div');
            grp.className = 'lab-palette__group';
            grp.textContent = title;
            els.paletteList.appendChild(grp);

            items.forEach((item) => {
                const idx = state.paletteItems.length;
                state.paletteItems.push(item);

                const row = document.createElement('div');
                row.className = 'lab-palette__item' + (idx === state.paletteSelected ? ' is-selected' : '');
                row.setAttribute('role', 'option');
                row.setAttribute('tabindex', '0');
                row.setAttribute('aria-selected', idx === state.paletteSelected ? 'true' : 'false');

                const ico = document.createElement('span');
                ico.className = 'lab-palette__item-ico';
                ico.setAttribute('aria-hidden', 'true');
                ico.textContent = getEmoji(item);

                const main = document.createElement('span');
                main.className = 'lab-palette__item-main';

                const lbl = document.createElement('span');
                lbl.className = 'lab-palette__item-lbl';
                lbl.textContent = item.label;

                const sub = document.createElement('span');
                sub.className = 'lab-palette__item-sub';
                sub.textContent = item.description ? `${item.description} · ${item.url}` : item.url;

                main.appendChild(lbl);
                main.appendChild(sub);
                row.appendChild(ico);
                row.appendChild(main);

                const meta = document.createElement('span');
                meta.className = 'lab-palette__item-meta';

                const badgeEl = createBadgeEl(state.badges[item.id]);
                if (badgeEl) meta.appendChild(badgeEl);

                const tagStr = item.source === 'docker'
                    ? '🐳 Auto'
                    : (item.source === 'bookmark' ? '🔖 Custom' : defaultTag);
                if (tagStr) {
                    const tag = document.createElement('span');
                    tag.className = 'lab-palette__item-tag' + (item.source === 'docker' ? ' lab-palette__item-tag--docker' : '');
                    tag.textContent = tagStr;
                    meta.appendChild(tag);
                }

                if (isEmbeddableApp(item)) {
                    const wsAct = document.createElement('button');
                    wsAct.type = 'button';
                    wsAct.className = 'lab-palette__ws-btn';
                    wsAct.title = 'เปิดใน Workspace';
                    wsAct.textContent = '🪟';
                    wsAct.addEventListener('click', (e) => {
                        e.stopPropagation();
                        closePalette();
                        openApp(item, { inWorkspace: true });
                    });

                    const splitAct = document.createElement('button');
                    splitAct.type = 'button';
                    splitAct.className = 'lab-palette__ws-btn';
                    splitAct.title = 'เปิดแบบ Split-View (2 หน้าต่าง)';
                    splitAct.textContent = '⊞';
                    splitAct.addEventListener('click', (e) => {
                        e.stopPropagation();
                        closePalette();
                        openApp(item, { inWorkspace: true, split: true });
                    });

                    meta.appendChild(wsAct);
                    meta.appendChild(splitAct);
                }

                row.appendChild(meta);

                row.addEventListener('mouseenter', () => {
                    state.paletteSelected = idx;
                    updatePaletteSelection();
                });

                row.addEventListener('click', (e) => {
                    closePalette();
                    openApp(item, { inWorkspace: Boolean(e.shiftKey) });
                });

                els.paletteList.appendChild(row);
            });
        };

        const visibleViews = getVisibleInternalViews();
        if (!q) {
            const recentApps = state.recent
                .map((id) => findAppById(id))
                .filter((a) => a && (state.role !== 'family' || a.family));
            const recentIds = new Set(recentApps.map((a) => a.id));
            const dockerApps = state.apps.filter((a) => a.source === 'docker' && !recentIds.has(a.id));
            const customBms = state.apps.filter((a) => a.source === 'bookmark' && !recentIds.has(a.id));
            const builtinApps = state.apps.filter((a) => a.source !== 'docker' && a.source !== 'bookmark' && !recentIds.has(a.id));

            appendGroup('ล่าสุด', recentApps, 'ล่าสุด');
            appendGroup('แอปหลัก', builtinApps, '');
            appendGroup('Docker Auto-Discovery', dockerApps, '🐳 Auto');
            appendGroup('บุ๊กมาร์กของฉัน', customBms, '🔖 Custom');
            appendGroup('มุมมองภายใน', visibleViews.filter((v) => !recentIds.has(v.id)), 'มุมมอง');
        } else {
            const combined = state.apps.concat(visibleViews);
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

    // ── Shortcut & Bookmarks Editor Modal (⚙️) ───────────────────────────────
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
        dialog.setAttribute('aria-label', 'จัดการปุ่มลัดและบุ๊กมาร์ก');

        const head = document.createElement('div');
        head.className = 'lab-editor__head';

        const titleWrap = document.createElement('div');
        const h3 = document.createElement('h3');
        h3.className = 'lab-editor__title';
        h3.textContent = '⚙️ จัดการ Launcher, Docker & บุ๊กมาร์ก';
        const sub = document.createElement('p');
        sub.className = 'lab-editor__sub';
        sub.textContent = 'ปักหมุดได้สูงสุด 12 แอป · เพิ่มบุ๊กมาร์กเว็บนอก/ภายในได้เอง';
        titleWrap.appendChild(h3);
        titleWrap.appendChild(sub);

        const headRight = document.createElement('div');
        headRight.className = 'lab-editor__head-right';

        const rescanBtn = document.createElement('button');
        rescanBtn.type = 'button';
        rescanBtn.className = 'lab-editor__btn lab-editor__btn--sm';
        rescanBtn.textContent = '🐳 สแกน Docker';
        rescanBtn.title = 'ค้นหาคอนเทนเนอร์ Docker ที่เปิดพอร์ตเว็บหรือติด label lab.dashboard.*';
        rescanBtn.addEventListener('click', rescanDockerApps);

        const xBtn = document.createElement('button');
        xBtn.type = 'button';
        xBtn.className = 'lab-palette__close';
        xBtn.textContent = '✕';
        xBtn.setAttribute('aria-label', 'ปิดหน้าต่าง');
        xBtn.addEventListener('click', closeEditor);

        headRight.appendChild(rescanBtn);
        headRight.appendChild(xBtn);
        head.appendChild(titleWrap);
        head.appendChild(headRight);

        // Editor Tabs
        const tabs = document.createElement('div');
        tabs.className = 'lab-editor__tabs';
        tabs.setAttribute('role', 'tablist');

        const tabPinned = document.createElement('button');
        tabPinned.type = 'button';
        tabPinned.className = 'lab-editor__tab is-active';
        tabPinned.textContent = '📌 ปุ่มลัด (Shortcuts)';
        tabPinned.addEventListener('click', () => switchEditorTab('pinned'));

        const tabBookmarks = document.createElement('button');
        tabBookmarks.type = 'button';
        tabBookmarks.className = 'lab-editor__tab';
        tabBookmarks.textContent = '🔖 บุ๊กมาร์ก (Bookmarks)';
        tabBookmarks.addEventListener('click', () => switchEditorTab('bookmarks'));

        tabs.appendChild(tabPinned);
        tabs.appendChild(tabBookmarks);

        // Pane 1: Pinned shortcuts
        const body = document.createElement('div');
        body.className = 'lab-editor__body';

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

        const rightCol = document.createElement('div');
        rightCol.className = 'lab-editor__col';
        const rightHead = document.createElement('div');
        rightHead.className = 'lab-editor__col-head';
        const rightTitle = document.createElement('span');
        rightTitle.textContent = 'แอปทั้งหมด (Builtin + Docker + Custom)';
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

        // Pane 2: Custom Bookmarks CRUD
        const bmPane = document.createElement('div');
        bmPane.className = 'lab-editor__bm-pane';
        bmPane.hidden = true;

        const bmForm = document.createElement('form');
        bmForm.className = 'lab-bm-form';

        const bmFormTitle = document.createElement('div');
        bmFormTitle.className = 'lab-editor__col-head';
        bmFormTitle.textContent = 'เพิ่มบุ๊กมาร์กใหม่';

        const bmGrid = document.createElement('div');
        bmGrid.className = 'lab-bm-form__grid';

        const mkField = (labelText, inputEl) => {
            const wrap = document.createElement('label');
            wrap.className = 'lab-bm-field';
            const sp = document.createElement('span');
            sp.textContent = labelText;
            wrap.appendChild(sp);
            wrap.appendChild(inputEl);
            return wrap;
        };

        const bmLabelIn = document.createElement('input');
        bmLabelIn.type = 'text';
        bmLabelIn.required = true;
        bmLabelIn.maxLength = 80;
        bmLabelIn.placeholder = 'เช่น Router Admin, NAS, Docs';
        bmLabelIn.className = 'lab-editor__filter';

        const bmUrlIn = document.createElement('input');
        bmUrlIn.type = 'text';
        bmUrlIn.required = true;
        bmUrlIn.placeholder = 'https://... หรือ /path';
        bmUrlIn.className = 'lab-editor__filter';

        const bmEmojiIn = document.createElement('input');
        bmEmojiIn.type = 'text';
        bmEmojiIn.maxLength = 8;
        bmEmojiIn.value = '🔖';
        bmEmojiIn.className = 'lab-editor__filter';

        const bmGroupIn = document.createElement('input');
        bmGroupIn.type = 'text';
        bmGroupIn.maxLength = 40;
        bmGroupIn.value = 'Custom';
        bmGroupIn.placeholder = 'Custom / Network / Media';
        bmGroupIn.className = 'lab-editor__filter';

        bmGrid.appendChild(mkField('ชื่อบุ๊กมาร์ก *', bmLabelIn));
        bmGrid.appendChild(mkField('URL *', bmUrlIn));
        bmGrid.appendChild(mkField('อีโมจิ', bmEmojiIn));
        bmGrid.appendChild(mkField('กลุ่ม', bmGroupIn));

        const bmChecks = document.createElement('div');
        bmChecks.className = 'lab-bm-form__checks';

        const mkCheck = (text) => {
            const lbl = document.createElement('label');
            lbl.className = 'lab-bm-check';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            const sp = document.createElement('span');
            sp.textContent = text;
            lbl.appendChild(cb);
            lbl.appendChild(sp);
            return { lbl, cb };
        };

        const wsCheck = mkCheck('เปิดใน Workspace (iframe)');
        const famCheck = mkCheck('อนุญาตโหมดครอบครัว (Family)');
        bmChecks.appendChild(wsCheck.lbl);
        bmChecks.appendChild(famCheck.lbl);

        const bmFormBtns = document.createElement('div');
        bmFormBtns.className = 'lab-bm-form__btns';

        const bmSubmitBtn = document.createElement('button');
        bmSubmitBtn.type = 'submit';
        bmSubmitBtn.className = 'lab-editor__btn lab-editor__btn--primary';
        bmSubmitBtn.textContent = '+ เพิ่มบุ๊กมาร์ก';

        const bmCancelEditBtn = document.createElement('button');
        bmCancelEditBtn.type = 'button';
        bmCancelEditBtn.className = 'lab-editor__btn';
        bmCancelEditBtn.textContent = 'ยกเลิกแก้ไข';
        bmCancelEditBtn.hidden = true;
        bmCancelEditBtn.addEventListener('click', resetBookmarkForm);

        bmFormBtns.appendChild(bmSubmitBtn);
        bmFormBtns.appendChild(bmCancelEditBtn);

        bmForm.appendChild(bmFormTitle);
        bmForm.appendChild(bmGrid);
        bmForm.appendChild(bmChecks);
        bmForm.appendChild(bmFormBtns);
        bmForm.addEventListener('submit', handleBookmarkSubmit);

        const bmListWrap = document.createElement('div');
        bmListWrap.className = 'lab-editor__col';
        const bmListHead = document.createElement('div');
        bmListHead.className = 'lab-editor__col-head';
        const bmListTitle = document.createElement('span');
        bmListTitle.textContent = 'รายการบุ๊กมาร์กทั้งหมด';
        const bmListCount = document.createElement('span');
        bmListHead.appendChild(bmListTitle);
        bmListHead.appendChild(bmListCount);

        const bmList = document.createElement('div');
        bmList.className = 'lab-editor__list';
        bmListWrap.appendChild(bmListHead);
        bmListWrap.appendChild(bmList);

        bmPane.appendChild(bmForm);
        bmPane.appendChild(bmListWrap);

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
        saveBtn.textContent = 'บันทึกปุ่มลัด';
        saveBtn.addEventListener('click', saveEditor);

        rightBtns.appendChild(cancelBtn);
        rightBtns.appendChild(saveBtn);
        foot.appendChild(resetBtn);
        foot.appendChild(rightBtns);

        dialog.appendChild(head);
        dialog.appendChild(tabs);
        dialog.appendChild(body);
        dialog.appendChild(bmPane);
        dialog.appendChild(foot);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeEditor();
        });

        els.editorBackdrop = backdrop;
        els.editorTabPinned = tabPinned;
        els.editorTabBookmarks = tabBookmarks;
        els.editorPinnedPane = body;
        els.editorBmPane = bmPane;
        els.editorFoot = foot;
        els.editorCount = leftCount;
        els.editorPinnedList = pinnedList;
        els.editorAllList = allList;
        els.editorFilter = filterInput;
        els.bmFormTitle = bmFormTitle;
        els.bmLabelIn = bmLabelIn;
        els.bmUrlIn = bmUrlIn;
        els.bmEmojiIn = bmEmojiIn;
        els.bmGroupIn = bmGroupIn;
        els.bmWsCb = wsCheck.cb;
        els.bmFamCb = famCheck.cb;
        els.bmSubmitBtn = bmSubmitBtn;
        els.bmCancelEditBtn = bmCancelEditBtn;
        els.bmList = bmList;
        els.bmListCount = bmListCount;
    }

    function switchEditorTab(tab) {
        state.editorTab = tab === 'bookmarks' ? 'bookmarks' : 'pinned';
        if (!els.editorPinnedPane || !els.editorBmPane) return;
        const isBm = state.editorTab === 'bookmarks';
        els.editorPinnedPane.hidden = isBm;
        els.editorBmPane.hidden = !isBm;
        els.editorFoot.hidden = isBm;
        els.editorTabPinned.classList.toggle('is-active', !isBm);
        els.editorTabBookmarks.classList.toggle('is-active', isBm);
        if (isBm) renderBookmarksList();
        else renderEditorLists();
    }

    function resetBookmarkForm() {
        state.editingBmId = null;
        if (!els.bmLabelIn) return;
        els.bmFormTitle.textContent = 'เพิ่มบุ๊กมาร์กใหม่';
        els.bmLabelIn.value = '';
        els.bmUrlIn.value = '';
        els.bmEmojiIn.value = '🔖';
        els.bmGroupIn.value = 'Custom';
        els.bmWsCb.checked = false;
        els.bmFamCb.checked = false;
        els.bmSubmitBtn.textContent = '+ เพิ่มบุ๊กมาร์ก';
        els.bmCancelEditBtn.hidden = true;
    }

    function fillBookmarkForm(bm) {
        state.editingBmId = bm.id;
        els.bmFormTitle.textContent = `แก้ไขบุ๊กมาร์ก: ${bm.label}`;
        els.bmLabelIn.value = bm.label || '';
        els.bmUrlIn.value = bm.url || '';
        els.bmEmojiIn.value = bm.emoji || '🔖';
        els.bmGroupIn.value = bm.group || 'Custom';
        els.bmWsCb.checked = Boolean(bm.openInWorkspace);
        els.bmFamCb.checked = Boolean(bm.family);
        els.bmSubmitBtn.textContent = 'บันทึกการแก้ไข';
        els.bmCancelEditBtn.hidden = false;
        els.bmLabelIn.focus();
    }

    function renderBookmarksList() {
        if (!els.bmList) return;
        els.bmList.textContent = '';
        const list = state.bookmarks || [];
        els.bmListCount.textContent = `${list.length} รายการ`;

        if (!list.length) {
            const empty = document.createElement('div');
            empty.className = 'lab-palette__empty';
            empty.textContent = 'ยังไม่มีบุ๊กมาร์กที่สร้างเอง เพิ่มได้จากแบบฟอร์มด้านบน';
            els.bmList.appendChild(empty);
            return;
        }

        list.forEach((bm) => {
            const row = document.createElement('div');
            row.className = 'lab-editor__row';

            const ico = document.createElement('span');
            ico.className = 'lab-editor__row-ico';
            ico.textContent = getEmoji(bm);

            const main = document.createElement('div');
            main.className = 'lab-editor__row-main';
            const lbl = document.createElement('div');
            lbl.className = 'lab-editor__row-lbl';
            lbl.textContent = bm.label;
            const sub = document.createElement('div');
            sub.className = 'lab-editor__row-sub';
            sub.textContent = `${bm.group || 'Custom'} · ${bm.url}`;
            main.appendChild(lbl);
            main.appendChild(sub);

            const btns = document.createElement('div');
            btns.className = 'lab-editor__row-btns';

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'lab-editor__mini-btn';
            editBtn.textContent = '✏️';
            editBtn.title = 'แก้ไขบุ๊กมาร์ก';
            editBtn.addEventListener('click', () => fillBookmarkForm(bm));

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'lab-editor__mini-btn lab-editor__mini-btn--danger';
            delBtn.textContent = '🗑️';
            delBtn.title = 'ลบบุ๊กมาร์ก';
            delBtn.addEventListener('click', () => deleteBookmarkById(bm.id));

            btns.appendChild(editBtn);
            btns.appendChild(delBtn);

            row.appendChild(ico);
            row.appendChild(main);
            row.appendChild(btns);
            els.bmList.appendChild(row);
        });
    }

    async function handleBookmarkSubmit(e) {
        e.preventDefault();
        const payload = {
            label: String(els.bmLabelIn.value || '').trim(),
            url: String(els.bmUrlIn.value || '').trim(),
            emoji: String(els.bmEmojiIn.value || '🔖').trim() || '🔖',
            group: String(els.bmGroupIn.value || 'Custom').trim() || 'Custom',
            openInWorkspace: Boolean(els.bmWsCb.checked),
            family: Boolean(els.bmFamCb.checked),
        };
        if (!payload.label || !payload.url) {
            showToast('กรุณากรอกชื่อและ URL');
            return;
        }
        if (!/^(https?:\/\/|\/|#|\\\\)/i.test(payload.url)) {
            showToast('URL ต้องขึ้นต้นด้วย https://, http://, /, # หรือ \\\\');
            return;
        }

        const isEdit = Boolean(state.editingBmId);
        const endpoint = isEdit ? `/api/bookmarks/${encodeURIComponent(state.editingBmId)}` : '/api/bookmarks';
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const res = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
            resetBookmarkForm();
            await loadLauncher();
            renderBookmarksList();
            showToast(isEdit ? 'อัปเดตบุ๊กมาร์กแล้ว' : 'เพิ่มบุ๊กมาร์กเรียบร้อย');
        } catch (err) {
            // Local fallback when server hasn't restarted yet
            const localBms = readJsonStorage(STORAGE_LOCAL_BM, []);
            if (isEdit) {
                const idx = localBms.findIndex((x) => x.id === state.editingBmId);
                if (idx >= 0) localBms[idx] = { ...localBms[idx], ...payload, source: 'bookmark', embed: payload.openInWorkspace };
            } else {
                localBms.push({
                    id: `bm_local_${Date.now().toString(36)}`,
                    ...payload,
                    source: 'bookmark',
                    embed: payload.openInWorkspace,
                });
            }
            writeJsonStorage(STORAGE_LOCAL_BM, localBms);
            resetBookmarkForm();
            await loadLauncher();
            renderBookmarksList();
            showToast('บันทึกบุ๊กมาร์กในเครื่องนี้ (รอรีสตาร์ตเซิร์ฟเวอร์)');
        }
    }

    async function deleteBookmarkById(id) {
        try {
            const res = await fetch(`/api/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (state.editingBmId === id) resetBookmarkForm();
            await loadLauncher();
            renderBookmarksList();
            showToast('ลบบุ๊กมาร์กแล้ว');
        } catch (_) {
            const localBms = readJsonStorage(STORAGE_LOCAL_BM, []).filter((x) => x.id !== id);
            writeJsonStorage(STORAGE_LOCAL_BM, localBms);
            if (state.editingBmId === id) resetBookmarkForm();
            await loadLauncher();
            renderBookmarksList();
            showToast('ลบบุ๊กมาร์กในเครื่องนี้แล้ว');
        }
    }

    async function rescanDockerApps() {
        try {
            const res = await fetch('/api/launcher/discovered?force=1', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            await loadLauncher();
            if (state.editorOpen) renderEditorLists();
            showToast(`พบ Docker Apps อัตโนมัติ ${Number(data.count || 0)} รายการ`);
        } catch (_) {
            showToast('Docker Auto-Discovery พร้อมใช้หลังรีสตาร์ตเซิร์ฟเวอร์');
        }
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
                if (dragFromIdx !== -1 && dragFromIdx !== idx) row.classList.add('is-drag-over');
            });
            row.addEventListener('dragleave', () => row.classList.remove('is-drag-over'));
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
            ico.textContent = getEmoji(app);

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
        const filtered = q ? state.apps.filter((a) => fuzzyScore(q, a) > 0) : state.apps;

        filtered.forEach((app) => {
            const row = document.createElement('div');
            row.className = 'lab-editor__row';

            const ico = document.createElement('span');
            ico.className = 'lab-editor__row-ico';
            ico.setAttribute('aria-hidden', 'true');
            ico.textContent = getEmoji(app);

            const lbl = document.createElement('span');
            lbl.className = 'lab-editor__row-lbl';
            lbl.textContent = app.label;

            row.appendChild(ico);
            row.appendChild(lbl);

            if (app.source === 'docker' || app.source === 'bookmark') {
                const tag = document.createElement('span');
                tag.className = 'lab-palette__item-tag' + (app.source === 'docker' ? ' lab-palette__item-tag--docker' : '');
                tag.textContent = app.source === 'docker' ? '🐳 Auto' : '🔖';
                row.appendChild(tag);
            }

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

            row.appendChild(addBtn);
            els.editorAllList.appendChild(row);
        });
    }

    function openEditor(tab) {
        if (state.role === 'family') {
            showToast('โหมดครอบครัวไม่สามารถแก้ไขปุ่มลัดได้');
            return;
        }
        if (state.paletteOpen) closePalette();
        ensureEditorDom();
        state.editorOpen = true;
        state.editorDraft = state.pinned.slice();
        state.editorFilter = '';
        els.editorFilter.value = '';
        resetBookmarkForm();
        switchEditorTab(tab || 'pinned');
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

    // ── Live Badges Polling ──────────────────────────────────────────────────
    async function pollBadges() {
        if (document.hidden) return;
        if (Date.now() < state.badgesApiDisabledUntil) return;
        try {
            const res = await fetch('/api/launcher/badges', { cache: 'no-store' });
            if (res.status === 404) {
                state.badgesApiDisabledUntil = Date.now() + 120_000;
                return;
            }
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.badges && typeof data.badges === 'object') {
                state.badges = data.badges;
                updateBarBadgesInPlace();
                window.dispatchEvent(new CustomEvent('lab:launcher-updated', { detail: { badges: state.badges } }));
            }
        } catch (_) {
            // silent fallback
        }
    }

    // ── Initial Load with Server + localStorage Fallback ─────────────────────
    async function loadLauncher() {
        state.recent = readJsonStorage(STORAGE_RECENT, []).slice(0, MAX_RECENT);

        try {
            const res = await fetch('/api/launcher', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data || !Array.isArray(data.apps)) throw new Error('Invalid payload');

            state.serverSupportsHub = Boolean(data.badges !== undefined || data.bookmarks !== undefined || data.role);
            state.role = data.role === 'family' ? 'family' : 'admin';
            state.bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
            state.discovered = Array.isArray(data.discovered) ? data.discovered : [];
            state.badges = (data.badges && typeof data.badges === 'object') ? data.badges : {};

            const localBms = !state.serverSupportsHub ? readJsonStorage(STORAGE_LOCAL_BM, []) : [];
            if (!state.serverSupportsHub && localBms.length) {
                state.bookmarks = localBms;
            }

            state.apps = mergeApps(data.apps.concat(localBms), state.role === 'family');
            state.pinned = sanitizePinned(data.pinned);
            writeJsonStorage(STORAGE_PINNED, state.pinned);
            renderBar();
            window.dispatchEvent(new CustomEvent('lab:launcher-updated', {
                detail: { apps: state.apps, badges: state.badges, role: state.role },
            }));
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

        const localBms = readJsonStorage(STORAGE_LOCAL_BM, []);
        state.bookmarks = localBms;
        state.apps = mergeApps(summaryLinks.concat(localBms), false);
        const savedPinned = readJsonStorage(STORAGE_PINNED, DEFAULT_PINNED);
        state.pinned = sanitizePinned(savedPinned);
        renderBar();
        window.dispatchEvent(new CustomEvent('lab:launcher-updated', {
            detail: { apps: state.apps, badges: state.badges, role: state.role },
        }));
    }

    function init() {
        bindGlobalEvents();
        loadLauncher();
        if (!badgePollTimer) {
            badgePollTimer = setInterval(pollBadges, BADGE_POLL_MS);
        }
    }

    window.LabLauncher = {
        openPalette,
        closePalette,
        openEditor,
        closeEditor,
        openApp,
        getApps: () => state.apps.slice(),
        getBadges: () => ({ ...state.badges }),
        getRole: () => state.role,
        reload: loadLauncher,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

/* ============================================================================
   Agent Hub Mini Widget (Overview)
   Polls GET /api/agent-hub/mini every 5s (pauses when hidden or off overview)
   Fallback: GET /api/agent-hub/status (strictly ignores token field)
   ========================================================================== */
(function () {
    'use strict';

    const POLL_MS = 5000;
    const HOT_THRESHOLD = 85;
    let pollTimer = null;
    let inFlight = false;

    function isOverviewActive() {
        const view = document.getElementById('view-overview');
        return Boolean(view && view.classList.contains('is-active'));
    }

    function fmtGb(bytes) {
        const n = Number(bytes) || 0;
        return (n / 1073741824).toFixed(1);
    }

    function clampPct(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
    }

    function fmtAge(ageMs) {
        const ms = Number(ageMs);
        if (!Number.isFinite(ms) || ms < 0) return 'ออฟไลน์';
        const sec = Math.floor(ms / 1000);
        if (sec < 60) return `เห็นล่าสุด ${sec} วิที่แล้ว`;
        const min = Math.floor(sec / 60);
        if (min < 60) return `เห็นล่าสุด ${min} นาทีที่แล้ว`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `เห็นล่าสุด ${hr} ชม.ที่แล้ว`;
        const day = Math.floor(hr / 24);
        return `เห็นล่าสุด ${day} วันที่แล้ว`;
    }

    function normalizeStatusFallback(raw) {
        const rawNodes = Array.isArray(raw && raw.nodes) ? raw.nodes : [];
        const nodes = rawNodes.map((n) => {
            const specs = (n && n.specs) || {};
            const metrics = (n && n.metrics) || {};
            const memUsed = Number(metrics.memUsed) || 0;
            const memTotal = Number(metrics.memTotal) || 0;
            return {
                nodeId: String((n && n.nodeId) || ''),
                hostname: String(specs.hostname || (n && n.nodeId) || 'Agent'),
                online: Boolean(n && n.online),
                ageMs: Number.isFinite(Number(n && n.ageMs)) ? Number(n.ageMs) : null,
                cpuPct: metrics.cpuPct != null ? Number(metrics.cpuPct) : null,
                memUsed,
                memTotal,
                memPct: memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : null,
                gpuUtilPct: metrics.gpuUtilPct != null ? Number(metrics.gpuUtilPct) : null,
                gpuModel: String(specs.gpuModel || ''),
            };
        });
        nodes.sort((a, b) => Number(b.online) - Number(a.online));
        return {
            ok: true,
            totalNodes: nodes.length,
            onlineNodes: nodes.filter((x) => x.online).length,
            nodes,
        };
    }

    async function fetchMiniData() {
        try {
            const res = await fetch('/api/agent-hub/mini', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                if (data && Array.isArray(data.nodes)) return data;
            }
        } catch (_) {
            // fall through to /api/agent-hub/status
        }

        const r2 = await fetch('/api/agent-hub/status', { cache: 'no-store' });
        if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
        const raw = await r2.json();
        return normalizeStatusFallback(raw);
    }

    function buildMeter(labelText, valueText, pct, variant) {
        const wrap = document.createElement('div');
        wrap.className = 'ov-am-meter';

        const row = document.createElement('div');
        row.className = 'ov-am-meter-row';

        const lbl = document.createElement('span');
        lbl.textContent = labelText;

        const val = document.createElement('span');
        val.className = 'ov-am-meter-val';
        val.textContent = valueText;

        row.appendChild(lbl);
        row.appendChild(val);

        const track = document.createElement('div');
        track.className = 'ov-am-track';

        const fill = document.createElement('i');
        const clamped = clampPct(pct);
        fill.className = `ov-am-fill ov-am-fill--${variant}` + (clamped > HOT_THRESHOLD ? ' ov-am-fill--hot' : '');
        fill.style.width = `${clamped.toFixed(1)}%`;

        track.appendChild(fill);
        wrap.appendChild(row);
        wrap.appendChild(track);
        return wrap;
    }

    function render(data) {
        const host = document.getElementById('ov-agent-mini');
        if (!host) return;

        const nodes = (Array.isArray(data && data.nodes) ? data.nodes.slice() : [])
            .sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)));
        const total = Number.isFinite(Number(data && data.totalNodes)) ? Number(data.totalNodes) : nodes.length;
        const online = Number.isFinite(Number(data && data.onlineNodes))
            ? Number(data.onlineNodes)
            : nodes.filter((n) => n.online).length;

        host.textContent = '';

        // Header
        const head = document.createElement('div');
        head.className = 'ov-am-head';

        const title = document.createElement('div');
        title.className = 'ov-am-title';
        title.textContent = `🛰️ HOMELAB AGENT HUB · ออนไลน์ ${online}/${total}`;

        const link = document.createElement('a');
        link.className = 'ov-am-link';
        link.href = '/agent-hub';
        link.textContent = 'เปิดศูนย์ควบคุม →';

        head.appendChild(title);
        head.appendChild(link);
        host.appendChild(head);

        if (!nodes.length) {
            const empty = document.createElement('div');
            empty.className = 'ov-am-empty';

            const msg = document.createElement('span');
            msg.textContent = 'ยังไม่มีเครื่องลูก Homelab Agent Hub เชื่อมต่ออยู่';

            const dl = document.createElement('a');
            dl.className = 'ov-am-dl';
            dl.href = '/api/agent-hub/download/homelab-agent.exe';
            dl.textContent = '⬇️ ดาวน์โหลด Agent (Windows)';

            empty.appendChild(msg);
            empty.appendChild(dl);
            host.appendChild(empty);
            return;
        }

        if (online === 0) {
            const note = document.createElement('div');
            note.className = 'ov-am-note';
            note.textContent = 'ขณะนี้ไม่มีเครื่องลูกออนไลน์ (แสดงสถานะล่าสุด)';
            host.appendChild(note);
        }

        const grid = document.createElement('div');
        grid.className = 'ov-am-grid';

        nodes.forEach((n) => {
            const card = document.createElement('a');
            card.className = 'ov-am-card' + (n.online ? '' : ' is-offline');
            card.href = '/agent-hub';

            const top = document.createElement('div');
            top.className = 'ov-am-card-top';

            const hw = document.createElement('div');
            hw.className = 'ov-am-host-wrap';

            const dot = document.createElement('span');
            dot.className = 'ov-am-dot' + (n.online ? ' is-online' : '');
            dot.setAttribute('aria-hidden', 'true');

            const name = document.createElement('span');
            name.className = 'ov-am-host';
            name.textContent = String(n.hostname || n.nodeId || 'Agent');

            hw.appendChild(dot);
            hw.appendChild(name);

            const st = document.createElement('span');
            st.className = 'ov-am-status';
            st.textContent = n.online ? 'ออนไลน์' : fmtAge(n.ageMs);

            top.appendChild(hw);
            top.appendChild(st);
            card.appendChild(top);

            const cpuPct = n.cpuPct != null ? clampPct(n.cpuPct) : 0;
            card.appendChild(buildMeter(
                'CPU',
                n.cpuPct != null ? `${cpuPct.toFixed(0)}%` : '—',
                cpuPct,
                'cpu'
            ));

            const memTotal = Number(n.memTotal) || 0;
            const memUsed = Number(n.memUsed) || 0;
            const memPct = n.memPct != null
                ? clampPct(n.memPct)
                : (memTotal > 0 ? clampPct((memUsed / memTotal) * 100) : 0);
            const ramLabel = memTotal > 0 ? `RAM · ${fmtGb(memUsed)} / ${fmtGb(memTotal)} GB` : 'RAM';
            card.appendChild(buildMeter(
                ramLabel,
                memTotal > 0 ? `${memPct.toFixed(0)}%` : '—',
                memPct,
                'ram'
            ));

            if (n.gpuUtilPct != null) {
                const gpuPct = clampPct(n.gpuUtilPct);
                card.appendChild(buildMeter('GPU', `${gpuPct.toFixed(0)}%`, gpuPct, 'gpu'));
            }

            if (n.gpuModel) {
                const gm = document.createElement('div');
                gm.className = 'ov-am-gpu-name';
                gm.textContent = `🎮 ${n.gpuModel}`;
                card.appendChild(gm);
            }

            grid.appendChild(card);
        });

        host.appendChild(grid);
    }

    async function tick() {
        if (inFlight || document.hidden || !isOverviewActive()) return;
        inFlight = true;
        try {
            const data = await fetchMiniData();
            render(data);
        } catch (_) {
            // Keep last rendered state silently on transient error
        } finally {
            inFlight = false;
        }
    }

    function init() {
        const host = document.getElementById('ov-agent-mini');
        if (!host) return;

        tick();
        pollTimer = setInterval(tick, POLL_MS);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && isOverviewActive()) tick();
        });

        const view = document.getElementById('view-overview');
        if (view && typeof MutationObserver !== 'undefined') {
            const obs = new MutationObserver(() => {
                if (isOverviewActive() && !document.hidden) tick();
            });
            obs.observe(view, { attributes: true, attributeFilter: ['class'] });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

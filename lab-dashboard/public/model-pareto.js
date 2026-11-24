/**
 * model-pareto.js — หาโมเดลที่ "ถูกกลบ" (แพงกว่าแต่ฉลาดน้อยกว่า) แบบ Pareto แยกตามถังโควตา
 * ใช้ร่วมกันทั้ง Node (model-registry.js / ai-router.js) และหน้าเว็บ (model-alerts.js) — UMD
 *
 * กฎ: โมเดล A ถูกกลบในงานประเภท t เมื่อมี B ที่ active, อยู่ถังโควตาเดียวกัน,
 *     cost(B) <= cost(A) และ q_t(B) >= q_t(A) โดยดีกว่าอย่างน้อยหนึ่งข้อ
 *   - frontier       : ไม่ถูกกลบเลย → ตัวเลือกหลัก
 *   - standby        : ถูกกลบครบทั้ง code/analysis/chat → router ใช้เฉพาะตอน fallback
 *   - partial        : ถูกกลบบางประเภท → standby เฉพาะประเภทนั้น
 *   - separate-pool  : ชนะในถังตัวเอง แต่แพ้ถังอื่น → เก็บไว้ระบายโควตา
 *   - outside        : DeepSeek (จ่ายตามใช้) / ไม่ active → ไม่นำมาคิด
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ModelPareto = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const TYPES = ['code', 'analysis', 'chat'];
    // ตัวกลบต้องมีข้อมูลน่าเชื่อถือ (ผ่านเกณฑ์ ≥3 แหล่งอิสระ = 76) ไม่งั้นค่าประมาณจะดันตัวที่ยืนยันแล้วลง standby
    const MIN_DOMINATOR_CONFIDENCE = 76;

    function isPayPerUse(m) {
        return m.engine === 'deepseek' || String(m.id || '').startsWith('deepseek');
    }

    function poolOf(m) {
        if (m.engine === 'claude-code') return 'claude-code';
        const pool = (m.suggested && m.suggested.pool) || m.engine || 'unknown';
        // Orchestrator เป็นโหมดทีมสำหรับงานใหญ่ เทียบกันเองเท่านั้น ไม่เทียบกับโมเดลเดี่ยว
        return /orchestrator/i.test(String(m.id || '')) ? `${pool}:team` : pool;
    }

    // ค่าเดียวกับที่ตาราง Dashboard แสดง: ผลวิจัยภายนอกก่อน ไม่มีค่อยใช้ค่าแนะนำ
    function metricsOf(m) {
        const res = m.research || {};
        const sug = m.suggested || {};
        const q = res.effectiveQ || sug.q || {};
        const cost = (res.pricing && Number.isFinite(res.pricing.effectiveCost))
            ? res.pricing.effectiveCost
            : (Number.isFinite(Number(sug.cost)) ? Number(sug.cost) : 1);
        return {
            cost,
            q: { code: Number(q.code) || 0, analysis: Number(q.analysis) || 0, chat: Number(q.chat) || 0 }
        };
    }

    function dominates(b, a, t) {
        return b.cost <= a.cost && b.q[t] >= a.q[t] && (b.cost < a.cost || b.q[t] > a.q[t]);
    }

    // ตัวกลบที่ดีที่สุด: ฉลาดสุดในด้านนั้น → ถูกสุด
    function bestDominator(a, others, t) {
        let best = null;
        for (const b of others) {
            if (!dominates(b, a, t)) continue;
            if (!best || b.q[t] > best.q[t] || (b.q[t] === best.q[t] && b.cost < best.cost)) best = b;
        }
        return best;
    }

    /**
     * @param {Array} models รายการโมเดลจาก registry (id, engine, status, suggested, research)
     * @returns {Object} id -> { tier, pool, standbyTypes, dominatedBy:{type:id}, crossPoolBy:{type:id} }
     */
    function computePareto(models) {
        const list = (Array.isArray(models) ? models : []).filter((m) => m && m.id);
        const rows = list.map((m) => ({ id: m.id, m, pool: poolOf(m), ...metricsOf(m) }));
        const eligible = rows.filter((r) => r.m.status === 'active' && !isPayPerUse(r.m));
        const dominators = eligible.filter((r) => (Number(r.m.confidence) || 0) >= MIN_DOMINATOR_CONFIDENCE);
        const out = {};

        for (const r of rows) {
            if (r.m.status !== 'active' || isPayPerUse(r.m)) {
                out[r.id] = { tier: 'outside', pool: r.pool, standbyTypes: [], dominatedBy: {}, crossPoolBy: {} };
                continue;
            }
            const samePool = dominators.filter((o) => o.id !== r.id && o.pool === r.pool);
            const isTeam = (x) => x.pool.endsWith(':team');
            const otherPools = dominators.filter((o) => o.id !== r.id && o.pool !== r.pool && isTeam(o) === isTeam(r));
            const dominatedBy = {};
            const crossPoolBy = {};
            for (const t of TYPES) {
                const d = bestDominator(r, samePool, t);
                if (d) dominatedBy[t] = d.id;
                const x = bestDominator(r, otherPools, t);
                if (x) crossPoolBy[t] = x.id;
            }
            const standbyTypes = TYPES.filter((t) => dominatedBy[t]);
            let tier = 'frontier';
            if (standbyTypes.length === TYPES.length) tier = 'standby';
            else if (standbyTypes.length > 0) tier = 'partial';
            else if (Object.keys(crossPoolBy).length === TYPES.length) tier = 'separate-pool';
            out[r.id] = { tier, pool: r.pool, standbyTypes, dominatedBy, crossPoolBy };
        }
        return out;
    }

    /** ชุด model id ที่ควรเป็น standby สำหรับงานประเภท qType (code/analysis/chat) */
    function standbyIdsFor(pareto, qType) {
        const t = TYPES.includes(qType) ? qType : 'chat';
        const ids = new Set();
        for (const [id, p] of Object.entries(pareto || {})) {
            if (p.standbyTypes && p.standbyTypes.includes(t)) ids.add(id);
        }
        return ids;
    }

    return { TYPES, MIN_DOMINATOR_CONFIDENCE, computePareto, standbyIdsFor, metricsOf, poolOf };
}));

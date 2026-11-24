#!/usr/bin/env node
'use strict';

/**
 * scripts/rank-models-by-cost.js
 * จัดอันดับโมเดลตามต้นทุน (ถูก→แพง) จากผลวิจัยที่เก็บไว้ใน registry — ไม่ยิงเว็บซ้ำ
 *   - ซับสคริปชัน (Claude + Gemini, จ่ายไปแล้ว): เรียงต้นทุนรวมกัน มีเลขอันดับ
 *   - DeepSeek (จ่ายตามการใช้งาน): อยู่นอกกฎเกณฑ์ แยกตารางท้าย ไม่มีอันดับ
 * เขียนรายงานที่ docs/model-cost-ranking.md
 */

const fs = require('fs');
const path = require('path');

if (!process.env.MODEL_REGISTRY_FILE && fs.existsSync('/home/dev/.gemini/model-registry.json')) {
    process.env.MODEL_REGISTRY_FILE = '/home/dev/.gemini/model-registry.json';
}

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'model-cost-ranking.md');
const aiRouter = require(path.join(ROOT, 'ai-router'));
const modelRegistry = require(path.join(ROOT, 'model-registry'));
const researcher = require(path.join(ROOT, 'model-researcher'));

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

function row(m) {
    const q = (m.suggested && m.suggested.effectiveQ) || {};
    const usd = m.pricing && m.pricing.outputUsdPer1M != null ? `$${m.pricing.outputUsdPer1M}` : '-';
    const src = `${m.uniqueDomainCount}${m.meetsMinSourcesCount === false || !m.meetsMinSources ? ' ⚠️' : ''}`;
    return `| ${m.rank ?? '—'} | \`${esc(m.id)}\` | ${esc(m.status)} | ${m.pricing.effectiveCost} | ${usd} | ${m.scores.avgQ} (${q.code ?? '-'}/${q.analysis ?? '-'}/${q.chat ?? '-'}) | ${m.confidence}% | ${src} |`;
}

function main() {
    if (typeof aiRouter.activeFamilies === 'function') aiRouter.activeFamilies();
    const res = modelRegistry.getResearchRanking({ sortBy: 'cost' });
    if (!res.ok) { console.error('ranking failed', res); process.exit(1); }

    const head = [
        '| อันดับ | โมเดล | สถานะ | cost | Output $/1M | ความฉลาด avg (code/ana/chat) | ความมั่นใจ | แหล่ง |',
        '|---:|---|---|---:|---:|---|---:|---:|'
    ];
    const sub = res.ranked.filter((m) => m.billing === 'subscription');
    const ppu = res.ranked.filter((m) => m.billing === 'pay-per-use');
    const lines = [
        '# 💰 จัดอันดับโมเดลตามต้นทุน (ถูก → แพง)',
        '',
        `- **สร้างเมื่อ:** ${new Date().toISOString()} · ข้อมูลวิจัยล่าสุด: ${res.lastResearchAt || '-'}`,
        `- **cost** = อัตรากินโควตา (1.0 = $${researcher.HYDROGEN_REF_OUTPUT_USD_PER_1M.toFixed(2)} / 1M output tokens ของ Gemini 4 Hydrogen)`,
        '- ราคาเท่ากัน → เรียงตามความฉลาดก่อน แล้วตามความมั่นใจ · ⚠️ = ยังไม่ครบ 3 แหล่งอิสระ',
        '',
        `## 🎟️ ซับสคริปชันที่จ่ายไปแล้ว (Claude + Gemini) — ${sub.length} โมเดล`,
        '',
        ...head,
        ...sub.map(row),
        '',
        `## 💳 จ่ายตามการใช้งานจริง (DeepSeek) — นอกการจัดอันดับ — ${ppu.length} โมเดล`,
        '',
        'ต้องจ่ายเป็นเงินจริงต่อการใช้งาน จึงไม่นำ cost มาเทียบกับโควตาซับสคริปชัน',
        '',
        ...head,
        ...ppu.map(row),
        ''
    ];
    fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
    console.log(lines.join('\n'));
}

main();

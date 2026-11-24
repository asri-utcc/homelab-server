#!/usr/bin/env node
'use strict';

/**
 * scripts/eval-models-external.js
 * -----------------------------------------------------------------------------
 * รันระบบ External Multi-Source Model Researcher ประเมินโมเดลทั้งหมดใน
 * ~/.gemini/model-registry.json จากแหล่งข้อมูลภายนอกจริง (OpenRouter, LiteLLM,
 * Models.dev, DuckDuckGo, HackerNews, HuggingFace, Gemini Grounding)
 * แล้วอัปเดต registry พร้อมสร้างรายงาน:
 *   - docs/model-evaluation-report.md
 *   - docs/model-evaluation-report.json
 */

const fs = require('fs');
const path = require('path');

// ชี้ไปยัง live registry จริงของ homelab เสมอ (กันกรณีรันภายใต้โปรไฟล์ย่อยที่ HOME ต่างออกไป)
if (!process.env.MODEL_REGISTRY_FILE && fs.existsSync('/home/dev/.gemini/model-registry.json')) {
    process.env.MODEL_REGISTRY_FILE = '/home/dev/.gemini/model-registry.json';
}
if (!process.env.MODEL_RESEARCH_CACHE_FILE) {
    process.env.MODEL_RESEARCH_CACHE_FILE = '/home/dev/.gemini/model-research-cache.json';
}

const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const REPORT_MD = path.join(DOCS_DIR, 'model-evaluation-report.md');
const REPORT_JSON = path.join(DOCS_DIR, 'model-evaluation-report.json');

const aiRouter = require(path.join(ROOT, 'ai-router'));
const modelRegistry = require(path.join(ROOT, 'model-registry'));
const researcher = require(path.join(ROOT, 'model-researcher'));

function escMd(s) {
    return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function buildMarkdownReport(result, byConfidence, byIntelligence, byValue) {
    const ranked = result.ranked || [];
    const total = ranked.length;
    const met = result.meetsMinSourcesCount || 0;
    const avgConf = (result.summary && result.summary.avgConfidence) ?? 0;

    const lines = [
        '# 🔎 รายงานประเมินและจัดอันดับโมเดล AI จากแหล่งข้อมูลภายนอก (Multi-Source Evaluation)',
        '',
        `- **เวลาประเมิน:** ${result.researchedAt}`,
        `- **จำนวนโมเดลทั้งหมดในระบบ:** ${total} โมเดล`,
        `- **ผ่านเกณฑ์ ≥ ${researcher.MIN_TRUSTED_SOURCES} แหล่งอิสระ:** ${met} / ${total} โมเดล`,
        `- **ความมั่นใจเฉลี่ยรวม:** ${avgConf}%`,
        `- **เกณฑ์ต้นทุนอ้างอิง:** 1.0 cost = $${researcher.HYDROGEN_REF_OUTPUT_USD_PER_1M.toFixed(2)} / 1M output tokens (Hydrogen baseline)`,
        '',
        '## 📐 สูตรคำนวณความมั่นใจแบบโปร่งใส',
        '- ฐานจากจำนวนโดเมนอิสระ (`uniqueDomainCount`): 0 แหล่ง = 25, 1 แหล่ง = 42, 2 แหล่ง = 58, **3 แหล่ง = 76 (ผ่านเกณฑ์ขั้นต่ำ)**, 4 แหล่ง = 84, ≥5 แหล่ง = 90',
        '- โบนัสคุณภาพแหล่ง (`qualityBonus`): +0 ถึง +8 (แคตตาล็อกมีโครงสร้าง/ทางการ เช่น OpenRouter, LiteLLM, Models.dev, HuggingFace ให้คะแนนสูงกว่ากระทู้ทั่วไป)',
        '- ความสอดคล้อง (`agreementDelta`): สอดคล้องสูง (`high`) = +8, ปานกลาง (`medium`) = +2, น้อย (`low`) = -4, ขัดแย้ง (`conflict` เช่น ราคาต่างกัน >2×) = -20',
        '- ความครบถ้วน (`completenessDelta`): มีทั้งข้อมูลบทบาท/ความฉลาดและราคา = +4, มีอย่างใดอย่างหนึ่ง = -4, ขาดทั้งคู่ = -8',
        '- ผลลัพธ์ถูกจำกัดช่วง `[10, 98]` และคำนวณคะแนนรวม `Composite = avgQ × 0.60 + confidence × 0.30 + valueNorm × 0.10`',
        '',
        '## 🏆 ตารางจัดอันดับโมเดลทั้งหมด (เรียงตามคะแนนรวม: ความฉลาด + ความมั่นใจ + ความคุ้มค่า)',
        '',
        '| อันดับ | Model ID | ชื่อโมเดล | Engine | ความมั่นใจ | แหล่งอิสระ | ความสอดคล้อง | ความฉลาด (avgQ / c/a/ch) | ต้นทุน (cost / $/1M out) | คะแนนรวม |',
        '|---:|---|---|---|---:|---:|---|---:|---:|---:|'
    ];

    for (const m of ranked) {
        const effQ = (m.suggested && m.suggested.effectiveQ) || (m.suggested && m.suggested.q) || {};
        const avgQ = (m.scores && m.scores.avgQ) ?? '-';
        const comp = (m.scores && m.scores.compositeScore) ?? '-';
        const effCost = (m.pricing && m.pricing.effectiveCost) ?? (m.suggested && m.suggested.cost) ?? '-';
        const outUsd = (m.pricing && m.pricing.outputUsdPer1M != null) ? `$${m.pricing.outputUsdPer1M}` : 'ไม่มีราคาสาธารณะ';
        const srcBadge = m.meetsMinSources ? `✅ ${m.uniqueDomainCount}` : `⚠️ ${m.uniqueDomainCount}`;
        lines.push(
            `| ${m.rank} | \`${escMd(m.id)}\` | ${escMd(m.name)} | ${escMd(m.engine)} | **${m.confidence}%** | ${srcBadge} | ${escMd(m.agreement)} | ${avgQ} (${effQ.code ?? '-'}/${effQ.analysis ?? '-'}/${effQ.chat ?? '-'}) | ${effCost} (${outUsd}) | **${comp}** |`
        );
    }

    lines.push(
        '',
        '## 📊 มุมมองจัดอันดับเฉพาะด้าน (Top 5)',
        '',
        '### 1. มั่นใจสูงสุด (เรียงตามความมั่นใจ + แหล่งอิสระ ≥3)',
        '| อันดับ | Model ID | ความมั่นใจ | แหล่งอิสระ | ข้อสรุป |',
        '|---:|---|---:|---:|---|'
    );
    for (const m of byConfidence.slice(0, 5)) {
        lines.push(`| ${m.rank} | \`${escMd(m.id)}\` | ${m.confidence}% | ${m.uniqueDomainCount} | ${escMd(m.verdict)} |`);
    }

    lines.push(
        '',
        '### 2. ฉลาดสูงสุด (เรียงตาม avgQ หลังปรับ Effort)',
        '| อันดับ | Model ID | avgQ (c/a/ch) | ต้นทุน (cost) | ความมั่นใจ |',
        '|---:|---|---:|---:|---:|'
    );
    for (const m of byIntelligence.slice(0, 5)) {
        const q = (m.suggested && m.suggested.effectiveQ) || {};
        lines.push(`| ${m.rank} | \`${escMd(m.id)}\` | ${m.scores.avgQ} (${q.code}/${q.analysis}/${q.chat}) | ${m.pricing.effectiveCost} | ${m.confidence}% |`);
    }

    lines.push(
        '',
        '### 3. คุ้มค่าสูงสุด (ความฉลาดต่อต้นทุน: valueScore)',
        '| อันดับ | Model ID | valueScore | avgQ | ต้นทุน (cost) | ความมั่นใจ |',
        '|---:|---|---:|---:|---:|---:|'
    );
    for (const m of byValue.slice(0, 5)) {
        lines.push(`| ${m.rank} | \`${escMd(m.id)}\` | ${m.scores.valueScore} | ${m.scores.avgQ} | ${m.pricing.effectiveCost} | ${m.confidence}% |`);
    }

    // แหล่งอ้างอิงจริงแยกตามตระกูล (ไม่ซ้ำ)
    lines.push('', '## 🌐 แหล่งข้อมูลภายนอกจริงที่ดึงได้ (แยกตามตระกูลโมเดล)', '');
    const seenFamilies = new Set();
    for (const m of ranked) {
        const fk = researcher.familyKeyOf(m.id);
        if (seenFamilies.has(fk)) continue;
        seenFamilies.add(fk);
        lines.push(`### \`${fk}\` — ความมั่นใจ ${m.confidence}% (${m.uniqueDomainCount} แหล่งอิสระ · ${m.verdict})`);
        if (!m.sources || m.sources.length === 0) {
            lines.push('- *ไม่พบแหล่งข้อมูลสาธารณะที่ตรงเวอร์ชัน/โค้ดเนมนี้โดยตรง (อาจเป็นรุ่นใหม่มากหรือโค้ดเนมภายในของ Antigravity)*');
        } else {
            for (const s of m.sources) {
                const priceInfo = s.outputUsdPer1M != null ? ` · ราคา $${s.inputUsdPer1M ?? '?'}/$${s.outputUsdPer1M} per 1M tok` : '';
                lines.push(`- **[${escMd(s.domain)}](${s.url})** (${escMd(s.provider)}/${escMd(s.quality)}): ${escMd(s.title)}${priceInfo}`);
            }
        }
        lines.push('');
    }

    if (result.synthesis && result.synthesis.ok && result.synthesis.summary) {
        lines.push(
            '## 🤖 บทสังเคราะห์จาก Gemini',
            `*(สร้างผ่าน ${result.synthesis.via} / \`${result.synthesis.model}\`)*`,
            '',
            result.synthesis.summary,
            ''
        );
    }

    return lines.join('\n');
}

async function main() {
    if (typeof aiRouter.activeFamilies === 'function') {
        aiRouter.activeFamilies();
    }
    const useGemini = !process.argv.includes('--no-gemini');
    console.log(`[eval-models-external] เริ่มประเมินโมเดลทั้งหมดจากแหล่งภายนอก (useGemini=${useGemini})...`);

    const result = await modelRegistry.researchAll({
        skipCache: true,
        sortBy: 'composite',
        useGemini,
        allowAgyCli: useGemini,
        agyModel: 'gemini-4-hydrogen-low',
        agyTimeoutMs: 40000
    });

    if (!result || !result.ok) {
        console.error('[eval-models-external] ประเมินไม่สำเร็จ:', result);
        process.exit(1);
    }

    const byConfidence = researcher.rankModels(result.ranked, { sortBy: 'confidence' });
    const byIntelligence = researcher.rankModels(result.ranked, { sortBy: 'intelligence' });
    const byValue = researcher.rankModels(result.ranked, { sortBy: 'value' });

    if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

    const jsonPayload = {
        generatedAt: result.researchedAt,
        totalModels: result.researchedCount,
        meetsMinSourcesCount: result.meetsMinSourcesCount,
        summary: result.summary,
        synthesis: result.synthesis || null,
        rankedByComposite: result.ranked,
        top5ByConfidence: byConfidence.slice(0, 5),
        top5ByIntelligence: byIntelligence.slice(0, 5),
        top5ByValue: byValue.slice(0, 5)
    };

    fs.writeFileSync(REPORT_JSON, JSON.stringify(jsonPayload, null, 2) + '\n', 'utf8');
    fs.writeFileSync(REPORT_MD, buildMarkdownReport(result, byConfidence, byIntelligence, byValue), 'utf8');

    console.log(`[eval-models-external] เสร็จสิ้น: ประเมิน ${result.researchedCount} โมเดล | ผ่านเกณฑ์ >=3 แหล่ง: ${result.meetsMinSourcesCount} โมเดล | ความมั่นใจเฉลี่ย: ${result.summary.avgConfidence}%`);
    console.log(`[eval-models-external] Top 5 (Composite):`);
    for (const m of result.ranked.slice(0, 5)) {
        console.log(`  #${m.rank} ${m.id} | conf=${m.confidence}% (${m.uniqueDomainCount} src) | avgQ=${m.scores.avgQ} | cost=${m.pricing.effectiveCost} | comp=${m.scores.compositeScore}`);
    }
    console.log(`[eval-models-external] บันทึกรายงานแล้วที่:\n  - ${REPORT_MD}\n  - ${REPORT_JSON}`);
}

main().catch((err) => {
    console.error('[eval-models-external] Fatal error:', err);
    process.exit(1);
});

# 💰 จัดอันดับโมเดลตามต้นทุน (ถูก → แพง)

- **สร้างเมื่อ:** 2026-11-24T11:55:15.331Z · ข้อมูลวิจัยล่าสุด: 2026-11-24T11:12:31.725Z
- **cost** = อัตรากินโควตา (1.0 = $7.50 / 1M output tokens ของ Gemini 4 Hydrogen)
- ราคาเท่ากัน → เรียงตามความฉลาดก่อน แล้วตามความมั่นใจ · ⚠️ = ยังไม่ครบ 3 แหล่งอิสระ

## 🎟️ ซับสคริปชันที่จ่ายไปแล้ว (Claude + Gemini) — 30 โมเดล

| อันดับ | โมเดล | สถานะ | cost | Output $/1M | ความฉลาด avg (code/ana/chat) | ความมั่นใจ | แหล่ง |
|---:|---|---|---:|---:|---|---:|---:|
| 1 | `gpt-oss-120b-medium` | active | 0.08 | $0.6 | 77.7 (76/78/80) | 82% | 10 |
| 2 | `gemini-3.8-flash-low` | active | 0.3 | $3.75 | 67.7 (64/66/76) | 98% | 11 |
| 3 | `gemini-3.8-flash-medium` | active | 0.5 | $3.75 | 73.2 (70/72/80) | 98% | 11 |
| 4 | `gemini-4-hydrogen-low` | active | 0.6 | $7.5 | 82.1 (81/82/84) | 98% | 10 |
| 5 | `claude-code-haiku` | active | 0.667 | $5 | 69.8 (68/66/78) | 82% | 7 |
| 6 | `gemini-3.8-flash-high` | active | 0.75 | $3.75 | 77 (74/76/83) | 98% | 11 |
| 7 | `gemini-4-carbon-low` | active | 0.8 | $10 | 86 (86/86/86) | 98% | 10 |
| 8 | `claude-sonnet-5-5-low` | active | 0.8 | $10 | 83.2 (84/81/85) | 98% | 8 |
| 9 | `gemini-4-argon-low` | active | 0.8 | $10 | 77.7 (76/78/80) | 98% | 10 |
| 10 | `gemini-4-hydrogen-medium` | active | 1 | $7.5 | 87.6 (87/88/88) | 98% | 10 |
| 11 | `gemini-4-neon-low` | active | 1.2 | $15 | 89.5 (90/90/88) | 98% | 8 |
| 12 | `gemini-4-carbon-medium` | active | 1.333 | $10 | 91.5 (92/92/90) | 98% | 10 |
| 13 | `claude-code-sonnet` | active | 1.333 | $10 | 89.1 (91/87/89) | 98% | 7 |
| 14 | `claude-sonnet-5-5-medium` | active | 1.333 | $10 | 88.7 (90/87/89) | 98% | 8 |
| 15 | `gemini-4-argon-medium` | active | 1.333 | $10 | 83.2 (82/84/84) | 98% | 10 |
| 16 | `gemini-4-hydrogen-high` | active | 1.5 | $7.5 | 91.3 (91/92/91) | 98% | 10 |
| 17 | `claude-opus-5-5-low` | active | 1.6 | $20 | 89 (91/89/86) | 98% | 10 |
| 18 | `gemini-4-carbon-high` | active | 1.999 | $10 | 95.3 (96/96/93) | 98% | 10 |
| 19 | `claude-sonnet-5-5-high` | active | 1.999 | $10 | 92.5 (94/91/92) | 98% | 8 |
| 20 | `gemini-4-argon-high` | active | 1.999 | $10 | 86.9 (86/88/87) | 98% | 10 |
| 21 | `gemini-4-neon-medium` | active | 2 | $15 | 95 (96/96/92) | 98% | 8 |
| 22 | `gemini-4-hydrogen-xhigh` | active | 2.2 | $7.5 | 94.1 (94/95/93) | 98% | 10 |
| 23 | `gemini-pro-orchestrator-neon` | active | 2.4 | - | 96 (98/98/90) | 13% | 0 ⚠️ |
| 24 | `gemini-pro-orchestrator` | active | 2.4 | - | 94.5 (96/96/90) | 13% | 0 ⚠️ |
| 25 | `gemini-pro-orchestrator-argon` | active | 2.4 | - | 89.7 (90/92/86) | 13% | 0 ⚠️ |
| 26 | `claude-opus-5-5-medium` | active | 2.667 | $20 | 94.6 (97/95/90) | 98% | 10 |
| 27 | `gemini-4-neon-high` | active | 3 | $15 | 98.8 (100/100/95) | 98% | 8 |
| 28 | `claude-code-opus` | active | 3.333 | $25 | 95 (98/95/90) | 98% | 8 |
| 29 | `claude-opus-5-5-high` | active | 4 | $20 | 97.9 (100/99/93) | 98% | 10 |
| 30 | `gemini-4-neon-xhigh` | active | 4.4 | $15 | 99.3 (100/100/97) | 98% | 8 |

## 💳 จ่ายตามการใช้งานจริง (DeepSeek) — นอกการจัดอันดับ — 2 โมเดล

ต้องจ่ายเป็นเงินจริงต่อการใช้งาน จึงไม่นำ cost มาเทียบกับโควตาซับสคริปชัน

| อันดับ | โมเดล | สถานะ | cost | Output $/1M | ความฉลาด avg (code/ana/chat) | ความมั่นใจ | แหล่ง |
|---:|---|---|---:|---:|---|---:|---:|
| — | `deepseek-flash` | active | 0.08 | $0.6 | 80 (80/80/80) | 82% | 9 |
| — | `deepseek-v4-pro` | active | 0.341 | $2.56 | 80 (80/80/80) | 98% | 7 |

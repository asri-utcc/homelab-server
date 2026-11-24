# 🔎 รายงานประเมินและจัดอันดับโมเดล AI จากแหล่งข้อมูลภายนอก (Multi-Source Evaluation)

- **เวลาประเมิน:** 2026-11-24T11:12:31.725Z
- **จำนวนโมเดลทั้งหมดในระบบ:** 32 โมเดล
- **ผ่านเกณฑ์ ≥ 3 แหล่งอิสระ:** 29 / 32 โมเดล
- **ความมั่นใจเฉลี่ยรวม:** 88.5%
- **เกณฑ์ต้นทุนอ้างอิง:** 1.0 cost = $7.50 / 1M output tokens (Hydrogen baseline)

## 📐 สูตรคำนวณความมั่นใจแบบโปร่งใส
- ฐานจากจำนวนโดเมนอิสระ (`uniqueDomainCount`): 0 แหล่ง = 25, 1 แหล่ง = 42, 2 แหล่ง = 58, **3 แหล่ง = 76 (ผ่านเกณฑ์ขั้นต่ำ)**, 4 แหล่ง = 84, ≥5 แหล่ง = 90
- โบนัสคุณภาพแหล่ง (`qualityBonus`): +0 ถึง +8 (แคตตาล็อกมีโครงสร้าง/ทางการ เช่น OpenRouter, LiteLLM, Models.dev, HuggingFace ให้คะแนนสูงกว่ากระทู้ทั่วไป)
- ความสอดคล้อง (`agreementDelta`): สอดคล้องสูง (`high`) = +8, ปานกลาง (`medium`) = +2, น้อย (`low`) = -4, ขัดแย้ง (`conflict` เช่น ราคาต่างกัน >2×) = -20
- ความครบถ้วน (`completenessDelta`): มีทั้งข้อมูลบทบาท/ความฉลาดและราคา = +4, มีอย่างใดอย่างหนึ่ง = -4, ขาดทั้งคู่ = -8
- ผลลัพธ์ถูกจำกัดช่วง `[10, 98]` และคำนวณคะแนนรวม `Composite = avgQ × 0.60 + confidence × 0.30 + valueNorm × 0.10`

## 🏆 ตารางจัดอันดับโมเดลทั้งหมด (เรียงตามคะแนนรวม: ความฉลาด + ความมั่นใจ + ความคุ้มค่า)

| อันดับ | Model ID | ชื่อโมเดล | Engine | ความมั่นใจ | แหล่งอิสระ | ความสอดคล้อง | ความฉลาด (avgQ / c/a/ch) | ต้นทุน (cost / $/1M out) | คะแนนรวม |
|---:|---|---|---|---:|---:|---|---:|---:|---:|
| 1 | `gemini-4-neon-high` | Gemini 4 Neon (High) | agy | **98%** | ✅ 8 | high | 98.8 (100/100/95) | 3 ($15) | **90.3** |
| 2 | `gemini-4-neon-xhigh` | Gemini 4 Neon (XHigh) | agy | **98%** | ✅ 8 | high | 99.3 (100/100/97) | 4.4 ($15) | **90.1** |
| 3 | `claude-opus-5-5-high` | Claude Opus 5.5 (High) | agy | **98%** | ✅ 10 | high | 97.9 (100/99/93) | 4 ($20) | **89.4** |
| 4 | `gemini-4-carbon-high` | Gemini 4 Carbon (High) | agy | **98%** | ✅ 10 | high | 95.3 (96/96/93) | 1.999 ($10) | **89** |
| 5 | `gemini-4-neon-medium` | Gemini 4 Neon (Medium) | agy | **98%** | ✅ 8 | high | 95 (96/96/92) | 2 ($15) | **88.8** |
| 6 | `gemini-4-hydrogen-xhigh` | Gemini 4 Hydrogen (XHigh) | agy | **98%** | ✅ 10 | high | 94.1 (94/95/93) | 2.2 ($7.5) | **88** |
| 7 | `claude-opus-5-5-medium` | Claude Opus 5.5 (Medium) | agy | **98%** | ✅ 10 | high | 94.6 (97/95/90) | 2.667 ($20) | **87.9** |
| 8 | `claude-code-opus` | Claude Code · Opus | claude-code | **98%** | ✅ 8 | high | 95 (98/95/90) | 3.333 ($25) | **87.8** |
| 9 | `gemini-4-carbon-medium` | Gemini 4 Carbon (Medium) | agy | **98%** | ✅ 10 | high | 91.5 (92/92/90) | 1.333 ($10) | **87.7** |
| 10 | `deepseek-v4-pro` | DeepSeek V4 Pro | deepseek | **98%** | ✅ 7 | medium | 80 (80/80/80) | 0.341 ($2.56) | **87.4** |
| 11 | `claude-sonnet-5-5-high` | Claude Sonnet 5.5 (High) | agy | **98%** | ✅ 8 | high | 92.5 (94/91/92) | 1.999 ($10) | **87.2** |
| 12 | `gemini-4-hydrogen-high` | Gemini 4 Hydrogen (High) | agy | **98%** | ✅ 10 | high | 91.3 (91/92/91) | 1.5 ($7.5) | **87.2** |
| 13 | `gemini-4-neon-low` | Gemini 4 Neon (Low) | agy | **98%** | ✅ 8 | high | 89.5 (90/90/88) | 1.2 ($15) | **86.8** |
| 14 | `gemini-4-carbon-low` | Gemini 4 Carbon (Low) | agy | **98%** | ✅ 10 | high | 86 (86/86/86) | 0.8 ($10) | **86.4** |
| 15 | `gemini-4-hydrogen-medium` | Gemini 4 Hydrogen (Medium) | agy | **98%** | ✅ 10 | high | 87.6 (87/88/88) | 1 ($7.5) | **86.3** |
| 16 | `claude-code-sonnet` | Claude Code · Sonnet | claude-code | **98%** | ✅ 7 | high | 89.1 (91/87/89) | 1.333 ($10) | **86.2** |
| 17 | `claude-sonnet-5-5-medium` | Claude Sonnet 5.5 (Medium) | agy | **98%** | ✅ 8 | high | 88.7 (90/87/89) | 1.333 ($10) | **85.9** |
| 18 | `claude-opus-5-5-low` | Claude Opus 5.5 (Low) | agy | **98%** | ✅ 10 | high | 89 (91/89/86) | 1.6 ($20) | **85.6** |
| 19 | `gemini-4-hydrogen-low` | Gemini 4 Hydrogen (Low) | agy | **98%** | ✅ 10 | high | 82.1 (81/82/84) | 0.6 ($7.5) | **85.5** |
| 20 | `claude-sonnet-5-5-low` | Claude Sonnet 5.5 (Low) | agy | **98%** | ✅ 8 | high | 83.2 (84/81/85) | 0.8 ($10) | **84.5** |
| 21 | `gemini-4-argon-high` | Gemini 4 Argon (High) | agy | **98%** | ✅ 10 | high | 86.9 (86/88/87) | 1.999 ($10) | **83.7** |
| 22 | `deepseek-flash` | DeepSeek V4.1 Flash | deepseek | **82%** | ✅ 9 | conflict | 80 (80/80/80) | 0.08 ($0.6) | **82.6** |
| 23 | `gemini-4-argon-medium` | Gemini 4 Argon (Medium) | agy | **98%** | ✅ 10 | high | 83.2 (82/84/84) | 1.333 ($10) | **82.4** |
| 24 | `gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | agy | **82%** | ✅ 10 | conflict | 77.7 (76/78/80) | 0.08 ($0.6) | **81.2** |
| 25 | `gemini-4-argon-low` | Gemini 4 Argon (Low) | agy | **98%** | ✅ 10 | high | 77.7 (76/78/80) | 0.8 ($10) | **80.9** |
| 26 | `gemini-3.8-flash-high` | Gemini 3.8 Flash (High) | agy | **98%** | ✅ 11 | high | 77 (74/76/83) | 0.75 ($3.75) | **80.7** |
| 27 | `gemini-3.8-flash-medium` | Gemini 3.8 Flash (Medium) | agy | **98%** | ✅ 11 | high | 73.2 (70/72/80) | 0.5 ($3.75) | **80.6** |
| 28 | `gemini-3.8-flash-low` | Gemini 3.8 Flash (Low) | agy | **98%** | ✅ 11 | high | 67.7 (64/66/76) | 0.3 ($3.75) | **80** |
| 29 | `claude-code-haiku` | Claude Code · Haiku | claude-code | **82%** | ✅ 7 | conflict | 69.8 (68/66/78) | 0.667 ($5) | **71.7** |
| 30 | `gemini-pro-orchestrator-neon` | Orchestrator (Neon) | agy | **13%** | ⚠️ 0 | low | 96 (98/98/90) | 2.4 (ไม่มีราคาสาธารณะ) | **63.5** |
| 31 | `gemini-pro-orchestrator` | Orchestrator (Carbon) | agy | **13%** | ⚠️ 0 | low | 94.5 (96/96/90) | 2.4 (ไม่มีราคาสาธารณะ) | **62.6** |
| 32 | `gemini-pro-orchestrator-argon` | Orchestrator (Argon) | agy | **13%** | ⚠️ 0 | low | 89.7 (90/92/86) | 2.4 (ไม่มีราคาสาธารณะ) | **59.6** |

## 📊 มุมมองจัดอันดับเฉพาะด้าน (Top 5)

### 1. มั่นใจสูงสุด (เรียงตามความมั่นใจ + แหล่งอิสระ ≥3)
| อันดับ | Model ID | ความมั่นใจ | แหล่งอิสระ | ข้อสรุป |
|---:|---|---:|---:|---|
| 1 | `gemini-4-neon-xhigh` | 98% | 8 | น่าเชื่อถือสูง (8 แหล่งอิสระสอดคล้องกัน) |
| 2 | `gemini-4-neon-high` | 98% | 8 | น่าเชื่อถือสูง (8 แหล่งอิสระสอดคล้องกัน) |
| 3 | `claude-opus-5-5-high` | 98% | 10 | น่าเชื่อถือสูง (10 แหล่งอิสระสอดคล้องกัน) |
| 4 | `gemini-4-carbon-high` | 98% | 10 | น่าเชื่อถือสูง (10 แหล่งอิสระสอดคล้องกัน) |
| 5 | `gemini-4-neon-medium` | 98% | 8 | น่าเชื่อถือสูง (8 แหล่งอิสระสอดคล้องกัน) |

### 2. ฉลาดสูงสุด (เรียงตาม avgQ หลังปรับ Effort)
| อันดับ | Model ID | avgQ (c/a/ch) | ต้นทุน (cost) | ความมั่นใจ |
|---:|---|---:|---:|---:|
| 1 | `gemini-4-neon-xhigh` | 99.3 (100/100/97) | 4.4 | 98% |
| 2 | `gemini-4-neon-high` | 98.8 (100/100/95) | 3 | 98% |
| 3 | `claude-opus-5-5-high` | 97.9 (100/99/93) | 4 | 98% |
| 4 | `gemini-pro-orchestrator-neon` | 96 (98/98/90) | 2.4 | 13% |
| 5 | `gemini-4-carbon-high` | 95.3 (96/96/93) | 1.999 | 98% |

### 3. คุ้มค่าสูงสุด (ความฉลาดต่อต้นทุน: valueScore)
| อันดับ | Model ID | valueScore | avgQ | ต้นทุน (cost) | ความมั่นใจ |
|---:|---|---:|---:|---:|---:|
| 1 | `deepseek-flash` | 533.3 | 80 | 0.08 | 82% |
| 2 | `gpt-oss-120b-medium` | 518 | 77.7 | 0.08 | 82% |
| 3 | `deepseek-v4-pro` | 234.6 | 80 | 0.341 | 98% |
| 4 | `gemini-3.8-flash-low` | 225.7 | 67.7 | 0.3 | 98% |
| 5 | `gemini-3.8-flash-medium` | 146.4 | 73.2 | 0.5 | 98% |

## 🌐 แหล่งข้อมูลภายนอกจริงที่ดึงได้ (แยกตามตระกูลโมเดล)

### `gemini-4-neon` — ความมั่นใจ 98% (8 แหล่งอิสระ · น่าเชื่อถือสูง (8 แหล่งอิสระสอดคล้องกัน))
- **[openrouter.ai](https://openrouter.ai/google/gemini-4-neon)** (openrouter/catalog): OpenRouter: Google: Gemini 4 Neon (google/gemini-4-neon) · ราคา $3/$15 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: gemini/gemini-4-neon · ราคา $3/$15 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: Gemini 4 Neon (google/gemini-4-neon) · ราคา $3/$15 per 1M tok
- **[blog.google](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-neon/)** (hackernews/community): Gemini 4 Neon
- **[github.io](https://git-aarvin.github.io/mei/)** (hackernews/community): Gemini 4 Neon is the new #1 on the Models Engineering Index
- **[micjm.com](https://micjm.com/blog/gemini-4-neon-looks-like-a-top-model/)** (hackernews/community): Gemini 4 Neon looks like an Opus 5.5 competitor
- **[google.com](https://aistudio.google.com/docs/models/gemini-4-neon)** (hackernews/official): Gemini 4 Neon
- **[echo.ls](https://echo.ls/zden-level-halv/)** (hackernews/community): Gemini 4 Neon solves Bitcoin puzzle from 2024

### `claude-opus-5-5` — ความมั่นใจ 98% (10 แหล่งอิสระ · น่าเชื่อถือสูง (10 แหล่งอิสระสอดคล้องกัน))
- **[openrouter.ai](https://openrouter.ai/anthropic/claude-opus-5.5)** (openrouter/catalog): OpenRouter: Anthropic: Claude Opus 5.5 (anthropic/claude-opus-5.5) · ราคา $4/$20 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: claude-opus-5-5 · ราคา $4/$20 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: Claude Opus 5.5 (anthropic/claude-opus-5-5) · ราคา $4/$20 per 1M tok
- **[anthropic.com](https://www.anthropic.com/claude-opus-5-5)** (hackernews/official): Claude Opus 5.5
- **[artificialanalysis.ai](https://artificialanalysis.ai/models/claude-opus-5-5)** (hackernews/official): Claude Opus 5.5 Intelligence, Performance and Price Analysis (Max)
- **[claude.com](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)** (hackernews/community): Prompting Claude Opus 5.5
- **[substack.com](https://stephenjgallagher.substack.com/p/ai-can-draw-blueprints-now)** (hackernews/community): Claude Opus 5.5 Can Draw Permit-Level Architectural Drawings
- **[youtube.com](https://www.youtube.com/watch?v=3TNpOD6bov8)** (hackernews/community): LGTM (Looks Good to Me) – Claude Opus 5.5 Music Video
- **[riba2534.cn](https://claude-opus-5-5.riba2534.cn/)** (hackernews/community): Claude Opus 5.5 – Pelican Game
- **[huggingface.co](https://huggingface.co/diablomike20/Claude-Opus-5.5)** (huggingface/catalog): Hugging Face: diablomike20/Claude-Opus-5.5

### `gemini-4-carbon` — ความมั่นใจ 98% (10 แหล่งอิสระ · น่าเชื่อถือสูง (10 แหล่งอิสระสอดคล้องกัน))
- **[openrouter.ai](https://openrouter.ai/google/gemini-4-carbon)** (openrouter/catalog): OpenRouter: Google: Gemini 4 Carbon (google/gemini-4-carbon) · ราคา $2/$10 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: gemini/gemini-4-carbon · ราคา $2/$10 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: Gemini 4 Carbon (google/gemini-4-carbon) · ราคา $2/$10 per 1M tok
- **[blog.google](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-carbon/)** (hackernews/community): Gemini 4 Carbon
- **[artificialanalysis.ai](https://artificialanalysis.ai/articles/gemini-4-carbon-new-number-1)** (hackernews/official): Gemini 4 Carbon is the new #1 on the Artificial Analysis Intelligence Index v5
- **[kernel.dev](https://kernel.dev/blog/why-is-gemini-4-carbon-taking-so-long/)** (hackernews/community): Why is Gemini 4 Carbon taking so long?
- **[twitter.com](https://twitter.com/sundarpichai/status/2120185896469496180)** (hackernews/community): Gemini 4 Carbon is rolling out today
- **[fofr.ai](https://www.fofr.ai/bianco-1466-cipher)** (hackernews/community): Gemini 4 Carbon cracked an unread 1466 Sforza cipher
- **[testingcatalog.com](https://www.testingcatalog.com/gemini-4-carbon-early-test-results/)** (hackernews/community): Gemini 4 Carbon early test results are in ahead of release
- **[huggingface.co](https://huggingface.co/crosbylegal/gemini-4-carbon)** (huggingface/catalog): Hugging Face: crosbylegal/gemini-4-carbon

### `gemini-4-hydrogen` — ความมั่นใจ 98% (10 แหล่งอิสระ · น่าเชื่อถือสูง (10 แหล่งอิสระสอดคล้องกัน))
- **[openrouter.ai](https://openrouter.ai/google/gemini-4-hydrogen)** (openrouter/catalog): OpenRouter: Google: Gemini 4 Hydrogen (google/gemini-4-hydrogen) · ราคา $1.5/$7.5 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: gemini/gemini-4-hydrogen · ราคา $1.5/$7.5 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: Gemini 4 Hydrogen (google/gemini-4-hydrogen) · ราคา $1.5/$7.5 per 1M tok
- **[blog.google](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-hydrogen/)** (hackernews/community): Gemini 4 Hydrogen
- **[antigravity.google](https://antigravity.google/blog/gemini-4-hydrogen-in-google-antigravity/)** (hackernews/community): Gemini 4 Hydrogen and Orchestrator
- **[google.com](https://aistudio.google.com/docs/whats-new-gemini-4-hydrogen)** (hackernews/official): Gemini 4 Hydrogen
- **[deepmind.google](https://deepmind.google/models/model-cards/gemini-4-hydrogen/)** (hackernews/official): Gemini 4 Hydrogen
- **[twitter.com](https://twitter.com/Google/status/2121004369617485896)** (hackernews/community): Gemini 4 Hydrogen paints and animates cells frame by frame inside Google Sheets
- **[zenodo.org](https://zenodo.org/records/24412128)** (hackernews/community): Testing Gemini 4 Hydrogen and Argon vs. Gen 3 over 1,474 Multi-Turn Queries
- **[huggingface.co](https://huggingface.co/crosbylegal/gemini-4-hydrogen)** (huggingface/catalog): Hugging Face: crosbylegal/gemini-4-hydrogen

### `claude-code-opus` — ความมั่นใจ 98% (8 แหล่งอิสระ · น่าเชื่อถือสูง (8 แหล่งอิสระสอดคล้องกัน))
- **[openrouter.ai](https://openrouter.ai/anthropic/claude-opus-5)** (openrouter/catalog): OpenRouter: Anthropic: Claude Opus 5 (anthropic/claude-opus-5) · ราคา $5/$25 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: claude-opus-5 · ราคา $5/$25 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: Claude Opus 5 (anthropic/claude-opus-5) · ราคา $5/$25 per 1M tok
- **[embracethered.com](https://embracethered.com/blog/posts/2026/breaking-claude-code-opus-5-and-automode/)** (hackernews/community): Breaking Claude Code Opus 5 Auto Mode
- **[ycombinator.com](https://news.ycombinator.com/item?id=47814832)** (hackernews/community): Claude Code Opus 4.7 keeps checking on malware
- **[chandlernguyen.com](https://chandlernguyen.com/blog/2026/03/13/codex-gpt-5-4-vs-claude-code-opus-4-6-dual-wielding-ai-coding-tools/)** (hackernews/community): Codex with GPT-5.4 vs. Claude Code with Opus 4.6 – Why I Now Use Both
- **[twitter.com](https://twitter.com/bcherny/status/2015979257038831967)** (hackernews/community): Pretty much 100% of our code is written by Claude Code and Opus 4.5
- **[huggingface.co](https://huggingface.co/DavidAU/Qwen3.6-40B-Claude-4.6-Opus-Deckard-Heretic-Uncensored-Thinking-NEO-CODE-Di-IMatrix-MAX-GGUF)** (huggingface/catalog): Hugging Face: DavidAU/Qwen3.6-40B-Claude-4.6-Opus-Deckard-Heretic-Uncensored-Thinking-NEO-CODE-Di-IMatrix-MAX-GGUF

### `deepseek-v4-pro` — ความมั่นใจ 98% (7 แหล่งอิสระ · น่าเชื่อถือสูง (7 แหล่งอิสระสอดคล้องกัน))
- **[openrouter.ai](https://openrouter.ai/deepseek/deepseek-v4-pro)** (openrouter/catalog): OpenRouter: DeepSeek: DeepSeek V4 Pro 0423 (deepseek/deepseek-v4-pro) · ราคา $1.28/$2.56 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: deepseek-v4-pro · ราคา $1.32/$3.96 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: DeepSeek V4 Pro (deepseek/deepseek-v4-pro) · ราคา $0.66/$1.98 per 1M tok
- **[runtimewire.com](https://runtimewire.com/article/deepseek-v4-pro-beats-gpt-5-5-pro-on-precision)** (hackernews/community): DeepSeek V4 Pro beats GPT-5.5 Pro on precision
- **[deepseek.com](https://api-docs.deepseek.com/quick_start/pricing)** (hackernews/official): DeepSeek V4 Pro at 75% off until 31 May
- **[substack.com](https://howardchen.substack.com/p/deepseek-v4-pro-at-5-the-cost-of)** (hackernews/community): DeepSeek V4 Pro at 5% the cost of Claude – what it takes to close the gap
- **[huggingface.co](https://huggingface.co/mradermacher/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic-GGUF)** (huggingface/catalog): Hugging Face: mradermacher/DeepSeek-V4-Pro-Qwen3.5-9B-UNCENSORED-heretic-GGUF

### `claude-sonnet-5-5` — ความมั่นใจ 98% (8 แหล่งอิสระ · น่าเชื่อถือสูง (8 แหล่งอิสระสอดคล้องกัน))
- **[openrouter.ai](https://openrouter.ai/anthropic/claude-sonnet-5.5)** (openrouter/catalog): OpenRouter: Anthropic: Claude Sonnet 5.5 (anthropic/claude-sonnet-5.5) · ราคา $2/$10 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: claude-sonnet-5-5 · ราคา $2/$10 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: Claude Sonnet 5.5 (anthropic/claude-sonnet-5-5) · ราคา $2/$10 per 1M tok
- **[coderabbit.ai](https://www.coderabbit.ai/blog/sonnet-5-5-model-review)** (hackernews/community): Claude Sonnet 5.5 for code review: More catches than Sonnet 5, in half the time
- **[artificialanalysis.ai](https://artificialanalysis.ai/models/claude-sonnet-5-5)** (hackernews/official): Claude Sonnet 5.5 (Max Effort) Intelligence, Performance and Price Analysis
- **[claude.com](https://status.claude.com/incidents/334jvgbrc4ff)** (hackernews/community): Elevated errors for Claude Sonnet 5.5
- **[fabivo.app](https://www.fabivo.app/en)** (hackernews/community): Show HN: Fabivo – Furniture design from a photo to a numbered cut list
- **[huggingface.co](https://huggingface.co/diablomike20/Claude-Sonnet-5.5)** (huggingface/catalog): Hugging Face: diablomike20/Claude-Sonnet-5.5

### `claude-code-sonnet` — ความมั่นใจ 98% (7 แหล่งอิสระ · น่าเชื่อถือสูง (7 แหล่งอิสระสอดคล้องกัน))
- **[openrouter.ai](https://openrouter.ai/anthropic/claude-sonnet-5)** (openrouter/catalog): OpenRouter: Anthropic: Claude Sonnet 5 (anthropic/claude-sonnet-5) · ราคา $2/$10 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: claude-sonnet-5 · ราคา $2/$10 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: Claude Sonnet 5 (anthropic/claude-sonnet-5) · ราคา $2/$10 per 1M tok
- **[fly.dev](https://benzi.fly.dev/about)** (hackernews/community): Show HN: Try Benzi – A coding harness/agent beating Claude Code itself on Sonnet
- **[airgradient.com](https://www.airgradient.com/cigarettes-equivalent-calculator/)** (hackernews/community): Show HN: How Many Cigarettes You Smoked Being Exposed to Air Pollution
- **[ycombinator.com](https://news.ycombinator.com/item?id=48774742)** (hackernews/community): Ask HN: Is it just me or does Claude / Sonnet 5 sound condescending recently?
- **[huggingface.co](https://huggingface.co/Kirill777Vais/Qwen3-4B-Claude-Sonnet-4-Reasoning-Distill-Heretic-Abliterated-Heretic-Abliterated-i1-GGUF)** (huggingface/catalog): Hugging Face: Kirill777Vais/Qwen3-4B-Claude-Sonnet-4-Reasoning-Distill-Heretic-Abliterated-Heretic-Abliterated-i1-GGUF

### `gemini-4-argon` — ความมั่นใจ 98% (10 แหล่งอิสระ · น่าเชื่อถือสูง (10 แหล่งอิสระสอดคล้องกัน))
- **[openrouter.ai](https://openrouter.ai/google/gemini-4-argon)** (openrouter/catalog): OpenRouter: Google: Gemini 4 Argon (google/gemini-4-argon) · ราคา $2/$10 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: gemini/gemini-4-argon · ราคา $2/$10 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: Gemini 4 Argon (google/gemini-4-argon) · ราคา $2/$10 per 1M tok
- **[blog.google](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/)** (hackernews/community): Gemini 4 Argon
- **[deepmind.google](https://deepmind.google/models/gemini/)** (hackernews/official): Gemini 4 Argon
- **[starskirmish.com](https://starskirmish.com/bench/v0-2/)** (hackernews/community): Show HN: Gemini 4 Argon plays StarCraft
- **[googleblog.com](https://developers.googleblog.com/gemini-4-argon-for-robotics/)** (hackernews/community): Gemini 4 Argon for Robotics
- **[artificialanalysis.ai](https://artificialanalysis.ai/models/gemini-4-argon)** (hackernews/official): Gemini 4 Argon (High): Intelligence, Performance and Price Analysis
- **[twitter.com](https://twitter.com/OfficialLoganK/status/2105388054274080946)** (hackernews/community): Gemini 4 Argon
- **[huggingface.co](https://huggingface.co/crosbylegal/gemini-4-argon)** (huggingface/catalog): Hugging Face: crosbylegal/gemini-4-argon

### `deepseek-flash` — ความมั่นใจ 82% (9 แหล่งอิสระ · ข้อมูลจากแหล่งภายนอกขัดแย้งกัน — ควรตรวจสอบด้วยตนเอง)
- **[openrouter.ai](https://openrouter.ai/deepseek/deepseek-v4.1-flash)** (openrouter/catalog): OpenRouter: DeepSeek: DeepSeek V4.1 Flash (deepseek/deepseek-v4.1-flash) · ราคา $0.14/$0.42 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: vertex_ai/deepseek-ai/deepseek-v4.1-flash-maas · ราคา $0.3/$1.2 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: DeepSeek V4.1 Flash 1017 (deepseek/deepseek-flash) · ราคา $0.15/$0.6 per 1M tok
- **[twitter.com](https://twitter.com/deepseek_ai/status/2097930608790167907)** (hackernews/community): DeepSeek v4.1 Flash
- **[huggingface.co](https://huggingface.co/ISTA-DASLab/DeepSeek-V4.1-Flash-1017-GSQ-RCO-GGUF)** (huggingface/catalog): Hugging Face: ISTA-DASLab/DeepSeek-V4.1-Flash-1017-GSQ-RCO-GGUF
- **[ycombinator.com](https://news.ycombinator.com/item?id=49624603)** (hackernews/community): DeepSeek launching v4.1 flash cheaper and more capable than v4 pro
- **[artificialanalysis.ai](https://artificialanalysis.ai/models/deepseek-v4-1-flash-1017)** (hackernews/official): DeepSeek V4.1 Flash 1017 (Max)
- **[enclave.ai](https://enclave.ai/blog/deepseek-v41-flash-is-now-our-best-hacking-model)** (hackernews/community): DeepSeek v4.1 Flash Is Now Our Best Hacking Model
- **[github.io](https://zartbot.github.io/blog/model_arch/dsv41flash_arch/en.html)** (hackernews/community): DeepSeek-v4.1 Flash: Pushing the Limits of KV Cache Compression

### `gpt-oss-120b` — ความมั่นใจ 82% (10 แหล่งอิสระ · ข้อมูลจากแหล่งภายนอกขัดแย้งกัน — ควรตรวจสอบด้วยตนเอง)
- **[openrouter.ai](https://openrouter.ai/openai/gpt-oss-120b)** (openrouter/catalog): OpenRouter: OpenAI: gpt-oss-120b (openai/gpt-oss-120b) · ราคา $0.05/$0.25 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: openai.gpt-oss-120b-1:0 · ราคา $0.15/$0.6 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: GPT OSS 120B (greenpt/gpt-oss-120b) · ราคา $0.228/$0.798 per 1M tok
- **[reddit.com](https://old.reddit.com/r/LocalLLaMA/comments/1mke7ef/120b_runs_awesome_on_just_8gb_vram/)** (hackernews/community): GPT-OSS-120B runs on just 8GB VRAM & 64GB+ system RAM
- **[baseten.co](https://www.baseten.co/blog/sota-performance-for-gpt-oss-120b-on-nvidia-gpus/)** (hackernews/community): Running GPT-OSS-120B at 500 tokens per second on Nvidia GPUs
- **[cerebras.ai](https://www.cerebras.ai/blog/openai-gpt-oss-120b-runs-fastest-on-cerebras)** (hackernews/community): GPT-OSS 120B Runs at 3000 tokens/sec on Cerebras
- **[ycombinator.com](https://news.ycombinator.com/item?id=46971287)** (hackernews/community): Show HN: I taught GPT-OSS-120B to see using Google Lens and OpenCV
- **[furiosa.ai](https://furiosa.ai/blog/serving-gpt-oss-120b-at-5-8-ms-tpot-with-two-rngd-cards-compiler-optimizations-in-practice)** (hackernews/community): Compiler optimizations for 5.8ms GPT-OSS-120B inference (not on GPUs)
- **[huggingface.co](https://huggingface.co/openai/gpt-oss-120b)** (huggingface/catalog): Hugging Face: openai/gpt-oss-120b
- **[simonwillison.net](https://til.simonwillison.net/llms/codex-spark-gpt-oss)** (hackernews/community): Using Codex CLI with GPT-OSS:120B on an Nvidia DGX Spark via Tailscale

### `gemini-3.8-flash` — ความมั่นใจ 98% (11 แหล่งอิสระ · น่าเชื่อถือสูง (11 แหล่งอิสระสอดคล้องกัน))
- **[openrouter.ai](https://openrouter.ai/google/gemini-3.8-flash)** (openrouter/catalog): OpenRouter: Google: Gemini 3.8 Flash (google/gemini-3.8-flash) · ราคา $0.825/$4.125 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: gemini-3.8-flash · ราคา $0.75/$3.75 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: Gemini 3.8 Flash (google/gemini-3.8-flash) · ราคา $0.75/$3.75 per 1M tok
- **[blog.google](https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/)** (hackernews/community): Gemini 3.8 Flash and 3.8 Flash Cyber
- **[ycombinator.com](https://news.ycombinator.com/item?id=49539315)** (hackernews/community): Kimi K3 and GLM-5.3 are better than Gemini 3.8 Flash
- **[googleapis.com](https://storage.googleapis.com/deepmind-media/Model-Cards/Gemini-3-8-Flash-Model-Card.pdf)** (hackernews/community): Gemini 3.8 Flash Model card [pdf]
- **[reddit.com](https://www.reddit.com/r/GeminiAI/comments/1w5c4dd/38_flash_released_in_webui)** (hackernews/community): Gemini 3.8 Flash appears to be rolling out now
- **[deepmind.google](https://deepmind.google/models/model-cards/gemini-3-8-flash/)** (hackernews/official): Gemini 3.8 Flash
- **[google.dev](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)** (hackernews/official): Gemini 3.8 Flash
- **[google.com](https://aistudio.google.com/docs/voice-remixing)** (hackernews/official): Voice remixing in Gemini 3.8 Flash TTS
- **[huggingface.co](https://huggingface.co/Null-Guard/LFM2.5-230M-distilled-Gemini-3.8-Flash-Uncensored)** (huggingface/catalog): Hugging Face: Null-Guard/LFM2.5-230M-distilled-Gemini-3.8-Flash-Uncensored

### `claude-code-haiku` — ความมั่นใจ 82% (7 แหล่งอิสระ · ข้อมูลจากแหล่งภายนอกขัดแย้งกัน — ควรตรวจสอบด้วยตนเอง)
- **[openrouter.ai](https://openrouter.ai/anthropic/claude-haiku-5.5)** (openrouter/catalog): OpenRouter: Anthropic: Claude Haiku 5.5 (anthropic/claude-haiku-5.5) · ราคา $0.1/$0.5 per 1M tok
- **[github.com](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)** (litellm/catalog): LiteLLM Model Registry: claude-haiku-4-5 · ราคา $1/$5 per 1M tok
- **[models.dev](https://models.dev/)** (modelsdev/catalog): Models.dev: Claude Haiku 4.5 (latest) (anthropic/claude-haiku-4-5) · ราคา $1/$5 per 1M tok
- **[waldin.net](https://tim.waldin.net/blog%20latest)** (hackernews/community): GEPA prompt optimization: Claude Code Haiku +20% solve rate on new bugs
- **[codelens.ai](https://codelens.ai/blog/claude-haiku-vs-sonnet-overengineering)** (hackernews/community): More Code ≠ Better Code: Claude Haiku 4.5 Wrote 62% More but Scored 16% Lower
- **[ycombinator.com](https://news.ycombinator.com/item?id=49996711)** (hackernews/community): Claude Haiku 5.5
- **[huggingface.co](https://huggingface.co/mradermacher/Claude-Haiku-5.5-Qwen-5B-Thinking-Safetensors-GGUF)** (huggingface/catalog): Hugging Face: mradermacher/Claude-Haiku-5.5-Qwen-5B-Thinking-Safetensors-GGUF

### `gemini-pro-orchestrator-neon` — ความมั่นใจ 13% (0 แหล่งอิสระ · ไม่พบข้อมูลสาธารณะภายนอก (รุ่นใหม่/โค้ดเนมภายใน))
- *ไม่พบแหล่งข้อมูลสาธารณะที่ตรงเวอร์ชัน/โค้ดเนมนี้โดยตรง (อาจเป็นรุ่นใหม่มากหรือโค้ดเนมภายในของ Antigravity)*

### `gemini-pro-orchestrator` — ความมั่นใจ 13% (0 แหล่งอิสระ · ไม่พบข้อมูลสาธารณะภายนอก (รุ่นใหม่/โค้ดเนมภายใน))
- *ไม่พบแหล่งข้อมูลสาธารณะที่ตรงเวอร์ชัน/โค้ดเนมนี้โดยตรง (อาจเป็นรุ่นใหม่มากหรือโค้ดเนมภายในของ Antigravity)*

### `gemini-pro-orchestrator-argon` — ความมั่นใจ 13% (0 แหล่งอิสระ · ไม่พบข้อมูลสาธารณะภายนอก (รุ่นใหม่/โค้ดเนมภายใน))
- *ไม่พบแหล่งข้อมูลสาธารณะที่ตรงเวอร์ชัน/โค้ดเนมนี้โดยตรง (อาจเป็นรุ่นใหม่มากหรือโค้ดเนมภายในของ Antigravity)*

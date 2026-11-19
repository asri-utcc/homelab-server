'use strict';

/**
 * deepseek-agent.js
 * -----------------------------------------------------------------------------
 * Full-featured DeepSeek API Agent with Streaming, Vision (deepseek-flash),
 * and Tool Calling (exec mode) for Homelab AI Assistant (lab-dashboard).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const HOME_DIR = os.homedir();
const AGENTS_MD_PATH = '/home/dev/projects/AGENTS.md';
const MEMORY_MD_PATH = path.join(HOME_DIR, '.gemini', 'MEMORY.md');

const DEEPSEEK_MODELS = [
    { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash-1017' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro-0813' }
];

const VISION_MODELS = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']);

// Max thinking/tool rounds per DeepSeek request (default 20, override via DEEPSEEK_MAX_STEPS)
const DEEPSEEK_MAX_STEPS = (() => {
    const raw = Number(process.env.DEEPSEEK_MAX_STEPS);
    if (Number.isFinite(raw) && raw > 0) return Math.min(Math.floor(raw), 100);
    return 20;
})();

const MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
};

function isDeepSeekModel(model) {
    return typeof model === 'string' && model.trim().toLowerCase().startsWith('deepseek-');
}

function supportsVision(model) {
    return VISION_MODELS.has((model || '').trim().toLowerCase());
}

function getApiKey() {
    return (process.env.DEEPSEEK_API_KEY || '').trim();
}

function truncateText(str, maxLen = 16000) {
    if (!str || str.length <= maxLen) return str || '';
    const half = Math.floor(maxLen / 2) - 40;
    return `${str.slice(0, half)}\n\n... [truncated ${str.length - maxLen} chars] ...\n\n${str.slice(-half)}`;
}

function resolveToolPath(targetPath, cwd) {
    if (!targetPath || targetPath === '.') return cwd;
    return path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
}

function buildSystemPrompt(cwd, mode) {
    const parts = [
        'You are Antigravity AI (powered by DeepSeek) running on the user\'s Homelab Debian Linux server.',
        `Current Working Directory: ${cwd}`,
        `Execution Mode: ${mode}`,
        `Current Time: ${new Date().toISOString()}`
    ];

    if (mode === 'exec') {
        parts.push(
            'You have full tool access (run_command, read_file, write_file, edit_file, list_dir, search_files) to inspect and operate on the server.',
            'Always verify facts using tools before reporting file contents, service statuses, or command outputs. Keep responses concise and in the user\'s language (usually Thai).',
            'When AGENTS.md defines a protocol/CLI tool for a request (e.g. get-energy.py for electricity), run it and report its output directly. Do NOT read, audit, or modify that tool unless the user explicitly asks. Always finish with a written answer to the user.'
        );
    } else {
        parts.push(
            'You are currently in advisory/chat mode (no command execution or file modification tools are enabled). Answer questions clearly and concisely in the user\'s language.'
        );
    }

    try {
        if (fs.existsSync(AGENTS_MD_PATH)) {
            const agentsMd = fs.readFileSync(AGENTS_MD_PATH, 'utf8').trim();
            if (agentsMd) parts.push(`\n--- Homelab Context (AGENTS.md) ---\n${truncateText(agentsMd, 6000)}`);
        }
    } catch (_) {}

    try {
        if (fs.existsSync(MEMORY_MD_PATH)) {
            const memMd = fs.readFileSync(MEMORY_MD_PATH, 'utf8').trim();
            if (memMd) parts.push(`\n--- Long-Term Memory (MEMORY.md) ---\n${truncateText(memMd, 4000)}`);
        }
    } catch (_) {}

    return parts.join('\n');
}

function encodeImageToDataUrl(imgPath) {
    if (!imgPath || !fs.existsSync(imgPath)) return null;
    const ext = path.extname(imgPath).toLowerCase();
    const mime = MIME_BY_EXT[ext] || 'image/png';
    const stat = fs.statSync(imgPath);
    if (stat.size > 15 * 1024 * 1024) return null; // Skip >15MB
    const b64 = fs.readFileSync(imgPath).toString('base64');
    return `data:${mime};base64,${b64}`;
}

function buildUserMessageContent(text, imagePaths, allowVision, onWarn) {
    if (!imagePaths || imagePaths.length === 0) return text;
    if (!allowVision) {
        if (onWarn) {
            onWarn('⚠️ โมเดลนี้รองรับเฉพาะข้อความ (ไม่รองรับรูปภาพ) — ระบบข้ามไฟล์รูปภาพให้แล้ว หากต้องการวิเคราะห์รูปแนะนำให้เลือก DeepSeek V4.1 Flash (Vision)\n');
        }
        return text;
    }

    const blocks = [];
    for (const p of imagePaths) {
        const dataUrl = encodeImageToDataUrl(p);
        if (dataUrl) {
            blocks.push({ type: 'image_url', image_url: { url: dataUrl } });
        }
    }
    blocks.push({ type: 'text', text: text || 'อธิบายรูปภาพนี้' });
    return blocks;
}

function buildConversationMessages({ history, currentPrompt, currentImagePaths, model, cwd, mode, onWarn }) {
    const allowVision = supportsVision(model);
    const messages = [{ role: 'system', content: buildSystemPrompt(cwd, mode) }];

    // Exclude the trailing user message if it matches currentPrompt (already pre-saved by executePrompt)
    const hist = Array.isArray(history) ? [...history] : [];
    if (hist.length > 0 && hist[hist.length - 1].role === 'user' && hist[hist.length - 1].content === currentPrompt) {
        hist.pop();
    }

    // Keep recent 24 turns to stay fast and cost-effective; merge consecutive same-role messages
    const recent = hist.slice(-24);
    for (let i = 0; i < recent.length; i++) {
        const m = recent[i];
        if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
        if (!text.trim()) continue;
        const clipped = truncateText(text, 8000);
        const prev = messages[messages.length - 1];
        if (prev && prev.role === m.role && typeof prev.content === 'string') {
            prev.content += '\n\n' + clipped;
        } else {
            messages.push({ role: m.role, content: clipped });
        }
    }

    const curContent = buildUserMessageContent(currentPrompt, currentImagePaths, allowVision, onWarn);
    const prevLast = messages[messages.length - 1];
    if (prevLast && prevLast.role === 'user' && typeof prevLast.content === 'string' && typeof curContent === 'string') {
        prevLast.content += '\n\n' + curContent;
    } else {
        messages.push({ role: 'user', content: curContent });
    }

    return messages;
}

const EXEC_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'run_command',
            description: 'Execute a bash shell command on the Linux homelab server in the working directory.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The bash command to run.' },
                    timeout_sec: { type: 'integer', description: 'Optional timeout in seconds (default 60, max 300).' }
                },
                required: ['command']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read a text file from the filesystem with optional line range.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative file path.' },
                    start_line: { type: 'integer', description: '1-based start line (optional).' },
                    end_line: { type: 'integer', description: '1-based inclusive end line (optional).' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Create or overwrite a file with the given content.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative file path.' },
                    content: { type: 'string', description: 'Full file content to write.' }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'edit_file',
            description: 'Replace an exact target string in an existing file with replacement text.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative file path.' },
                    target: { type: 'string', description: 'Exact existing text to replace.' },
                    replacement: { type: 'string', description: 'Replacement text.' }
                },
                required: ['path', 'target', 'replacement']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_dir',
            description: 'List files and subdirectories in a directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path (defaults to current working directory).' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for a text or regex pattern across files using grep.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Search pattern.' },
                    path: { type: 'string', description: 'Directory or file to search (defaults to current working directory).' }
                },
                required: ['pattern']
            }
        }
    }
];

function runShellTool(command, cwd, timeoutSec, abortSignal, activeChildren) {
    return new Promise((resolve) => {
        const ms = Math.min(Math.max((Number(timeoutSec) || 60) * 1000, 1000), 300000);
        const child = spawn('bash', ['-lc', command], {
            cwd,
            env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '0' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        activeChildren.add(child);

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            try { child.kill('SIGTERM'); } catch (_) {}
            setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 1500);
        }, ms);

        const onAbort = () => {
            try { child.kill('SIGTERM'); } catch (_) {}
        };
        if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });

        child.stdout.on('data', (d) => {
            if (stdout.length < 64000) stdout += d.toString('utf8');
        });
        child.stderr.on('data', (d) => {
            if (stderr.length < 32000) stderr += d.toString('utf8');
        });

        child.on('error', (err) => {
            clearTimeout(timer);
            activeChildren.delete(child);
            if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
            resolve(`Command error: ${err.message}`);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            activeChildren.delete(child);
            if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
            let out = `Exit code: ${code}${timedOut ? ' (TIMED OUT)' : ''}\n`;
            if (stdout.trim()) out += `STDOUT:\n${truncateText(stdout.trim(), 12000)}\n`;
            if (stderr.trim()) out += `STDERR:\n${truncateText(stderr.trim(), 4000)}\n`;
            resolve(out.trim());
        });
    });
}

// Commands that would restart/stop lab-dashboard itself. The DeepSeek job lives inside
// this process, so running them mid-job kills the reply before the answer is written.
const SELF_RESTART_RE = /\bpm2\s+(?:restart|reload|stop|delete|start|startOrRestart|startOrReload)\b[^;&|\n]*(?:lab-dashboard|ecosystem\.config|\ball\b|(?:^|\s)0(?:\s|$))|\bpm2\s+(?:kill|resurrect)\b/;

function isSelfRestartCommand(cmd) {
    return SELF_RESTART_RE.test(String(cmd || ''));
}

function runDeferredCommands(commands, cwd) {
    if (!commands.length) return;
    const script = `sleep 4; ${commands.join('; ')}`;
    try {
        const child = spawn('bash', ['-c', script], { cwd, detached: true, stdio: 'ignore' });
        child.unref();
    } catch (_) {}
}

async function executeToolCall(name, argsObj, cwd, abortSignal, activeChildren, deferredCommands) {
    try {
        switch (name) {
            case 'run_command':
                if (deferredCommands && isSelfRestartCommand(argsObj.command)) {
                    deferredCommands.push(argsObj.command);
                    return 'Deferred: this command restarts lab-dashboard (the process running this conversation). ' +
                        'It was NOT run now; it will run automatically ~4s after your final answer is delivered. ' +
                        'Do not try to run it again. Finish your answer and tell the user the service will restart right after.';
                }
                return await runShellTool(argsObj.command || '', cwd, argsObj.timeout_sec, abortSignal, activeChildren);

            case 'read_file': {
                const p = resolveToolPath(argsObj.path, cwd);
                if (!fs.existsSync(p)) return `Error: File not found: ${p}`;
                const stat = await fsp.stat(p);
                if (stat.isDirectory()) return `Error: ${p} is a directory, use list_dir instead.`;
                const raw = await fsp.readFile(p, 'utf8');
                const lines = raw.split('\n');
                const start = Math.max(1, Number(argsObj.start_line) || 1);
                const end = Math.min(lines.length, Number(argsObj.end_line) || Math.min(lines.length, start + 299));
                const slice = lines.slice(start - 1, end).map((l, idx) => `${start + idx}: ${l}`).join('\n');
                return `File: ${p} (lines ${start}-${end} of ${lines.length})\n${truncateText(slice, 14000)}`;
            }

            case 'write_file': {
                const p = resolveToolPath(argsObj.path, cwd);
                await fsp.mkdir(path.dirname(p), { recursive: true });
                await fsp.writeFile(p, String(argsObj.content ?? ''), 'utf8');
                return `Successfully wrote ${p} (${Buffer.byteLength(String(argsObj.content ?? ''), 'utf8')} bytes)`;
            }

            case 'edit_file': {
                const p = resolveToolPath(argsObj.path, cwd);
                if (!fs.existsSync(p)) return `Error: File not found: ${p}`;
                const raw = await fsp.readFile(p, 'utf8');
                const target = String(argsObj.target ?? '');
                if (!target || !raw.includes(target)) {
                    return `Error: Target string not found in ${p}`;
                }
                const updated = raw.split(target).join(String(argsObj.replacement ?? ''));
                await fsp.writeFile(p, updated, 'utf8');
                return `Successfully edited ${p}`;
            }

            case 'list_dir': {
                const p = resolveToolPath(argsObj.path || '.', cwd);
                if (!fs.existsSync(p)) return `Error: Directory not found: ${p}`;
                const entries = await fsp.readdir(p, { withFileTypes: true });
                const formatted = entries
                    .slice(0, 200)
                    .map((e) => `${e.isDirectory() ? '[DIR] ' : '      '}${e.name}`)
                    .join('\n');
                return `Directory: ${p} (${entries.length} entries)\n${formatted}`;
            }

            case 'search_files': {
                const p = resolveToolPath(argsObj.path || '.', cwd);
                const pattern = String(argsObj.pattern || '').replace(/'/g, `'\\''`);
                const cmd = `grep -rnI --exclude-dir=node_modules --exclude-dir=.git -- '${pattern}' '${p}' | head -n 80`;
                return await runShellTool(cmd, cwd, 20, abortSignal, activeChildren);
            }

            default:
                return `Error: Unknown tool "${name}"`;
        }
    } catch (err) {
        return `Tool execution error (${name}): ${err.message}`;
    }
}

async function streamDeepSeekTurn({ apiKey, model, messages, tools, signal, onContentDelta, onReasoningDelta }) {
    const body = {
        model,
        messages,
        stream: true
    };
    if (tools && tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
    }

    const combinedSignal = AbortSignal.any
        ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
        : signal;

    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: combinedSignal
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let msg = `DeepSeek API HTTP ${res.status}`;
        try {
            const parsed = JSON.parse(errText);
            if (parsed.error && parsed.error.message) msg += `: ${parsed.error.message}`;
            else if (errText) msg += `: ${errText.slice(0, 300)}`;
        } catch (_) {
            if (errText) msg += `: ${errText.slice(0, 300)}`;
        }
        throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let content = '';
    let reasoning = '';
    const toolCallsMap = new Map();
    let finishReason = null;

    const processLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;

        let json;
        try {
            json = JSON.parse(payload);
        } catch (_) {
            return;
        }

        const choice = json.choices && json.choices[0];
        if (!choice) return;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta || {};
        if (delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            if (onReasoningDelta) onReasoningDelta(delta.reasoning_content, reasoning);
        }
        if (delta.content) {
            content += delta.content;
            if (onContentDelta) onContentDelta(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsMap.has(idx)) {
                    toolCallsMap.set(idx, {
                        id: tc.id || `call_${Date.now()}_${idx}`,
                        type: 'function',
                        function: { name: '', arguments: '' }
                    });
                }
                const entry = toolCallsMap.get(idx);
                if (tc.id) entry.id = tc.id;
                if (tc.function) {
                    if (tc.function.name) entry.function.name += tc.function.name;
                    if (tc.function.arguments) entry.function.arguments += tc.function.arguments;
                }
            }
        }
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) processLine(line);
    }
    if (buffer.trim()) processLine(buffer);

    const toolCalls = [...toolCallsMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v);

    return { content, reasoning, toolCalls, finishReason };
}

function summarizeToolAction(name, argsObj) {
    if (name === 'run_command') return `⚙️ run_command: ${(argsObj.command || '').slice(0, 70)}`;
    if (name === 'read_file') return `📖 read_file: ${argsObj.path || ''}`;
    if (name === 'write_file') return `📝 write_file: ${argsObj.path || ''}`;
    if (name === 'edit_file') return `✏️ edit_file: ${argsObj.path || ''}`;
    if (name === 'list_dir') return `📁 list_dir: ${argsObj.path || '.'}`;
    if (name === 'search_files') return `🔍 search_files: ${argsObj.pattern || ''}`;
    return `🔧 ${name}`;
}

function runDeepSeekPrompt({ job, prompt, imagePaths = [], mode = 'exec', cwd, model, history = [], onChunk, onDone }) {
    const apiKey = getApiKey();
    const controller = new AbortController();
    const activeChildren = new Set();

    const abort = () => {
        if (job.status === 'running') {
            job.status = 'aborted';
            job.finishedAt = Date.now();
        }
        try { controller.abort(); } catch (_) {}
        for (const child of activeChildren) {
            try { child.kill('SIGTERM'); } catch (_) {}
        }
    };

    (async () => {
        try {
            if (!apiKey) {
                throw new Error('ยังไม่ได้ตั้งค่า DEEPSEEK_API_KEY ใน ~/.gemini/.env');
            }

            const messages = buildConversationMessages({
                history,
                currentPrompt: prompt,
                currentImagePaths: imagePaths,
                model,
                cwd,
                mode,
                onWarn: (msg) => onChunk('stderr', msg)
            });

            const tools = mode === 'exec' ? EXEC_TOOLS : [];
            const maxIterations = DEEPSEEK_MAX_STEPS;
            const steps = [];
            const timeline = [];
            const pushEvent = (kind, text) => {
                const clean = String(text || '').trim();
                if (!clean) return;
                timeline.push({ kind, text: clean, ts: Date.now() });
                if (timeline.length > 120) timeline.shift();
            };
            pushEvent('init', `deepseek --model=${model} --mode=${mode} --max-steps=${maxIterations}`);
            let accumulatedThinking = '';
            let lastThoughtEmitAt = 0;

            const emitThought = (currentAction, thinkingText, force = false) => {
                const stepList = steps.length
                    ? 'ขั้นตอนที่ทำในรอบนี้:\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
                    : '';
                const text = thinkingText || stepList;
                const payload = {
                    currentAction: currentAction || 'กำลังคิดวิเคราะห์ (DeepSeek)...',
                    thinking: text,
                    steps: [...steps],
                    stepsCount: steps.length,
                    timeline: [...timeline],
                    engine: 'deepseek'
                };
                job.liveThought = payload;
                const now = Date.now();
                if (force || now - lastThoughtEmitAt >= 100) {
                    lastThoughtEmitAt = now;
                    try { onChunk('thought', payload); } catch (_) {}
                }
            };

            let completedWithText = false;
            let emptyRetries = 0;
            const deferredCommands = [];
            for (let step = 0; step < maxIterations; step++) {
                if (controller.signal.aborted) break;

                let contentStartedInStep = false;
                let currentStepReasoning = '';
                const buildCombinedThinking = () => {
                    const combined = currentStepReasoning
                        ? (accumulatedThinking ? `${accumulatedThinking}\n\n---\n${currentStepReasoning}` : currentStepReasoning)
                        : accumulatedThinking;
                    return combined.slice(-3000);
                };
                const stepAction = step === 0 ? 'กำลังคิดคำตอบ (DeepSeek)...' : `กำลังวิเคราะห์ผลลัพธ์รอบที่ ${step + 1}...`;
                pushEvent('status', stepAction);
                emitThought(stepAction, accumulatedThinking, true);

                const turn = await streamDeepSeekTurn({
                    apiKey,
                    model,
                    messages,
                    tools,
                    signal: controller.signal,
                    onReasoningDelta: (_delta, fullReasoning) => {
                        currentStepReasoning = fullReasoning;
                        emitThought('กำลังคิดวิเคราะห์ (DeepSeek)...', buildCombinedThinking());
                    },
                    onContentDelta: (delta) => {
                        if (!contentStartedInStep) {
                            contentStartedInStep = true;
                            if (currentStepReasoning.trim()) {
                                pushEvent('think', currentStepReasoning.trim().slice(-1200));
                            }
                            pushEvent('status', 'กำลังเรียบเรียงคำตอบ (DeepSeek)...');
                            emitThought('กำลังเรียบเรียงคำตอบ (DeepSeek)...', buildCombinedThinking(), true);
                        }
                        job.output += delta;
                        onChunk('stdout', delta);
                    }
                });

                if (turn.reasoning && !contentStartedInStep) {
                    pushEvent('think', turn.reasoning.trim().slice(-1200));
                }
                if (turn.reasoning) {
                    accumulatedThinking = (accumulatedThinking
                        ? `${accumulatedThinking}\n\n---\n${turn.reasoning}`
                        : turn.reasoning).slice(-3000);
                }

                if (turn.toolCalls.length === 0) {
                    if (turn.content.trim() || emptyRetries >= 2) {
                        completedWithText = Boolean(turn.content.trim()) || Boolean(job.output.trim());
                        break;
                    }
                    // Model ended with reasoning only (no visible answer) — nudge it to write the final answer
                    emptyRetries++;
                    pushEvent('status', `ไม่ได้รับข้อความคำตอบ (finish_reason=${turn.finishReason || 'unknown'}) — ขอให้สรุปคำตอบอีกครั้ง...`);
                    messages.push({
                        role: 'user',
                        content: 'คุณยังไม่ได้เขียนคำตอบให้ผู้ใช้ กรุณาสรุปผลลัพธ์จากเครื่องมือที่รันไปแล้วเป็นคำตอบสุดท้ายถึงผู้ใช้ทันที (ภาษาไทย กระชับ)'
                    });
                    continue;
                }

                // Append assistant message with tool_calls (preserve reasoning_content if present)
                const assistantMsg = {
                    role: 'assistant',
                    content: turn.content || null,
                    tool_calls: turn.toolCalls
                };
                if (turn.reasoning) {
                    assistantMsg.reasoning_content = turn.reasoning;
                }
                messages.push(assistantMsg);

                // Execute each tool call and append results
                for (const tc of turn.toolCalls) {
                    if (controller.signal.aborted) break;
                    let argsObj = {};
                    try {
                        argsObj = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                    } catch (_) {}

                    const summary = summarizeToolAction(tc.function.name, argsObj);
                    steps.push(summary);
                    pushEvent('tool', summary);
                    const stepList = 'ขั้นตอนที่ทำในรอบนี้:\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
                    const thinkingView = accumulatedThinking
                        ? `${accumulatedThinking}\n\n${stepList}`.slice(-3000)
                        : stepList;
                    emitThought(summary, thinkingView, true);

                    const toolResult = await executeToolCall(
                        tc.function.name,
                        argsObj,
                        cwd,
                        controller.signal,
                        activeChildren,
                        deferredCommands
                    );

                    pushEvent('tool_ok', `${tc.function.name} done (${String(toolResult || '').length} bytes)`);
                    emitThought(summary, thinkingView, true);

                    messages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: toolResult
                    });
                }

                // Add a newline separator if the model already streamed pre-tool text
                if (turn.content && !job.output.endsWith('\n')) {
                    job.output += '\n\n';
                    onChunk('stdout', '\n\n');
                }
            }

            // If DeepSeek hit maxIterations while still calling tools, force 1 final summary turn without tools
            if (!completedWithText && !controller.signal.aborted) {
                pushEvent('status', `ครบ ${maxIterations} รอบแล้ว — กำลังสรุปคำตอบสุดท้าย...`);
                emitThought('ครบจำนวนรอบสูงสุด — กำลังสรุปผลลัพธ์...', accumulatedThinking, true);
                messages.push({
                    role: 'user',
                    content: 'ครบจำนวนรอบเรียกเครื่องมือสูงสุดแล้ว กรุณาสรุปผลลัพธ์ทั้งหมดที่ค้นพบจนถึงตอนนี้ให้ผู้ใช้ทราบทันที (ไม่ต้องเรียกเครื่องมือเพิ่ม)'
                });
                let currentStepReasoning = '';
                const finalTurn = await streamDeepSeekTurn({
                    apiKey,
                    model,
                    messages,
                    tools: [],
                    signal: controller.signal,
                    onReasoningDelta: (_delta, fullReasoning) => {
                        currentStepReasoning = fullReasoning;
                        const combined = (accumulatedThinking ? `${accumulatedThinking}\n\n---\n${currentStepReasoning}` : currentStepReasoning).slice(-3000);
                        emitThought('กำลังสรุปคำตอบสุดท้าย (DeepSeek)...', combined);
                    },
                    onContentDelta: (delta) => {
                        job.output += delta;
                        onChunk('stdout', delta);
                    }
                });
                if (!job.output.trim() && !finalTurn.content) {
                    const warnMsg = `\n⚠️ ครบจำนวนรอบสูงสุด (${maxIterations} รอบ) และไม่ได้รับข้อความสรุปเพิ่มเติม\n`;
                    job.output += warnMsg;
                    onChunk('stdout', warnMsg);
                }
            }

            if (job.status !== 'aborted') {
                job.status = 'completed';
                job.exitCode = 0;
            }
            job.liveThought = null;
            job.finishedAt = Date.now();
            onDone(job.status === 'aborted' ? 130 : 0, job.error);
            if (job.status !== 'aborted') runDeferredCommands(deferredCommands, cwd);
        } catch (err) {
            job.liveThought = null;
            if (controller.signal.aborted || job.status === 'aborted') {
                job.status = 'aborted';
                job.exitCode = 130;
                job.finishedAt = Date.now();
                onDone(130, 'Aborted by user');
            } else {
                job.status = 'error';
                job.error = err.message;
                job.exitCode = 1;
                job.finishedAt = Date.now();
                onChunk('stderr', `❌ ${err.message}\n`);
                onDone(1, err.message);
            }
        }
    })();

    return { abort };
}

async function getDeepSeekBalance() {
    const apiKey = getApiKey();
    if (!apiKey) return null;
    try {
        const res = await fetch(`${DEEPSEEK_BASE_URL}/user/balance`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) {
            return { ok: false, error: `HTTP ${res.status}` };
        }
        const data = await res.json();
        const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
        const primary = infos.find(b => b.currency === 'USD') || infos[0] || {};
        return {
            ok: true,
            isAvailable: Boolean(data.is_available),
            currency: primary.currency || 'USD',
            totalBalance: primary.total_balance ?? '0.00',
            grantedBalance: primary.granted_balance ?? '0.00',
            toppedUpBalance: primary.topped_up_balance ?? '0.00',
            balanceInfos: infos,
            models: DEEPSEEK_MODELS
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

module.exports = {
    DEEPSEEK_MODELS,
    isDeepSeekModel,
    supportsVision,
    getApiKey,
    getDeepSeekBalance,
    runDeepSeekPrompt
};

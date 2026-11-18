'use strict';

const { execFile, exec } = require('child_process');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const LOGS_DIR = path.join(__dirname, 'cron-logs');
const JOBS_DIR = path.join(__dirname, 'cron-jobs');
const TAG_PREFIX = '# HOMELAB_CRON:';
const AI_RUNNER_PATH = '/home/dev/projects/cron-ai-runner.py';
const DEFAULT_AI_MODEL = 'gemini-3.8-flash-low';
const VALID_MODES = new Set(['script', 'ai', 'script_ai']);

function runCrontabRead() {
    return new Promise((resolve) => {
        execFile('crontab', ['-l'], (err, stdout) => {
            if (err) return resolve('');
            resolve(stdout || '');
        });
    });
}

function runCrontabWrite(content) {
    return new Promise((resolve, reject) => {
        const child = execFile('crontab', ['-'], (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            resolve(true);
        });
        child.stdin.write(content.endsWith('\n') ? content : content + '\n');
        child.stdin.end();
    });
}

function validateCronExpr(expr) {
    const clean = String(expr || '').trim().replace(/\s+/g, ' ');
    const parts = clean.split(' ');
    if (parts.length !== 5) {
        throw new Error('รูปแบบ Cron ต้องมี 5 ช่อง (นาที ชั่วโมง วันที่ เดือน วันในสัปดาห์) เช่น 0 22 * * *');
    }
    const fieldRe = /^[0-9*,\/-]+$/;
    for (const p of parts) {
        if (!fieldRe.test(p)) {
            throw new Error(`รูปแบบ Cron ไม่ถูกต้อง: "${p}"`);
        }
    }
    return clean;
}

function parseCrontab(raw) {
    const lines = String(raw || '').split(/\r?\n/);
    const jobs = [];
    const unmanaged = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        if (line.startsWith(TAG_PREFIX)) {
            let meta = {};
            try {
                meta = JSON.parse(line.slice(TAG_PREFIX.length));
            } catch (_) {}
            const nextLine = lines[i + 1] || '';
            i++;
            const disabled = nextLine.startsWith('#DISABLED# ');
            const activeLine = disabled ? nextLine.slice('#DISABLED# '.length) : nextLine;
            const match = activeLine.trim().match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/);
            if (match) {
                const mode = VALID_MODES.has(meta.mode) ? meta.mode : 'script';
                jobs.push({
                    id: meta.id || ('cron_' + i),
                    name: meta.name || 'Scheduled Job',
                    schedule: match[1],
                    command: match[2],
                    mode,
                    rawCommand: typeof meta.rawCommand === 'string' ? meta.rawCommand : match[2],
                    aiPrompt: typeof meta.aiPrompt === 'string' ? meta.aiPrompt : '',
                    aiModel: meta.aiModel || DEFAULT_AI_MODEL,
                    notifyTelegram: meta.notifyTelegram !== false,
                    skipOk: Boolean(meta.skipOk),
                    enabled: !disabled,
                    createdAt: meta.createdAt || null,
                    managed: true
                });
            }
        } else {
            const disabled = line.startsWith('#DISABLED# ');
            const activeLine = disabled ? line.slice('#DISABLED# '.length) : line;
            if (!activeLine.trim().startsWith('#')) {
                const match = activeLine.trim().match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/);
                if (match) {
                    jobs.push({
                        id: 'sys_' + jobs.length,
                        name: path.basename(match[2].split(/\s+/)[0]) || 'System Cron',
                        schedule: match[1],
                        command: match[2],
                        mode: 'script',
                        rawCommand: match[2],
                        aiPrompt: '',
                        aiModel: DEFAULT_AI_MODEL,
                        notifyTelegram: false,
                        skipOk: false,
                        enabled: !disabled,
                        managed: false
                    });
                    continue;
                }
            }
            unmanaged.push(line);
        }
    }
    return { jobs, unmanaged };
}

function serializeCrontab(jobs, unmanaged) {
    const out = [];
    for (const u of unmanaged) {
        if (u.trim()) out.push(u);
    }
    for (const j of jobs) {
        if (j.managed) {
            const meta = {
                id: j.id,
                name: j.name,
                mode: j.mode || 'script',
                rawCommand: j.rawCommand || '',
                aiPrompt: j.aiPrompt || '',
                aiModel: j.aiModel || DEFAULT_AI_MODEL,
                notifyTelegram: j.notifyTelegram !== false,
                skipOk: Boolean(j.skipOk),
                createdAt: j.createdAt || Date.now()
            };
            out.push(`${TAG_PREFIX}${JSON.stringify(meta)}`);
        }
        const prefix = j.enabled ? '' : '#DISABLED# ';
        out.push(`${prefix}${j.schedule} ${j.command}`);
    }
    return out.join('\n') + '\n';
}

async function listJobs() {
    const raw = await runCrontabRead();
    const { jobs } = parseCrontab(raw);
    await fsp.mkdir(LOGS_DIR, { recursive: true }).catch(() => {});
    for (const j of jobs) {
        const logFile = path.join(LOGS_DIR, `${j.id}.log`);
        if (fs.existsSync(logFile)) {
            try {
                const st = fs.statSync(logFile);
                j.lastRunAt = st.mtimeMs;
                j.lastLog = fs.readFileSync(logFile, 'utf8').slice(-800);
            } catch (_) {}
        }
    }
    return jobs;
}

async function buildCronCommand({ jobId, mode, rawCommand, aiPrompt, aiModel, notifyTelegram, skipOk, logPath }) {
    const safeModel = String(aiModel || DEFAULT_AI_MODEL).replace(/[^a-zA-Z0-9._-]/g, '');
    if (mode === 'script') {
        if (rawCommand.includes(LOGS_DIR)) return rawCommand;
        return `bash -lc ${JSON.stringify(rawCommand)} >> ${logPath} 2>&1`;
    }
    await fsp.mkdir(JOBS_DIR, { recursive: true });
    const jobFile = path.join(JOBS_DIR, `${jobId}.json`);
    await fsp.writeFile(jobFile, JSON.stringify({
        id: jobId,
        mode,
        rawCommand,
        aiPrompt,
        aiModel: safeModel || DEFAULT_AI_MODEL,
        notifyTelegram: notifyTelegram !== false,
        skipOk: Boolean(skipOk)
    }, null, 2), 'utf8');
    return `/usr/bin/python3 ${AI_RUNNER_PATH} --job-file ${jobFile} >> ${logPath} 2>&1`;
}

async function addOrUpdateJob({
    id,
    name,
    schedule,
    mode = 'script',
    command = '',
    aiPrompt = '',
    aiModel = DEFAULT_AI_MODEL,
    notifyTelegram = true,
    skipOk = false,
    enabled = true
}) {
    const cleanSchedule = validateCronExpr(schedule);
    const cleanMode = VALID_MODES.has(mode) ? mode : 'script';
    const cleanCmd = String(command || '').trim();
    const cleanPrompt = String(aiPrompt || '').trim();

    if ((cleanMode === 'script' || cleanMode === 'script_ai') && !cleanCmd) {
        throw new Error('กรุณาระบุคำสั่ง (Linux Command) ที่ต้องการให้ทำงาน');
    }
    if (cleanMode === 'ai' && !cleanPrompt) {
        throw new Error('กรุณาระบุ AI Prompt ที่ต้องการให้ทำงาน');
    }
    const cleanName = String(name || 'Custom Cron Job').trim().slice(0, 80);

    const raw = await runCrontabRead();
    const { jobs, unmanaged } = parseCrontab(raw);

    const jobId = id || ('cron_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    const logPath = path.join(LOGS_DIR, `${jobId}.log`);
    await fsp.mkdir(LOGS_DIR, { recursive: true });

    const wrappedCmd = await buildCronCommand({
        jobId,
        mode: cleanMode,
        rawCommand: cleanCmd,
        aiPrompt: cleanPrompt,
        aiModel,
        notifyTelegram,
        skipOk,
        logPath
    });

    const existingIdx = jobs.findIndex(j => j.id === jobId);
    const newJob = {
        id: jobId,
        name: cleanName,
        schedule: cleanSchedule,
        command: wrappedCmd,
        mode: cleanMode,
        rawCommand: cleanCmd,
        aiPrompt: cleanPrompt,
        aiModel: aiModel || DEFAULT_AI_MODEL,
        notifyTelegram: notifyTelegram !== false,
        skipOk: Boolean(skipOk),
        enabled: Boolean(enabled),
        createdAt: existingIdx >= 0 ? jobs[existingIdx].createdAt : Date.now(),
        managed: true
    };

    if (existingIdx >= 0) {
        jobs[existingIdx] = newJob;
    } else {
        jobs.push(newJob);
    }

    await runCrontabWrite(serializeCrontab(jobs, unmanaged));
    return { ok: true, job: newJob, jobs: await listJobs() };
}

async function toggleJob(id) {
    const raw = await runCrontabRead();
    const { jobs, unmanaged } = parseCrontab(raw);
    const job = jobs.find(j => j.id === id);
    if (!job) throw new Error('ไม่พบงาน Cron นี้');
    job.enabled = !job.enabled;
    await runCrontabWrite(serializeCrontab(jobs, unmanaged));
    return { ok: true, job, jobs: await listJobs() };
}

async function deleteJob(id) {
    const raw = await runCrontabRead();
    const { jobs, unmanaged } = parseCrontab(raw);
    const filtered = jobs.filter(j => j.id !== id);
    if (filtered.length === jobs.length) throw new Error('ไม่พบงาน Cron นี้');
    await runCrontabWrite(serializeCrontab(filtered, unmanaged));
    return { ok: true, jobs: await listJobs() };
}

async function runJobNow(id) {
    const raw = await runCrontabRead();
    const { jobs } = parseCrontab(raw);
    const job = jobs.find(j => j.id === id);
    if (!job) throw new Error('ไม่พบงาน Cron นี้');

    await fsp.mkdir(LOGS_DIR, { recursive: true });
    const logFile = path.join(LOGS_DIR, `${job.id}.log`);
    let prevSize = 0;
    try { prevSize = fs.statSync(logFile).size; } catch (_) {}

    return new Promise((resolve) => {
        exec(job.command, { timeout: 150000, shell: '/bin/bash' }, (err, stdout, stderr) => {
            let logDelta = '';
            try {
                const st = fs.statSync(logFile);
                if (st.size > prevSize) {
                    const buf = Buffer.alloc(Math.min(st.size - prevSize, 4096));
                    const fd = fs.openSync(logFile, 'r');
                    fs.readSync(fd, buf, 0, buf.length, Math.max(prevSize, st.size - buf.length));
                    fs.closeSync(fd);
                    logDelta = buf.toString('utf8').trim();
                }
            } catch (_) {}
            const output = [stdout, stderr, logDelta].filter(Boolean).join('\n').trim();
            resolve({
                ok: !err,
                exitCode: err ? (err.code || 1) : 0,
                output: output || (err ? err.message : '✅ รันคำสั่งเสร็จสิ้น (ไม่มี output)')
            });
        });
    });
}

module.exports = {
    listJobs,
    addOrUpdateJob,
    toggleJob,
    deleteJob,
    runJobNow
};

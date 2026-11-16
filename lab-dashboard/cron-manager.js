'use strict';

const { execFile, exec } = require('child_process');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const LOGS_DIR = path.join(__dirname, 'cron-logs');
const TAG_PREFIX = '# HOMELAB_CRON:';

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
                jobs.push({
                    id: meta.id || ('cron_' + i),
                    name: meta.name || 'Scheduled Job',
                    schedule: match[1],
                    command: match[2],
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
            out.push(`${TAG_PREFIX}${JSON.stringify({ id: j.id, name: j.name, createdAt: j.createdAt || Date.now() })}`);
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

async function addOrUpdateJob({ id, name, schedule, command, enabled = true }) {
    const cleanSchedule = validateCronExpr(schedule);
    const cleanCmd = String(command || '').trim();
    if (!cleanCmd) throw new Error('กรุณาระบุคำสั่ง (Command) ที่ต้องการให้ทำงาน');
    const cleanName = String(name || 'Custom Cron Job').trim().slice(0, 80);

    const raw = await runCrontabRead();
    const { jobs, unmanaged } = parseCrontab(raw);

    const jobId = id || ('cron_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    const logPath = path.join(LOGS_DIR, `${jobId}.log`);
    await fsp.mkdir(LOGS_DIR, { recursive: true });

    // Wrap command cleanly with bash -lc if not already logging to our log file
    const wrappedCmd = cleanCmd.includes(LOGS_DIR)
        ? cleanCmd
        : `bash -lc ${JSON.stringify(cleanCmd)} >> ${logPath} 2>&1`;

    const existingIdx = jobs.findIndex(j => j.id === jobId);
    const newJob = {
        id: jobId,
        name: cleanName,
        schedule: cleanSchedule,
        command: wrappedCmd,
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
    return new Promise((resolve) => {
        exec(job.command, { timeout: 30000, shell: '/bin/bash' }, (err, stdout, stderr) => {
            const output = [stdout, stderr].filter(Boolean).join('\n').trim();
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

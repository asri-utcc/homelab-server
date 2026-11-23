'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
process.env.AUDIT_DIR = path.join(tmp, 'audit');
process.env.AUDIT_ARCHIVE_DIR = path.join(tmp, 'gdrive');
const audit = require('../audit-logger');

// 1. secret redaction
{
    const s = audit.redactSecrets('curl -H "Authorization: Bearer abcdef1234567890XYZ" DEEPSEEK_API_KEY=sk-abcdefghijklmnopqrstuv password: hunter2 bot 123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    assert(!/abcdef1234567890XYZ|sk-abcdefghij|hunter2|AAAAAAAAAAAA/.test(s), 'secrets removed: ' + s);
    assert(s.includes('***REDACTED***'));
}

// 2. non-git: size delta only, unreported detection, no diff file (decision D1)
{
    const ws = path.join(tmp, 'plain');
    fs.mkdirSync(ws);
    fs.writeFileSync(path.join(ws, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(ws, 'b.txt'), 'bee');
    const id = audit.startRun({ source: 'chat', prompt: 'do things token=SECRETVALUE1', cwd: ws, model: 'm', account: 'g1' });
    assert(id);
    audit.recordEvent(id, 'tool', `✏️ Edit: ${path.join(ws, 'a.txt')}`);
    fs.writeFileSync(path.join(ws, 'a.txt'), 'hello world, longer');
    fs.writeFileSync(path.join(ws, 'b.txt'), 'sneaky change!!'); // not reported via tools
    const sum = audit.finishRun(id, { answer: 'ok', exitCode: 0 });
    assert.strictEqual(sum.status, 'completed');
    assert(!sum.promptFull.includes('SECRETVALUE1'));
    const a = sum.filesTouched.find((f) => f.path.endsWith('a.txt'));
    const b = sum.filesTouched.find((f) => f.path.endsWith('b.txt'));
    assert.strictEqual(a.unreported, false);
    assert.strictEqual(b.unreported, true);
    assert(a.deltaBytes > 0);
    assert.strictEqual(sum.unreportedFilesCount, 1);
    assert.strictEqual(sum.diffFile, null, 'no unified diff outside git');
    const full = audit.getRun(id);
    assert(full.events.some((e) => e.kind === 'job_start') && full.events.some((e) => e.kind === 'job_end'));
}

// 3. git repo: unified diff + numstat
{
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
    g('init', '-q');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'f.js'), 'one\ntwo\n');
    g('add', '.'); g('commit', '-qm', 'init');
    const id = audit.startRun({ source: 'chat', prompt: 'edit', cwd: repo });
    fs.writeFileSync(path.join(repo, 'f.js'), 'one\nTWO\nthree\n');
    const sum = audit.finishRun(id, {});
    assert(sum.diffFile, 'diff saved in git repo');
    const f = sum.filesTouched.find((x) => x.path.endsWith('f.js'));
    assert.strictEqual(f.insertions, 2);
    assert.strictEqual(f.deletions, 1);
    assert(audit.getRun(id).diff.includes('+three'));
}

// 4. timeline observer logs only new entries
{
    const id = audit.startRun({ source: 'chat', prompt: 'tl' });
    const tl = [{ kind: 'tool', text: '📖 Read: /home/dev/x.js', ts: 1 }];
    audit.observeTimeline(id, tl);
    tl.push({ kind: 'tool', text: '⚡ Bash: ls', ts: 2 });
    audit.observeTimeline(id, tl);
    audit.observeTimeline(id, tl);
    const sum = audit.finishRun(id, { error: 'boom', status: 'error' });
    assert.strictEqual(sum.status, 'error');
    const ev = audit.getRun(id).events.filter((e) => e.kind === 'tool');
    assert.strictEqual(ev.length, 2);
}

// 5. orphan sweep: registry from a dead owner becomes crashed_midway
{
    const deadPid = 999999;
    const act = path.join(process.env.AUDIT_DIR, 'active-runs.json');
    const now = Date.now();
    const d = new Date(now); const p2 = (n) => String(n).padStart(2, '0');
    const eventDate = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    fs.writeFileSync(act, JSON.stringify({
        job_dead: { jobId: 'job_dead', source: 'chat', promptFull: 'p', hostPid: deadPid, startedAt: now - 5000, eventDate, lastHeartbeatAt: now - 1000, lastStepText: 'Edit foo' }
    }));
    const swept = audit.sweepOrphanedRunsOnBoot();
    assert.strictEqual(swept.length, 1);
    assert.strictEqual(swept[0].status, 'crashed_midway');
    assert(audit.getRun('job_dead').events.some((e) => e.kind === 'job_crashed'));
    assert.strictEqual(audit.queryRuns({ status: 'crashed_midway' }).total, 1);
}

// 6. cron filter (D2)
{
    assert.strictEqual(audit.shouldAuditCron({}), false);
    assert.strictEqual(audit.shouldAuditCron({ aiInvoked: true }), true);
    assert.strictEqual(audit.shouldAuditCron({ exitCode: 1 }), true);
    assert.strictEqual(audit.shouldAuditCron({ telegramSent: true }), true);
    assert.strictEqual(audit.shouldAuditCron({ manual: true }), true);
    assert.strictEqual(audit.stats().cronSkippedOk, 1);
}

// 7. query filters + stats
{
    assert(audit.queryRuns({ file: 'a.txt' }).total >= 1);
    assert(audit.queryRuns({ unreported: 1 }).total >= 1);
    assert(audit.queryRuns({ q: 'edit' }).total >= 1);
    const st = audit.stats();
    assert(st.all.total >= 4 && st.crashed === 1);
}

// 8. archive moves >90d event files and stays readable
{
    const old = path.join(process.env.AUDIT_DIR, 'events', '2020-01-01.jsonl');
    fs.writeFileSync(old, JSON.stringify({ ts: 1, jobId: 'job_old', seq: 0, kind: 'job_start', text: 'x' }) + '\n');
    fs.appendFileSync(path.join(process.env.AUDIT_DIR, 'runs', '2020-01.jsonl'), JSON.stringify({ jobId: 'job_old', eventDate: '2020-01-01', startedAt: 1577836800000, source: 'chat', status: 'completed', promptFull: 'old' }) + '\n');
    const moved = audit.archiveOldLogs();
    assert.strictEqual(moved.length, 1);
    assert(!fs.existsSync(old));
    assert.strictEqual(audit.getRun('job_old').events.length, 1);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('audit-logger tests passed');

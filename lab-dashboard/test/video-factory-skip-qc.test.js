'use strict';
// ทดสอบสถานะ QC 'skipped', stopGate 'skip' และคอลัมน์ 'kept':
//   node --test test/video-factory-skip-qc.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const videoStudioManager = require('../video-studio-manager');
const factoryManager = require('../video-factory-manager');

const { classifyJobColumn, setJobQC, submitOrder, reviseJobWithAI, getAnalytics } = factoryManager;

test('classifyJobColumn: maps skipped/pending/approved/rejected/running/queued accurately', () => {
    assert.equal(classifyJobColumn({ status: 'done', qcStatus: 'skipped' }), 'kept');
    assert.equal(classifyJobColumn({ status: 'done', qcStatus: 'pending' }), 'qc');
    assert.equal(classifyJobColumn({ status: 'done', qcStatus: 'approved' }), 'ready');
    assert.equal(classifyJobColumn({ status: 'done', qcStatus: 'rejected' }), 'script');
    assert.equal(classifyJobColumn({ status: 'rendering', qcStatus: 'skipped', alive: true }), 'running');
    assert.equal(classifyJobColumn({ status: 'done', qcStatus: 'skipped', alive: true }), 'running');
    assert.equal(classifyJobColumn({ status: 'queued', qcStatus: 'skipped', deferredStart: true }), 'queued');
    assert.equal(classifyJobColumn({ status: 'draft_ready', qcStatus: 'skipped' }), 'script');
});

test('setJobQC: supports skipped (with default/custom note & 409 guard), revert to pending, and rejects unknown status', async () => {
    const tmpJobsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vf-skip-qc-'));
    const origJobsDir = videoStudioManager.JOBS_DIR;
    videoStudioManager.JOBS_DIR = tmpJobsDir;

    try {
        // 1. Done job -> skipped (default note)
        const doneId = 'testjob-done01';
        await fsp.mkdir(path.join(tmpJobsDir, doneId), { recursive: true });
        await fsp.writeFile(
            path.join(tmpJobsDir, doneId, 'job.json'),
            JSON.stringify({ id: doneId, status: 'done', qcStatus: 'pending', qcHistory: [] }),
            'utf8'
        );

        const skippedRes = await setJobQC(doneId, { qcStatus: 'skipped' });
        assert.equal(skippedRes.ok, true);
        assert.equal(skippedRes.qcStatus, 'skipped');
        assert.equal(skippedRes.qcNote, 'ผ่าน — เก็บไว้ดูเอง ไม่ต้องโพสต์');
        assert.equal(skippedRes.job.qcStatus, 'skipped');
        assert.equal(skippedRes.job.qcHistory.length, 1);
        assert.equal(skippedRes.job.qcHistory[0].status, 'skipped');
        assert.equal(skippedRes.job.qcHistory[0].note, 'ผ่าน — เก็บไว้ดูเอง ไม่ต้องโพสต์');
        assert.equal(classifyJobColumn(skippedRes.job), 'kept');

        // 2. Revert skipped -> pending
        const revertRes = await setJobQC(doneId, { qcStatus: 'pending' });
        assert.equal(revertRes.ok, true);
        assert.equal(revertRes.qcStatus, 'pending');
        assert.equal(revertRes.job.qcHistory.length, 2);
        assert.equal(classifyJobColumn(revertRes.job), 'qc');

        // 3. Custom note on skipped
        const customRes = await setJobQC(doneId, { qcStatus: 'skipped', note: 'ทำเทสต์เล่นๆ' });
        assert.equal(customRes.qcNote, 'ทำเทสต์เล่นๆ');

        // 4. Non-done job -> skipped must throw 409
        const runId = 'testjob-run001';
        await fsp.mkdir(path.join(tmpJobsDir, runId), { recursive: true });
        await fsp.writeFile(
            path.join(tmpJobsDir, runId, 'job.json'),
            JSON.stringify({ id: runId, status: 'rendering', qcStatus: 'pending' }),
            'utf8'
        );
        await assert.rejects(
            () => setJobQC(runId, { qcStatus: 'skipped' }),
            (err) => err.statusCode === 409 && err.message.includes('งานยังเรนเดอร์ไม่เสร็จ')
        );

        // 5. Unknown qcStatus -> must throw 400
        await assert.rejects(
            () => setJobQC(doneId, { qcStatus: 'bogus' }),
            (err) => err.statusCode === 400 && err.message.includes('skipped')
        );
    } finally {
        videoStudioManager.JOBS_DIR = origJobsDir;
        await fsp.rm(tmpJobsDir, { recursive: true, force: true });
    }
});

test('submitOrder: stopGate skip sets qcStatus=skipped, mode=oneshot, sendTelegram=false (unless explicitly true)', async () => {
    const origCreateJob = videoStudioManager.createJob;
    const origListJobs = videoStudioManager.listJobs;
    const calls = [];

    videoStudioManager.listJobs = async () => ({ ok: true, jobs: [] });
    videoStudioManager.createJob = async (req) => {
        calls.push(req);
        return { ok: true, id: `mock-job-${calls.length}`, jobId: `mock-job-${calls.length}`, ...req };
    };

    try {
        // Single order with stopGate: 'skip'
        const singleRes = await submitOrder({
            orderMode: 'single',
            topic: 'คลิปทดลองเล่นๆ ไม่ต้อง QC',
            styleId: 'look-3',
            durationSec: 30,
            stopGate: 'skip',
        });
        assert.equal(singleRes.ok, true);
        assert.equal(calls[0].stopGate, 'skip');
        assert.equal(calls[0].mode, 'oneshot');
        assert.equal(calls[0].qcStatus, 'skipped');
        assert.equal(calls[0].sendTelegram, false);

        // Single order with stopGate: 'skip' and explicit sendTelegram: true
        await submitOrder({
            orderMode: 'single',
            topic: 'คลิปเล่นๆ แต่ขอส่ง Telegram',
            styleId: 'look-3',
            durationSec: 30,
            stopGate: 'skip',
            sendTelegram: true,
        });
        assert.equal(calls[1].stopGate, 'skip');
        assert.equal(calls[1].qcStatus, 'skipped');
        assert.equal(calls[1].sendTelegram, true);

        // Batch order with stopGate: 'skip'
        const batchRes = await submitOrder({
            orderMode: 'batch',
            topics: ['หัวข้อเล่นหนึ่ง', 'หัวข้อเล่นสอง'],
            styleId: 'look-3',
            durationSec: 30,
            stopGate: 'skip',
        });
        assert.equal(batchRes.ok, true);
        assert.equal(batchRes.count, 2);
        assert.equal(calls[2].stopGate, 'skip');
        assert.equal(calls[2].qcStatus, 'skipped');
        assert.equal(calls[2].sendTelegram, false);
        assert.equal(calls[3].qcStatus, 'skipped');
    } finally {
        videoStudioManager.createJob = origCreateJob;
        videoStudioManager.listJobs = origListJobs;
    }
});

test('reviseJobWithAI: preserves qcStatus=skipped on BGM revision (draft-bgm and remix)', async () => {
    const tmpJobsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vf-revise-skip-'));
    const origJobsDir = videoStudioManager.JOBS_DIR;
    const origFindRender = videoStudioManager.findLatestJobRender;
    const origFindFinal = videoStudioManager.findLatestJobFinal;
    const origRemix = videoStudioManager.remixJob;

    videoStudioManager.JOBS_DIR = tmpJobsDir;
    videoStudioManager.remixJob = async (id) => ({ ok: true, id, status: 'queued' });

    try {
        // Path A: draft-bgm (no render yet)
        const idA = 'testrev-skip01';
        await fsp.mkdir(path.join(tmpJobsDir, idA), { recursive: true });
        await fsp.writeFile(
            path.join(tmpJobsDir, idA, 'job.json'),
            JSON.stringify({ id: idA, status: 'draft_ready', qcStatus: 'skipped', bgm: 'warm_tech' }),
            'utf8'
        );
        videoStudioManager.findLatestJobRender = async () => null;
        videoStudioManager.findLatestJobFinal = async () => null;

        const resA = await reviseJobWithAI(idA, { prompt: 'ลดเสียงเพลงประกอบ BGM ให้เบาลง' });
        assert.equal(resA.ok, true);
        assert.equal(resA.mode, 'draft-bgm');
        const savedA = JSON.parse(fs.readFileSync(path.join(tmpJobsDir, idA, 'job.json'), 'utf8'));
        assert.equal(savedA.qcStatus, 'skipped');

        // Path B: remix (rendered video exists)
        const idB = 'testrev-skip02';
        await fsp.mkdir(path.join(tmpJobsDir, idB), { recursive: true });
        await fsp.writeFile(
            path.join(tmpJobsDir, idB, 'job.json'),
            JSON.stringify({ id: idB, status: 'done', qcStatus: 'skipped', bgm: 'warm_tech' }),
            'utf8'
        );
        videoStudioManager.findLatestJobRender = async () => 'render.mp4';
        videoStudioManager.findLatestJobFinal = async () => 'final.mp4';

        const resB = await reviseJobWithAI(idB, { prompt: 'ปิดเพลง BGM' });
        assert.equal(resB.ok, true);
        assert.equal(resB.mode, 'remix');
        const savedB = JSON.parse(fs.readFileSync(path.join(tmpJobsDir, idB, 'job.json'), 'utf8'));
        assert.equal(savedB.qcStatus, 'skipped');
    } finally {
        videoStudioManager.JOBS_DIR = origJobsDir;
        videoStudioManager.findLatestJobRender = origFindRender;
        videoStudioManager.findLatestJobFinal = origFindFinal;
        videoStudioManager.remixJob = origRemix;
        await fsp.rm(tmpJobsDir, { recursive: true, force: true });
    }
});

test('getAnalytics: counts keptJobs separately and excludes skipped jobs from firstPassQcRate', async () => {
    const origListJobs = videoStudioManager.listJobs;
    videoStudioManager.listJobs = async () => ({
        ok: true,
        jobs: [
            { id: 'job-0001', status: 'done', qcStatus: 'approved', revisions: [], versions: [1] },
            { id: 'job-0002', status: 'done', qcStatus: 'rejected', revisions: [{ at: '2026-11-27' }], versions: [1] },
            { id: 'job-0003', status: 'done', qcStatus: 'skipped', revisions: [], versions: [1] },
            { id: 'job-0004', status: 'done', qcStatus: 'skipped', revisions: [], versions: [1] },
            { id: 'job-0005', status: 'done', qcStatus: 'pending', revisions: [], versions: [1] },
        ],
    });

    try {
        const stats = await getAnalytics();
        assert.equal(stats.ok, true);
        assert.equal(stats.doneJobs, 5);
        assert.equal(stats.keptJobs, 2);
        assert.equal(stats.qcPendingJobs, 1);
        assert.equal(stats.qcApprovedJobs, 1);
        assert.equal(stats.qcRejectedJobs, 1);
        // 1 firstPassApproved / (1 approved + 1 rejected) = 50% (skipped jobs excluded!)
        assert.equal(stats.firstPassQcRate, 50);
    } finally {
        videoStudioManager.listJobs = origListJobs;
    }
});

test('video-studio-manager: ALLOWED_STOP_GATES includes skip and ALLOWED_QC_STATUS includes skipped', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'video-studio-manager.js'), 'utf8');
    assert.match(src, /ALLOWED_STOP_GATES\s*=\s*new Set\(\[[^\]]*'skip'[^\]]*\]\)/);
    assert.match(src, /ALLOWED_QC_STATUS\s*=\s*new Set\(\[[^\]]*'skipped'[^\]]*\]\)/);
});

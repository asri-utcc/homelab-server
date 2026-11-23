/* Audit Explorer — "Black Box" run history (self-contained: injects its own CSS, button, modal).
   API: /api/audit/{live,runs,runs/:id,stats}. Exposes window.openAuditExplorer(jobId?). */
(function () {
  'use strict';
  if (window.openAuditExplorer) return;

  const css = `
#modal-audit .au-card{width:min(1180px,96vw);height:min(86vh,820px);display:flex;flex-direction:column;background:var(--panel-2,#08222f);border:1px solid var(--border-bright,#00e5ff);border-radius:12px;padding:14px;overflow:hidden}
.au-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.au-title{font-family:var(--mono);font-size:15px;font-weight:700;color:var(--cyan,#00e5ff)}
.au-x{background:none;border:1px solid var(--border,#0aa);color:var(--ink-2,#8ceeff);border-radius:6px;padding:2px 10px;cursor:pointer}
.au-live{font-size:12px;color:var(--green,#00e5a3);margin-bottom:6px;min-height:16px}
.au-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.au-filters input,.au-filters select{background:#021018;color:var(--ink-1,#e8fcff);border:1px solid var(--border,#0aa);border-radius:6px;padding:5px 8px;font-size:12px}
.au-body{display:grid;grid-template-columns:minmax(260px,38%) 1fr;gap:10px;flex:1;min-height:0}
.au-list,.au-detail{overflow:auto;border:1px solid var(--border,#0aa);border-radius:8px;padding:6px;background:rgba(0,10,16,.5)}
.au-run{padding:7px 8px;border-radius:6px;cursor:pointer;border:1px solid transparent;font-size:12px;margin-bottom:4px}
.au-run:hover,.au-run.is-sel{border-color:var(--cyan,#00e5ff);background:var(--cyan-dim,rgba(0,229,255,.12))}
.au-run__top{display:flex;justify-content:space-between;gap:6px;color:var(--ink-muted,#4b94a8);font-family:var(--mono);font-size:11px}
.au-run__p{margin-top:3px;color:var(--ink-1,#e8fcff);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.au-badge{display:inline-block;padding:0 6px;border-radius:8px;font-size:10px;margin-right:4px;border:1px solid currentColor}
.au-s-completed{color:var(--green,#00e5a3)}.au-s-error{color:var(--critical,#ff3b30)}.au-s-aborted{color:#ffc857}.au-s-crashed_midway{color:var(--critical,#ff3b30)}.au-s-running{color:var(--cyan,#00e5ff)}
.au-warn{color:var(--orange,#ff7b29)}
.au-detail h4{margin:10px 0 4px;font-size:12px;color:var(--cyan,#00e5ff);font-family:var(--mono)}
.au-kv{font-size:12px;color:var(--ink-2,#8ceeff);line-height:1.6;word-break:break-word}
.au-pre{white-space:pre-wrap;word-break:break-word;font-family:var(--mono);font-size:11px;background:#021018;border:1px solid var(--border,#0aa);border-radius:6px;padding:6px;max-height:240px;overflow:auto}
.au-file{font-family:var(--mono);font-size:11px;padding:2px 0;word-break:break-all}
.au-ev{font-family:var(--mono);font-size:11px;padding:2px 0;border-bottom:1px dashed rgba(0,229,255,.12);word-break:break-word}
.au-ev b{color:var(--ink-muted,#4b94a8);font-weight:400}
.au-more{width:100%;margin-top:4px}
.btn-msg-audit{background:none;border:1px solid var(--border,#0aa);color:var(--ink-2,#8ceeff);border-radius:6px;font-size:11px;padding:1px 6px;cursor:pointer}
@media(max-width:760px){.au-body{grid-template-columns:1fr}.au-list{max-height:34vh}}
`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  const modal = document.createElement('div');
  modal.id = 'modal-audit';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
  <div class="au-card" role="dialog" aria-label="ประวัติงาน AI">
    <div class="au-head"><div class="au-title">📜 ประวัติงาน AI (Black Box)</div><button type="button" class="au-x" id="au-close">✕</button></div>
    <div class="au-live" id="au-live"></div>
    <div class="au-filters">
      <input type="search" id="au-q" placeholder="ค้นหาคำสั่ง/คำตอบ" autocomplete="off" data-lpignore="true" name="au-q-nofill">
      <input type="search" id="au-file" placeholder="ไฟล์ เช่น gemini.html" autocomplete="off" data-lpignore="true" name="au-file-nofill">
      <select id="au-source"><option value="all">ทุกแหล่ง</option><option value="chat">แชท</option><option value="recovery">กู้งาน</option><option value="cron">Cron</option><option value="agent-hub">Homelab Agent Hub</option></select>
      <select id="au-status"><option value="all">ทุกสถานะ</option><option value="completed">สำเร็จ</option><option value="crashed_midway">ดับกลางคัน 🔴</option><option value="error">ผิดพลาด</option><option value="aborted">ยกเลิก</option></select>
      <label style="font-size:12px;color:var(--ink-2,#8ceeff)"><input type="checkbox" id="au-unrep"> แตะไฟล์นอกเหนือที่แจ้ง ⚠️</label>
      <input type="date" id="au-from" title="ตั้งแต่"><input type="date" id="au-to" title="ถึง">
    </div>
    <div class="au-body"><div class="au-list" id="au-list"></div><div class="au-detail" id="au-detail"><div class="au-kv">เลือกงานทางซ้ายเพื่อดูรายละเอียด</div></div></div>
  </div>`;
  document.body.appendChild(modal);

  const $ = (id) => modal.querySelector('#' + id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STATUS = { completed: 'สำเร็จ', error: 'ผิดพลาด', aborted: 'ยกเลิก', crashed_midway: '🔴 ดับกลางคัน', running: 'กำลังรัน' };
  const fmtT = (ts) => ts ? new Date(ts).toLocaleString('th-TH', { hour12: false }) : '-';
  const fmtD = (ms) => { if (!ms) return '0s'; const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`; };
  const fmtB = (n) => (n == null ? '' : (n >= 0 ? '+' : '-') + (Math.abs(n) >= 1024 ? (Math.abs(n) / 1024).toFixed(1) + 'KB' : Math.abs(n) + 'B'));

  let offset = 0, selected = null;
  const LIMIT = 50;

  async function api(path) {
    const r = await fetch(path, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function reset() {
    ['au-q', 'au-file', 'au-from', 'au-to'].forEach((i) => { $(i).value = ''; });
    $('au-source').value = 'all'; $('au-status').value = 'all'; $('au-unrep').checked = false;
  }
  function runCard(r) {
    const files = (r.filesTouched || []).length;
    return `<div class="au-run${selected === r.jobId ? ' is-sel' : ''}" data-id="${esc(r.jobId)}">
      <div class="au-run__top"><span>${esc(fmtT(r.startedAt))}</span><span>${esc(fmtD(r.durationMs))}</span></div>
      <div><span class="au-badge au-s-${esc(r.status)}">${esc(STATUS[r.status] || r.status)}</span><span class="au-badge">${esc(r.source)}</span>${r.unreportedFilesCount ? '<span class="au-badge au-warn">⚠️ ไฟล์นอกเหนือแจ้ง</span>' : ''}</div>
      <div class="au-run__p">${esc((r.promptFull || '').slice(0, 160))}</div>
      <div class="au-run__top"><span>${esc(r.model || '')} ${esc(r.account || '')}</span><span>${files ? '📁 ' + files + ' ไฟล์' : ''}</span></div></div>`;
  }
  async function load(append) {
    if (!append) { offset = 0; $('au-list').innerHTML = ''; }
    const p = new URLSearchParams({ limit: LIMIT, offset });
    const q = $('au-q').value.trim(), f = $('au-file').value.trim();
    if (q) p.set('q', q); if (f) p.set('file', f);
    p.set('source', $('au-source').value); p.set('status', $('au-status').value);
    if ($('au-unrep').checked) p.set('unreported', '1');
    if ($('au-from').value) p.set('from', $('au-from').value);
    if ($('au-to').value) p.set('to', $('au-to').value);
    try {
      const d = await api('/api/audit/runs?' + p);
      const list = $('au-list');
      const old = list.querySelector('.au-more'); if (old) old.remove();
      list.insertAdjacentHTML('beforeend', d.runs.map(runCard).join('') || (append ? '' : '<div class="au-kv">ไม่พบงาน</div>'));
      offset += d.runs.length;
      if (offset < d.total) list.insertAdjacentHTML('beforeend', `<button type="button" class="au-x au-more">โหลดเพิ่ม (${d.total - offset})</button>`);
    } catch (e) { $('au-list').innerHTML = `<div class="au-kv au-warn">โหลดไม่สำเร็จ: ${esc(e.message)}</div>`; }
  }
  async function loadLive() {
    try {
      const d = await api('/api/audit/live');
      $('au-live').textContent = d.runs.length
        ? '🟢 กำลังรัน: ' + d.runs.map((r) => `${r.source} · ${fmtD(r.elapsedMs)} · ${(r.lastStepText || r.promptSnippet || '').slice(0, 60)}`).join('  |  ')
        : '';
    } catch (_) { $('au-live').textContent = ''; }
  }
  async function showRun(id) {
    selected = id;
    modal.querySelectorAll('.au-run').forEach((n) => n.classList.toggle('is-sel', n.dataset.id === id));
    const box = $('au-detail');
    box.innerHTML = '<div class="au-kv">กำลังโหลด…</div>';
    try {
      const { run, events, diff } = await api('/api/audit/runs/' + encodeURIComponent(id));
      const files = (run.filesTouched || []).map((f) => {
        const acts = (f.actions || []).join('/');
        const stat = f.insertions != null ? ` +${f.insertions}/-${f.deletions}` : (f.deltaBytes != null ? ' ' + fmtB(f.deltaBytes) : '');
        return `<div class="au-file">${f.unreported ? '<span class="au-warn">⚠️ ไม่ได้แจ้ง</span> ' : ''}<b>${esc(acts)}</b> ${esc(f.path)}${esc(stat)}</div>`;
      }).join('') || '<div class="au-kv">ไม่มีไฟล์ถูกแตะ</div>';
      const evs = (events || []).map((e) => `<div class="au-ev"><b>${esc(new Date(e.ts).toLocaleTimeString('th-TH', { hour12: false }))}</b> [${esc(e.kind)}] ${esc(e.text)}</div>`).join('') || '<div class="au-kv">ไม่มี event</div>';
      const tu = run.tokenUsage && run.tokenUsage.totalTokens ? ` · ${Number(run.tokenUsage.totalTokens).toLocaleString('en-US')} tok` : '';
      box.innerHTML = `
        <div><span class="au-badge au-s-${esc(run.status)}">${esc(STATUS[run.status] || run.status)}</span><span class="au-badge">${esc(run.source)}</span></div>
        <div class="au-kv">เริ่ม ${esc(fmtT(run.startedAt))} · จบ ${esc(fmtT(run.finishedAt))} · ใช้เวลา ${esc(fmtD(run.durationMs))}${esc(tu)}<br>
        โมเดล ${esc(run.model || '-')} ${esc(run.account || '')} · cwd ${esc(run.cwd || '-')} · ห้อง ${esc(run.sessionTitle || run.sessionId || '-')}<br>
        ${run.error ? `<span class="au-warn">ข้อผิดพลาด: ${esc(run.error)}</span>` : ''}</div>
        <h4>คำสั่ง</h4><div class="au-pre">${esc(run.promptFull)}</div>
        <h4>ไฟล์ที่ถูกแตะ (${(run.filesTouched || []).length}${run.unreportedFilesCount ? ` · ⚠️ ${run.unreportedFilesCount} ไม่ได้แจ้ง` : ''})</h4>${files}
        ${diff ? `<h4>Unified Diff (Git)</h4><div class="au-pre">${esc(diff)}</div>` : ''}
        <h4>Timeline (${(events || []).length})</h4>${evs}
        ${run.answerPreview ? `<h4>คำตอบ (ตัวอย่าง)</h4><div class="au-pre">${esc(run.answerPreview)}</div>` : ''}`;
    } catch (e) { box.innerHTML = `<div class="au-kv au-warn">โหลดไม่สำเร็จ: ${esc(e.message)}</div>`; }
  }

  let debounce = null;
  const refilter = () => { clearTimeout(debounce); debounce = setTimeout(() => load(false), 250); };
  ['au-q', 'au-file'].forEach((i) => $(i).addEventListener('input', refilter));
  ['au-source', 'au-status', 'au-unrep', 'au-from', 'au-to'].forEach((i) => $(i).addEventListener('change', refilter));
  $('au-list').addEventListener('click', (e) => {
    if (e.target.closest('.au-more')) return load(true);
    const n = e.target.closest('.au-run'); if (n) showRun(n.dataset.id);
  });
  $('au-close').addEventListener('click', () => modal.classList.remove('is-open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('is-open'); });

  window.openAuditExplorer = function (jobId) {
    reset();
    modal.classList.add('is-open');
    loadLive();
    load(false).then(() => { if (jobId) showRun(jobId); });
  };

  // Topbar entry point + alert badge (crashed / unreported in the last 24h)
  function addButton() {
    const host = document.querySelector('.topbar .controls');
    if (!host || document.getElementById('btn-audit-open')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'btn-audit-open'; b.className = 'btn'; b.title = 'ประวัติงาน AI (Black Box)';
    b.textContent = '📜 ประวัติงาน AI';
    b.addEventListener('click', () => window.openAuditExplorer());
    host.insertBefore(b, host.firstChild);
    api('/api/audit/runs?limit=50&from=' + new Date(Date.now() - 864e5).toISOString().slice(0, 10)).then((d) => {
      const bad = d.runs.filter((r) => r.startedAt > Date.now() - 864e5 && (r.status === 'crashed_midway' || r.unreportedFilesCount > 0)).length;
      if (bad) b.textContent = `📜 ประวัติงาน AI ⚠️${bad}`;
    }).catch(() => {});
  }
  addButton();
})();

/* Pixel Office side panels: left = agent task + terminal, right = office chat feed.
 * Events are derived from real office state (HomelabPixelOffice.getAgents()), polled every second. */
(function (root) {
  'use strict';

  var CSS = [
    '.po-pn{position:absolute;top:0;bottom:0;z-index:20;display:flex;flex-direction:column;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#c9d4e8;background:rgba(8,13,24,.94);backdrop-filter:blur(6px);transition:transform .22s ease;min-height:0}',
    '.po-pn--left{left:0;width:var(--po-lw,300px);border-right:1px solid #22304a;transform:translateX(-100%)}',
    '.po-pn--right{right:0;width:var(--po-rw,300px);border-left:1px solid #22304a;transform:translateX(100%);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px}',
    '.po-pn.is-open{transform:none}',
    '.po-pn__head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1c2840;flex:0 0 auto}',
    '.po-pn__dot{width:9px;height:9px;border-radius:50%;background:#64748b;flex:0 0 auto}',
    '.po-pn__dot.is-work{background:#34d399;box-shadow:0 0 8px #34d399;animation:po-pulse 1.4s infinite}',
    '.po-pn__dot.is-chat{background:#38bdf8;box-shadow:0 0 8px #38bdf8}',
    '.po-pn__dot.is-hand{background:#f59e0b;box-shadow:0 0 8px #f59e0b}',
    '@keyframes po-pulse{50%{opacity:.4}}',
    '.po-pn__title{font-weight:700;color:#f1f5f9;font-size:14px}',
    '.po-pn__chip{font-size:10px;padding:1px 7px;border-radius:99px;background:#1b2740;color:#93a4c3;border:1px solid #2a3a5c}',
    '.po-pn__x{margin-left:auto;background:#141e33;border:1px solid #2a3a5c;color:#93a4c3;border-radius:6px;width:24px;height:24px;cursor:pointer;line-height:1}',
    '.po-pn__x:hover{color:#fff;border-color:#4b6194}',
    '.po-pn__body{flex:1 1 auto;overflow-y:auto;padding:10px 12px;min-height:0;scrollbar-width:thin;scrollbar-color:#2a3a5c transparent}',
    '.po-pn__sec{margin-bottom:12px}',
    '.po-pn__lbl{font-size:10px;letter-spacing:.14em;color:#5f7196;margin-bottom:4px;display:flex;justify-content:space-between}',
    '.po-pn__val{color:#e2e8f0;word-break:break-word}',
    '.po-pn__sub{color:#7f90b0}',
    '.po-pn__state{color:#34d399;font-weight:600;margin:2px 0 10px}',
    '.po-pn__state.is-chat{color:#38bdf8}.po-pn__state.is-hand{color:#f59e0b}.po-pn__state.is-idle{color:#94a3b8}',
    '.po-term{background:#050912;border:1px solid #1c2840;border-radius:8px;padding:6px 8px;max-height:260px;overflow-y:auto;scrollbar-width:thin}',
    '.po-term__row{display:flex;gap:8px;white-space:pre-wrap;word-break:break-word}',
    '.po-term__t{color:#4b5b7c;flex:0 0 auto}',
    '.po-term__k{flex:0 0 auto;font-weight:700}',
    '.k-start{color:#34d399}.k-move{color:#38bdf8}.k-hand{color:#f59e0b}.k-done{color:#a78bfa}.k-chat{color:#f472b6}.k-info{color:#94a3b8}',
    '.po-term__cur{display:inline-block;width:7px;height:13px;background:#34d399;vertical-align:-2px;animation:po-pulse 1s steps(2) infinite}',
    '.po-pn__tabs{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #1c2840;flex:0 0 auto}',
    '.po-pn__tab{background:#121b30;border:1px solid #22304a;color:#93a4c3;border-radius:99px;padding:2px 10px;font-size:11px;cursor:pointer}',
    '.po-pn__tab.is-active{background:#1e3a5f;color:#fff;border-color:#3b82f6}',
    '.po-msg{display:flex;gap:8px;margin-bottom:10px}',
    '.po-msg__av{width:30px;height:30px;border-radius:7px;flex:0 0 auto;display:grid;place-items:center;font-size:11px;font-weight:800;color:#0b1220;cursor:pointer}',
    '.po-msg__name{font-weight:700;cursor:pointer}.po-msg__time{color:#5f7196;font-size:10px;margin-left:6px}',
    '.po-msg__txt{color:#cbd5e1}',
    '.po-msg--sys{justify-content:center}.po-msg--sys .po-msg__txt{background:#141e33;border:1px solid #2a3a5c;border-radius:6px;padding:2px 10px;font-size:11px;color:#f59e0b}',
    '.po-pn__foot{padding:8px 12px;border-top:1px solid #1c2840;color:#5f7196;font-size:10px;flex:0 0 auto}',
    '.po-pn__empty{color:#5f7196;text-align:center;padding:24px 8px}',
    '.po-tgl{position:absolute;top:10px;z-index:21;background:rgba(8,13,24,.88);border:1px solid #2a3a5c;color:#c9d4e8;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;backdrop-filter:blur(4px)}',
    '.po-tgl:hover{border-color:#4b6194;color:#fff}.po-tgl.is-on{border-color:#3b82f6;color:#fff}',
    '.po-tgl--l{left:10px}.po-tgl--r{right:10px}',
    '@media(max-width:900px){.po-pn{--po-lw:78vw;--po-rw:78vw}}'
  ].join('\n');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hhmmss(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function elapsed(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' วิ';
    var m = Math.floor(s / 60);
    return m < 60 ? m + ' น. ' + (s % 60) + ' วิ' : Math.floor(m / 60) + ' ชม. ' + (m % 60) + ' น.';
  }
  var TALK = /คุย|เม้าท์|ปิงปอง|ไพ่|ชม|chat/;

  function attach(viewport, ctrl, opts) {
    opts = opts || {};
    if (!viewport || !ctrl || typeof ctrl.getAgents !== 'function') return null;
    if (viewport.__poPanels) return viewport.__poPanels;
    var host = opts.hostEl || null;

    if (!document.getElementById('po-pn-css')) {
      var st = document.createElement('style');
      st.id = 'po-pn-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    var left = document.createElement('aside');
    left.className = 'po-pn po-pn--left';
    var right = document.createElement('aside');
    right.className = 'po-pn po-pn--right';
    var tglL = document.createElement('button');
    tglL.className = 'po-tgl po-tgl--l';
    tglL.type = 'button';
    tglL.textContent = '📟 เทอร์มินัล';
    var tglR = document.createElement('button');
    tglR.className = 'po-tgl po-tgl--r';
    tglR.type = 'button';
    tglR.textContent = '💬 แชทออฟฟิศ';
    viewport.appendChild(left);
    viewport.appendChild(right);
    viewport.appendChild(tglL);
    viewport.appendChild(tglR);

    var agents = {};      // id -> latest snapshot
    var meta = {};        // id -> { since, workSince, log:[] , prev }
    var chat = [];
    var selected = null;
    var filter = 'all';
    var leftOpen = false;
    var rightOpen = viewport.clientWidth >= 900;
    var seeded = false;
    var timer = null;

    function agentMeta(id) {
      return meta[id] || (meta[id] = { log: [], workSince: 0, prev: null });
    }
    function logTo(id, kind, text, ts) {
      var m = agentMeta(id);
      m.log.push({ t: ts, k: kind, x: text });
      if (m.log.length > 80) m.log.shift();
    }
    function say(a, kind, text, ts) {
      chat.push({ id: a ? a.id : null, kind: kind, text: text, t: ts });
      if (chat.length > 150) chat.shift();
    }

    function diff(list, ts) {
      list.forEach(function (a) {
        var m = agentMeta(a.id);
        var p = m.prev;
        agents[a.id] = a;
        var isWork = a.state === 'working' || (a.state === 'returning' && a.working);
        var wasWork = p && (p.state === 'working' || (p.state === 'returning' && p.working));
        if (!p) {
          if (isWork) { m.workSince = ts; logTo(a.id, 'start', a.workDetail || a.role, ts); }
          else logTo(a.id, 'info', a.activityLabel || 'พร้อมรับงาน', ts);
          m.prev = a;
          return;
        }
        if (isWork && !wasWork) {
          m.workSince = ts;
          logTo(a.id, 'start', 'เริ่มงาน: ' + (a.workDetail || a.role), ts);
          say(a, 'work', 'starting: ' + (a.workDetail || a.role), ts);
        } else if (!isWork && wasWork) {
          logTo(a.id, 'done', 'จบงาน (' + elapsed(ts - m.workSince) + ')', ts);
          say(a, 'work', '✅ เสร็จงาน: ' + (p.workDetail || p.role), ts);
        } else if (isWork && a.workDetail !== p.workDetail && a.workDetail) {
          logTo(a.id, 'start', 'งานใหม่: ' + a.workDetail, ts);
          say(a, 'work', '⚡ ' + a.workDetail, ts);
        }
        if (a.state === 'handoff' && p.state !== 'handoff') {
          var tgt = agents[a.handoffTo];
          var lbl = a.handoffLabel || 'ส่งงาน';
          logTo(a.id, 'hand', '📦 ' + lbl, ts);
          say(a, 'sys', '📦 ' + a.name + ' · ' + lbl + (tgt ? ' → ' + tgt.name : ''), ts);
          if (tgt) logTo(tgt.id, 'hand', '📥 ได้รับงานจาก ' + a.name, ts);
        }
        if (a.roomId && a.roomId !== p.roomId) {
          logTo(a.id, 'move', '→ ' + (a.roomLabel || a.roomId), ts);
        }
        if (!isWork && a.activityLabel && a.activityLabel !== p.activityLabel) {
          logTo(a.id, 'chat', a.activityLabel, ts);
          say(a, TALK.test(a.activityLabel) ? 'chat' : 'idle', (a.bubble ? a.bubble + ' ' : '') + a.activityLabel, ts);
        }
        m.prev = a;
      });
    }

    function statusOf(a) {
      if (a.state === 'handoff') return { cls: 'is-hand', txt: 'กำลังเดินส่งงาน' };
      if (a.state === 'working' || (a.state === 'returning' && a.working)) return { cls: 'is-work', txt: 'working' };
      if (a.activityLabel && TALK.test(a.activityLabel)) return { cls: 'is-chat', txt: 'chatting' };
      return { cls: 'is-chat', txt: 'พักผ่อน' };
    }
    function initials(a) {
      return esc((a.name || '?').replace(/^น้อง/, '').trim().slice(0, 2).toUpperCase());
    }

    function renderLeft() {
      if (!leftOpen) return;
      var a = selected && agents[selected];
      if (!a) {
        left.innerHTML = '<div class="po-pn__head"><span class="po-pn__title">📟 เทอร์มินัลเอเจนต์</span><button class="po-pn__x" data-act="close-l" aria-label="ปิด">✕</button></div>' +
          '<div class="po-pn__body"><div class="po-pn__empty">คลิกที่ตัวละครในออฟฟิศ<br>เพื่อดูว่ากำลังทำอะไรอยู่</div></div>';
        return;
      }
      var m = agentMeta(a.id), s = statusOf(a), now = Date.now();
      var working = s.cls === 'is-work';
      var task = working ? (a.workDetail || a.role) : (a.activityLabel || 'รอรับงาน');
      var sinceTxt = working && m.workSince ? 'working for ' + elapsed(now - m.workSince) : s.txt;
      var rows = m.log.slice(-40).map(function (r) {
        return '<div class="po-term__row"><span class="po-term__t">' + hhmmss(r.t) + '</span><span class="po-term__k k-' + r.k + '">' +
          { start: '▶', move: '➜', hand: '⇄', done: '✔', chat: '💬', info: '·' }[r.k] + '</span><span>' + esc(r.x) + '</span></div>';
      }).join('');
      var wasNear = left.__term && (left.__term.scrollHeight - left.__term.scrollTop - left.__term.clientHeight < 30);
      var keepTop = left.__term ? left.__term.scrollTop : 0;
      left.innerHTML =
        '<div class="po-pn__head"><span class="po-pn__dot ' + s.cls + '"></span><span class="po-pn__title">' + esc(a.name) + '</span>' +
        '<span class="po-pn__chip">' + esc(a.deptId) + '</span><button class="po-pn__x" data-act="close-l" aria-label="ปิด">✕</button></div>' +
        '<div class="po-pn__body">' +
        '<div class="po-pn__state ' + (working ? '' : s.cls === 'is-hand' ? 'is-hand' : 'is-chat') + '">' + esc(sinceTxt) + '</div>' +
        '<div class="po-pn__sec"><div class="po-pn__lbl">TASK</div><div class="po-pn__val">' + esc(task) + '</div></div>' +
        '<div class="po-pn__sec"><div class="po-pn__lbl">ROLE</div><div class="po-pn__val po-pn__sub">' + esc(a.role) + '</div></div>' +
        '<div class="po-pn__sec"><div class="po-pn__lbl">WHERE</div><div class="po-pn__val">' + esc(a.roomLabel || a.roomId || '-') + '</div></div>' +
        '<div class="po-pn__sec"><div class="po-pn__lbl"><span>TERMINAL · ' + m.log.length + ' EVENTS</span></div>' +
        '<div class="po-term" id="po-term">' + (rows || '<span class="po-pn__sub">ยังไม่มีเหตุการณ์</span>') +
        (working ? '<div><span class="po-term__cur"></span></div>' : '') + '</div></div></div>' +
        '<div class="po-pn__foot">live · อัปเดตทุก 1 วินาที จากสถานะออฟฟิศจริง</div>';
      var term = left.querySelector('#po-term');
      left.__term = term;
      if (term) term.scrollTop = wasNear || !keepTop ? term.scrollHeight : keepTop;
    }

    function renderRight() {
      if (!rightOpen) return;
      var list = agents ? Object.keys(agents).map(function (k) { return agents[k]; }) : [];
      var nWork = 0, nChat = 0;
      list.forEach(function (a) { var c = statusOf(a).cls; if (c === 'is-work') nWork++; else nChat++; });
      var msgs = chat.filter(function (c) {
        return filter === 'all' || (filter === 'work' ? (c.kind === 'work' || c.kind === 'sys') : (c.kind === 'chat' || c.kind === 'idle'));
      }).slice(-60);
      var body = right.querySelector('#po-chat-body');
      var near = body ? body.scrollHeight - body.scrollTop - body.clientHeight < 40 : true;
      var html = msgs.map(function (c) {
        var a = c.id && agents[c.id];
        if (c.kind === 'sys') return '<div class="po-msg po-msg--sys"><div class="po-msg__txt">' + esc(c.text) + '</div></div>';
        if (!a) return '';
        return '<div class="po-msg"><div class="po-msg__av" data-sel="' + esc(a.id) + '" style="background:' + esc(a.shirt) + '">' + initials(a) + '</div>' +
          '<div><div><span class="po-msg__name" data-sel="' + esc(a.id) + '" style="color:' + esc(a.shirt) + '">' + esc(a.name) + '</span><span class="po-msg__time">' + hhmmss(c.t) + '</span></div>' +
          '<div class="po-msg__txt">' + esc(c.text) + '</div></div></div>';
      }).join('');
      var tabs = [['all', 'ทั้งหมด'], ['work', '⚡ งาน'], ['chat', '☕ คุยเล่น']].map(function (t) {
        return '<button class="po-pn__tab' + (filter === t[0] ? ' is-active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('');
      var scrollTop = body ? body.scrollTop : 0;
      right.innerHTML =
        '<div class="po-pn__head"><span class="po-pn__title"># office-general</span>' +
        '<span class="po-pn__chip">🟢 ' + nWork + ' ทำงาน</span><span class="po-pn__chip">☕ ' + nChat + ' พัก/คุย</span>' +
        '<button class="po-pn__x" data-act="close-r" aria-label="ปิด">✕</button></div>' +
        '<div class="po-pn__tabs">' + tabs + '</div>' +
        '<div class="po-pn__body" id="po-chat-body">' + (html || '<div class="po-pn__empty">รอเหตุการณ์ในออฟฟิศ…</div>') + '</div>' +
        '<div class="po-pn__foot">ฟีดอัตโนมัติจากสถานะเอเจนต์ · คลิกชื่อเพื่อเปิดเทอร์มินัล</div>';
      var nb = right.querySelector('#po-chat-body');
      if (nb) nb.scrollTop = near ? nb.scrollHeight : scrollTop;
    }

    function layout() {
      left.classList.toggle('is-open', leftOpen);
      right.classList.toggle('is-open', rightOpen);
      tglL.classList.toggle('is-on', leftOpen);
      tglR.classList.toggle('is-on', rightOpen);
      tglL.style.display = leftOpen ? 'none' : '';
      tglR.style.display = rightOpen ? 'none' : '';
      if (host) {
        var narrow = viewport.clientWidth < 900;
        host.style.left = leftOpen && !narrow ? left.offsetWidth + 'px' : '0';
        host.style.right = rightOpen && !narrow ? right.offsetWidth + 'px' : '0';
        host.style.width = 'auto';
      }
    }

    function poll() {
      var ts = Date.now();
      try { diff(ctrl.getAgents(), ts); } catch (_) { return; }
      if (!seeded) {
        seeded = true;
        say(null, 'sys', '🏢 เชื่อมต่อออฟฟิศแล้ว · เอเจนต์ ' + Object.keys(agents).length + ' ตัว', ts);
        layout();
      }
      renderLeft();
      renderRight();
    }

    function openLeft(id) {
      if (id) selected = id;
      leftOpen = true;
      layout();
      renderLeft();
    }

    viewport.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-act],[data-sel],[data-tab]');
      if (!t || !viewport.contains(t)) return;
      if (t.dataset.act === 'close-l') { leftOpen = false; layout(); }
      else if (t.dataset.act === 'close-r') { rightOpen = false; layout(); }
      else if (t.dataset.sel) openLeft(t.dataset.sel);
      else if (t.dataset.tab) { filter = t.dataset.tab; renderRight(); }
    });
    tglL.addEventListener('click', function () { openLeft(); });
    tglR.addEventListener('click', function () { rightOpen = true; layout(); renderRight(); });

    left.innerHTML = right.innerHTML = '';
    poll();
    layout();
    timer = setInterval(function () { if (!document.hidden) poll(); }, 1000);

    var api = {
      select: function (id) { if (id && agents[id]) openLeft(id); },
      destroy: function () {
        clearInterval(timer);
        [left, right, tglL, tglR].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
        if (host) { host.style.left = host.style.right = host.style.width = ''; }
        delete viewport.__poPanels;
      }
    };
    viewport.__poPanels = api;
    return api;
  }

  root.PixelOfficePanels = { attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);

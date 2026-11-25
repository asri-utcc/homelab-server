(function () {
  'use strict';

  const MAX_HISTORY = 100;
  const AUTOSAVE_MS = 1500;
  const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

  const DEFAULT_BGM_LIST = [
    { name: 'warm_tech', label: 'Warm Tech (เทคโนโลยีอบอุ่น)', durationSec: 60 },
    { name: 'story_cinematic', label: 'Story Cinematic (เล่าเรื่องภาพยนตร์)', durationSec: 60 },
    { name: 'dawn_ambient', label: 'Dawn Ambient (บรรยากาศนุ่มนวล)', durationSec: 60 },
  ];

  const TEXT_PRESETS = [
    {
      id: 'title',
      name: 'หัวเรื่อง (Title)',
      desc: 'ตัวใหญ่เด่นด้านบนจอ เหมาะเปิดหัวคลิป',
      text: 'หัวข้อหลักของคลิป',
      fontSize: 68,
      color: '#ffffff',
      x: 0.5,
      y: 0.22,
    },
    {
      id: 'subtitle',
      name: 'ซับไตเติล (Subtitle)',
      desc: 'ข้อความบรรยายด้านล่าง อ่านง่ายชัดเจน',
      text: 'ข้อความซับไตเติล',
      fontSize: 44,
      color: '#fde047',
      x: 0.5,
      y: 0.82,
    },
    {
      id: 'badge',
      name: 'ป้ายกำกับ (Badge)',
      desc: 'ป้ายข้อความเน้นประเด็นสำคัญมุมบน',
      text: 'ไฮไลต์สำคัญ',
      fontSize: 34,
      color: '#22d3ee',
      x: 0.5,
      y: 0.12,
    },
  ];

  const KIND_LABELS = {
    video: 'วิดีโอ',
    voice: 'เสียงพากย์',
    music: 'เพลงประกอบ',
    sfx: 'เอฟเฟกต์เสียง',
    text: 'ข้อความ',
  };

  // =========================================================================
  // STATE
  // =========================================================================
  const state = {
    jobId: '',
    jobMeta: null,
    project: null,
    assets: {
      bgm: [],
      sfx: [],
      job: { render: null, final: null, narration: null },
      jobAssets: [],
      uploads: [], // client-side uploaded assets before autosave promotes them
    },
    apiUnavailable: false,
    activeTab: 'media',
    selectedClipId: null,
    currentTime: 0,
    isPlaying: false,
    masterMuted: false,

    // History
    history: [],
    historyIndex: -1,

    // Save
    isDirty: false,
    isSaving: false,
    autosaveTimer: null,

    // Timeline instance
    timeline: null,

    // Audition player for Media Bin
    auditionAudio: null,
    auditionUrl: null,

    // Web Audio playback engine
    audioCtx: null,
    masterGain: null,
    audioBufferCache: new Map(), // url -> Promise<AudioBuffer|null>
    activeAudioNodes: [],
    rafId: null,
    playStartWall: 0,
    playStartTime: 0,
    lastVideoSrc: '',
    lastOverlaySrc: '',

    // Local blob URLs for freshly uploaded files (key: "upload:<id>")
    localObjectUrls: new Map(),

    // Export polling
    exportPollTimer: null,
  };

  // =========================================================================
  // DOM REFERENCES
  // =========================================================================
  const $ = (id) => document.getElementById(id);
  const dom = {
    shell: $('ve-shell'),
    jobTitle: $('ve-job-title'),
    btnOpenJobs: $('ve-btn-open-jobs'),
    btnUndo: $('ve-btn-undo'),
    btnRedo: $('ve-btn-redo'),
    btnSave: $('ve-btn-save'),
    btnShortcuts: $('ve-btn-shortcuts'),
    btnExport: $('ve-btn-export'),
    saveStatus: $('ve-save-status'),
    apiBanner: $('ve-api-banner'),
    apiBannerText: $('ve-api-banner-text'),
    apiBannerClose: $('ve-api-banner-close'),
    binBody: $('ve-bin-body'),
    stage: $('ve-stage'),
    video: $('ve-video'),
    overlayVideo: $('ve-overlay-video'),
    overlayImg: $('ve-overlay-img'),
    stageEmpty: $('ve-stage-empty'),
    textOverlays: $('ve-text-overlays'),
    tcCur: $('ve-tc-cur'),
    tcTotal: $('ve-tc-total'),
    btnHome: $('ve-btn-home'),
    btnPrevFrame: $('ve-btn-prev-frame'),
    btnPlay: $('ve-btn-play'),
    btnNextFrame: $('ve-btn-next-frame'),
    btnEnd: $('ve-btn-end'),
    btnMuteMaster: $('ve-btn-mute-master'),
    btnFullscreen: $('ve-btn-fullscreen'),
    inspectorTitle: $('ve-inspector-title'),
    inspectorPill: $('ve-inspector-pill'),
    inspectorBody: $('ve-inspector-body'),
    splitter: $('ve-splitter'),
    timelineHost: $('ve-timeline'),
    modalJobs: $('ve-modal-jobs'),
    modalJobsBody: $('ve-modal-jobs-body'),
    modalExport: $('ve-modal-export'),
    modalExportBody: $('ve-modal-export-body'),
    modalExportFooter: $('ve-modal-export-footer'),
    modalShortcuts: $('ve-modal-shortcuts'),
    toast: $('ve-toast'),
  };

  // =========================================================================
  // UTILITIES
  // =========================================================================
  function uid(prefix) {
    return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function clamp(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function round3(n) {
    return Math.round((Number(n) || 0) * 1000) / 1000;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function showToast(msg, ms = 2400) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), ms);
  }

  function formatTimecode(sec, fps = 30) {
    const s = Math.max(0, Number(sec) || 0);
    const totalFrames = Math.floor(s * fps + 1e-6);
    const f = totalFrames % fps;
    const totalSec = Math.floor(totalFrames / fps);
    const secs = totalSec % 60;
    const mins = Math.floor(totalSec / 60) % 60;
    const hrs = Math.floor(totalSec / 3600);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}:${pad(f)}`;
  }

  function formatDuration(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = (s % 60).toFixed(1);
    return m > 0 ? `${m}:${Number(r) < 10 ? '0' : ''}${r}` : `${r}s`;
  }

  function clipDuration(clip) {
    if (!clip) return 0;
    const spd = Math.max(0.25, Number(clip.speed) || 1);
    return Math.max(0.05, ((Number(clip.out) || 0) - (Number(clip.in) || 0)) / spd);
  }

  function getProjectDuration(proj = state.project) {
    if (!proj || !Array.isArray(proj.tracks)) return 10;
    let maxEnd = 0;
    for (const tr of proj.tracks) {
      if (!Array.isArray(tr.clips)) continue;
      for (const c of tr.clips) {
        const end = (Number(c.start) || 0) + clipDuration(c);
        if (end > maxEnd) maxEnd = end;
      }
    }
    return Math.max(1, round3(maxEnd));
  }

  function findClipById(clipId, proj = state.project) {
    if (!clipId || !proj || !Array.isArray(proj.tracks)) return null;
    for (const track of proj.tracks) {
      if (!Array.isArray(track.clips)) continue;
      const idx = track.clips.findIndex((c) => c.id === clipId);
      if (idx >= 0) {
        return { track, clip: track.clips[idx], index: idx };
      }
    }
    return null;
  }

  function resolveSrcUrl(src) {
    if (!src || typeof src !== 'object') return '';
    const job = encodeURIComponent(state.jobId || '');
    if (src.type === 'render') {
      if (state.assets.job && state.assets.job.render && state.assets.job.render.url) {
        return state.assets.job.render.url;
      }
      if (state.apiUnavailable) {
        return `/api/video-studio/file/${job}/render.mp4`;
      }
      return `/api/video-studio/media/render/main?job=${job}`;
    }
    if (src.type === 'final') {
      if (state.assets.job && state.assets.job.final && state.assets.job.final.url) {
        return state.assets.job.final.url;
      }
      if (state.apiUnavailable) {
        return `/api/video-studio/file/${job}/final.mp4`;
      }
      return `/api/video-studio/media/final/main?job=${job}`;
    }
    if (src.type === 'narration') {
      if (state.assets.job && state.assets.job.narration && state.assets.job.narration.url) {
        return state.assets.job.narration.url;
      }
      return `/api/video-studio/media/narration/main?job=${job}`;
    }
    if (src.type === 'bgm' && src.name) {
      return `/api/video-studio/media/bgm/${encodeURIComponent(src.name)}?job=${job}`;
    }
    if (src.type === 'sfx' && src.name) {
      return `/api/video-studio/media/sfx/${encodeURIComponent(src.name)}?job=${job}`;
    }
    if (src.type === 'jobasset' && src.file) {
      return `/api/video-studio/media/jobasset/${encodeURIComponent(src.file)}?job=${job}`;
    }
    if (src.type === 'upload' && src.id) {
      return state.localObjectUrls.get(`upload:${src.id}`) || '';
    }
    return '';
  }

  function getAssetDuration(src) {
    if (!src || typeof src !== 'object') return 5;
    if (src.type === 'render') return (state.assets.job.render && state.assets.job.render.durationSec) || getProjectDuration();
    if (src.type === 'final') return (state.assets.job.final && state.assets.job.final.durationSec) || getProjectDuration();
    if (src.type === 'narration') return (state.assets.job.narration && state.assets.job.narration.durationSec) || getProjectDuration();
    if (src.type === 'bgm') {
      const found = state.assets.bgm.find((b) => b.name === src.name);
      return (found && found.durationSec) || 60;
    }
    if (src.type === 'sfx') {
      const found = state.assets.sfx.find((s) => s.name === src.name);
      return (found && found.durationSec) || 1;
    }
    if (src.type === 'jobasset') {
      const found = state.assets.jobAssets.find((a) => a.file === src.file);
      return (found && found.durationSec) || 5;
    }
    if (src.type === 'upload') {
      const found = state.assets.uploads.find((u) => u.id === src.id);
      return (found && found.durationSec) || 5;
    }
    return 5;
  }

  function isImageFile(nameOrMime) {
    return /\.(png|jpe?g|webp|gif)$/i.test(String(nameOrMime || '')) || /^image\//i.test(String(nameOrMime || ''));
  }

  function isAudioFile(nameOrMime) {
    return /\.(mp3|wav|m4a|aac|ogg)$/i.test(String(nameOrMime || '')) || /^audio\//i.test(String(nameOrMime || ''));
  }

  async function fetchJsonSafe(url, opts) {
    const res = await fetch(url, opts);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const isJson = ct.includes('application/json');
    const text = await res.text();
    let data = null;
    if (isJson || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
    }
    return {
      ok: res.ok && data !== null && data.ok !== false,
      status: res.status,
      isHtml: !isJson && /^\s*<!doctype|^\s*<html/i.test(text),
      data,
      text,
    };
  }

  // =========================================================================
  // API BANNER & SAVE STATUS
  // =========================================================================
  function showApiBanner(msg) {
    dom.apiBannerText.textContent = msg || 'ต้องรีสตาร์ท lab-dashboard เพื่อเปิดใช้ API โปรแกรมตัดต่อ';
    dom.apiBanner.classList.add('is-visible');
  }

  function updateSaveStatus(mode, extraText) {
    const el = dom.saveStatus;
    el.classList.remove('is-dirty', 'is-saving', 'is-saved', 'is-error');
    if (state.apiUnavailable) {
      el.textContent = 'โหมดพรีวิว (API ยังไม่พร้อม)';
      el.classList.add('is-dirty');
      return;
    }
    if (mode === 'dirty') {
      el.textContent = 'ยังไม่ได้บันทึก';
      el.classList.add('is-dirty');
    } else if (mode === 'saving') {
      el.textContent = 'กำลังบันทึก...';
      el.classList.add('is-saving');
    } else if (mode === 'saved') {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      el.textContent = extraText || `บันทึกแล้ว ${hh}:${mm}:${ss}`;
      el.classList.add('is-saved');
    } else if (mode === 'error') {
      el.textContent = extraText || 'บันทึกไม่สำเร็จ';
      el.classList.add('is-error');
    } else {
      el.textContent = extraText || 'พร้อมใช้งาน';
    }
  }

  // =========================================================================
  // HISTORY (UNDO / REDO — 100 LEVELS)
  // =========================================================================
  function updateHistoryButtons() {
    dom.btnUndo.disabled = state.historyIndex <= 0;
    dom.btnRedo.disabled = state.historyIndex >= state.history.length - 1;
  }

  function pushHistory(proj) {
    const snap = JSON.stringify(proj);
    if (state.history[state.historyIndex] === snap) return;
    if (state.historyIndex < state.history.length - 1) {
      state.history = state.history.slice(0, state.historyIndex + 1);
    }
    state.history.push(snap);
    if (state.history.length > MAX_HISTORY) {
      state.history.shift();
    }
    state.historyIndex = state.history.length - 1;
    updateHistoryButtons();
  }

  function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex -= 1;
    const restored = JSON.parse(state.history[state.historyIndex]);
    applyProjectChange(restored, { recordHistory: false, fromTimeline: false });
    updateHistoryButtons();
    showToast('เลิกทำแล้ว');
  }

  function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex += 1;
    const restored = JSON.parse(state.history[state.historyIndex]);
    applyProjectChange(restored, { recordHistory: false, fromTimeline: false });
    updateHistoryButtons();
    showToast('ทำซ้ำแล้ว');
  }

  // =========================================================================
  // AUTOSAVE & PERSISTENCE
  // =========================================================================
  function scheduleAutosave() {
    state.isDirty = true;
    updateSaveStatus('dirty');
    clearTimeout(state.autosaveTimer);
    if (state.apiUnavailable) return;
    state.autosaveTimer = setTimeout(() => {
      saveProjectNow({ silent: true });
    }, AUTOSAVE_MS);
  }

  async function saveProjectNow({ silent = false } = {}) {
    clearTimeout(state.autosaveTimer);
    if (!state.jobId || !state.project) return false;
    if (state.apiUnavailable) {
      if (!silent) showToast('ไม่สามารถบันทึกได้: ต้องรีสตาร์ท lab-dashboard ก่อน');
      return false;
    }
    if (state.isSaving) return false;
    state.isSaving = true;
    updateSaveStatus('saving');

    try {
      const resp = await fetchJsonSafe(`/api/video-studio/jobs/${encodeURIComponent(state.jobId)}/project`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: state.project }),
      });
      if (resp.status === 404 || resp.isHtml) {
        state.apiUnavailable = true;
        showApiBanner('ต้องรีสตาร์ท lab-dashboard เพื่อเปิดใช้ API โปรแกรมตัดต่อ');
        updateSaveStatus('dirty');
        return false;
      }
      if (!resp.ok) {
        const msg = (resp.data && resp.data.error) || `HTTP ${resp.status}`;
        updateSaveStatus('error', `บันทึกพลาด: ${msg}`);
        if (!silent) showToast(`บันทึกไม่สำเร็จ: ${msg}`);
        return false;
      }

      // If server promoted upload -> jobasset, sync src references cleanly
      if (resp.data && resp.data.project) {
        const hadUploads = JSON.stringify(state.project).includes('"type":"upload"');
        state.project = resp.data.project;
        if (state.timeline && typeof state.timeline.setProject === 'function') {
          state.timeline.setProject(state.project);
        }
        if (hadUploads) {
          refreshEditorAssets();
        }
      }

      state.isDirty = false;
      updateSaveStatus('saved');
      if (!silent) showToast('บันทึกโปรเจกต์แล้ว');
      return true;
    } catch (err) {
      updateSaveStatus('error', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
      if (!silent) showToast(`บันทึกไม่สำเร็จ: ${err.message}`);
      return false;
    } finally {
      state.isSaving = false;
    }
  }

  async function refreshEditorAssets() {
    if (!state.jobId || state.apiUnavailable) return;
    try {
      const r = await fetchJsonSafe(`/api/video-studio/editor-assets?job=${encodeURIComponent(state.jobId)}`);
      if (r.ok && r.data) {
        state.assets.bgm = Array.isArray(r.data.bgm) ? r.data.bgm : [];
        state.assets.sfx = Array.isArray(r.data.sfx) ? r.data.sfx : [];
        state.assets.job = r.data.job || { render: null, final: null, narration: null };
        state.assets.jobAssets = Array.isArray(r.data.jobAssets) ? r.data.jobAssets : [];
        renderMediaBin();
        renderInspector();
      }
    } catch (_) {}
  }

  // =========================================================================
  // CORE PROJECT MUTATION ENTRYPOINT
  // =========================================================================
  function applyProjectChange(nextProject, { recordHistory = true, fromTimeline = false, skipSave = false } = {}) {
    state.project = nextProject;

    // Validate selection still exists
    if (state.selectedClipId && !findClipById(state.selectedClipId)) {
      state.selectedClipId = null;
    }

    if (recordHistory) {
      pushHistory(state.project);
    }
    if (!fromTimeline && state.timeline && typeof state.timeline.setProject === 'function') {
      state.timeline.setProject(state.project);
    }
    if (!skipSave) {
      scheduleAutosave();
    }

    updateTotalTimecode();
    renderPreviewAt(state.currentTime);
    renderInspector();
    if (state.activeTab === 'music') {
      renderMediaBin();
    }

    // If currently playing, reschedule Web Audio immediately so edits are heard live
    if (state.isPlaying) {
      stopAllAudioNodes();
      scheduleAllAudioFrom(state.currentTime);
    }
  }

  // =========================================================================
  // BGM HELPER (3 WAYS TO SWITCH BGM)
  // =========================================================================
  function getCurrentBgmKey() {
    if (!state.project) return '';
    const mTrack = state.project.tracks.find((t) => t.kind === 'music');
    if (!mTrack || !mTrack.clips.length) return '';
    const c = mTrack.clips[0];
    if (!c.src) return '';
    if (c.src.type === 'bgm') return `bgm:${c.src.name}`;
    if (c.src.type === 'jobasset') return `jobasset:${c.src.file}`;
    if (c.src.type === 'upload') return `upload:${c.src.id}`;
    return '';
  }

  function setProjectBgm(src, label) {
    if (!state.project) return;
    const next = clone(state.project);
    let mTrack = next.tracks.find((t) => t.kind === 'music');
    if (!mTrack) {
      mTrack = { id: 'm1', kind: 'music', name: 'เพลงประกอบ (BGM)', muted: false, locked: false, hidden: false, clips: [] };
      next.tracks.push(mTrack);
    }
    if (mTrack.locked) {
      showToast('แทร็กเพลงประกอบถูกล็อกอยู่ กรุณาปลดล็อกก่อน');
      return;
    }

    if (!src) {
      // Remove BGM (none)
      mTrack.clips = [];
      applyProjectChange(next);
      showToast('ปิดเพลงประกอบแล้ว');
      return;
    }

    const projDur = getProjectDuration(next);
    if (mTrack.clips.length > 0) {
      const first = mTrack.clips[0];
      first.src = clone(src);
      first.label = label || src.name || src.file || 'เพลงประกอบ';
      first.in = 0;
      if (!first.out || first.out <= first.in) {
        first.out = projDur;
      }
      state.selectedClipId = first.id;
    } else {
      const newClip = {
        id: uid('m'),
        label: label || src.name || src.file || 'เพลงประกอบ',
        src: clone(src),
        in: 0,
        out: projDur,
        start: 0,
        speed: 1,
        volume: 0.14,
        fadeIn: 1,
        fadeOut: 2,
        duckDb: 12,
        loop: true,
      };
      mTrack.clips.push(newClip);
      state.selectedClipId = newClip.id;
    }

    if (state.timeline && typeof state.timeline.setSelected === 'function') {
      state.timeline.setSelected(state.selectedClipId);
    }
    applyProjectChange(next);
    showToast(`เปลี่ยนเพลงประกอบเป็น "${label || src.name || src.file}" แล้ว`);
  }

  function getAllMusicChoices() {
    const choices = [];
    for (const b of state.assets.bgm) {
      choices.push({
        key: `bgm:${b.name}`,
        label: `🎵 ${b.label || b.name}`,
        src: { type: 'bgm', name: b.name },
        shortLabel: b.label || b.name,
      });
    }
    for (const a of state.assets.jobAssets) {
      if (isAudioFile(a.file) || isAudioFile(a.mime)) {
        choices.push({
          key: `jobasset:${a.file}`,
          label: `📁 ${a.file}`,
          src: { type: 'jobasset', file: a.file },
          shortLabel: a.file,
        });
      }
    }
    for (const u of state.assets.uploads) {
      if (isAudioFile(u.originalName) || isAudioFile(u.mime)) {
        choices.push({
          key: `upload:${u.id}`,
          label: `⬆️ ${u.originalName || u.filename}`,
          src: { type: 'upload', id: u.id },
          shortLabel: u.originalName || u.filename,
        });
      }
    }
    return choices;
  }

  // =========================================================================
  // ADD CLIP HELPERS
  // =========================================================================
  function addClipToTrack(kind, clipData) {
    if (!state.project) return;
    const next = clone(state.project);
    let track = next.tracks.find((t) => t.kind === kind && !t.locked);
    if (!track) {
      track = next.tracks.find((t) => t.kind === kind);
      if (track && track.locked) {
        showToast(`แทร็ก "${track.name}" ถูกล็อกอยู่`);
        return;
      }
    }
    if (!track) {
      showToast(`ไม่พบแทร็กประเภท ${KIND_LABELS[kind] || kind}`);
      return;
    }
    const newClip = {
      id: uid(kind[0] || 'c'),
      label: clipData.label || KIND_LABELS[kind] || 'คลิปใหม่',
      in: 0,
      out: Math.max(0.2, Number(clipData.durationSec) || 3),
      start: round3(state.currentTime),
      speed: 1,
      volume: kind === 'video' ? 0 : kind === 'music' ? 0.14 : kind === 'sfx' ? 0.7 : 1,
      fadeIn: kind === 'music' ? 1 : 0,
      fadeOut: kind === 'music' ? 2 : 0,
      ...clipData,
    };
    delete newClip.durationSec;
    if (kind === 'music') {
      newClip.duckDb = newClip.duckDb != null ? newClip.duckDb : 12;
      newClip.loop = newClip.loop != null ? newClip.loop : true;
    }
    track.clips.push(newClip);
    state.selectedClipId = newClip.id;
    if (state.timeline && typeof state.timeline.setSelected === 'function') {
      state.timeline.setSelected(newClip.id);
    }
    applyProjectChange(next);
    showToast(`เพิ่ม "${newClip.label}" ลงแทร็ก ${track.name}`);
  }

  function addTextPreset(preset) {
    addClipToTrack('text', {
      label: preset.name,
      text: preset.text,
      fontSize: preset.fontSize,
      color: preset.color,
      x: preset.x,
      y: preset.y,
      in: 0,
      out: 3,
      durationSec: 3,
    });
  }

  // =========================================================================
  // EDIT OPERATIONS (SPLIT / DELETE / RIPPLE / DUPLICATE — FALLBACKS)
  // =========================================================================
  function splitAtPlayhead() {
    if (state.timeline && typeof state.timeline.splitAtPlayhead === 'function') {
      state.timeline.splitAtPlayhead();
      return;
    }
    if (!state.project) return;
    const t = state.currentTime;
    const next = clone(state.project);
    let targetInfo = state.selectedClipId ? findClipById(state.selectedClipId, next) : null;

    if (!targetInfo) {
      // Find clip under playhead on first unlocked track
      for (const tr of next.tracks) {
        if (tr.locked) continue;
        const idx = tr.clips.findIndex((c) => t > c.start + 0.05 && t < c.start + clipDuration(c) - 0.05);
        if (idx >= 0) {
          targetInfo = { track: tr, clip: tr.clips[idx], index: idx };
          break;
        }
      }
    }
    if (!targetInfo || targetInfo.track.locked) {
      showToast('วาง Playhead บนคลิปที่ต้องการตัดก่อนกด S');
      return;
    }

    const targets = [targetInfo];
    if (targetInfo.clip.linkId) {
      for (const tr of next.tracks) {
        if (tr.locked) continue;
        tr.clips.forEach((c, idx) => {
          if (c.linkId === targetInfo.clip.linkId && c.id !== targetInfo.clip.id) {
            targets.push({ track: tr, clip: c, index: idx });
          }
        });
      }
    }

    let didSplit = false;
    const newLinkId = targetInfo.clip.linkId ? uid('lnk') : null;
    for (const item of targets) {
      const c = item.clip;
      const dur = clipDuration(c);
      if (t <= c.start + 0.05 || t >= c.start + dur - 0.05) continue;
      const spd = Math.max(0.25, Number(c.speed) || 1);
      const splitSource = round3(c.in + (t - c.start) * spd);
      const right = clone(c);
      right.id = uid(item.track.kind[0] || 'c');
      right.in = splitSource;
      right.start = round3(t);
      if (newLinkId) right.linkId = newLinkId;
      c.out = splitSource;
      item.track.clips.push(right);
      didSplit = true;
    }

    if (didSplit) {
      applyProjectChange(next);
      showToast('ตัดแยกคลิปที่ตำแหน่ง Playhead แล้ว');
    } else {
      showToast('Playhead ไม่อยู่ภายในช่วงของคลิปที่เลือก');
    }
  }

  function deleteSelected(ripple = false) {
    if (state.timeline && typeof state.timeline.deleteSelected === 'function') {
      state.timeline.deleteSelected(ripple);
      return;
    }
    if (!state.selectedClipId || !state.project) return;
    const next = clone(state.project);
    const info = findClipById(state.selectedClipId, next);
    if (!info) return;
    if (info.track.locked) {
      showToast('แทร็กถูกล็อกอยู่ ไม่สามารถลบได้');
      return;
    }

    const linkId = info.clip.linkId;
    const removedStart = info.clip.start;
    const removedDur = clipDuration(info.clip);

    for (const tr of next.tracks) {
      if (tr.locked) continue;
      const beforeLen = tr.clips.length;
      tr.clips = tr.clips.filter((c) => c.id !== info.clip.id && (!linkId || c.linkId !== linkId));
      if (ripple && tr.clips.length < beforeLen) {
        for (const c of tr.clips) {
          if (c.start >= removedStart + removedDur - 0.001) {
            c.start = Math.max(0, round3(c.start - removedDur));
          }
        }
      }
    }
    state.selectedClipId = null;
    applyProjectChange(next);
    showToast(ripple ? 'ลบคลิปแบบเลื่อนชิดแล้ว' : 'ลบคลิปแล้ว');
  }

  function duplicateSelected() {
    if (state.timeline && typeof state.timeline.duplicateSelected === 'function') {
      state.timeline.duplicateSelected();
      return;
    }
    if (!state.selectedClipId || !state.project) return;
    const next = clone(state.project);
    const info = findClipById(state.selectedClipId, next);
    if (!info || info.track.locked) return;

    const dup = clone(info.clip);
    dup.id = uid(info.track.kind[0] || 'c');
    delete dup.linkId;
    dup.start = round3(info.clip.start + clipDuration(info.clip));
    info.track.clips.push(dup);
    state.selectedClipId = dup.id;
    applyProjectChange(next);
    showToast('ทำสำเนาคลิปแล้ว');
  }

  // =========================================================================
  // MEDIA BIN (5 TABS)
  // =========================================================================
  function stopAudition() {
    if (state.auditionAudio) {
      state.auditionAudio.pause();
      state.auditionAudio.currentTime = 0;
    }
    state.auditionUrl = null;
    renderMediaBin();
  }

  function toggleAudition(url) {
    if (!url) return;
    if (state.auditionUrl === url && state.auditionAudio && !state.auditionAudio.paused) {
      stopAudition();
      return;
    }
    if (!state.auditionAudio) {
      state.auditionAudio = new Audio();
      state.auditionAudio.addEventListener('ended', () => {
        state.auditionUrl = null;
        renderMediaBin();
      });
    }
    state.auditionAudio.pause();
    state.auditionAudio.src = url;
    state.auditionUrl = url;
    state.auditionAudio.play().catch((err) => {
      state.auditionUrl = null;
      showToast(`ไม่สามารถเล่นตัวอย่างเสียงได้: ${err.message}`);
      renderMediaBin();
    });
    renderMediaBin();
  }

  function attachDraggable(el, payload) {
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-ve-asset', JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', payload.label || 'asset');
    });
  }

  function renderMediaBin() {
    const body = dom.binBody;
    body.innerHTML = '';

    const tab = state.activeTab;

    if (tab === 'media') {
      const hint = document.createElement('div');
      hint.className = 've-bin-hint';
      hint.textContent = 'ลากไฟล์สื่อลงบน Timeline หรือกด "+ เพิ่ม" เพื่อวางที่ตำแหน่ง Playhead';
      body.appendChild(hint);

      const items = [];
      if (state.assets.job.render) {
        items.push({
          kind: 'video',
          ico: '🎬',
          label: `วิดีโอหลัก (${state.assets.job.render.file || 'render.mp4'})`,
          durationSec: state.assets.job.render.durationSec || getProjectDuration(),
          src: { type: 'render' },
        });
      }
      if (state.assets.job.final) {
        items.push({
          kind: 'video',
          ico: '🎞️',
          label: `วิดีโอล่าสุด (${state.assets.job.final.file || 'final.mp4'})`,
          durationSec: state.assets.job.final.durationSec || getProjectDuration(),
          src: { type: 'final' },
        });
      }
      if (state.assets.job.narration) {
        items.push({
          kind: 'voice',
          ico: '🎙️',
          label: `เสียงพากย์ (${state.assets.job.narration.file || 'narration.wav'})`,
          durationSec: state.assets.job.narration.durationSec || getProjectDuration(),
          src: { type: 'narration' },
        });
      }

      if (items.length) {
        const sec = document.createElement('div');
        sec.className = 've-bin-section-title';
        sec.textContent = 'สื่อของงานนี้';
        body.appendChild(sec);
        items.forEach((it) => body.appendChild(createMediaCard(it)));
      }

      const customAssets = [
        ...state.assets.jobAssets.map((a) => ({
          kind: isAudioFile(a.file) || isAudioFile(a.mime) ? 'music' : 'video',
          ico: isAudioFile(a.file) ? '🎵' : isImageFile(a.file) ? '🖼️' : '🎥',
          label: a.file,
          durationSec: a.durationSec || (isImageFile(a.file) ? 4 : 5),
          src: { type: 'jobasset', file: a.file },
        })),
        ...state.assets.uploads.map((u) => ({
          kind: isAudioFile(u.originalName) || isAudioFile(u.mime) ? 'music' : 'video',
          ico: isAudioFile(u.originalName) ? '🎵' : isImageFile(u.originalName) ? '🖼️' : '🎥',
          label: u.originalName || u.filename,
          durationSec: u.durationSec || (isImageFile(u.originalName) ? 4 : 5),
          src: { type: 'upload', id: u.id },
        })),
      ];

      if (customAssets.length) {
        const sec2 = document.createElement('div');
        sec2.className = 've-bin-section-title';
        sec2.textContent = 'ไฟล์สื่อที่นำเข้า';
        body.appendChild(sec2);
        customAssets.forEach((it) => body.appendChild(createMediaCard(it)));
      }
    } else if (tab === 'music') {
      const hint = document.createElement('div');
      hint.className = 've-bin-hint';
      hint.textContent = 'กด ▶ เพื่อฟังตัวอย่าง หรือกด "ใช้เป็นเพลงประกอบ" เพื่อเปลี่ยนเพลงพื้นหลังทันที (ลากลงแทร็ก BGM ก็ได้)';
      body.appendChild(hint);

      const curKey = getCurrentBgmKey();
      const bgmList = state.assets.bgm.length ? state.assets.bgm : DEFAULT_BGM_LIST;

      bgmList.forEach((b) => {
        const key = `bgm:${b.name}`;
        const url = b.url || resolveSrcUrl({ type: 'bgm', name: b.name });
        const card = createMusicCard({
          label: b.label || b.name,
          meta: formatDuration(b.durationSec || 60),
          src: { type: 'bgm', name: b.name },
          durationSec: b.durationSec || 60,
          url,
          isCurrent: curKey === key,
        });
        body.appendChild(card);
      });

      // Also show uploaded/jobasset audio here so user can use custom MP3/WAV as BGM!
      const customAudios = [
        ...state.assets.jobAssets
          .filter((a) => isAudioFile(a.file) || isAudioFile(a.mime))
          .map((a) => ({
            key: `jobasset:${a.file}`,
            label: a.file,
            meta: `${formatDuration(a.durationSec || 10)} · อัปโหลดแล้ว`,
            src: { type: 'jobasset', file: a.file },
            durationSec: a.durationSec || 10,
            url: a.url || resolveSrcUrl({ type: 'jobasset', file: a.file }),
          })),
        ...state.assets.uploads
          .filter((u) => isAudioFile(u.originalName) || isAudioFile(u.mime))
          .map((u) => ({
            key: `upload:${u.id}`,
            label: u.originalName || u.filename,
            meta: `${formatDuration(u.durationSec || 10)} · เพิ่งอัปโหลด`,
            src: { type: 'upload', id: u.id },
            durationSec: u.durationSec || 10,
            url: resolveSrcUrl({ type: 'upload', id: u.id }),
          })),
      ];

      if (customAudios.length) {
        const sec = document.createElement('div');
        sec.className = 've-bin-section-title';
        sec.textContent = 'เพลงที่อัปโหลดเอง';
        body.appendChild(sec);
        customAudios.forEach((a) => {
          body.appendChild(createMusicCard({ ...a, isCurrent: curKey === a.key }));
        });
      }

      // Quick remove BGM button
      const muteBtn = document.createElement('button');
      muteBtn.type = 'button';
      muteBtn.className = 've-btn-secondary';
      muteBtn.style.marginTop = '6px';
      muteBtn.textContent = '🔇 ปิดเพลงประกอบ (ไม่ใส่ BGM)';
      muteBtn.addEventListener('click', () => setProjectBgm(null));
      body.appendChild(muteBtn);
    } else if (tab === 'sfx') {
      const hint = document.createElement('div');
      hint.className = 've-bin-hint';
      hint.textContent = 'กด ▶ ฟังตัวอย่าง แล้วลากลงแทร็กเอฟเฟกต์เสียง หรือกด "+ เพิ่ม" ที่ตำแหน่ง Playhead';
      body.appendChild(hint);

      if (!state.assets.sfx.length) {
        const empty = document.createElement('div');
        empty.style.color = 'var(--muted)';
        empty.style.padding = '12px 4px';
        empty.textContent = 'ไม่พบไฟล์เอฟเฟกต์เสียงในระบบ';
        body.appendChild(empty);
      } else {
        state.assets.sfx.forEach((s) => {
          const url = s.url || resolveSrcUrl({ type: 'sfx', name: s.name });
          const isPlaying = state.auditionUrl === url;
          const card = document.createElement('div');
          card.className = 've-asset-card';
          card.innerHTML = `
            <div class="ve-asset-top">
              <div class="ve-asset-badge" data-kind="sfx">✨</div>
              <div class="ve-asset-info">
                <div class="ve-asset-name">${escapeHtml(s.label || s.name)}</div>
                <div class="ve-asset-meta">${formatDuration(s.durationSec || 0.8)}</div>
              </div>
            </div>
            <div class="ve-asset-actions">
              <button type="button" class="ve-chip-btn ${isPlaying ? 'is-playing' : ''}" data-act="play">${isPlaying ? '⏹ หยุด' : '▶ ฟัง'}</button>
              <button type="button" class="ve-chip-btn is-cyan" data-act="add">+ เพิ่มที่ Playhead</button>
            </div>
          `;
          card.querySelector('[data-act="play"]').addEventListener('click', () => toggleAudition(url));
          card.querySelector('[data-act="add"]').addEventListener('click', () => {
            addClipToTrack('sfx', {
              label: s.label || s.name,
              src: { type: 'sfx', name: s.name },
              durationSec: s.durationSec || 0.8,
            });
          });
          attachDraggable(card, {
            kind: 'sfx',
            label: s.label || s.name,
            src: { type: 'sfx', name: s.name },
            durationSec: s.durationSec || 0.8,
          });
          body.appendChild(card);
        });
      }
    } else if (tab === 'text') {
      const hint = document.createElement('div');
      hint.className = 've-bin-hint';
      hint.textContent = 'คลิกรูปแบบข้อความเพื่อเพิ่มลงแทร็กข้อความยาว 3 วินาทีที่ตำแหน่ง Playhead หรือลากลงแทร็กโดยตรง';
      body.appendChild(hint);

      TEXT_PRESETS.forEach((p) => {
        const card = document.createElement('div');
        card.className = 've-asset-card';
        card.innerHTML = `
          <div class="ve-asset-top">
            <div class="ve-asset-badge" data-kind="text">T</div>
            <div class="ve-asset-info">
              <div class="ve-asset-name">${escapeHtml(p.name)}</div>
              <div class="ve-asset-meta">${escapeHtml(p.desc)}</div>
            </div>
          </div>
          <div class="ve-asset-actions">
            <button type="button" class="ve-chip-btn is-cyan" style="flex:1" data-act="add">+ เพิ่มข้อความ (3 วิ)</button>
          </div>
        `;
        card.querySelector('[data-act="add"]').addEventListener('click', () => addTextPreset(p));
        attachDraggable(card, {
          kind: 'text',
          label: p.name,
          text: p.text,
          fontSize: p.fontSize,
          color: p.color,
          x: p.x,
          y: p.y,
          durationSec: 3,
        });
        body.appendChild(card);
      });
    } else if (tab === 'upload') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,video/*,image/*';
      input.multiple = true;
      input.style.display = 'none';
      input.addEventListener('change', (e) => {
        handleUploadFiles(e.target.files);
        input.value = '';
      });
      body.appendChild(input);

      const dz = document.createElement('div');
      dz.className = 've-upload-dropzone';
      dz.innerHTML = `
        <div style="font-size:22px">⬆️</div>
        <strong>คลิกหรือวางไฟล์เพื่ออัปโหลด</strong>
        <span>รองรับ MP3, WAV, M4A, MP4, MOV, PNG, JPG (สูงสุด 60 MB)</span>
      `;
      dz.addEventListener('click', () => input.click());
      dz.addEventListener('dragover', (e) => {
        e.preventDefault();
        dz.classList.add('is-dragover');
      });
      dz.addEventListener('dragleave', () => dz.classList.remove('is-dragover'));
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        dz.classList.remove('is-dragover');
        if (e.dataTransfer && e.dataTransfer.files) {
          handleUploadFiles(e.dataTransfer.files);
        }
      });
      body.appendChild(dz);

      if (state.assets.uploads.length || state.assets.jobAssets.length) {
        const sec = document.createElement('div');
        sec.className = 've-bin-section-title';
        sec.textContent = 'ไฟล์ที่อัปโหลดในงานนี้';
        body.appendChild(sec);

        state.assets.uploads.forEach((u) => {
          const isAud = isAudioFile(u.originalName) || isAudioFile(u.mime);
          if (isAud) {
            body.appendChild(createMusicCard({
              label: u.originalName || u.filename,
              meta: `${formatDuration(u.durationSec || 10)} · อัปโหลดใหม่`,
              src: { type: 'upload', id: u.id },
              durationSec: u.durationSec || 10,
              url: resolveSrcUrl({ type: 'upload', id: u.id }),
              isCurrent: getCurrentBgmKey() === `upload:${u.id}`,
            }));
          } else {
            body.appendChild(createMediaCard({
              kind: 'video',
              ico: isImageFile(u.originalName) ? '🖼️' : '🎥',
              label: u.originalName || u.filename,
              durationSec: u.durationSec || 4,
              src: { type: 'upload', id: u.id },
            }));
          }
        });

        state.assets.jobAssets.forEach((a) => {
          const isAud = isAudioFile(a.file) || isAudioFile(a.mime);
          if (isAud) {
            body.appendChild(createMusicCard({
              label: a.file,
              meta: `${formatDuration(a.durationSec || 10)} · บันทึกในงานแล้ว`,
              src: { type: 'jobasset', file: a.file },
              durationSec: a.durationSec || 10,
              url: a.url || resolveSrcUrl({ type: 'jobasset', file: a.file }),
              isCurrent: getCurrentBgmKey() === `jobasset:${a.file}`,
            }));
          } else {
            body.appendChild(createMediaCard({
              kind: 'video',
              ico: isImageFile(a.file) ? '🖼️' : '🎥',
              label: a.file,
              durationSec: a.durationSec || 4,
              src: { type: 'jobasset', file: a.file },
            }));
          }
        });
      }
    }
  }

  function createMediaCard(it) {
    const card = document.createElement('div');
    card.className = 've-asset-card';
    card.innerHTML = `
      <div class="ve-asset-top">
        <div class="ve-asset-badge" data-kind="${escapeHtml(it.kind)}">${it.ico}</div>
        <div class="ve-asset-info">
          <div class="ve-asset-name" title="${escapeHtml(it.label)}">${escapeHtml(it.label)}</div>
          <div class="ve-asset-meta">${formatDuration(it.durationSec)}</div>
        </div>
      </div>
      <div class="ve-asset-actions">
        <button type="button" class="ve-chip-btn is-cyan" style="flex:1" data-act="add">+ เพิ่มลง Timeline</button>
      </div>
    `;
    card.querySelector('[data-act="add"]').addEventListener('click', () => {
      addClipToTrack(it.kind, {
        label: it.label,
        src: it.src,
        durationSec: it.durationSec,
      });
    });
    attachDraggable(card, {
      kind: it.kind,
      label: it.label,
      src: it.src,
      durationSec: it.durationSec,
    });
    return card;
  }

  function createMusicCard({ label, meta, src, durationSec, url, isCurrent }) {
    const isPlaying = state.auditionUrl === url;
    const card = document.createElement('div');
    card.className = `ve-asset-card${isCurrent ? ' is-current-bgm' : ''}`;
    card.innerHTML = `
      <div class="ve-asset-top">
        <div class="ve-asset-badge" data-kind="music">🎵</div>
        <div class="ve-asset-info">
          <div class="ve-asset-name" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
          <div class="ve-asset-meta">${escapeHtml(meta)}${isCurrent ? ' · กำลังใช้อยู่' : ''}</div>
        </div>
      </div>
      <div class="ve-asset-actions">
        <button type="button" class="ve-chip-btn ${isPlaying ? 'is-playing' : ''}" data-act="play">${isPlaying ? '⏹ หยุด' : '▶ ฟัง'}</button>
        <button type="button" class="ve-chip-btn is-accent" data-act="use">${isCurrent ? '✓ กำลังใช้' : 'ใช้เป็นเพลงประกอบ'}</button>
      </div>
    `;
    card.querySelector('[data-act="play"]').addEventListener('click', () => toggleAudition(url));
    card.querySelector('[data-act="use"]').addEventListener('click', () => setProjectBgm(src, label));
    attachDraggable(card, {
      kind: 'music',
      label,
      src,
      durationSec: durationSec || 60,
    });
    return card;
  }

  function probeClientMediaDuration(file, objUrl) {
    return new Promise((resolve) => {
      if (isImageFile(file.name) || isImageFile(file.type)) {
        resolve(4);
        return;
      }
      const el = document.createElement(isAudioFile(file.name) || isAudioFile(file.type) ? 'audio' : 'video');
      el.preload = 'metadata';
      const done = (val) => {
        el.src = '';
        resolve(Number.isFinite(val) && val > 0 ? round3(val) : 5);
      };
      const timer = setTimeout(() => done(5), 5000);
      el.onloadedmetadata = () => {
        clearTimeout(timer);
        done(el.duration);
      };
      el.onerror = () => {
        clearTimeout(timer);
        done(5);
      };
      el.src = objUrl;
    });
  }

  async function handleUploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        showToast(`ไฟล์ "${file.name}" ใหญ่เกิน 60 MB`);
        continue;
      }
      showToast(`กำลังอัปโหลด ${file.name}...`, 4000);
      try {
        const objUrl = URL.createObjectURL(file);
        const durationSec = await probeClientMediaDuration(file, objUrl);
        const dataUrl = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
          fr.readAsDataURL(file);
        });

        const resp = await fetchJsonSafe('/api/video-studio/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, filename: file.name }),
        });

        if (!resp.ok || !resp.data) {
          const msg = (resp.data && resp.data.error) || `HTTP ${resp.status}`;
          showToast(`อัปโหลดไม่สำเร็จ: ${msg}`);
          URL.revokeObjectURL(objUrl);
          continue;
        }

        const upId = resp.data.id || resp.data.uploadId;
        state.localObjectUrls.set(`upload:${upId}`, objUrl);
        state.assets.uploads.unshift({
          id: upId,
          filename: resp.data.filename,
          originalName: resp.data.originalName || file.name,
          mime: resp.data.mime || file.type,
          durationSec,
        });
        renderMediaBin();
        renderInspector();
        showToast(`อัปโหลด "${file.name}" สำเร็จ!`);
      } catch (err) {
        showToast(`อัปโหลดพลาด: ${err.message}`);
      }
    }
  }

  // =========================================================================
  // INSPECTOR
  // =========================================================================
  function renderInspector() {
    const body = dom.inspectorBody;
    body.innerHTML = '';

    if (!state.project) {
      dom.inspectorTitle.textContent = 'โปรเจกต์';
      dom.inspectorPill.textContent = 'กำลังโหลด';
      return;
    }

    const found = state.selectedClipId ? findClipById(state.selectedClipId) : null;
    if (!found) {
      renderProjectInspector(body);
      return;
    }

    const { track, clip } = found;
    const kind = track.kind;
    dom.inspectorTitle.textContent = clip.label || KIND_LABELS[kind] || 'คลิป';
    dom.inspectorPill.textContent = KIND_LABELS[kind] || kind;

    const mutateClip = (mutator) => {
      const next = clone(state.project);
      const target = findClipById(clip.id, next);
      if (!target) return;
      mutator(target.clip, target.track, next);
      applyProjectChange(next);
    };

    // MUSIC SPECIFIC (BGM Switcher + Volume + Ducking + Fade + Loop)
    if (kind === 'music') {
      const grp = createGroup('เพลงประกอบ (BGM)');
      const choices = getAllMusicChoices();
      const curKey = clip.src
        ? clip.src.type === 'bgm' ? `bgm:${clip.src.name}`
          : clip.src.type === 'jobasset' ? `jobasset:${clip.src.file}`
            : clip.src.type === 'upload' ? `upload:${clip.src.id}` : ''
        : '';

      const selField = document.createElement('div');
      selField.className = 've-field';
      selField.innerHTML = `<label>เปลี่ยนเพลง</label>`;
      const sel = document.createElement('select');
      sel.className = 've-select';
      choices.forEach((ch) => {
        const opt = document.createElement('option');
        opt.value = ch.key;
        opt.textContent = ch.label;
        if (ch.key === curKey) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        const picked = choices.find((c) => c.key === sel.value);
        if (!picked) return;
        mutateClip((c) => {
          c.src = clone(picked.src);
          c.label = picked.shortLabel;
          c.in = 0;
        });
      });
      selField.appendChild(sel);
      grp.appendChild(selField);

      grp.appendChild(createSliderField('ความดังเพลง', Math.round((clip.volume ?? 0.14) * 100), 0, 200, 1, '%', (v) => {
        mutateClip((c) => { c.volume = round3(v / 100); });
      }));
      grp.appendChild(createSliderField('ลดเสียงอัตโนมัติตอนพูด (Duck)', clip.duckDb ?? 12, 0, 30, 1, ' dB', (v) => {
        mutateClip((c) => { c.duckDb = v; });
      }));

      const fadeGrid = document.createElement('div');
      fadeGrid.className = 've-field-grid-2';
      fadeGrid.appendChild(createNumberField('Fade In (วิ)', clip.fadeIn ?? 0, 0, 10, 0.1, (v) => {
        mutateClip((c) => { c.fadeIn = clamp(v, 0, 10); });
      }));
      fadeGrid.appendChild(createNumberField('Fade Out (วิ)', clip.fadeOut ?? 0, 0, 10, 0.1, (v) => {
        mutateClip((c) => { c.fadeOut = clamp(v, 0, 10); });
      }));
      grp.appendChild(fadeGrid);

      const loopLbl = document.createElement('label');
      loopLbl.className = 've-checkbox-row';
      loopLbl.innerHTML = `<input type="checkbox" ${clip.loop ? 'checked' : ''} /> <span>วนลูปเพลงจนจบคลิป</span>`;
      loopLbl.querySelector('input').addEventListener('change', (e) => {
        mutateClip((c) => { c.loop = e.target.checked; });
      });
      grp.appendChild(loopLbl);
      body.appendChild(grp);
    }

    // VOICE / SFX SPECIFIC
    if (kind === 'voice' || kind === 'sfx') {
      const grp = createGroup('เสียง (Audio)');
      grp.appendChild(createSliderField('ความดังเสียง', Math.round((clip.volume ?? 1) * 100), 0, 200, 1, '%', (v) => {
        mutateClip((c) => { c.volume = round3(v / 100); });
      }));
      grp.appendChild(createSliderField('ความเร็ว', clip.speed ?? 1, 0.5, 2, 0.05, 'x', (v) => {
        mutateClip((c) => { c.speed = clamp(v, 0.5, 2); });
      }));
      const fadeGrid = document.createElement('div');
      fadeGrid.className = 've-field-grid-2';
      fadeGrid.appendChild(createNumberField('Fade In (วิ)', clip.fadeIn ?? 0, 0, 10, 0.1, (v) => {
        mutateClip((c) => { c.fadeIn = clamp(v, 0, 10); });
      }));
      fadeGrid.appendChild(createNumberField('Fade Out (วิ)', clip.fadeOut ?? 0, 0, 10, 0.1, (v) => {
        mutateClip((c) => { c.fadeOut = clamp(v, 0, 10); });
      }));
      grp.appendChild(fadeGrid);
      body.appendChild(grp);
    }

    // VIDEO SPECIFIC
    if (kind === 'video') {
      const grp = createGroup('วิดีโอ & ตำแหน่ง');
      grp.appendChild(createSliderField('ความเร็วเล่น', clip.speed ?? 1, 0.25, 4, 0.05, 'x', (v) => {
        mutateClip((c) => { c.speed = clamp(v, 0.25, 4); });
      }));
      const tr = clip.transform || { x: 0.5, y: 0.5, scale: 1 };
      grp.appendChild(createSliderField('ขนาด (Scale)', Math.round((tr.scale ?? 1) * 100), 20, 250, 1, '%', (v) => {
        mutateClip((c) => {
          c.transform = { ...(c.transform || { x: 0.5, y: 0.5, scale: 1 }), scale: round3(v / 100) };
        });
      }));
      grp.appendChild(createSliderField('ตำแหน่ง X', Math.round((tr.x ?? 0.5) * 100), 0, 100, 1, '%', (v) => {
        mutateClip((c) => {
          c.transform = { ...(c.transform || { x: 0.5, y: 0.5, scale: 1 }), x: round3(v / 100) };
        });
      }));
      grp.appendChild(createSliderField('ตำแหน่ง Y', Math.round((tr.y ?? 0.5) * 100), 0, 100, 1, '%', (v) => {
        mutateClip((c) => {
          c.transform = { ...(c.transform || { x: 0.5, y: 0.5, scale: 1 }), y: round3(v / 100) };
        });
      }));
      body.appendChild(grp);
    }

    // TEXT SPECIFIC
    if (kind === 'text') {
      const grp = createGroup('ข้อความโอเวอร์เลย์');
      const tf = document.createElement('div');
      tf.className = 've-field';
      tf.innerHTML = `<label>เนื้อหาข้อความ</label>`;
      const ta = document.createElement('textarea');
      ta.className = 've-textarea';
      ta.value = clip.text || '';
      ta.addEventListener('input', () => {
        mutateClip((c) => {
          c.text = ta.value;
          c.label = ta.value.slice(0, 28) || 'ข้อความ';
        });
      });
      tf.appendChild(ta);
      grp.appendChild(tf);

      grp.appendChild(createSliderField('ขนาดตัวอักษร', clip.fontSize ?? 48, 16, 160, 1, 'px', (v) => {
        mutateClip((c) => { c.fontSize = Math.round(v); });
      }));

      const cf = document.createElement('div');
      cf.className = 've-field';
      cf.innerHTML = `<label>สีตัวอักษร</label>`;
      const sw = document.createElement('div');
      sw.className = 've-swatches';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = clip.color || '#ffffff';
      colorInput.style.width = '32px';
      colorInput.style.height = '26px';
      colorInput.style.border = 'none';
      colorInput.style.background = 'none';
      colorInput.addEventListener('input', () => {
        mutateClip((c) => { c.color = colorInput.value; });
      });
      sw.appendChild(colorInput);
      ['#ffffff', '#fde047', '#22d3ee', '#f472b6', '#4ade80', '#fb923c'].forEach((hex) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 've-swatch';
        b.style.background = hex;
        b.title = hex;
        b.addEventListener('click', () => {
          mutateClip((c) => { c.color = hex; });
        });
        sw.appendChild(b);
      });
      cf.appendChild(sw);
      grp.appendChild(cf);

      grp.appendChild(createSliderField('ตำแหน่งแนวนอน (X)', Math.round((clip.x ?? 0.5) * 100), 5, 95, 1, '%', (v) => {
        mutateClip((c) => { c.x = round3(v / 100); });
      }));
      grp.appendChild(createSliderField('ตำแหน่งแนวตั้ง (Y)', Math.round((clip.y ?? 0.8) * 100), 5, 95, 1, '%', (v) => {
        mutateClip((c) => { c.y = round3(v / 100); });
      }));
      body.appendChild(grp);
    }

    // COMMON TIMING GROUP
    const timeGrp = createGroup('ช่วงเวลาใน Timeline');
    const grid = document.createElement('div');
    grid.className = 've-field-grid-2';
    grid.appendChild(createNumberField('เริ่มที่ (วิ)', round3(clip.start), 0, 7200, 0.1, (v) => {
      mutateClip((c) => { c.start = Math.max(0, round3(v)); });
    }));
    grid.appendChild(createNumberField('ความยาว (วิ)', round3(clipDuration(clip)), 0.1, 7200, 0.1, (v) => {
      mutateClip((c) => {
        const spd = Math.max(0.25, Number(c.speed) || 1);
        c.out = round3(c.in + Math.max(0.1, v) * spd);
      });
    }));
    timeGrp.appendChild(grid);
    body.appendChild(timeGrp);

    // ACTIONS
    const actGrp = createGroup('จัดการคลิป');
    if (clip.linkId) {
      const unlinkBtn = document.createElement('button');
      unlinkBtn.type = 'button';
      unlinkBtn.className = 've-btn-secondary';
      unlinkBtn.textContent = '🔓 แยกการผูกวิดีโอ-เสียง (Unlink)';
      unlinkBtn.addEventListener('click', () => {
        mutateClip((c, _tr, next) => {
          const lid = c.linkId;
          for (const t of next.tracks) {
            for (const cl of t.clips) {
              if (cl.linkId === lid) delete cl.linkId;
            }
          }
        });
        showToast('แยกการผูกคลิปแล้ว');
      });
      actGrp.appendChild(unlinkBtn);
    }
    const delRow = document.createElement('div');
    delRow.className = 've-field-grid-2';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 've-btn-danger';
    delBtn.textContent = '🗑 ลบคลิป';
    delBtn.addEventListener('click', () => deleteSelected(false));
    const ripBtn = document.createElement('button');
    ripBtn.type = 'button';
    ripBtn.className = 've-btn-danger';
    ripBtn.textContent = '🗑 ลบเลื่อนชิด';
    ripBtn.addEventListener('click', () => deleteSelected(true));
    delRow.appendChild(delBtn);
    delRow.appendChild(ripBtn);
    actGrp.appendChild(delRow);
    body.appendChild(actGrp);
  }

  function renderProjectInspector(body) {
    dom.inspectorTitle.textContent = 'ตั้งค่าโปรเจกต์';
    dom.inspectorPill.textContent = `${state.project.width}×${state.project.height}`;

    // Quick BGM Switcher shortcut right in Project Inspector!
    const bgmGrp = createGroup('🎵 เปลี่ยนเพลงประกอบ (ทางลัด)');
    const choices = getAllMusicChoices();
    const curKey = getCurrentBgmKey();
    const selField = document.createElement('div');
    selField.className = 've-field';
    selField.innerHTML = `<label>เลือกเพลงพื้นหลัง</label>`;
    const sel = document.createElement('select');
    sel.className = 've-select';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '🔇 ไม่ใส่เพลงประกอบ';
    if (!curKey) noneOpt.selected = true;
    sel.appendChild(noneOpt);
    choices.forEach((ch) => {
      const opt = document.createElement('option');
      opt.value = ch.key;
      opt.textContent = ch.label;
      if (ch.key === curKey) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      if (!sel.value) {
        setProjectBgm(null);
        return;
      }
      const picked = choices.find((c) => c.key === sel.value);
      if (picked) setProjectBgm(picked.src, picked.shortLabel);
    });
    selField.appendChild(sel);
    bgmGrp.appendChild(selField);
    body.appendChild(bgmGrp);

    // Master Audio
    const masterGrp = createGroup('เสียงรวม (Master Audio)');
    const master = state.project.master || { volume: 1, lufs: -14 };
    masterGrp.appendChild(createSliderField('Master Volume', Math.round((master.volume ?? 1) * 100), 0, 200, 1, '%', (v) => {
      const next = clone(state.project);
      next.master = { ...(next.master || { volume: 1, lufs: -14 }), volume: round3(v / 100) };
      applyProjectChange(next);
    }));
    masterGrp.appendChild(createSliderField('ความดังมาตรฐาน (LUFS)', master.lufs ?? -14, -24, -8, 1, ' LUFS', (v) => {
      const next = clone(state.project);
      next.master = { ...(next.master || { volume: 1, lufs: -14 }), lufs: Math.round(v) };
      applyProjectChange(next);
    }));
    body.appendChild(masterGrp);

    // Info & Reset
    const infoGrp = createGroup('ข้อมูลโปรเจกต์');
    const metaDiv = document.createElement('div');
    metaDiv.style.fontSize = '12px';
    metaDiv.style.color = 'var(--ink-2)';
    metaDiv.innerHTML = `
      <div>ความละเอียด: <strong>${state.project.width} × ${state.project.height}</strong></div>
      <div>เฟรมเรต: <strong>${state.project.fps || 30} fps</strong></div>
      <div>ความยาวรวม: <strong>${formatDuration(getProjectDuration())}</strong></div>
    `;
    infoGrp.appendChild(metaDiv);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 've-btn-danger';
    resetBtn.style.marginTop = '6px';
    resetBtn.textContent = '↺ รีเซ็ตโปรเจกต์จากวิดีโอ AI';
    resetBtn.addEventListener('click', handleResetProject);
    infoGrp.appendChild(resetBtn);
    body.appendChild(infoGrp);
  }

  function createGroup(title) {
    const grp = document.createElement('div');
    grp.className = 've-field-group';
    const t = document.createElement('div');
    t.className = 've-field-group-title';
    t.textContent = title;
    grp.appendChild(t);
    return grp;
  }

  function createSliderField(label, value, min, max, step, unit, onChange) {
    const f = document.createElement('div');
    f.className = 've-field';
    const row = document.createElement('div');
    row.className = 've-field-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const valSpan = document.createElement('span');
    valSpan.className = 've-field-val';
    valSpan.textContent = `${value}${unit}`;
    row.appendChild(lbl);
    row.appendChild(valSpan);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 've-range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.addEventListener('input', () => {
      valSpan.textContent = `${input.value}${unit}`;
    });
    input.addEventListener('change', () => {
      onChange(parseFloat(input.value));
    });

    f.appendChild(row);
    f.appendChild(input);
    return f;
  }

  function createNumberField(label, value, min, max, step, onChange) {
    const f = document.createElement('div');
    f.className = 've-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 've-input';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.addEventListener('change', () => {
      const n = parseFloat(input.value);
      if (Number.isFinite(n)) onChange(n);
    });
    f.appendChild(lbl);
    f.appendChild(input);
    return f;
  }

  async function handleResetProject() {
    if (!state.jobId) return;
    if (!window.confirm('ต้องการรีเซ็ตโปรเจกต์กลับเป็นค่าเริ่มต้นจากวิดีโอ AI ใช่หรือไม่? การตัดต่อที่ทำไว้จะถูกล้าง')) {
      return;
    }
    if (state.apiUnavailable) {
      showToast('ไม่สามารถรีเซ็ตได้: API ยังไม่พร้อม');
      return;
    }
    try {
      const resp = await fetchJsonSafe(`/api/video-studio/jobs/${encodeURIComponent(state.jobId)}/project/reset`, {
        method: 'POST',
      });
      if (!resp.ok || !resp.data || !resp.data.project) {
        showToast('รีเซ็ตโปรเจกต์ไม่สำเร็จ');
        return;
      }
      state.selectedClipId = null;
      applyProjectChange(resp.data.project, { skipSave: true });
      state.isDirty = false;
      updateSaveStatus('saved', 'รีเซ็ตแล้ว');
      showToast('รีเซ็ตโปรเจกต์เรียบร้อยแล้ว');
    } catch (err) {
      showToast(`รีเซ็ตไม่สำเร็จ: ${err.message}`);
    }
  }

  // =========================================================================
  // PREVIEW ENGINE (VIDEO + OVERLAY + TEXT + WEB AUDIO MIXER)
  // =========================================================================
  function ensureAudioContext() {
    if (!state.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      state.audioCtx = new Ctx();
      state.masterGain = state.audioCtx.createGain();
      state.masterGain.connect(state.audioCtx.destination);
    }
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(() => {});
    }
    const vol = state.masterMuted ? 0 : ((state.project && state.project.master && state.project.master.volume) ?? 1);
    state.masterGain.gain.setValueAtTime(clamp(vol, 0, 2), state.audioCtx.currentTime);
    return state.audioCtx;
  }

  function loadAudioBuffer(url) {
    if (!url) return Promise.resolve(null);
    if (state.audioBufferCache.has(url)) {
      return state.audioBufferCache.get(url);
    }
    const ctx = ensureAudioContext();
    if (!ctx) return Promise.resolve(null);

    const p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => (buf ? ctx.decodeAudioData(buf.slice(0)) : null))
      .catch(() => null);

    state.audioBufferCache.set(url, p);
    return p;
  }

  function stopAllAudioNodes() {
    for (const node of state.activeAudioNodes) {
      try {
        node.stop();
      } catch (_) {}
      try {
        node.disconnect();
      } catch (_) {}
    }
    state.activeAudioNodes = [];
  }

  function getVoiceIntervals(proj) {
    const intervals = [];
    for (const tr of proj.tracks || []) {
      if (tr.kind !== 'voice' || tr.muted) continue;
      for (const c of tr.clips || []) {
        intervals.push([c.start, c.start + clipDuration(c)]);
      }
    }
    return intervals;
  }

  function scheduleAllAudioFrom(startSec) {
    if (!state.project) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const proj = state.project;
    const voiceIntervals = getVoiceIntervals(proj);
    const scheduleToken = Symbol('play');
    state._playToken = scheduleToken;

    for (const tr of proj.tracks || []) {
      if (tr.muted) continue;
      if (tr.kind !== 'voice' && tr.kind !== 'music' && tr.kind !== 'sfx') continue;

      for (const clip of tr.clips || []) {
        const dur = clipDuration(clip);
        const clipEnd = clip.start + dur;
        if (clipEnd <= startSec) continue;

        const url = resolveSrcUrl(clip.src);
        if (!url) continue;

        loadAudioBuffer(url).then((buffer) => {
          if (!buffer || !state.isPlaying || state._playToken !== scheduleToken) return;
          const nowT = state.currentTime;
          if (clipEnd <= nowT) return;

          const spd = Math.max(0.25, Number(clip.speed) || 1);
          const delay = Math.max(0, clip.start - nowT);
          const elapsedInClip = Math.max(0, nowT - clip.start);
          const remainingDur = Math.max(0.02, clipEnd - Math.max(nowT, clip.start));
          let srcOffset = (Number(clip.in) || 0) + elapsedInClip * spd;

          const srcNode = ctx.createBufferSource();
          srcNode.buffer = buffer;
          srcNode.playbackRate.value = spd;

          if (tr.kind === 'music' && clip.loop && buffer.duration > 0) {
            srcNode.loop = true;
            srcNode.loopStart = 0;
            srcNode.loopEnd = buffer.duration;
            srcOffset = srcOffset % buffer.duration;
          } else if (srcOffset >= buffer.duration) {
            return;
          }

          const gainNode = ctx.createGain();
          const baseVol = clamp(clip.volume ?? (tr.kind === 'music' ? 0.14 : 1), 0, 2);
          const when = ctx.currentTime + delay;
          const endWhen = when + remainingDur;

          gainNode.gain.setValueAtTime(baseVol, when);

          // Fade in
          const fi = Math.min(Number(clip.fadeIn) || 0, dur / 2);
          if (fi > 0 && elapsedInClip < fi) {
            const startRatio = elapsedInClip / fi;
            gainNode.gain.setValueAtTime(baseVol * startRatio, when);
            gainNode.gain.linearRampToValueAtTime(baseVol, when + (fi - elapsedInClip));
          }

          // Approximate auto-ducking for music track
          if (tr.kind === 'music' && (clip.duckDb || 0) > 0 && voiceIntervals.length) {
            const duckGain = baseVol * Math.pow(10, -clamp(clip.duckDb, 0, 30) / 20);
            const clipWinStart = Math.max(nowT, clip.start);
            for (const [vs, ve] of voiceIntervals) {
              if (ve <= clipWinStart || vs >= clipEnd) continue;
              const dStart = ctx.currentTime + Math.max(0, vs - nowT);
              const dEnd = ctx.currentTime + Math.max(0, Math.min(ve, clipEnd) - nowT);
              if (dStart <= ctx.currentTime + 0.02) {
                gainNode.gain.setValueAtTime(duckGain, dStart);
              } else {
                gainNode.gain.setValueAtTime(baseVol, Math.max(when, dStart - 0.12));
                gainNode.gain.linearRampToValueAtTime(duckGain, dStart);
              }
              gainNode.gain.setValueAtTime(duckGain, Math.max(dStart, dEnd - 0.02));
              gainNode.gain.linearRampToValueAtTime(baseVol, Math.min(endWhen, dEnd + 0.25));
            }
          }

          // Fade out
          const fo = Math.min(Number(clip.fadeOut) || 0, dur / 2);
          if (fo > 0 && remainingDur > 0.05) {
            const foStart = Math.max(when, endWhen - fo);
            gainNode.gain.setValueAtTime(baseVol, foStart);
            gainNode.gain.linearRampToValueAtTime(0.0001, endWhen);
          }

          srcNode.connect(gainNode);
          gainNode.connect(state.masterGain);

          try {
            srcNode.start(when, Math.max(0, srcOffset));
            srcNode.stop(endWhen);
            state.activeAudioNodes.push(srcNode);
          } catch (_) {}
        });
      }
    }
  }

  function findActiveClipOnTrack(track, t) {
    if (!track || track.hidden || !Array.isArray(track.clips)) return null;
    for (const c of track.clips) {
      if (t >= c.start && t < c.start + clipDuration(c)) {
        return c;
      }
    }
    return null;
  }

  function renderPreviewAt(t) {
    if (!state.project) return;
    const fps = state.project.fps || 30;
    dom.tcCur.textContent = formatTimecode(t, fps);

    // 1. Main Video Track (v1 / first video track)
    const videoTracks = state.project.tracks.filter((tr) => tr.kind === 'video');
    const mainTrack = videoTracks[0];
    const activeMain = findActiveClipOnTrack(mainTrack, t);

    if (activeMain) {
      const url = resolveSrcUrl(activeMain.src);
      const spd = Math.max(0.25, Number(activeMain.speed) || 1);
      const srcTime = (Number(activeMain.in) || 0) + (t - activeMain.start) * spd;

      dom.stageEmpty.style.display = 'none';
      dom.video.style.display = 'block';

      if (url && state.lastVideoSrc !== url) {
        state.lastVideoSrc = url;
        dom.video.src = url;
        dom.video.load();
      }
      if (dom.video.readyState >= 1) {
        const drift = Math.abs((dom.video.currentTime || 0) - srcTime);
        if (!state.isPlaying || drift > 0.22) {
          try { dom.video.currentTime = Math.max(0, srcTime); } catch (_) {}
        }
        dom.video.playbackRate = spd;
        if (state.isPlaying && dom.video.paused) {
          dom.video.play().catch(() => {});
        } else if (!state.isPlaying && !dom.video.paused) {
          dom.video.pause();
        }
      }

      const tr = activeMain.transform || { x: 0.5, y: 0.5, scale: 1 };
      const tx = ((tr.x ?? 0.5) - 0.5) * 100;
      const ty = ((tr.y ?? 0.5) - 0.5) * 100;
      dom.video.style.transform = `translate(${tx}%, ${ty}%) scale(${tr.scale ?? 1})`;
    } else {
      dom.stageEmpty.style.display = 'flex';
      dom.video.style.display = 'none';
      if (!dom.video.paused) dom.video.pause();
    }

    // 2. Overlay Video/Image Track (v2 / second video track)
    const overlayTrack = videoTracks[1];
    const activeOverlay = findActiveClipOnTrack(overlayTrack, t);
    if (activeOverlay) {
      const url = resolveSrcUrl(activeOverlay.src);
      const tr = activeOverlay.transform || { x: 0.5, y: 0.5, scale: 1 };
      const tx = ((tr.x ?? 0.5) - 0.5) * 100;
      const ty = ((tr.y ?? 0.5) - 0.5) * 100;
      const tf = `translate(${tx}%, ${ty}%) scale(${tr.scale ?? 1})`;
      const nameHint = (activeOverlay.src && (activeOverlay.src.file || activeOverlay.label)) || '';

      if (isImageFile(nameHint)) {
        dom.overlayVideo.style.display = 'none';
        if (!dom.overlayVideo.paused) dom.overlayVideo.pause();
        dom.overlayImg.style.display = 'block';
        if (dom.overlayImg.src !== url) dom.overlayImg.src = url;
        dom.overlayImg.style.transform = tf;
      } else {
        dom.overlayImg.style.display = 'none';
        dom.overlayVideo.style.display = 'block';
        if (url && state.lastOverlaySrc !== url) {
          state.lastOverlaySrc = url;
          dom.overlayVideo.src = url;
          dom.overlayVideo.load();
        }
        const spd = Math.max(0.25, Number(activeOverlay.speed) || 1);
        const srcTime = (Number(activeOverlay.in) || 0) + (t - activeOverlay.start) * spd;
        if (dom.overlayVideo.readyState >= 1) {
          if (!state.isPlaying || Math.abs((dom.overlayVideo.currentTime || 0) - srcTime) > 0.25) {
            try { dom.overlayVideo.currentTime = Math.max(0, srcTime); } catch (_) {}
          }
          dom.overlayVideo.playbackRate = spd;
          if (state.isPlaying && dom.overlayVideo.paused) dom.overlayVideo.play().catch(() => {});
          else if (!state.isPlaying && !dom.overlayVideo.paused) dom.overlayVideo.pause();
        }
        dom.overlayVideo.style.transform = tf;
      }
    } else {
      dom.overlayImg.style.display = 'none';
      dom.overlayVideo.style.display = 'none';
      if (!dom.overlayVideo.paused) dom.overlayVideo.pause();
    }

    // 3. Text Overlays
    const stageH = dom.stage.clientHeight || 480;
    const projH = state.project.height || 1920;
    const scaleRatio = stageH / projH;
    const textTracks = state.project.tracks.filter((tr) => tr.kind === 'text' && !tr.hidden);
    const activeTexts = [];
    for (const tr of textTracks) {
      for (const c of tr.clips || []) {
        if (t >= c.start && t < c.start + clipDuration(c)) {
          activeTexts.push(c);
        }
      }
    }

    dom.textOverlays.innerHTML = '';
    for (const tc of activeTexts) {
      const div = document.createElement('div');
      div.className = `ve-text-item${tc.id === state.selectedClipId ? ' is-selected' : ''}`;
      div.textContent = tc.text || '';
      div.style.left = `${(tc.x ?? 0.5) * 100}%`;
      div.style.top = `${(tc.y ?? 0.8) * 100}%`;
      div.style.color = tc.color || '#ffffff';
      div.style.fontSize = `${Math.max(10, Math.round((tc.fontSize || 48) * scaleRatio))}px`;
      dom.textOverlays.appendChild(div);
    }
  }

  function updateTotalTimecode() {
    if (!state.project) return;
    dom.tcTotal.textContent = formatTimecode(getProjectDuration(), state.project.fps || 30);
  }

  function seekTo(sec, { fromTimeline = false } = {}) {
    const dur = getProjectDuration();
    state.currentTime = clamp(sec, 0, dur);
    if (!fromTimeline && state.timeline && typeof state.timeline.setTime === 'function') {
      state.timeline.setTime(state.currentTime);
    }
    renderPreviewAt(state.currentTime);
    if (state.isPlaying) {
      state.playStartWall = performance.now();
      state.playStartTime = state.currentTime;
      stopAllAudioNodes();
      scheduleAllAudioFrom(state.currentTime);
    }
  }

  function startPlayback() {
    if (!state.project) return;
    if (state.auditionAudio && !state.auditionAudio.paused) {
      stopAudition();
    }
    const dur = getProjectDuration();
    if (state.currentTime >= dur - 0.05) {
      state.currentTime = 0;
    }
    state.isPlaying = true;
    dom.btnPlay.textContent = '⏸';
    state.playStartWall = performance.now();
    state.playStartTime = state.currentTime;

    ensureAudioContext();
    stopAllAudioNodes();
    scheduleAllAudioFrom(state.currentTime);

    const tick = (now) => {
      if (!state.isPlaying) return;
      const elapsed = (now - state.playStartWall) / 1000;
      const nextT = state.playStartTime + elapsed;
      const total = getProjectDuration();
      if (nextT >= total) {
        state.currentTime = total;
        pausePlayback();
        renderPreviewAt(total);
        if (state.timeline && typeof state.timeline.setTime === 'function') {
          state.timeline.setTime(total);
        }
        return;
      }
      state.currentTime = nextT;
      renderPreviewAt(nextT);
      if (state.timeline && typeof state.timeline.setTime === 'function') {
        state.timeline.setTime(nextT);
      }
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  function pausePlayback() {
    state.isPlaying = false;
    dom.btnPlay.textContent = '▶';
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    stopAllAudioNodes();
    if (!dom.video.paused) dom.video.pause();
    if (!dom.overlayVideo.paused) dom.overlayVideo.pause();
  }

  function togglePlayback() {
    if (state.isPlaying) pausePlayback();
    else startPlayback();
  }

  // =========================================================================
  // EXPORT FLOW
  // =========================================================================
  async function startExport() {
    if (!state.jobId || !state.project) return;
    if (state.apiUnavailable) {
      showToast('ไม่สามารถ Export ได้: ต้องรีสตาร์ท lab-dashboard เพื่อเปิดใช้ API');
      return;
    }
    pausePlayback();

    if (state.isDirty) {
      const saved = await saveProjectNow({ silent: true });
      if (!saved) return;
    }

    openModal('ve-modal-export');
    dom.modalExportFooter.innerHTML = `<button type="button" class="ve-btn-secondary" data-close-modal="ve-modal-export">ซ่อนหน้าต่าง</button>`;
    renderExportProgress(5, 'กำลังส่งคำสั่ง Export ไปยังเซิร์ฟเวอร์...');

    try {
      const resp = await fetchJsonSafe(`/api/video-studio/jobs/${encodeURIComponent(state.jobId)}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: state.project }),
      });
      if (!resp.ok) {
        const msg = (resp.data && resp.data.error) || `HTTP ${resp.status}`;
        renderExportError(`เริ่ม Export ไม่สำเร็จ: ${msg}`);
        return;
      }
      pollExportStatus();
    } catch (err) {
      renderExportError(`เชื่อมต่อไม่สำเร็จ: ${err.message}`);
    }
  }

  function renderExportProgress(pct, msg) {
    const p = clamp(pct, 0, 100);
    dom.modalExportBody.innerHTML = `
      <div style="font-size:13px;color:var(--ink)">${escapeHtml(msg || 'กำลังเรนเดอร์วิดีโอ...')}</div>
      <div class="ve-progress-track"><div class="ve-progress-fill" style="width:${p}%"></div></div>
      <div style="font-family:var(--mono);font-size:12px;color:var(--cyan);text-align:right">${Math.round(p)}%</div>
    `;
  }

  function renderExportError(msg) {
    dom.modalExportBody.innerHTML = `
      <div style="padding:12px;border-radius:8px;background:var(--red-soft);border:1px solid rgba(239,68,68,0.4);color:#fecaca">
        <strong>Export ไม่สำเร็จ</strong>
        <div style="margin-top:4px">${escapeHtml(msg)}</div>
      </div>
    `;
    dom.modalExportFooter.innerHTML = `<button type="button" class="ve-btn-secondary" data-close-modal="ve-modal-export">ปิด</button>`;
  }

  function renderExportSuccess(jobData) {
    const versions = Array.isArray(jobData.versions) ? jobData.versions : [];
    const latest = versions.length ? versions[versions.length - 1] : null;
    const jobEnc = encodeURIComponent(state.jobId);
    const fileUrl = latest && latest.file
      ? `/api/video-studio/file/${jobEnc}/${encodeURIComponent(latest.file)}?t=${Date.now()}`
      : (latest && latest.watchUrl) || `/api/video-studio/file/${jobEnc}/final.mp4?t=${Date.now()}`;
    const dlUrl = latest && latest.file
      ? `/api/video-studio/file/${jobEnc}/${encodeURIComponent(latest.file)}?download=1`
      : (latest && latest.downloadUrl) || `/api/video-studio/file/${jobEnc}/final.mp4?download=1`;

    const verLabel = latest ? `v${latest.version} · ${formatDuration(latest.durationSec || 0)}` : 'เวอร์ชันล่าสุด';
    dom.modalExportBody.innerHTML = `
      <div style="color:var(--green);font-weight:600">✓ Export วิดีโอเสร็จสมบูรณ์ (${escapeHtml(verLabel)})</div>
      <video class="ve-export-video" controls playsinline src="${escapeHtml(fileUrl)}"></video>
      <div style="font-size:12px;color:var(--muted)">${escapeHtml(jobData.message || '')}</div>
    `;
    dom.modalExportFooter.innerHTML = `
      <a class="ve-btn-primary" href="${escapeHtml(dlUrl)}" download style="text-decoration:none">⬇ ดาวน์โหลด MP4</a>
      <button type="button" class="ve-btn-secondary" data-close-modal="ve-modal-export">ปิด</button>
    `;
  }

  function pollExportStatus() {
    clearTimeout(state.exportPollTimer);
    const activeStatuses = new Set(['queued', 'editing', 'rendering', 'running', 'exporting']);

    const step = async () => {
      try {
        const resp = await fetchJsonSafe(`/api/video-studio/jobs/${encodeURIComponent(state.jobId)}`);
        if (!resp.ok || !resp.data) {
          state.exportPollTimer = setTimeout(step, 2500);
          return;
        }
        const job = resp.data.job || resp.data;
        const st = String(job.status || '').toLowerCase();
        if (activeStatuses.has(st)) {
          renderExportProgress(job.progress ?? 15, job.message || `กำลังประมวลผล (${st})...`);
          state.exportPollTimer = setTimeout(step, 2000);
          return;
        }
        if (st === 'done' || st === 'completed') {
          renderExportSuccess(job);
          refreshEditorAssets();
        } else {
          renderExportError(job.error || job.message || `สถานะงาน: ${st}`);
        }
      } catch (_) {
        state.exportPollTimer = setTimeout(step, 2500);
      }
    };
    state.exportPollTimer = setTimeout(step, 1500);
  }

  // =========================================================================
  // MODALS & JOB PICKER
  // =========================================================================
  function openModal(id) {
    const el = $(id);
    if (el) el.classList.add('is-open');
  }

  function closeModal(id) {
    const el = $(id);
    if (el) el.classList.remove('is-open');
  }

  async function openJobPicker() {
    openModal('ve-modal-jobs');
    dom.modalJobsBody.innerHTML = `<div style="color:var(--muted)">กำลังโหลดรายการงานล่าสุด...</div>`;
    try {
      const resp = await fetchJsonSafe('/api/video-studio/jobs');
      const jobs = (resp.data && Array.isArray(resp.data.jobs)) ? resp.data.jobs : [];
      if (!jobs.length) {
        dom.modalJobsBody.innerHTML = `<div style="color:var(--muted)">ยังไม่มีงานวิดีโอ กรุณาสร้างงานจากหน้า Video Studio ก่อน</div>`;
        return;
      }
      const list = document.createElement('div');
      list.className = 've-job-list';
      jobs.slice(0, 20).forEach((j) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 've-job-item';
        const title = j.topic || j.id;
        const dur = j.durationSec ? `${j.durationSec}s` : '';
        btn.innerHTML = `
          <div style="min-width:0;flex:1">
            <div class="ve-job-item-title">${escapeHtml(title)}</div>
            <div class="ve-job-item-meta">${escapeHtml(j.id)} · ${escapeHtml(j.status || '')} ${dur ? '· ' + escapeHtml(dur) : ''}</div>
          </div>
          <span style="color:var(--cyan);font-size:12px;font-weight:600">เปิด →</span>
        `;
        btn.addEventListener('click', () => {
          window.location.href = `/video-editor.html?job=${encodeURIComponent(j.id)}`;
        });
        list.appendChild(btn);
      });
      dom.modalJobsBody.innerHTML = '';
      dom.modalJobsBody.appendChild(list);
    } catch (err) {
      dom.modalJobsBody.innerHTML = `<div style="color:#fca5a5">โหลดรายการงานไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
    }
  }

  // =========================================================================
  // CLIENT-SIDE FALLBACK PROJECT (WHEN API RETURNS 404 BEFORE RESTART)
  // =========================================================================
  async function buildFallbackProjectFromTimeline(jobId) {
    const tlResp = await fetchJsonSafe(`/api/video-studio/jobs/${encodeURIComponent(jobId)}/timeline`);
    const tl = (tlResp.ok && tlResp.data) ? tlResp.data : {};
    const totalSec = Math.max(1, Number(tl.totalSec) || 15);
    const fps = Number(tl.fps) || 30;
    const scenes = Array.isArray(tl.scenes) ? tl.scenes : [];

    const v1Clips = [];
    const a1Clips = [];
    if (scenes.length) {
      scenes.forEach((sc, i) => {
        const lid = uid('lnk');
        const st = Number(sc.startSec) || 0;
        const en = Math.max(st + 0.1, Number(sc.endSec) || totalSec);
        const title = sc.title || `ฉาก ${i + 1}`;
        v1Clips.push({
          id: uid('v'), linkId: lid, label: title, sceneId: sc.id,
          src: { type: 'render' }, in: st, out: en, start: st, speed: 1, volume: 0, fadeIn: 0, fadeOut: 0,
        });
        a1Clips.push({
          id: uid('a'), linkId: lid, label: `พากย์: ${title}`, sceneId: sc.id,
          src: { type: 'narration' }, in: st, out: en, start: st, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0,
        });
      });
    } else {
      v1Clips.push({
        id: uid('v'), label: 'วิดีโอหลัก', src: { type: 'render' },
        in: 0, out: totalSec, start: 0, speed: 1, volume: 0, fadeIn: 0, fadeOut: 0,
      });
    }

    const bgmName = tl.bgm && tl.bgm !== 'none' ? tl.bgm : 'warm_tech';
    const m1Clips = [{
      id: uid('m'), label: bgmName, src: { type: 'bgm', name: bgmName },
      in: 0, out: totalSec, start: 0, speed: 1, volume: 0.14, fadeIn: 1, fadeOut: 2, duckDb: 12, loop: true,
    }];

    state.assets.bgm = DEFAULT_BGM_LIST.map((b) => ({ ...b, url: '' }));
    state.assets.job.render = tl.hasRender
      ? { file: 'render.mp4', durationSec: totalSec, url: `/api/video-studio/file/${encodeURIComponent(jobId)}/render.mp4` }
      : null;

    return {
      version: 1,
      jobId,
      fps,
      width: 1080,
      height: 1920,
      master: { volume: 1, lufs: -14 },
      tracks: [
        { id: 'v1', kind: 'video', name: 'วิดีโอหลัก', muted: false, locked: false, hidden: false, clips: v1Clips },
        { id: 'v2', kind: 'video', name: 'โอเวอร์เลย์', muted: false, locked: false, hidden: false, clips: [] },
        { id: 'a1', kind: 'voice', name: 'เสียงพากย์', muted: false, locked: false, hidden: false, clips: a1Clips },
        { id: 'm1', kind: 'music', name: 'เพลงประกอบ (BGM)', muted: false, locked: false, hidden: false, clips: m1Clips },
        { id: 's1', kind: 'sfx', name: 'เอฟเฟกต์เสียง', muted: false, locked: false, hidden: false, clips: [] },
        { id: 't1', kind: 'text', name: 'ข้อความ', muted: false, locked: false, hidden: false, clips: [] },
      ],
    };
  }

  // =========================================================================
  // MOUNT TIMELINE (t4: window.VETimeline)
  // =========================================================================
  function mountTimeline() {
    if (typeof window.VETimeline !== 'function') {
      dom.timelineHost.innerHTML = `
        <div class="ve-timeline-error">
          <strong>ไม่พบโมดูล Timeline (VETimeline)</strong>
          <div>ไฟล์ <code>/video-editor-timeline.js</code> ยังไม่พร้อมใช้งานหรือโหลดไม่สำเร็จ — กรุณารีเฟรชหน้าหลังสร้างโมดูล Timeline เสร็จ</div>
        </div>
      `;
      return;
    }

    state.timeline = new window.VETimeline(dom.timelineHost, {
      onChange: (updatedProject) => {
        applyProjectChange(updatedProject, { recordHistory: true, fromTimeline: true });
      },
      onSelect: (clipId) => {
        state.selectedClipId = clipId || null;
        renderInspector();
        renderPreviewAt(state.currentTime);
      },
      onSeek: (sec) => {
        seekTo(sec, { fromTimeline: true });
      },
      getAssetDuration: (src) => getAssetDuration(src),
    });

    if (state.project && typeof state.timeline.setProject === 'function') {
      state.timeline.setProject(state.project);
    }
    if (typeof state.timeline.setTime === 'function') {
      state.timeline.setTime(state.currentTime);
    }
  }

  // =========================================================================
  // SPLITTER (RESIZE TIMELINE HEIGHT)
  // =========================================================================
  function initSplitter() {
    let dragging = false;
    dom.splitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      dom.splitter.classList.add('is-dragging');
      document.body.style.cursor = 'row-resize';
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const vh = window.innerHeight;
      const newH = clamp(vh - e.clientY, 170, Math.round(vh * 0.65));
      document.documentElement.style.setProperty('--timeline-h', `${newH}px`);
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      dom.splitter.classList.remove('is-dragging');
      document.body.style.cursor = '';
    });
  }

  // =========================================================================
  // KEYBOARD SHORTCUTS
  // =========================================================================
  function isEditableTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      const lower = key.toLowerCase();

      if (mod && lower === 's') {
        e.preventDefault();
        saveProjectNow({ silent: false });
        return;
      }
      if (mod && lower === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((mod && e.shiftKey && lower === 'z') || (mod && lower === 'y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && lower === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod) return;

      if (key === ' ') {
        e.preventDefault();
        togglePlayback();
      } else if (lower === 's') {
        e.preventDefault();
        splitAtPlayhead();
      } else if (lower === 'c') {
        if (state.timeline && typeof state.timeline.setTool === 'function') {
          state.timeline.setTool('razor');
          showToast('เครื่องมือใบมีด (Razor)');
        }
      } else if (lower === 'v') {
        if (state.timeline && typeof state.timeline.setTool === 'function') {
          state.timeline.setTool('select');
          showToast('เครื่องมือเลือก (Select)');
        }
      } else if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        deleteSelected(e.shiftKey);
      } else if (key === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / ((state.project && state.project.fps) || 30);
        seekTo(state.currentTime - step);
      } else if (key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / ((state.project && state.project.fps) || 30);
        seekTo(state.currentTime + step);
      } else if (key === 'Home') {
        e.preventDefault();
        seekTo(0);
      } else if (key === 'End') {
        e.preventDefault();
        seekTo(getProjectDuration());
      } else if (key === '+' || key === '=') {
        if (state.timeline && typeof state.timeline.zoomIn === 'function') {
          state.timeline.zoomIn();
        }
      } else if (key === '-') {
        if (state.timeline && typeof state.timeline.zoomOut === 'function') {
          state.timeline.zoomOut();
        }
      }
    });
  }

  // =========================================================================
  // EVENT WIRING & BOOTSTRAP
  // =========================================================================
  function bindUIEvents() {
    // Media Bin tabs
    document.querySelectorAll('.ve-bin-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.tab;
        document.querySelectorAll('.ve-bin-tab').forEach((b) => {
          const active = b.dataset.tab === state.activeTab;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        renderMediaBin();
      });
    });

    // Topbar actions
    dom.btnUndo.addEventListener('click', undo);
    dom.btnRedo.addEventListener('click', redo);
    dom.btnSave.addEventListener('click', () => saveProjectNow({ silent: false }));
    dom.btnExport.addEventListener('click', startExport);
    dom.btnOpenJobs.addEventListener('click', openJobPicker);
    dom.btnShortcuts.addEventListener('click', () => openModal('ve-modal-shortcuts'));
    dom.apiBannerClose.addEventListener('click', () => dom.apiBanner.classList.remove('is-visible'));

    // Transport
    dom.btnPlay.addEventListener('click', togglePlayback);
    dom.btnHome.addEventListener('click', () => seekTo(0));
    dom.btnEnd.addEventListener('click', () => seekTo(getProjectDuration()));
    dom.btnPrevFrame.addEventListener('click', () => {
      seekTo(state.currentTime - 1 / ((state.project && state.project.fps) || 30));
    });
    dom.btnNextFrame.addEventListener('click', () => {
      seekTo(state.currentTime + 1 / ((state.project && state.project.fps) || 30));
    });
    dom.btnMuteMaster.addEventListener('click', () => {
      state.masterMuted = !state.masterMuted;
      dom.btnMuteMaster.textContent = state.masterMuted ? '🔇' : '🔊';
      dom.btnMuteMaster.classList.toggle('is-active', state.masterMuted);
      if (state.masterGain && state.audioCtx) {
        const vol = state.masterMuted ? 0 : ((state.project && state.project.master && state.project.master.volume) ?? 1);
        state.masterGain.gain.setValueAtTime(vol, state.audioCtx.currentTime);
      }
    });
    dom.btnFullscreen.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else if (dom.stage.requestFullscreen) {
        dom.stage.requestFullscreen().catch(() => {});
      }
    });

    // Modal close buttons & backdrop click
    document.addEventListener('click', (e) => {
      const closeTarget = e.target.closest('[data-close-modal]');
      if (closeTarget) {
        closeModal(closeTarget.dataset.closeModal);
        return;
      }
      if (e.target.classList.contains('ve-modal-backdrop') && e.target.id !== 've-modal-jobs') {
        e.target.classList.remove('is-open');
      }
    });

    // Unsaved changes guard
    window.addEventListener('beforeunload', (e) => {
      if (state.isDirty && !state.apiUnavailable) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Resize text overlay scaling smoothly
    window.addEventListener('resize', () => {
      if (state.project) renderPreviewAt(state.currentTime);
    });
  }

  async function loadJob(jobId) {
    state.jobId = jobId;
    dom.jobTitle.textContent = `กำลังโหลด ${jobId}...`;

    // Fetch job metadata + project + editor-assets in parallel
    const [jobResp, projResp, assetsResp] = await Promise.all([
      fetchJsonSafe(`/api/video-studio/jobs/${encodeURIComponent(jobId)}`),
      fetchJsonSafe(`/api/video-studio/jobs/${encodeURIComponent(jobId)}/project`),
      fetchJsonSafe(`/api/video-studio/editor-assets?job=${encodeURIComponent(jobId)}`),
    ]);

    if (jobResp.ok && jobResp.data) {
      state.jobMeta = jobResp.data.job || jobResp.data;
      dom.jobTitle.textContent = state.jobMeta.topic || jobId;
    } else {
      dom.jobTitle.textContent = jobId;
    }

    const apiMissing = projResp.status === 404 || projResp.isHtml || assetsResp.status === 404 || assetsResp.isHtml;
    if (apiMissing) {
      state.apiUnavailable = true;
      showApiBanner('ต้องรีสตาร์ท lab-dashboard เพื่อเปิดใช้ API โปรแกรมตัดต่อ');
      state.project = await buildFallbackProjectFromTimeline(jobId);
      updateSaveStatus('dirty');
    } else if (projResp.ok && projResp.data && projResp.data.project) {
      state.project = projResp.data.project;
      if (assetsResp.ok && assetsResp.data) {
        state.assets.bgm = Array.isArray(assetsResp.data.bgm) ? assetsResp.data.bgm : [];
        state.assets.sfx = Array.isArray(assetsResp.data.sfx) ? assetsResp.data.sfx : [];
        state.assets.job = assetsResp.data.job || { render: null, final: null, narration: null };
        state.assets.jobAssets = Array.isArray(assetsResp.data.jobAssets) ? assetsResp.data.jobAssets : [];
      }
      updateSaveStatus('saved', 'โหลดโปรเจกต์แล้ว');
    } else {
      const errMsg = (projResp.data && projResp.data.error) || 'ไม่พบข้อมูลโปรเจกต์';
      showApiBanner(`โหลดโปรเจกต์ไม่สำเร็จ: ${errMsg}`);
      state.project = await buildFallbackProjectFromTimeline(jobId);
    }

    state.history = [];
    state.historyIndex = -1;
    pushHistory(state.project);
    updateHistoryButtons();

    mountTimeline();
    renderMediaBin();
    renderInspector();
    updateTotalTimecode();
    renderPreviewAt(0);
  }

  function init() {
    bindUIEvents();
    initSplitter();
    initKeyboardShortcuts();

    const params = new URLSearchParams(window.location.search);
    const jobId = (params.get('job') || '').trim();
    if (!jobId) {
      dom.jobTitle.textContent = 'ยังไม่ได้เลือกงาน';
      openJobPicker();
      return;
    }
    loadJob(jobId);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

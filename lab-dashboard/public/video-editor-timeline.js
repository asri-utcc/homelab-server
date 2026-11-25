/* global window, document, getComputedStyle */
(function (root) {
  'use strict';

  var MIN_ZOOM = 10;
  var MAX_ZOOM = 400;
  var MIN_CLIP_DUR = 0.1;
  var SNAP_PX = 8;
  var EPS = 1e-4;

  var KIND_META = {
    video: { icon: '🎬', label: 'วิดีโอ' },
    voice: { icon: '🎙️', label: 'เสียงพากย์' },
    music: { icon: '🎵', label: 'เพลงประกอบ' },
    sfx: { icon: '⚡', label: 'เอฟเฟกต์เสียง' },
    text: { icon: '𝐓', label: 'ข้อความ' }
  };

  var _uidSeq = 0;

  function uid(prefix) {
    _uidSeq += 1;
    var rand = Math.random().toString(36).slice(2, 7);
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + _uidSeq + rand;
  }

  function clone(obj) {
    if (obj == null) return obj;
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(obj);
      } catch (_) {
        // fallback below
      }
    }
    return JSON.parse(JSON.stringify(obj));
  }

  function clamp(v, min, max) {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  function roundTime(t) {
    return Math.round(t * 10000) / 10000;
  }

  function isTextClip(clip, trackKind) {
    if (trackKind === 'text') return true;
    if (!clip) return false;
    return typeof clip.text === 'string' && clip.out == null;
  }

  function clipDuration(clip, trackKind) {
    if (!clip) return 0;
    if (isTextClip(clip, trackKind)) {
      if (clip.duration != null) return Math.max(0, Number(clip.duration) || 0);
      if (clip.out != null && clip.in != null) {
        return Math.max(0, (Number(clip.out) - Number(clip.in)) / (Number(clip.speed) || 1));
      }
      return 3;
    }
    var spd = Number(clip.speed) || 1;
    if (spd <= 0) spd = 1;
    var inn = Number(clip.in) || 0;
    var out = clip.out != null ? Number(clip.out) : inn + (Number(clip.duration) || 0) * spd;
    return Math.max(0, (out - inn) / spd);
  }

  function clipEnd(clip, trackKind) {
    if (!clip) return 0;
    return (Number(clip.start) || 0) + clipDuration(clip, trackKind);
  }

  function projectDuration(project) {
    if (!project || !Array.isArray(project.tracks)) return 0;
    var maxEnd = 0;
    for (var i = 0; i < project.tracks.length; i++) {
      var tr = project.tracks[i];
      var clips = tr && Array.isArray(tr.clips) ? tr.clips : [];
      for (var j = 0; j < clips.length; j++) {
        var e = clipEnd(clips[j], tr.kind);
        if (e > maxEnd) maxEnd = e;
      }
    }
    return maxEnd;
  }

  function findTrack(project, trackId) {
    if (!project || !Array.isArray(project.tracks)) return null;
    for (var i = 0; i < project.tracks.length; i++) {
      if (project.tracks[i] && project.tracks[i].id === trackId) {
        return { track: project.tracks[i], trackIndex: i };
      }
    }
    return null;
  }

  function findClip(project, clipId) {
    if (!project || !Array.isArray(project.tracks)) return null;
    for (var i = 0; i < project.tracks.length; i++) {
      var tr = project.tracks[i];
      var clips = tr && Array.isArray(tr.clips) ? tr.clips : [];
      for (var j = 0; j < clips.length; j++) {
        if (clips[j] && clips[j].id === clipId) {
          return { track: tr, clip: clips[j], trackIndex: i, clipIndex: j };
        }
      }
    }
    return null;
  }

  function findLinkedClips(project, linkId) {
    var out = [];
    if (!linkId || !project || !Array.isArray(project.tracks)) return out;
    for (var i = 0; i < project.tracks.length; i++) {
      var tr = project.tracks[i];
      var clips = tr && Array.isArray(tr.clips) ? tr.clips : [];
      for (var j = 0; j < clips.length; j++) {
        if (clips[j] && clips[j].linkId === linkId) {
          out.push({ track: tr, clip: clips[j], trackIndex: i, clipIndex: j });
        }
      }
    }
    return out;
  }

  function sortTrackClips(track) {
    if (!track || !Array.isArray(track.clips)) return;
    track.clips.sort(function (a, b) {
      return (Number(a.start) || 0) - (Number(b.start) || 0);
    });
  }

  function formatTime(sec, fps) {
    var s = Math.max(0, Number(sec) || 0);
    var mins = Math.floor(s / 60);
    var rem = s - mins * 60;
    var wholeSec = Math.floor(rem);
    var mm = mins < 10 ? '0' + mins : String(mins);
    var ss = wholeSec < 10 ? '0' + wholeSec : String(wholeSec);
    if (fps && fps > 0) {
      var frame = Math.floor((rem - wholeSec) * fps + 1e-6);
      var ff = frame < 10 ? '0' + frame : String(frame);
      return mm + ':' + ss + ':' + ff;
    }
    var cs = Math.floor((rem - wholeSec) * 100 + 1e-6);
    var cc = cs < 10 ? '0' + cs : String(cs);
    return mm + ':' + ss + '.' + cc;
  }

  function formatRulerTime(sec, showTenths) {
    var s = Math.max(0, Number(sec) || 0);
    var mins = Math.floor(s / 60);
    var rem = s - mins * 60;
    var wholeSec = Math.floor(rem + 1e-6);
    if (wholeSec >= 60) {
      mins += 1;
      wholeSec = 0;
    }
    var mm = mins < 10 ? '0' + mins : String(mins);
    var ss = wholeSec < 10 ? '0' + wholeSec : String(wholeSec);
    if (showTenths) {
      var tenth = Math.round((rem - Math.floor(rem)) * 10);
      if (tenth > 0 && tenth < 10) return mm + ':' + ss + '.' + tenth;
    }
    return mm + ':' + ss;
  }

  // ==================== Pure Operations (exposed via VEModel & VEModel._test) ====================

  function collectSnapEdges(project, excludeClipIds, playheadSec) {
    var exclude = Object.create(null);
    if (Array.isArray(excludeClipIds)) {
      for (var k = 0; k < excludeClipIds.length; k++) {
        exclude[excludeClipIds[k]] = true;
      }
    }
    var edges = [0];
    if (typeof playheadSec === 'number' && isFinite(playheadSec) && playheadSec >= 0) {
      edges.push(playheadSec);
    }
    if (project && Array.isArray(project.tracks)) {
      for (var i = 0; i < project.tracks.length; i++) {
        var tr = project.tracks[i];
        var clips = tr && Array.isArray(tr.clips) ? tr.clips : [];
        for (var j = 0; j < clips.length; j++) {
          var c = clips[j];
          if (!c || exclude[c.id]) continue;
          edges.push(Number(c.start) || 0);
          edges.push(clipEnd(c, tr.kind));
        }
      }
    }
    return edges;
  }

  function snapTime(targetTime, edges, thresholdSec) {
    var best = null;
    var bestDist = thresholdSec + 1e-9;
    if (!Array.isArray(edges) || thresholdSec <= 0) {
      return { snapped: false, time: targetTime, edge: null };
    }
    for (var i = 0; i < edges.length; i++) {
      var d = Math.abs(targetTime - edges[i]);
      if (d <= bestDist) {
        bestDist = d;
        best = edges[i];
      }
    }
    if (best !== null) {
      return { snapped: true, time: best, edge: best };
    }
    return { snapped: false, time: targetTime, edge: null };
  }

  /**
   * Pure split of clip(s) at timeSec.
   * opts: { linked?: boolean, clipIds?: string[] }
   * If clipIds is empty/null, splits all unlocked clips intersecting timeSec.
   * Returns { project, splitCount, newClipIds }
   */
  function splitClipAt(project, clipIds, timeSec, opts) {
    var next = clone(project);
    var linked = !opts || opts.linked !== false;
    var targetIds = Object.create(null);
    var hasExplicit = Array.isArray(clipIds) && clipIds.length > 0;
    var i, j, tr, c;

    if (typeof clipIds === 'string') {
      hasExplicit = true;
      clipIds = [clipIds];
    }

    if (hasExplicit) {
      for (i = 0; i < clipIds.length; i++) {
        var found = findClip(next, clipIds[i]);
        if (!found || found.track.locked) continue;
        targetIds[found.clip.id] = true;
        if (linked && found.clip.linkId) {
          var peers = findLinkedClips(next, found.clip.linkId);
          for (j = 0; j < peers.length; j++) {
            if (!peers[j].track.locked) targetIds[peers[j].clip.id] = true;
          }
        }
      }
    } else {
      for (i = 0; i < next.tracks.length; i++) {
        tr = next.tracks[i];
        if (!tr || tr.locked || !Array.isArray(tr.clips)) continue;
        for (j = 0; j < tr.clips.length; j++) {
          c = tr.clips[j];
          var s0 = Number(c.start) || 0;
          var e0 = clipEnd(c, tr.kind);
          if (timeSec > s0 + MIN_CLIP_DUR * 0.5 && timeSec < e0 - MIN_CLIP_DUR * 0.5) {
            targetIds[c.id] = true;
          }
        }
      }
    }

    // Group linkId -> { leftLinkId, rightLinkId } so split linked pairs stay linked
    var linkPairMap = Object.create(null);
    var newClipIds = [];
    var splitCount = 0;

    for (i = 0; i < next.tracks.length; i++) {
      tr = next.tracks[i];
      if (!tr || tr.locked || !Array.isArray(tr.clips)) continue;
      var updatedClips = [];
      for (j = 0; j < tr.clips.length; j++) {
        c = tr.clips[j];
        if (!targetIds[c.id]) {
          updatedClips.push(c);
          continue;
        }
        var start = Number(c.start) || 0;
        var dur = clipDuration(c, tr.kind);
        var end = start + dur;
        if (timeSec <= start + EPS || timeSec >= end - EPS) {
          updatedClips.push(c);
          continue;
        }
        var leftDur = roundTime(timeSec - start);
        var rightDur = roundTime(end - timeSec);
        if (leftDur < MIN_CLIP_DUR * 0.25 || rightDur < MIN_CLIP_DUR * 0.25) {
          updatedClips.push(c);
          continue;
        }

        var leftClip = clone(c);
        var rightClip = clone(c);
        rightClip.id = uid('c');

        if (c.linkId) {
          if (!linkPairMap[c.linkId]) {
            linkPairMap[c.linkId] = {
              left: uid('lnk'),
              right: uid('lnk')
            };
          }
          leftClip.linkId = linkPairMap[c.linkId].left;
          rightClip.linkId = linkPairMap[c.linkId].right;
        }

        if (isTextClip(c, tr.kind)) {
          leftClip.duration = leftDur;
          rightClip.start = roundTime(timeSec);
          rightClip.duration = rightDur;
        } else {
          var speed = Number(c.speed) || 1;
          if (speed <= 0) speed = 1;
          var origIn = Number(c.in) || 0;
          var origOut = c.out != null ? Number(c.out) : origIn + dur * speed;
          var splitSrc = roundTime(origIn + leftDur * speed);
          leftClip.out = splitSrc;
          leftClip.fadeOut = 0;
          rightClip.start = roundTime(timeSec);
          rightClip.in = splitSrc;
          rightClip.out = origOut;
          rightClip.fadeIn = 0;
        }

        updatedClips.push(leftClip);
        updatedClips.push(rightClip);
        newClipIds.push(rightClip.id);
        splitCount += 1;
      }
      tr.clips = updatedClips;
      sortTrackClips(tr);
    }

    return { project: next, splitCount: splitCount, newClipIds: newClipIds };
  }

  /**
   * Pure delete (with optional ripple).
   * opts: { ripple?: boolean, linked?: boolean }
   * Returns { project, deletedCount }
   */
  function rippleDelete(project, clipIds, opts) {
    var next = clone(project);
    var ripple = !opts || opts.ripple !== false;
    var linked = !opts || opts.linked !== false;
    var toDelete = Object.create(null);
    var i, j;

    if (!Array.isArray(clipIds) || clipIds.length === 0) {
      return { project: next, deletedCount: 0 };
    }

    for (i = 0; i < clipIds.length; i++) {
      var found = findClip(next, clipIds[i]);
      if (!found || found.track.locked) continue;
      toDelete[found.clip.id] = true;
      if (linked && found.clip.linkId) {
        var peers = findLinkedClips(next, found.clip.linkId);
        for (j = 0; j < peers.length; j++) {
          if (!peers[j].track.locked) toDelete[peers[j].clip.id] = true;
        }
      }
    }

    var deletedCount = 0;
    for (i = 0; i < next.tracks.length; i++) {
      var tr = next.tracks[i];
      if (!tr || tr.locked || !Array.isArray(tr.clips)) continue;
      var removedIntervals = [];
      var remaining = [];

      for (j = 0; j < tr.clips.length; j++) {
        var c = tr.clips[j];
        if (toDelete[c.id]) {
          deletedCount += 1;
          removedIntervals.push({
            start: Number(c.start) || 0,
            end: clipEnd(c, tr.kind)
          });
        } else {
          remaining.push(c);
        }
      }

      if (ripple && removedIntervals.length > 0) {
        // Merge overlapping/adjacent deleted intervals
        removedIntervals.sort(function (a, b) { return a.start - b.start; });
        var merged = [removedIntervals[0]];
        for (j = 1; j < removedIntervals.length; j++) {
          var prev = merged[merged.length - 1];
          var cur = removedIntervals[j];
          if (cur.start <= prev.end + EPS) {
            if (cur.end > prev.end) prev.end = cur.end;
          } else {
            merged.push(cur);
          }
        }
        // Apply ripple from rightmost interval to leftmost
        for (var m = merged.length - 1; m >= 0; m--) {
          var iv = merged[m];
          var gap = iv.end - iv.start;
          if (gap <= 0) continue;
          for (j = 0; j < remaining.length; j++) {
            var rc = remaining[j];
            if ((Number(rc.start) || 0) >= iv.start - EPS) {
              rc.start = roundTime(Math.max(0, (Number(rc.start) || 0) - gap));
            }
          }
        }
      }

      tr.clips = remaining;
      sortTrackClips(tr);
    }

    return { project: next, deletedCount: deletedCount };
  }

  function getClipDisplayLabel(clip, kind) {
    if (!clip) return '';
    if (kind === 'text') {
      return clip.text || clip.label || 'ข้อความ';
    }
    if (kind === 'music') {
      var songName = clip.label || (clip.src && (clip.src.name || clip.src.file)) || 'BGM';
      return (clip.loop ? '🔁 ' : '') + songName;
    }
    return clip.label || (clip.src && (clip.src.name || clip.src.file || clip.src.type)) || 'Clip';
  }

  // ==================== Expose window.VEModel ====================

  var VEModel = {
    uid: uid,
    clone: clone,
    clamp: clamp,
    roundTime: roundTime,
    isTextClip: isTextClip,
    clipDuration: clipDuration,
    clipEnd: clipEnd,
    projectDuration: projectDuration,
    findTrack: findTrack,
    findClip: findClip,
    findLinkedClips: findLinkedClips,
    sortTrackClips: sortTrackClips,
    formatTime: formatTime,
    formatRulerTime: formatRulerTime,
    getClipDisplayLabel: getClipDisplayLabel,
    collectSnapEdges: collectSnapEdges,
    snapTime: snapTime,
    splitClipAt: splitClipAt,
    rippleDelete: rippleDelete,
    _test: {
      splitClipAt: splitClipAt,
      rippleDelete: rippleDelete,
      snapTime: snapTime,
      collectSnapEdges: collectSnapEdges,
      clipDuration: clipDuration,
      projectDuration: projectDuration
    }
  };

  if (root) {
    root.VEModel = VEModel;
  }

  // ==================== Fallback CSS Injection ====================

  var FALLBACK_CSS = [
    '.vt-root{display:flex;flex-direction:column;width:100%;height:100%;min-height:240px;background:#111318;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;user-select:none;overflow:hidden;position:relative;box-sizing:border-box;}',
    '.vt-root *,.vt-root *::before,.vt-root *::after{box-sizing:border-box;}',
    '.vt-toolbar{display:flex;align-items:center;gap:6px;padding:6px 10px;background:#181b22;border-bottom:1px solid #2a2f3a;flex-wrap:wrap;flex-shrink:0;}',
    '.vt-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid #323846;border-radius:5px;background:#222631;color:#d1d5db;cursor:pointer;font-size:12px;line-height:1.2;transition:background .12s,border-color .12s;}',
    '.vt-btn:hover{background:#2c3240;color:#fff;}',
    '.vt-btn.is-active{background:#2563eb;border-color:#3b82f6;color:#fff;}',
    '.vt-sep{width:1px;height:18px;background:#2e3442;margin:0 2px;}',
    '.vt-spacer{flex:1;}',
    '.vt-zoom-wrap{display:inline-flex;align-items:center;gap:6px;color:#9ca3af;}',
    '.vt-zoom-wrap input[type=range]{width:96px;accent-color:#3b82f6;cursor:pointer;}',
    '.vt-body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;}',
    '.vt-top-row{display:flex;height:28px;flex-shrink:0;border-bottom:1px solid #2a2f3a;background:#161920;}',
    '.vt-corner{width:150px;min-width:150px;max-width:150px;display:flex;align-items:center;justify-content:center;border-right:1px solid #2a2f3a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#93c5fd;background:#151820;}',
    '.vt-ruler{position:relative;flex:1;overflow:hidden;cursor:ew-resize;background:#161920;}',
    '.vt-ruler-track{position:relative;height:100%;}',
    '.vt-tick{position:absolute;bottom:0;width:1px;background:#3a4152;pointer-events:none;}',
    '.vt-tick.is-major{height:12px;background:#6b7280;}',
    '.vt-tick.is-minor{height:6px;}',
    '.vt-tick-label{position:absolute;top:2px;left:3px;font-size:10px;color:#9ca3af;white-space:nowrap;pointer-events:none;font-family:ui-monospace,monospace;}',
    '.vt-ruler-head{position:absolute;top:0;left:0;width:12px;height:14px;margin-left:-6px;background:#ef4444;clip-path:polygon(0 0,100% 0,100% 55%,50% 100%,0 55%);pointer-events:none;z-index:20;will-change:transform;}',
    '.vt-main-row{display:flex;flex:1;min-height:0;overflow:hidden;}',
    '.vt-headers{width:150px;min-width:150px;max-width:150px;overflow-y:auto;overflow-x:hidden;border-right:1px solid #2a2f3a;background:#151820;scrollbar-width:none;}',
    '.vt-headers::-webkit-scrollbar{display:none;}',
    '.vt-track-header{height:52px;padding:4px 6px;border-bottom:1px solid #232833;display:flex;flex-direction:column;justify-content:space-between;background:#171a22;}',
    '.vt-track-header.is-locked{opacity:.65;background:#16181f;}',
    '.vt-track-header.is-hidden{opacity:.55;}',
    '.vt-track-title{display:flex;align-items:center;gap:5px;font-weight:600;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.vt-track-controls{display:flex;gap:4px;}',
    '.vt-icon-btn{padding:2px 5px;border:1px solid transparent;border-radius:4px;background:transparent;color:#9ca3af;cursor:pointer;font-size:11px;line-height:1;}',
    '.vt-icon-btn:hover{background:#252a36;color:#fff;}',
    '.vt-icon-btn.is-on{background:#374151;border-color:#4b5563;color:#f87171;}',
    '.vt-lanes{position:relative;flex:1;overflow:auto;background:#0f1116;}',
    '.vt-lanes-inner{position:relative;min-height:100%;}',
    '.vt-lane{position:relative;height:52px;border-bottom:1px solid #20242e;background:#11141b;}',
    '.vt-lane:nth-child(even){background:#131720;}',
    '.vt-lane.is-locked{background:repeating-linear-gradient(-45deg,#12151c,#12151c 8px,#171b24 8px,#171b24 16px);}',
    '.vt-lane.is-hidden{opacity:.4;}',
    '.vt-lane.is-dragover{outline:2px dashed #3b82f6;outline-offset:-2px;background:rgba(59,130,246,.14)!important;}',
    '.vt-clip{position:absolute;top:5px;height:42px;border-radius:6px;border:1px solid rgba(255,255,255,.16);overflow:hidden;display:flex;align-items:center;cursor:grab;color:#fff;font-size:11px;padding:0 10px;box-shadow:0 1px 3px rgba(0,0,0,.4);}',
    '.vt-clip:active{cursor:grabbing;}',
    '.vt-clip[data-kind="video"]{background:linear-gradient(180deg,#2563eb,#1d4ed8);border-color:#60a5fa;}',
    '.vt-clip[data-kind="voice"]{background:linear-gradient(180deg,#059669,#047857);border-color:#34d399;}',
    '.vt-clip[data-kind="music"]{background:linear-gradient(180deg,#7c3aed,#6d28d9);border-color:#a78bfa;}',
    '.vt-clip[data-kind="sfx"]{background:linear-gradient(180deg,#d97706,#b45309);border-color:#fbbf24;}',
    '.vt-clip[data-kind="text"]{background:linear-gradient(180deg,#db2777,#be185d);border-color:#f472b6;}',
    '.vt-clip.is-selected{outline:2px solid #facc15;outline-offset:-1px;z-index:5;box-shadow:0 0 0 2px rgba(250,204,21,.25);}',
    '.vt-root.is-razor .vt-clip{cursor:crosshair;}',
    '.vt-clip-content{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;overflow:hidden;pointer-events:none;}',
    '.vt-clip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;}',
    '.vt-clip-dur{font-size:10px;opacity:.85;white-space:nowrap;flex-shrink:0;font-family:ui-monospace,monospace;}',
    '.vt-handle-l,.vt-handle-r{position:absolute;top:0;bottom:0;width:8px;cursor:ew-resize;z-index:3;}',
    '.vt-handle-l{left:0;border-radius:6px 0 0 6px;}',
    '.vt-handle-r{right:0;border-radius:0 6px 6px 0;}',
    '.vt-handle-l:hover,.vt-handle-r:hover{background:rgba(255,255,255,.32);}',
    '.vt-playhead{position:absolute;top:0;bottom:0;left:0;width:2px;margin-left:-1px;background:#ef4444;pointer-events:none;z-index:25;will-change:transform;}',
    '.vt-snapline{position:absolute;top:0;bottom:0;left:0;width:1px;background:#facc15;box-shadow:0 0 6px #facc15;pointer-events:none;z-index:24;display:none;}'
  ].join('\n');

  function ensureFallbackCss(rootEl) {
    if (typeof document === 'undefined' || !rootEl) return;
    if (document.getElementById('vt-fallback-css')) return;
    try {
      var cs = getComputedStyle(rootEl);
      // If external stylesheet already styles .vt-root as flex or sets a non-transparent bg, skip fallback
      var hasExternalStyle =
        cs.display === 'flex' ||
        (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
      if (hasExternalStyle) return;
    } catch (_) {
      // fall through and inject
    }
    var style = document.createElement('style');
    style.id = 'vt-fallback-css';
    style.textContent = FALLBACK_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ==================== VETimeline Class ====================

  function VETimeline(container, opts) {
    if (!(this instanceof VETimeline)) {
      return new VETimeline(container, opts);
    }
    if (container && typeof container === 'object' && !container.nodeType && !opts) {
      opts = container;
      container = opts.container;
    }
    if (typeof container === 'string' && typeof document !== 'undefined') {
      container = document.querySelector(container);
    }
    if (!container) {
      throw new Error('VETimeline: container element is required');
    }

    this._container = container;
    this._opts = opts || {};
    this._project = this._opts.project ? clone(this._opts.project) : { version: 1, fps: 30, tracks: [] };
    this._zoom = clamp(Number(this._opts.zoom || this._opts.pxPerSec || 60), MIN_ZOOM, MAX_ZOOM);
    this._playhead = Math.max(0, Number(this._opts.playhead) || 0);
    this._snap = this._opts.snap !== false;
    this._linked = this._opts.linked !== false && this._opts.linkEnabled !== false;
    this._tool = this._opts.tool === 'razor' ? 'razor' : 'select';
    this._selectedIds = new Set();
    this._isScrubbing = false;
    this._dragState = null;
    this._syncingScroll = false;
    this._destroyed = false;

    this._buildDOM();
    ensureFallbackCss(this._root);
    this._bindEvents();
    this.render();
  }

  VETimeline.create = function (container, opts) {
    return new VETimeline(container, opts);
  };

  // ---------- DOM Construction ----------

  VETimeline.prototype._buildDOM = function () {
    this._container.innerHTML = '';

    var rootEl = document.createElement('div');
    rootEl.className = 'vt-root';

    // Toolbar
    var toolbar = document.createElement('div');
    toolbar.className = 'vt-toolbar';
    toolbar.innerHTML = [
      '<button type="button" class="vt-btn" data-action="tool-select" title="เลือก / ย้าย (V)">↖ เลือก</button>',
      '<button type="button" class="vt-btn" data-action="tool-razor" title="กรรไกรตัดคลิป (C)">✂️ ตัด</button>',
      '<span class="vt-sep"></span>',
      '<button type="button" class="vt-btn" data-action="split" title="แบ่งคลิปที่ Playhead (S)">|✂| แบ่ง</button>',
      '<button type="button" class="vt-btn" data-action="ripple-delete" title="ลบแบบเลื่อนชิด (Shift+Del)">⌫ ลบเลื่อนชิด</button>',
      '<span class="vt-sep"></span>',
      '<button type="button" class="vt-btn" data-action="toggle-snap" title="ดูดขอบคลิปอัตโนมัติ">🧲 Snap</button>',
      '<button type="button" class="vt-btn" data-action="toggle-link" title="เชื่อมคลิปวิดีโอ+เสียง">🔗 Link</button>',
      '<span class="vt-sep"></span>',
      '<button type="button" class="vt-btn" data-action="add-video" title="เพิ่มแทร็กวิดีโอ">+ วิดีโอ</button>',
      '<button type="button" class="vt-btn" data-action="add-text" title="เพิ่มแทร็กข้อความ">+ ข้อความ</button>',
      '<span class="vt-spacer"></span>',
      '<div class="vt-zoom-wrap">',
      '  <span>🔍</span>',
      '  <input type="range" class="vt-zoom-slider" min="' + MIN_ZOOM + '" max="' + MAX_ZOOM + '" step="1" value="' + Math.round(this._zoom) + '" title="ซูมไทม์ไลน์">',
      '  <button type="button" class="vt-btn" data-action="fit" title="พอดีหน้าจอ">Fit</button>',
      '</div>'
    ].join('');

    // Body
    var body = document.createElement('div');
    body.className = 'vt-body';

    var topRow = document.createElement('div');
    topRow.className = 'vt-top-row';

    var corner = document.createElement('div');
    corner.className = 'vt-corner';
    corner.textContent = formatTime(this._playhead, this._project.fps || 30);

    var ruler = document.createElement('div');
    ruler.className = 'vt-ruler';

    var rulerTrack = document.createElement('div');
    rulerTrack.className = 'vt-ruler-track';

    var rulerHead = document.createElement('div');
    rulerHead.className = 'vt-ruler-head';

    ruler.appendChild(rulerTrack);
    rulerTrack.appendChild(rulerHead);
    topRow.appendChild(corner);
    topRow.appendChild(ruler);

    var mainRow = document.createElement('div');
    mainRow.className = 'vt-main-row';

    var headers = document.createElement('div');
    headers.className = 'vt-headers';

    var lanes = document.createElement('div');
    lanes.className = 'vt-lanes';

    var lanesInner = document.createElement('div');
    lanesInner.className = 'vt-lanes-inner';

    var playhead = document.createElement('div');
    playhead.className = 'vt-playhead';

    var snapline = document.createElement('div');
    snapline.className = 'vt-snapline';

    lanesInner.appendChild(playhead);
    lanesInner.appendChild(snapline);
    lanes.appendChild(lanesInner);

    mainRow.appendChild(headers);
    mainRow.appendChild(lanes);

    body.appendChild(topRow);
    body.appendChild(mainRow);

    rootEl.appendChild(toolbar);
    rootEl.appendChild(body);
    this._container.appendChild(rootEl);

    this._root = rootEl;
    this._toolbar = toolbar;
    this._zoomSlider = toolbar.querySelector('.vt-zoom-slider');
    this._corner = corner;
    this._ruler = ruler;
    this._rulerTrack = rulerTrack;
    this._rulerHead = rulerHead;
    this._headers = headers;
    this._lanes = lanes;
    this._lanesInner = lanesInner;
    this._playheadEl = playhead;
    this._snaplineEl = snapline;
  };

  // ---------- Event Binding ----------

  VETimeline.prototype._bindEvents = function () {
    var self = this;

    // Toolbar clicks
    this._onToolbarClick = function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var act = btn.getAttribute('data-action');
      if (act === 'tool-select') self.setTool('select');
      else if (act === 'tool-razor') self.setTool('razor');
      else if (act === 'split') self.splitAtPlayhead();
      else if (act === 'ripple-delete') self.deleteSelected({ ripple: true });
      else if (act === 'toggle-snap') self.setSnap(!self._snap);
      else if (act === 'toggle-link') self.setLinked(!self._linked);
      else if (act === 'add-video') self.addTrack('video');
      else if (act === 'add-text') self.addTrack('text');
      else if (act === 'fit') self.zoomToFit();
    };
    this._toolbar.addEventListener('click', this._onToolbarClick);

    this._onZoomInput = function () {
      self.setZoom(Number(self._zoomSlider.value));
    };
    this._zoomSlider.addEventListener('input', this._onZoomInput);

    // Track header buttons (hidden / muted / locked)
    this._onHeaderClick = function (e) {
      var btn = e.target.closest('[data-track-flag]');
      if (!btn) return;
      var header = btn.closest('.vt-track-header');
      if (!header) return;
      var trackId = header.getAttribute('data-track-id');
      var flag = btn.getAttribute('data-track-flag');
      self.toggleTrackFlag(trackId, flag);
    };
    this._headers.addEventListener('click', this._onHeaderClick);

    // Scroll sync between lanes, headers (vertical), and ruler (horizontal)
    this._onLanesScroll = function () {
      if (self._syncingScroll) return;
      self._syncingScroll = true;
      self._headers.scrollTop = self._lanes.scrollTop;
      self._ruler.scrollLeft = self._lanes.scrollLeft;
      self._syncingScroll = false;
    };
    this._lanes.addEventListener('scroll', this._onLanesScroll, { passive: true });

    this._onHeadersScroll = function () {
      if (self._syncingScroll) return;
      self._syncingScroll = true;
      self._lanes.scrollTop = self._headers.scrollTop;
      self._syncingScroll = false;
    };
    this._headers.addEventListener('scroll', this._onHeadersScroll, { passive: true });

    // Ctrl+wheel zoom on lanes
    this._onLanesWheel = function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        self.setZoom(self._zoom * factor, e.clientX);
      }
    };
    this._lanes.addEventListener('wheel', this._onLanesWheel, { passive: false });

    // Ruler scrubbing
    this._onRulerPointerDown = function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      self._isScrubbing = true;
      if (self._ruler.setPointerCapture) {
        try { self._ruler.setPointerCapture(e.pointerId); } catch (_) {}
      }
      var t = self._clientXToTime(e.clientX);
      self.setPlayhead(t, { autoScroll: false });
      self._emitSeek(t);
    };
    this._onRulerPointerMove = function (e) {
      if (!self._isScrubbing) return;
      var t = self._clientXToTime(e.clientX);
      self.setPlayhead(t, { autoScroll: false });
      self._emitSeek(t);
    };
    this._onRulerPointerUp = function (e) {
      if (!self._isScrubbing) return;
      self._isScrubbing = false;
      if (self._ruler.releasePointerCapture) {
        try { self._ruler.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    this._ruler.addEventListener('pointerdown', this._onRulerPointerDown);
    this._ruler.addEventListener('pointermove', this._onRulerPointerMove);
    this._ruler.addEventListener('pointerup', this._onRulerPointerUp);
    this._ruler.addEventListener('pointercancel', this._onRulerPointerUp);

    // Lanes pointer interactions (select, drag, trim, razor, empty click seek)
    this._onLanesPointerDown = function (e) { self._handleLanesPointerDown(e); };
    this._onLanesPointerMove = function (e) { self._handleLanesPointerMove(e); };
    this._onLanesPointerUp = function (e) { self._handleLanesPointerUp(e); };
    this._lanes.addEventListener('pointerdown', this._onLanesPointerDown);
    this._lanes.addEventListener('pointermove', this._onLanesPointerMove);
    this._lanes.addEventListener('pointerup', this._onLanesPointerUp);
    this._lanes.addEventListener('pointercancel', this._onLanesPointerUp);

    // Drag & Drop assets onto lanes
    this._onLanesDragOver = function (e) { self._handleLanesDragOver(e); };
    this._onLanesDragLeave = function (e) { self._handleLanesDragLeave(e); };
    this._onLanesDrop = function (e) { self._handleLanesDrop(e); };
    this._lanes.addEventListener('dragover', this._onLanesDragOver);
    this._lanes.addEventListener('dragleave', this._onLanesDragLeave);
    this._lanes.addEventListener('drop', this._onLanesDrop);
  };

  // ---------- Coordinate Helpers ----------

  VETimeline.prototype._clientXToTime = function (clientX) {
    var rect = this._lanes.getBoundingClientRect();
    var px = clientX - rect.left + this._lanes.scrollLeft;
    return Math.max(0, px / this._zoom);
  };

  VETimeline.prototype._getContentWidthPx = function () {
    var dur = Math.max(10, projectDuration(this._project) + 10);
    var minW = this._lanes ? this._lanes.clientWidth : 800;
    return Math.max(minW, Math.ceil(dur * this._zoom));
  };

  VETimeline.prototype._showSnapLine = function (timeSec) {
    if (!this._snaplineEl) return;
    if (timeSec == null) {
      this._snaplineEl.style.display = 'none';
      return;
    }
    this._snaplineEl.style.display = 'block';
    this._snaplineEl.style.transform = 'translateX(' + (timeSec * this._zoom) + 'px)';
  };

  // ---------- Pointer Interactions on Lanes & Clips ----------

  VETimeline.prototype._handleLanesPointerDown = function (e) {
    if (e.button !== 0) return;
    var clipEl = e.target.closest('.vt-clip');
    if (!clipEl) {
      // Clicked empty space -> clear selection & seek
      if (this._selectedIds.size > 0) {
        this._selectedIds.clear();
        this._updateSelectionDOM();
        this._emitSelect();
      }
      var seekTime = this._clientXToTime(e.clientX);
      this.setPlayhead(seekTime, { autoScroll: false });
      this._emitSeek(seekTime);
      return;
    }

    var clipId = clipEl.getAttribute('data-clip-id');
    var found = findClip(this._project, clipId);
    if (!found) return;

    // Razor tool: split clip at click time
    if (this._tool === 'razor') {
      if (found.track.locked) return;
      e.preventDefault();
      var clickTime = this._clientXToTime(e.clientX);
      if (this._snap) {
        var edges = collectSnapEdges(this._project, [clipId], this._playhead);
        var sn = snapTime(clickTime, edges, SNAP_PX / this._zoom);
        if (sn.snapped) clickTime = sn.time;
      }
      this.splitClip(clipId, clickTime);
      return;
    }

    // Select tool
    var isAdditive = e.shiftKey || e.ctrlKey || e.metaKey;
    var wasSelected = this._selectedIds.has(clipId);
    var collapseOnClick = false;

    if (isAdditive) {
      if (wasSelected) this._selectedIds.delete(clipId);
      else this._selectedIds.add(clipId);
      this._updateSelectionDOM();
      this._emitSelect();
    } else if (!wasSelected) {
      this._selectedIds.clear();
      this._selectedIds.add(clipId);
      this._updateSelectionDOM();
      this._emitSelect();
    } else if (this._selectedIds.size > 1) {
      collapseOnClick = true;
    }

    if (found.track.locked) return;

    var handleL = e.target.closest('.vt-handle-l');
    var handleR = e.target.closest('.vt-handle-r');
    var mode = handleL ? 'trim-l' : (handleR ? 'trim-r' : 'move');

    e.preventDefault();
    if (this._lanes.setPointerCapture) {
      try { this._lanes.setPointerCapture(e.pointerId); } catch (_) {}
    }

    // Collect participating clips (selected clips for move, or primary clip for trim, plus linked clips if enabled)
    var participantMap = Object.create(null);
    var baseIds = mode === 'move' ? Array.from(this._selectedIds) : [clipId];
    if (baseIds.indexOf(clipId) === -1) baseIds.push(clipId);

    for (var i = 0; i < baseIds.length; i++) {
      var f = findClip(this._project, baseIds[i]);
      if (!f || f.track.locked) continue;
      participantMap[f.clip.id] = f;
      if (this._linked && f.clip.linkId) {
        var peers = findLinkedClips(this._project, f.clip.linkId);
        for (var j = 0; j < peers.length; j++) {
          if (!peers[j].track.locked) {
            participantMap[peers[j].clip.id] = peers[j];
          }
        }
      }
    }

    var participants = [];
    var excludeIds = [];
    var keys = Object.keys(participantMap);
    for (var k = 0; k < keys.length; k++) {
      var info = participantMap[keys[k]];
      var el = this._lanesInner.querySelector('.vt-clip[data-clip-id="' + info.clip.id + '"]');
      var origStart = Number(info.clip.start) || 0;
      var origDur = clipDuration(info.clip, info.track.kind);
      var speed = Number(info.clip.speed) || 1;
      if (speed <= 0) speed = 1;
      var origIn = Number(info.clip.in) || 0;
      var origOut = info.clip.out != null ? Number(info.clip.out) : origIn + origDur * speed;
      var maxSrcDur = null;
      if (mode === 'trim-r' && !isTextClip(info.clip, info.track.kind)) {
        var isLoopMusic = info.track.kind === 'music' && !!info.clip.loop;
        if (!isLoopMusic && typeof this._opts.getAssetDuration === 'function') {
          var d = this._opts.getAssetDuration(info.clip.src, info.clip, info.track);
          if (typeof d === 'number' && isFinite(d) && d > 0) {
            maxSrcDur = d;
          }
        }
      }
      participants.push({
        id: info.clip.id,
        trackId: info.track.id,
        kind: info.track.kind,
        isPrimary: info.clip.id === clipId,
        isText: isTextClip(info.clip, info.track.kind),
        el: el,
        origStart: origStart,
        origDur: origDur,
        origEnd: origStart + origDur,
        origIn: origIn,
        origOut: origOut,
        speed: speed,
        maxSrcDur: maxSrcDur
      });
      excludeIds.push(info.clip.id);
    }

    var snapEdges = this._snap ? collectSnapEdges(this._project, excludeIds, this._playhead) : [];

    this._dragState = {
      pointerId: e.pointerId,
      mode: mode,
      primaryId: clipId,
      primaryTrackId: found.track.id,
      primaryKind: found.track.kind,
      targetTrackId: found.track.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startScrollLeft: this._lanes.scrollLeft,
      participants: participants,
      snapEdges: snapEdges,
      deltaSec: 0,
      moved: false,
      collapseOnClick: collapseOnClick
    };
  };

  VETimeline.prototype._handleLanesPointerMove = function (e) {
    var st = this._dragState;
    if (!st) return;

    var dxPx = (e.clientX - st.startClientX) + (this._lanes.scrollLeft - st.startScrollLeft);
    var dyPx = e.clientY - st.startClientY;
    if (!st.moved && Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) return;
    st.moved = true;

    var rawDelta = dxPx / this._zoom;
    var thresholdSec = SNAP_PX / this._zoom;
    var snappedEdge = null;
    var i, p;

    if (st.mode === 'move') {
      // Clamp so no participant goes below 0
      var minStart = Infinity;
      var maxEnd = -Infinity;
      for (i = 0; i < st.participants.length; i++) {
        p = st.participants[i];
        if (p.origStart < minStart) minStart = p.origStart;
        if (p.origEnd > maxEnd) maxEnd = p.origEnd;
      }
      var delta = Math.max(-minStart, rawDelta);

      if (this._snap && st.snapEdges.length > 0) {
        var snLeft = snapTime(minStart + delta, st.snapEdges, thresholdSec);
        var snRight = snapTime(maxEnd + delta, st.snapEdges, thresholdSec);
        var dLeft = snLeft.snapped ? Math.abs(snLeft.time - (minStart + delta)) : Infinity;
        var dRight = snRight.snapped ? Math.abs(snRight.time - (maxEnd + delta)) : Infinity;
        if (dLeft <= dRight && snLeft.snapped) {
          delta = Math.max(-minStart, snLeft.time - minStart);
          snappedEdge = snLeft.edge;
        } else if (snRight.snapped) {
          delta = Math.max(-minStart, snRight.time - maxEnd);
          snappedEdge = snRight.edge;
        }
      }

      st.deltaSec = delta;
      this._showSnapLine(snappedEdge);

      // Update clip positions directly in DOM (no onChange yet)
      for (i = 0; i < st.participants.length; i++) {
        p = st.participants[i];
        if (p.el) {
          p.el.style.left = ((p.origStart + delta) * this._zoom) + 'px';
        }
      }

      // Check vertical lane hover for cross-track move (same kind, unlocked)
      var hoverTrackId = st.primaryTrackId;
      var laneEls = this._lanesInner.querySelectorAll('.vt-lane');
      for (i = 0; i < laneEls.length; i++) {
        var laneEl = laneEls[i];
        laneEl.classList.remove('is-dragover');
        var rect = laneEl.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          var lKind = laneEl.getAttribute('data-kind');
          var lId = laneEl.getAttribute('data-track-id');
          var lInfo = findTrack(this._project, lId);
          if (lKind === st.primaryKind && lInfo && !lInfo.track.locked) {
            hoverTrackId = lId;
            if (lId !== st.primaryTrackId) {
              laneEl.classList.add('is-dragover');
            }
          }
        }
      }
      st.targetTrackId = hoverTrackId;
    } else if (st.mode === 'trim-l') {
      // Intersect valid deltaSec across all participants (primary + linked)
      var minDelta = -Infinity;
      var maxDelta = Infinity;
      var primaryP = st.participants[0];
      for (i = 0; i < st.participants.length; i++) {
        p = st.participants[i];
        if (p.isPrimary) primaryP = p;
        var pMin = -p.origStart;
        if (!p.isText) {
          pMin = Math.max(pMin, -p.origIn / p.speed);
        }
        var pMax = p.origDur - MIN_CLIP_DUR;
        if (pMin > minDelta) minDelta = pMin;
        if (pMax < maxDelta) maxDelta = pMax;
      }
      var deltaL = clamp(rawDelta, minDelta, maxDelta);
      if (this._snap && st.snapEdges.length > 0) {
        var snL = snapTime(primaryP.origStart + deltaL, st.snapEdges, thresholdSec);
        if (snL.snapped) {
          var cand = snL.time - primaryP.origStart;
          if (cand >= minDelta - EPS && cand <= maxDelta + EPS) {
            deltaL = clamp(cand, minDelta, maxDelta);
            snappedEdge = snL.edge;
          }
        }
      }
      st.deltaSec = deltaL;
      this._showSnapLine(snappedEdge);

      for (i = 0; i < st.participants.length; i++) {
        p = st.participants[i];
        if (p.el) {
          var newS = p.origStart + deltaL;
          var newD = Math.max(MIN_CLIP_DUR, p.origDur - deltaL);
          p.el.style.left = (newS * this._zoom) + 'px';
          p.el.style.width = Math.max(6, newD * this._zoom) + 'px';
          var durEl = p.el.querySelector('.vt-clip-dur');
          if (durEl) durEl.textContent = newD.toFixed(1) + 's';
        }
      }
    } else if (st.mode === 'trim-r') {
      var minDeltaR = -Infinity;
      var maxDeltaR = Infinity;
      var primaryPR = st.participants[0];
      for (i = 0; i < st.participants.length; i++) {
        p = st.participants[i];
        if (p.isPrimary) primaryPR = p;
        var rMin = MIN_CLIP_DUR - p.origDur;
        var rMax = Infinity;
        if (!p.isText && p.maxSrcDur != null) {
          rMax = (p.maxSrcDur - p.origOut) / p.speed;
        }
        if (rMin > minDeltaR) minDeltaR = rMin;
        if (rMax < maxDeltaR) maxDeltaR = rMax;
      }
      var deltaR = clamp(rawDelta, minDeltaR, maxDeltaR);
      if (this._snap && st.snapEdges.length > 0) {
        var snR = snapTime(primaryPR.origEnd + deltaR, st.snapEdges, thresholdSec);
        if (snR.snapped) {
          var candR = snR.time - primaryPR.origEnd;
          if (candR >= minDeltaR - EPS && candR <= maxDeltaR + EPS) {
            deltaR = clamp(candR, minDeltaR, maxDeltaR);
            snappedEdge = snR.edge;
          }
        }
      }
      st.deltaSec = deltaR;
      this._showSnapLine(snappedEdge);

      for (i = 0; i < st.participants.length; i++) {
        p = st.participants[i];
        if (p.el) {
          var newDR = Math.max(MIN_CLIP_DUR, p.origDur + deltaR);
          p.el.style.width = Math.max(6, newDR * this._zoom) + 'px';
          var durElR = p.el.querySelector('.vt-clip-dur');
          if (durElR) durElR.textContent = newDR.toFixed(1) + 's';
        }
      }
    }
  };

  VETimeline.prototype._handleLanesPointerUp = function (e) {
    var st = this._dragState;
    if (!st) return;
    this._dragState = null;
    this._showSnapLine(null);

    if (this._lanes.releasePointerCapture) {
      try { this._lanes.releasePointerCapture(e.pointerId); } catch (_) {}
    }

    var laneEls = this._lanesInner.querySelectorAll('.vt-lane.is-dragover');
    for (var l = 0; l < laneEls.length; l++) {
      laneEls[l].classList.remove('is-dragover');
    }

    if (!st.moved) {
      if (st.collapseOnClick) {
        this._selectedIds.clear();
        this._selectedIds.add(st.primaryId);
        this._updateSelectionDOM();
        this._emitSelect();
      }
      return;
    }

    var delta = roundTime(st.deltaSec);
    var changedTrack = st.mode === 'move' && st.targetTrackId && st.targetTrackId !== st.primaryTrackId;
    if (Math.abs(delta) < EPS && !changedTrack) {
      this.render();
      return;
    }

    var next = clone(this._project);
    var i, p, found;

    if (st.mode === 'move') {
      for (i = 0; i < st.participants.length; i++) {
        p = st.participants[i];
        found = findClip(next, p.id);
        if (!found || found.track.locked) continue;
        found.clip.start = roundTime(Math.max(0, p.origStart + delta));
      }
      if (changedTrack) {
        var srcInfo = findClip(next, st.primaryId);
        var dstInfo = findTrack(next, st.targetTrackId);
        if (srcInfo && dstInfo && !dstInfo.track.locked && srcInfo.track.kind === dstInfo.track.kind) {
          srcInfo.track.clips.splice(srcInfo.clipIndex, 1);
          dstInfo.track.clips.push(srcInfo.clip);
          sortTrackClips(dstInfo.track);
        }
      }
      for (i = 0; i < next.tracks.length; i++) sortTrackClips(next.tracks[i]);
      this._commit(next, 'ย้ายคลิป');
    } else if (st.mode === 'trim-l') {
      for (i = 0; i < st.participants.length; i++) {
        p = st.participants[i];
        found = findClip(next, p.id);
        if (!found || found.track.locked) continue;
        found.clip.start = roundTime(Math.max(0, p.origStart + delta));
        if (p.isText) {
          found.clip.duration = roundTime(Math.max(MIN_CLIP_DUR, p.origDur - delta));
        } else {
          found.clip.in = roundTime(Math.max(0, p.origIn + delta * p.speed));
        }
      }
      for (i = 0; i < next.tracks.length; i++) sortTrackClips(next.tracks[i]);
      this._commit(next, 'ตัดขอบซ้าย');
    } else if (st.mode === 'trim-r') {
      for (i = 0; i < st.participants.length; i++) {
        p = st.participants[i];
        found = findClip(next, p.id);
        if (!found || found.track.locked) continue;
        if (p.isText) {
          found.clip.duration = roundTime(Math.max(MIN_CLIP_DUR, p.origDur + delta));
        } else {
          var newOut = roundTime(p.origOut + delta * p.speed);
          if (p.maxSrcDur != null && newOut > p.maxSrcDur) newOut = p.maxSrcDur;
          found.clip.out = Math.max(roundTime(p.origIn + MIN_CLIP_DUR * p.speed), newOut);
        }
      }
      this._commit(next, 'ตัดขอบขวา');
    }
  };

  // ---------- Drag & Drop Asset ----------

  VETimeline.prototype._handleLanesDragOver = function (e) {
    var types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    if (types.indexOf('application/x-ve-asset') === -1) return;

    var laneEl = e.target.closest('.vt-lane');
    var allLanes = this._lanesInner.querySelectorAll('.vt-lane.is-dragover');
    for (var i = 0; i < allLanes.length; i++) {
      if (allLanes[i] !== laneEl) allLanes[i].classList.remove('is-dragover');
    }
    if (!laneEl) return;

    var trackId = laneEl.getAttribute('data-track-id');
    var info = findTrack(this._project, trackId);
    if (!info || info.track.locked) return;

    // Optional kind pre-check if Media Bin exposes root.__VE_DRAG_ASSET
    var previewAsset = root && root.__VE_DRAG_ASSET;
    if (previewAsset && previewAsset.kind && previewAsset.kind !== info.track.kind) {
      return;
    }

    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    laneEl.classList.add('is-dragover');
  };

  VETimeline.prototype._handleLanesDragLeave = function (e) {
    var laneEl = e.target.closest('.vt-lane');
    if (laneEl && !laneEl.contains(e.relatedTarget)) {
      laneEl.classList.remove('is-dragover');
    }
  };

  VETimeline.prototype._handleLanesDrop = function (e) {
    var laneEl = e.target.closest('.vt-lane');
    var allLanes = this._lanesInner.querySelectorAll('.vt-lane.is-dragover');
    for (var i = 0; i < allLanes.length; i++) {
      allLanes[i].classList.remove('is-dragover');
    }
    if (!laneEl) return;

    var raw = e.dataTransfer ? e.dataTransfer.getData('application/x-ve-asset') : '';
    if (!raw) return;

    var asset;
    try {
      asset = JSON.parse(raw);
    } catch (_) {
      return;
    }

    var trackId = laneEl.getAttribute('data-track-id');
    var info = findTrack(this._project, trackId);
    if (!info || info.track.locked) return;
    if (asset.kind && asset.kind !== info.track.kind) return;

    e.preventDefault();

    var dropTime = this._clientXToTime(e.clientX);
    if (this._snap) {
      var edges = collectSnapEdges(this._project, [], this._playhead);
      var sn = snapTime(dropTime, edges, SNAP_PX / this._zoom);
      if (sn.snapped) dropTime = sn.time;
    }
    dropTime = roundTime(Math.max(0, dropTime));

    var targetClipEl = e.target.closest('.vt-clip');
    var targetClipId = targetClipEl ? targetClipEl.getAttribute('data-clip-id') : null;

    if (typeof this._opts.onDropAsset === 'function') {
      this._opts.onDropAsset(asset, {
        trackId: info.track.id,
        trackKind: info.track.kind,
        time: dropTime,
        targetClipId: targetClipId
      });
      return;
    }

    var next = clone(this._project);
    var nextTrackInfo = findTrack(next, info.track.id);
    if (!nextTrackInfo || nextTrackInfo.track.locked) return;
    var track = nextTrackInfo.track;

    // Dropping music onto an existing music clip replaces its src (preserving start/out)
    if (track.kind === 'music' && targetClipId) {
      var existing = findClip(next, targetClipId);
      if (existing && existing.track.id === track.id) {
        existing.clip.src = asset.src ? clone(asset.src) : { type: 'bgm', name: asset.name || 'warm_tech' };
        if (asset.label || asset.name) existing.clip.label = asset.label || asset.name;
        this._selectedIds.clear();
        this._selectedIds.add(existing.clip.id);
        this._commit(next, 'เปลี่ยนเพลงประกอบ');
        this._emitSelect();
        return;
      }
    }

    var durSec = Number(asset.durationSec || asset.duration) || (track.kind === 'music' ? Math.max(10, projectDuration(next) || 15) : 5);
    var newClip;
    if (track.kind === 'text') {
      newClip = {
        id: uid('c'),
        label: asset.label || 'ข้อความ',
        text: asset.text || asset.label || 'ข้อความใหม่',
        start: dropTime,
        duration: roundTime(durSec),
        style: asset.style ? clone(asset.style) : {}
      };
    } else {
      var isMusic = track.kind === 'music';
      newClip = {
        id: uid('c'),
        label: asset.label || asset.name || (asset.src && (asset.src.name || asset.src.file)) || track.kind,
        src: asset.src ? clone(asset.src) : (asset.file ? { type: 'jobasset', file: asset.file } : { type: track.kind }),
        in: 0,
        out: roundTime(durSec),
        start: dropTime,
        speed: 1,
        volume: isMusic ? 0.14 : (track.kind === 'video' ? 0 : 1),
        fadeIn: isMusic ? 1 : 0,
        fadeOut: isMusic ? 2 : 0,
        loop: isMusic
      };
      if (isMusic) {
        newClip.duckDb = 12;
      }
    }

    track.clips.push(newClip);
    sortTrackClips(track);
    this._selectedIds.clear();
    this._selectedIds.add(newClip.id);
    this._commit(next, 'เพิ่มคลิป');
    this._emitSelect();
  };

  // ---------- Rendering ----------

  VETimeline.prototype.render = function () {
    if (this._destroyed) return;
    this._renderToolbarState();
    var widthPx = this._getContentWidthPx();
    this._renderRuler(widthPx);
    this._renderHeaders();
    this._renderLanes(widthPx);
    this._updatePlayheadDOM();
  };

  VETimeline.prototype._renderToolbarState = function () {
    var selBtn = this._toolbar.querySelector('[data-action="tool-select"]');
    var razBtn = this._toolbar.querySelector('[data-action="tool-razor"]');
    var snapBtn = this._toolbar.querySelector('[data-action="toggle-snap"]');
    var linkBtn = this._toolbar.querySelector('[data-action="toggle-link"]');
    if (selBtn) selBtn.classList.toggle('is-active', this._tool === 'select');
    if (razBtn) razBtn.classList.toggle('is-active', this._tool === 'razor');
    if (snapBtn) snapBtn.classList.toggle('is-active', this._snap);
    if (linkBtn) linkBtn.classList.toggle('is-active', this._linked);
    if (this._zoomSlider) this._zoomSlider.value = String(Math.round(this._zoom));
    this._root.classList.toggle('is-razor', this._tool === 'razor');
  };

  VETimeline.prototype._renderRuler = function (widthPx) {
    this._rulerTrack.style.width = widthPx + 'px';
    // Remove old ticks while keeping rulerHead
    var children = Array.from(this._rulerTrack.children);
    for (var i = 0; i < children.length; i++) {
      if (children[i] !== this._rulerHead) {
        this._rulerTrack.removeChild(children[i]);
      }
    }

    var majorSteps = [0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    var majorSec = 1;
    for (var s = 0; s < majorSteps.length; s++) {
      if (majorSteps[s] * this._zoom >= 68) {
        majorSec = majorSteps[s];
        break;
      }
      majorSec = majorSteps[s];
    }
    var subDivs = majorSec >= 10 ? 5 : (majorSec >= 1 ? 4 : 2);
    var minorSec = majorSec / subDivs;
    var totalSec = widthPx / this._zoom;
    var showTenths = majorSec < 1;

    var frag = document.createDocumentFragment();
    var count = Math.ceil(totalSec / minorSec);
    for (var idx = 0; idx <= count; idx++) {
      var t = idx * minorSec;
      var x = t * this._zoom;
      if (x > widthPx) break;
      var isMajor = (idx % subDivs) === 0;
      var tick = document.createElement('div');
      tick.className = 'vt-tick ' + (isMajor ? 'is-major' : 'is-minor');
      tick.style.left = x + 'px';
      frag.appendChild(tick);

      if (isMajor) {
        var lbl = document.createElement('div');
        lbl.className = 'vt-tick-label';
        lbl.style.left = (x + 3) + 'px';
        lbl.textContent = formatRulerTime(t, showTenths);
        frag.appendChild(lbl);
      }
    }
    this._rulerTrack.appendChild(frag);
  };

  VETimeline.prototype._renderHeaders = function () {
    var tracks = (this._project && Array.isArray(this._project.tracks)) ? this._project.tracks : [];
    var frag = document.createDocumentFragment();

    for (var i = 0; i < tracks.length; i++) {
      var tr = tracks[i];
      var meta = KIND_META[tr.kind] || { icon: '🎞️', label: tr.kind || 'Track' };
      var row = document.createElement('div');
      row.className = 'vt-track-header';
      if (tr.locked) row.classList.add('is-locked');
      if (tr.hidden) row.classList.add('is-hidden');
      if (tr.muted) row.classList.add('is-muted');
      row.setAttribute('data-kind', tr.kind || '');
      row.setAttribute('data-track-id', tr.id || '');

      var title = document.createElement('div');
      title.className = 'vt-track-title';
      title.textContent = meta.icon + ' ' + (tr.name || meta.label);
      title.title = tr.name || meta.label;

      var ctrls = document.createElement('div');
      ctrls.className = 'vt-track-controls';

      var btnHide = document.createElement('button');
      btnHide.type = 'button';
      btnHide.className = 'vt-icon-btn' + (tr.hidden ? ' is-on' : '');
      btnHide.setAttribute('data-track-flag', 'hidden');
      btnHide.title = tr.hidden ? 'แสดงแทร็ก' : 'ซ่อนแทร็ก';
      btnHide.textContent = '👁';

      var btnMute = document.createElement('button');
      btnMute.type = 'button';
      btnMute.className = 'vt-icon-btn' + (tr.muted ? ' is-on' : '');
      btnMute.setAttribute('data-track-flag', 'muted');
      btnMute.title = tr.muted ? 'เปิดเสียงแทร็ก' : 'ปิดเสียงแทร็ก';
      btnMute.textContent = '🔇';

      var btnLock = document.createElement('button');
      btnLock.type = 'button';
      btnLock.className = 'vt-icon-btn' + (tr.locked ? ' is-on' : '');
      btnLock.setAttribute('data-track-flag', 'locked');
      btnLock.title = tr.locked ? 'ปลดล็อกแทร็ก' : 'ล็อกแทร็ก';
      btnLock.textContent = '🔒';

      ctrls.appendChild(btnHide);
      ctrls.appendChild(btnMute);
      ctrls.appendChild(btnLock);

      row.appendChild(title);
      row.appendChild(ctrls);
      frag.appendChild(row);
    }

    this._headers.innerHTML = '';
    this._headers.appendChild(frag);
  };

  VETimeline.prototype._renderLanes = function (widthPx) {
    this._lanesInner.style.width = widthPx + 'px';
    var children = Array.from(this._lanesInner.children);
    for (var cIdx = 0; cIdx < children.length; cIdx++) {
      var ch = children[cIdx];
      if (ch !== this._playheadEl && ch !== this._snaplineEl) {
        this._lanesInner.removeChild(ch);
      }
    }

    var tracks = (this._project && Array.isArray(this._project.tracks)) ? this._project.tracks : [];
    var frag = document.createDocumentFragment();

    for (var i = 0; i < tracks.length; i++) {
      var tr = tracks[i];
      var lane = document.createElement('div');
      lane.className = 'vt-lane';
      if (tr.locked) lane.classList.add('is-locked');
      if (tr.hidden) lane.classList.add('is-hidden');
      if (tr.muted) lane.classList.add('is-muted');
      lane.setAttribute('data-kind', tr.kind || '');
      lane.setAttribute('data-track-id', tr.id || '');

      var clips = Array.isArray(tr.clips) ? tr.clips : [];
      for (var j = 0; j < clips.length; j++) {
        var clip = clips[j];
        var dur = clipDuration(clip, tr.kind);
        var leftPx = (Number(clip.start) || 0) * this._zoom;
        var wPx = Math.max(6, dur * this._zoom);

        var clipEl = document.createElement('div');
        clipEl.className = 'vt-clip';
        if (this._selectedIds.has(clip.id)) clipEl.classList.add('is-selected');
        clipEl.setAttribute('data-kind', tr.kind || '');
        clipEl.setAttribute('data-clip-id', clip.id || '');
        clipEl.setAttribute('data-track-id', tr.id || '');
        if (clip.linkId) clipEl.setAttribute('data-link-id', clip.linkId);
        clipEl.style.left = leftPx + 'px';
        clipEl.style.width = wPx + 'px';

        var handleL = document.createElement('div');
        handleL.className = 'vt-handle-l';

        var content = document.createElement('div');
        content.className = 'vt-clip-content';

        var labelSpan = document.createElement('span');
        labelSpan.className = 'vt-clip-label';
        var labelText = getClipDisplayLabel(clip, tr.kind);
        labelSpan.textContent = (clip.linkId ? '🔗 ' : '') + labelText;
        clipEl.title = labelText + ' (' + dur.toFixed(2) + 's)';

        var durSpan = document.createElement('span');
        durSpan.className = 'vt-clip-dur';
        durSpan.textContent = dur.toFixed(1) + 's';

        content.appendChild(labelSpan);
        content.appendChild(durSpan);

        var handleR = document.createElement('div');
        handleR.className = 'vt-handle-r';

        clipEl.appendChild(handleL);
        clipEl.appendChild(content);
        clipEl.appendChild(handleR);
        lane.appendChild(clipEl);
      }

      frag.appendChild(lane);
    }

    this._lanesInner.insertBefore(frag, this._playheadEl);
  };

  VETimeline.prototype._updateSelectionDOM = function () {
    var clipEls = this._lanesInner.querySelectorAll('.vt-clip');
    for (var i = 0; i < clipEls.length; i++) {
      var id = clipEls[i].getAttribute('data-clip-id');
      clipEls[i].classList.toggle('is-selected', this._selectedIds.has(id));
    }
  };

  VETimeline.prototype._updatePlayheadDOM = function () {
    var px = this._playhead * this._zoom;
    var tx = 'translateX(' + px + 'px)';
    if (this._playheadEl) this._playheadEl.style.transform = tx;
    if (this._rulerHead) this._rulerHead.style.transform = tx;
    if (this._corner) {
      this._corner.textContent = formatTime(this._playhead, (this._project && this._project.fps) || 30);
    }
  };

  // ---------- Internal Emitters ----------

  VETimeline.prototype._commit = function (nextProject, labelThai) {
    this._project = nextProject;
    this.render();
    if (typeof this._opts.onChange === 'function') {
      this._opts.onChange(clone(this._project), labelThai || 'แก้ไขไทม์ไลน์');
    }
  };

  VETimeline.prototype._emitSelect = function () {
    var ids = Array.from(this._selectedIds);
    var primaryId = ids.length > 0 ? ids[ids.length - 1] : null;
    var primaryInfo = primaryId ? findClip(this._project, primaryId) : null;
    var trackId = primaryInfo ? primaryInfo.track.id : null;
    if (typeof this._opts.onSelect === 'function') {
      this._opts.onSelect(ids, primaryId, trackId);
    }
    if (typeof this._opts.onSelectionChange === 'function') {
      this._opts.onSelectionChange(ids, primaryId, trackId);
    }
  };

  VETimeline.prototype._emitSeek = function (timeSec) {
    if (typeof this._opts.onSeek === 'function') {
      this._opts.onSeek(timeSec);
    }
  };

  // ---------- Public API ----------

  VETimeline.prototype.setProject = function (project, opts) {
    var preserveSelection = !opts || opts.preserveSelection !== false;
    this._project = project ? clone(project) : { version: 1, fps: 30, tracks: [] };
    if (preserveSelection) {
      var valid = new Set();
      this._selectedIds.forEach(function (id) {
        if (findClip(this._project, id)) valid.add(id);
      }, this);
      this._selectedIds = valid;
    } else {
      this._selectedIds.clear();
    }
    this.render();
  };

  VETimeline.prototype.getProject = function () {
    return clone(this._project);
  };

  /**
   * Fast-path playhead update (called every animation frame during playback).
   * ONLY updates transform & timecode — never re-renders lanes/clips.
   */
  VETimeline.prototype.setPlayhead = function (sec, opts) {
    var t = Math.max(0, Number(sec) || 0);
    this._playhead = t;
    this._updatePlayheadDOM();

    var autoScroll = opts && typeof opts.autoScroll === 'boolean' ? opts.autoScroll : !this._isScrubbing;
    if (autoScroll && this._lanes && this._lanes.clientWidth > 0) {
      var px = t * this._zoom;
      var viewLeft = this._lanes.scrollLeft;
      var viewRight = viewLeft + this._lanes.clientWidth;
      if (px > viewRight - 24) {
        this._lanes.scrollLeft = Math.max(0, px - this._lanes.clientWidth * 0.25);
      } else if (px < viewLeft) {
        this._lanes.scrollLeft = Math.max(0, px - 24);
      }
    }
  };

  VETimeline.prototype.getPlayhead = function () {
    return this._playhead;
  };

  VETimeline.prototype.setTime = function (sec, opts) {
    return this.setPlayhead(sec, opts);
  };

  VETimeline.prototype.setSelected = function (clipId) {
    if (Array.isArray(clipId)) {
      return this.setSelection(clipId);
    }
    return this.selectClip(clipId, false);
  };

  VETimeline.prototype.setSelection = function (clipIds) {
    this._selectedIds.clear();
    if (Array.isArray(clipIds)) {
      for (var i = 0; i < clipIds.length; i++) {
        if (findClip(this._project, clipIds[i])) {
          this._selectedIds.add(clipIds[i]);
        }
      }
    }
    this._updateSelectionDOM();
    this._emitSelect();
  };

  VETimeline.prototype.selectClip = function (clipId, additive) {
    if (!additive) this._selectedIds.clear();
    if (clipId && findClip(this._project, clipId)) {
      this._selectedIds.add(clipId);
    }
    this._updateSelectionDOM();
    this._emitSelect();
  };

  VETimeline.prototype.clearSelection = function () {
    if (this._selectedIds.size === 0) return;
    this._selectedIds.clear();
    this._updateSelectionDOM();
    this._emitSelect();
  };

  VETimeline.prototype.getSelectedIds = function () {
    return Array.from(this._selectedIds);
  };

  VETimeline.prototype.setTool = function (tool) {
    var nextTool = tool === 'razor' ? 'razor' : 'select';
    if (this._tool === nextTool) return;
    this._tool = nextTool;
    this._renderToolbarState();
    if (typeof this._opts.onToolChange === 'function') {
      this._opts.onToolChange(this._tool);
    }
  };

  VETimeline.prototype.getTool = function () {
    return this._tool;
  };

  VETimeline.prototype.setSnap = function (enabled) {
    this._snap = !!enabled;
    this._renderToolbarState();
  };

  VETimeline.prototype.getSnap = function () {
    return this._snap;
  };

  VETimeline.prototype.setLinked = function (enabled) {
    this._linked = !!enabled;
    this._renderToolbarState();
  };

  VETimeline.prototype.getLinked = function () {
    return this._linked;
  };

  VETimeline.prototype.setZoom = function (pxPerSec, anchorClientX) {
    var oldZoom = this._zoom;
    var newZoom = clamp(Number(pxPerSec) || oldZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(newZoom - oldZoom) < 1e-4) return;

    var anchorOffsetPx = 0;
    var anchorTime = this._playhead;
    if (typeof anchorClientX === 'number' && this._lanes) {
      var rect = this._lanes.getBoundingClientRect();
      anchorOffsetPx = anchorClientX - rect.left;
      anchorTime = (anchorOffsetPx + this._lanes.scrollLeft) / oldZoom;
    } else if (this._lanes) {
      anchorOffsetPx = this._playhead * oldZoom - this._lanes.scrollLeft;
    }

    this._zoom = newZoom;
    this.render();

    if (this._lanes) {
      var newScroll = Math.max(0, anchorTime * newZoom - anchorOffsetPx);
      this._lanes.scrollLeft = newScroll;
      this._ruler.scrollLeft = newScroll;
    }

    if (typeof this._opts.onZoomChange === 'function') {
      this._opts.onZoomChange(this._zoom);
    }
  };

  VETimeline.prototype.getZoom = function () {
    return this._zoom;
  };

  VETimeline.prototype.zoomIn = function () {
    this.setZoom(this._zoom * 1.25);
  };

  VETimeline.prototype.zoomOut = function () {
    this.setZoom(this._zoom / 1.25);
  };

  VETimeline.prototype.zoomToFit = function () {
    var dur = Math.max(1, projectDuration(this._project));
    var availW = (this._lanes && this._lanes.clientWidth > 60) ? (this._lanes.clientWidth - 40) : 640;
    var nextZoom = clamp(availW / dur, MIN_ZOOM, MAX_ZOOM);
    this._zoom = nextZoom;
    this.render();
    if (this._lanes) {
      this._lanes.scrollLeft = 0;
      this._ruler.scrollLeft = 0;
    }
    if (typeof this._opts.onZoomChange === 'function') {
      this._opts.onZoomChange(this._zoom);
    }
  };

  VETimeline.prototype.splitClip = function (clipId, timeSec) {
    var res = splitClipAt(this._project, [clipId], timeSec, { linked: this._linked });
    if (res.splitCount > 0) {
      this._commit(res.project, 'ตัดแบ่งคลิป');
    }
    return res.splitCount > 0;
  };

  VETimeline.prototype.splitAtPlayhead = function () {
    var sel = Array.from(this._selectedIds);
    var res = splitClipAt(this._project, sel.length > 0 ? sel : null, this._playhead, { linked: this._linked });
    if (res.splitCount > 0) {
      this._commit(res.project, 'ตัดแบ่งคลิป');
    }
    return res.splitCount > 0;
  };

  VETimeline.prototype.deleteSelected = function (opts) {
    var sel = Array.from(this._selectedIds);
    if (sel.length === 0) return false;
    var ripple = !!(opts && opts.ripple);
    var res = rippleDelete(this._project, sel, { ripple: ripple, linked: this._linked });
    if (res.deletedCount > 0) {
      this._selectedIds.clear();
      this._commit(res.project, ripple ? 'ลบแบบเลื่อนชิด' : 'ลบคลิป');
      this._emitSelect();
      return true;
    }
    return false;
  };

  VETimeline.prototype.duplicateSelected = function () {
    var sel = Array.from(this._selectedIds);
    if (sel.length === 0) return false;

    var next = clone(this._project);
    var toDupMap = Object.create(null);
    var i, j;

    for (i = 0; i < sel.length; i++) {
      var f = findClip(next, sel[i]);
      if (!f || f.track.locked) continue;
      toDupMap[f.clip.id] = f;
      if (this._linked && f.clip.linkId) {
        var peers = findLinkedClips(next, f.clip.linkId);
        for (j = 0; j < peers.length; j++) {
          if (!peers[j].track.locked) toDupMap[peers[j].clip.id] = peers[j];
        }
      }
    }

    var ids = Object.keys(toDupMap);
    if (ids.length === 0) return false;

    var newLinkMap = Object.create(null);
    var newIds = [];

    for (i = 0; i < ids.length; i++) {
      var info = toDupMap[ids[i]];
      var copy = clone(info.clip);
      copy.id = uid('c');
      copy.start = roundTime(clipEnd(info.clip, info.track.kind));
      if (copy.linkId) {
        if (!newLinkMap[copy.linkId]) newLinkMap[copy.linkId] = uid('lnk');
        copy.linkId = newLinkMap[copy.linkId];
      }
      info.track.clips.push(copy);
      sortTrackClips(info.track);
      newIds.push(copy.id);
    }

    this._selectedIds = new Set(newIds);
    this._commit(next, 'ทำสำเนาคลิป');
    this._emitSelect();
    return true;
  };

  VETimeline.prototype.nudgeSelected = function (deltaSec) {
    var d = Number(deltaSec) || 0;
    if (Math.abs(d) < EPS) return false;
    var sel = Array.from(this._selectedIds);
    if (sel.length === 0) return false;

    var next = clone(this._project);
    var targets = Object.create(null);
    var i, j;

    for (i = 0; i < sel.length; i++) {
      var f = findClip(next, sel[i]);
      if (!f || f.track.locked) continue;
      targets[f.clip.id] = f;
      if (this._linked && f.clip.linkId) {
        var peers = findLinkedClips(next, f.clip.linkId);
        for (j = 0; j < peers.length; j++) {
          if (!peers[j].track.locked) targets[peers[j].clip.id] = peers[j];
        }
      }
    }

    var keys = Object.keys(targets);
    if (keys.length === 0) return false;

    var minStart = Infinity;
    for (i = 0; i < keys.length; i++) {
      var s = Number(targets[keys[i]].clip.start) || 0;
      if (s < minStart) minStart = s;
    }
    var actualDelta = Math.max(-minStart, d);
    if (Math.abs(actualDelta) < EPS) return false;

    for (i = 0; i < keys.length; i++) {
      var item = targets[keys[i]];
      item.clip.start = roundTime(Math.max(0, (Number(item.clip.start) || 0) + actualDelta));
    }
    for (i = 0; i < next.tracks.length; i++) sortTrackClips(next.tracks[i]);

    this._commit(next, 'ขยับคลิป');
    return true;
  };

  VETimeline.prototype.addTrack = function (kind, name) {
    var k = kind || 'video';
    var next = clone(this._project);
    if (!Array.isArray(next.tracks)) next.tracks = [];

    var countSame = 0;
    for (var i = 0; i < next.tracks.length; i++) {
      if (next.tracks[i].kind === k) countSame += 1;
    }
    var meta = KIND_META[k] || { label: k };
    var prefix = k.charAt(0) || 't';
    var track = {
      id: prefix + (countSame + 1) + '_' + uid('tr').slice(-4),
      kind: k,
      name: name || (meta.label + ' ' + (countSame + 1)),
      muted: false,
      locked: false,
      hidden: false,
      clips: []
    };

    if (k === 'text' || k === 'video') {
      // Insert new video/text track near top for natural layering
      next.tracks.unshift(track);
    } else {
      next.tracks.push(track);
    }

    this._commit(next, 'เพิ่มแทร็ก' + meta.label);
    return track;
  };

  VETimeline.prototype.toggleTrackFlag = function (trackId, flag) {
    if (flag !== 'hidden' && flag !== 'muted' && flag !== 'locked') return false;
    var next = clone(this._project);
    var info = findTrack(next, trackId);
    if (!info) return false;
    info.track[flag] = !info.track[flag];
    var labelMap = {
      hidden: info.track.hidden ? 'ซ่อนแทร็ก' : 'แสดงแทร็ก',
      muted: info.track.muted ? 'ปิดเสียงแทร็ก' : 'เปิดเสียงแทร็ก',
      locked: info.track.locked ? 'ล็อกแทร็ก' : 'ปลดล็อกแทร็ก'
    };
    this._commit(next, labelMap[flag]);
    return true;
  };

  VETimeline.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._toolbar) this._toolbar.removeEventListener('click', this._onToolbarClick);
    if (this._zoomSlider) this._zoomSlider.removeEventListener('input', this._onZoomInput);
    if (this._headers) {
      this._headers.removeEventListener('click', this._onHeaderClick);
      this._headers.removeEventListener('scroll', this._onHeadersScroll);
    }
    if (this._ruler) {
      this._ruler.removeEventListener('pointerdown', this._onRulerPointerDown);
      this._ruler.removeEventListener('pointermove', this._onRulerPointerMove);
      this._ruler.removeEventListener('pointerup', this._onRulerPointerUp);
      this._ruler.removeEventListener('pointercancel', this._onRulerPointerUp);
    }
    if (this._lanes) {
      this._lanes.removeEventListener('scroll', this._onLanesScroll);
      this._lanes.removeEventListener('wheel', this._onLanesWheel);
      this._lanes.removeEventListener('pointerdown', this._onLanesPointerDown);
      this._lanes.removeEventListener('pointermove', this._onLanesPointerMove);
      this._lanes.removeEventListener('pointerup', this._onLanesPointerUp);
      this._lanes.removeEventListener('pointercancel', this._onLanesPointerUp);
      this._lanes.removeEventListener('dragover', this._onLanesDragOver);
      this._lanes.removeEventListener('dragleave', this._onLanesDragLeave);
      this._lanes.removeEventListener('drop', this._onLanesDrop);
    }
    if (this._container) this._container.innerHTML = '';
  };

  if (root) {
    root.VETimeline = VETimeline;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VEModel: VEModel, VETimeline: VETimeline };
  }
})(typeof window !== 'undefined' ? window : globalThis);

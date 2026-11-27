/*
 * Homelab Pixel Company — Procedural Pixel-Art Drawing Library
 * Canvas 2D pure fillRect/fillText sprite & furniture renderer (no external assets).
 * Exports: window.PixelOfficeArt
 */
(function (root) {
  'use strict';

  var TILE = 16;

  // ---------------------------------------------------------------------------
  // Color & Pixel Utilities
  // ---------------------------------------------------------------------------
  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return { r: 120, g: 120, b: 140 };
    var h = hex.replace('#', '').trim();
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    var n = parseInt(h, 16);
    if (isNaN(n)) return { r: 120, g: 120, b: 140 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(r, g, b) {
    var rr = clamp(r | 0, 0, 255).toString(16);
    var gg = clamp(g | 0, 0, 255).toString(16);
    var bb = clamp(b | 0, 0, 255).toString(16);
    return '#' + (rr.length < 2 ? '0' + rr : rr) +
      (gg.length < 2 ? '0' + gg : gg) +
      (bb.length < 2 ? '0' + bb : bb);
  }

  function shadeHex(hex, delta) {
    var c = hexToRgb(hex);
    return rgbToHex(c.r + delta, c.g + delta, c.b + delta);
  }

  function mixHex(hexA, hexB, t) {
    var a = hexToRgb(hexA);
    var b = hexToRgb(hexB);
    return rgbToHex(
      a.r + (b.r - a.r) * t,
      a.g + (b.g - a.g) * t,
      a.b + (b.b - a.b) * t
    );
  }

  function rgbaFromHex(hex, alpha) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
  }

  function hash2D(ix, iy) {
    var h = (ix * 374761393 + iy * 668265263) ^ 0x5bf03635;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0);
  }

  function hashSeed(seed) {
    if (typeof seed === 'number' && isFinite(seed)) {
      var n = (seed | 0) ^ 0x9e3779b9;
      n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
      n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
      return (n ^ (n >>> 16)) >>> 0;
    }
    var s = String(seed == null ? 'homelab' : seed);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    var state = a >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Pixel-aligned fillRect shorthand
  function px(ctx, x, y, w, h, color) {
    if (color) ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  // Framed pixel box (1px outline + fill + optional top highlight & bottom shade)
  function box(ctx, x, y, w, h, fill, outline, hi, lo) {
    var ix = x | 0;
    var iy = y | 0;
    var iw = w | 0;
    var ih = h | 0;
    if (iw <= 0 || ih <= 0) return;
    px(ctx, ix, iy, iw, ih, outline || '#191423');
    if (iw > 2 && ih > 2) {
      px(ctx, ix + 1, iy + 1, iw - 2, ih - 2, fill);
      if (hi && ih > 3) px(ctx, ix + 1, iy + 1, iw - 2, 1, hi);
      if (lo && ih > 4) px(ctx, ix + 1, iy + ih - 2, iw - 2, 1, lo);
    }
  }

  // Soft pixel drop shadow ellipse-ish rect
  function dropShadow(ctx, x, y, w, h, alpha) {
    var ix = x | 0;
    var iy = y | 0;
    var iw = w | 0;
    var ih = h | 0;
    ctx.fillStyle = 'rgba(12, 9, 24, ' + (alpha != null ? alpha : 0.30) + ')';
    if (iw >= 4 && ih >= 3) {
      ctx.fillRect(ix + 1, iy, iw - 2, ih);
      ctx.fillRect(ix, iy + 1, iw, ih - 2);
    } else {
      ctx.fillRect(ix, iy, iw, ih);
    }
  }

  // ---------------------------------------------------------------------------
  // Palette (Dark & Light Themes + 6 Signature Departments)
  // ---------------------------------------------------------------------------
  var DEPT_COLORS = {
    ai: '#6d4bc4',     // ม่วง — AI Chat
    video: '#d9667a',  // ชมพูอิฐ — Video Studio
    cron: '#c9a23a',   // เหลืองมัสตาร์ด — Cron & Scheduler
    hub: '#3d6fb6',    // ฟ้า — IT / Agent Hub
    ops: '#3f8f6a',    // เขียว — Operations / Infra
    lounge: '#8a6a4a'  // ไม้อุ่น — Lounge & Courtyard
  };

  function makeDeptSet(baseHex, isLight) {
    return {
      base: baseHex,
      wall: isLight ? mixHex(baseHex, '#ffffff', 0.16) : shadeHex(baseHex, -12),
      wallTop: isLight ? mixHex(baseHex, '#ffffff', 0.38) : mixHex(baseHex, '#ffffff', 0.20),
      wallDark: isLight ? shadeHex(baseHex, -28) : shadeHex(baseHex, -46),
      sign: isLight ? shadeHex(baseHex, -12) : shadeHex(baseHex, -22),
      signHi: mixHex(baseHex, '#ffffff', 0.25),
      carpet: isLight ? mixHex(baseHex, '#f4efe6', 0.65) : mixHex(baseHex, '#1d1b2c', 0.68),
      accent: mixHex(baseHex, '#ffffff', 0.32)
    };
  }

  var PALETTE = {
    outline: '#191423',
    // Top-level dept aliases for direct lookup
    ai: DEPT_COLORS.ai,
    video: DEPT_COLORS.video,
    cron: DEPT_COLORS.cron,
    hub: DEPT_COLORS.hub,
    ops: DEPT_COLORS.ops,
    lounge: DEPT_COLORS.lounge,
    depts: {
      ai: DEPT_COLORS.ai,
      video: DEPT_COLORS.video,
      cron: DEPT_COLORS.cron,
      hub: DEPT_COLORS.hub,
      ops: DEPT_COLORS.ops,
      lounge: DEPT_COLORS.lounge
    },
    dark: {
      name: 'dark',
      outline: '#161121',
      shadow: 'rgba(8, 6, 18, 0.38)',
      skyTop: '#0d152b',
      skyBottom: '#1f2d52',
      buildingShell: '#2a2438',
      buildingTrim: '#48405d',
      corridor: '#2f3246',
      wood: ['#6e4a30', '#634129', '#795236', '#4a2f1d'],
      carpet: ['#383d5b', '#313652', '#444a6e', '#262a42'],
      tile: ['#3b4158', '#33384d', '#484f6a', '#262a3b'],
      concrete: ['#414756', '#3a3f4d', '#4c5364', '#2e323e'],
      grass: ['#2f6b3e', '#275c34', '#3b824a', '#1d4527'],
      desk: ['#8a5733', '#6b4123', '#a66d43', '#492a15'],
      metal: ['#4b556b', '#353d4f', '#6b7791', '#232936'],
      screenBg: '#0c1b2a',
      screenGlow: '#38e8c6',
      bubbleBg: '#fffdf7',
      bubbleShade: '#dde4f0',
      bubbleText: '#1a1526',
      signBorder: '#f4f0e8',
      signText: '#ffffff',
      windowGlass: '#142442',
      depts: {
        ai: makeDeptSet(DEPT_COLORS.ai, false),
        video: makeDeptSet(DEPT_COLORS.video, false),
        cron: makeDeptSet(DEPT_COLORS.cron, false),
        hub: makeDeptSet(DEPT_COLORS.hub, false),
        ops: makeDeptSet(DEPT_COLORS.ops, false),
        lounge: makeDeptSet(DEPT_COLORS.lounge, false)
      }
    },
    light: {
      name: 'light',
      outline: '#221a2e',
      shadow: 'rgba(24, 18, 40, 0.24)',
      skyTop: '#4e9be6',
      skyBottom: '#a6d8ff',
      buildingShell: '#cfc5b4',
      buildingTrim: '#efe7d8',
      corridor: '#dad4c8',
      wood: ['#b68252', '#a87547', '#c59261', '#7d5430'],
      carpet: ['#8d98bd', '#818cb2', '#a0abc9', '#677194'],
      tile: ['#e4dfd5', '#d7d1c5', '#f2eee6', '#b8b0a3'],
      concrete: ['#b5bac4', '#a7adb8', '#c6cbd4', '#868c98'],
      grass: ['#57a64c', '#4a9441', '#6fc25f', '#387531'],
      desk: ['#a96e3f', '#87542c', '#c78855', '#5d371b'],
      metal: ['#768299', '#5a657a', '#99a6bd', '#3e4657'],
      screenBg: '#12263a',
      screenGlow: '#2fd6b7',
      bubbleBg: '#ffffff',
      bubbleShade: '#e3e9f2',
      bubbleText: '#1c1728',
      signBorder: '#fffdf7',
      signText: '#ffffff',
      windowGlass: '#88c8f7',
      depts: {
        ai: makeDeptSet(DEPT_COLORS.ai, true),
        video: makeDeptSet(DEPT_COLORS.video, true),
        cron: makeDeptSet(DEPT_COLORS.cron, true),
        hub: makeDeptSet(DEPT_COLORS.hub, true),
        ops: makeDeptSet(DEPT_COLORS.ops, true),
        lounge: makeDeptSet(DEPT_COLORS.lounge, true)
      }
    }
  };

  function getTheme(opts) {
    var t = (opts && opts.theme) || (typeof opts === 'string' ? opts : 'dark');
    return t === 'light' ? PALETTE.light : PALETTE.dark;
  }

  function resolveColor(color, theme) {
    if (!color) return theme.depts.hub.wall;
    if (theme.depts[color]) return theme.depts[color].wall;
    if (DEPT_COLORS[color]) return DEPT_COLORS[color];
    return color;
  }

  // ---------------------------------------------------------------------------
  // 1. Floor Renderer
  // ---------------------------------------------------------------------------
  function drawFloor(ctx, x, y, w, h, style, opts) {
    var ix = x | 0;
    var iy = y | 0;
    var iw = w | 0;
    var ih = h | 0;
    if (iw <= 0 || ih <= 0) return;

    var o = opts || {};
    var theme = getTheme(o);
    var st = style || 'wood';

    ctx.save();
    ctx.beginPath();
    ctx.rect(ix, iy, iw, ih);
    ctx.clip();

    if (st === 'wood') {
      var wc = o.color
        ? [o.color, shadeHex(o.color, -10), shadeHex(o.color, 12), shadeHex(o.color, -32)]
        : theme.wood;
      px(ctx, ix, iy, iw, ih, wc[0]);
      var plankH = 4;
      var plankW = 16;
      for (var py0 = iy; py0 < iy + ih; py0 += plankH) {
        var row = ((py0 - iy) / plankH) | 0;
        var offset = (row % 2) * 8;
        // Horizontal seam
        px(ctx, ix, py0 + plankH - 1, iw, 1, wc[3]);
        for (var px0 = ix - offset; px0 < ix + iw; px0 += plankW) {
          var hval = hash2D(px0 >> 4, row);
          var tone = wc[hval % 3];
          px(ctx, px0, py0, plankW - 1, plankH - 1, tone);
          // Subtle wood grain highlight
          if ((hval & 3) === 0) {
            px(ctx, px0 + 3, py0 + 1, 6, 1, wc[2]);
          }
          // Vertical plank joint
          px(ctx, px0 + plankW - 1, py0, 1, plankH, wc[3]);
        }
      }
    } else if (st === 'carpet') {
      var baseC = o.color
        ? (theme.depts[o.color] ? theme.depts[o.color].carpet : o.color)
        : theme.carpet[0];
      var darkC = shadeHex(baseC, -12);
      var lightC = shadeHex(baseC, 14);
      var borderC = shadeHex(baseC, -24);
      px(ctx, ix, iy, iw, ih, baseC);
      // Woven micro-stipple texture
      ctx.fillStyle = darkC;
      for (var cy = iy + 1; cy < iy + ih - 1; cy += 4) {
        var shift = ((cy - iy) >> 2) & 1 ? 2 : 0;
        for (var cx = ix + 1 + shift; cx < ix + iw - 1; cx += 4) {
          ctx.fillRect(cx, cy, 1, 1);
        }
      }
      ctx.fillStyle = lightC;
      for (var cy2 = iy + 3; cy2 < iy + ih - 1; cy2 += 8) {
        for (var cx2 = ix + 3; cx2 < ix + iw - 1; cx2 += 8) {
          ctx.fillRect(cx2, cy2, 1, 1);
        }
      }
      // Subtle stitched border inset
      if (iw > 10 && ih > 10) {
        ctx.fillStyle = borderC;
        ctx.fillRect(ix + 2, iy + 2, iw - 4, 1);
        ctx.fillRect(ix + 2, iy + ih - 3, iw - 4, 1);
        ctx.fillRect(ix + 2, iy + 2, 1, ih - 4);
        ctx.fillRect(ix + iw - 3, iy + 2, 1, ih - 4);
        ctx.fillStyle = lightC;
        ctx.fillRect(ix + 3, iy + 3, iw - 6, 1);
      }
    } else if (st === 'tile') {
      var tc = o.color
        ? [o.color, shadeHex(o.color, -12), shadeHex(o.color, 14), shadeHex(o.color, -28)]
        : theme.tile;
      var ts = o.tileSize || 8;
      for (var ty = iy; ty < iy + ih; ty += ts) {
        var tr = ((ty - iy) / ts) | 0;
        for (var tx = ix; tx < ix + iw; tx += ts) {
          var tcol = ((tx - ix) / ts) | 0;
          var checker = (tr + tcol) & 1;
          px(ctx, tx, ty, ts, ts, checker ? tc[1] : tc[0]);
          // Grout lines
          px(ctx, tx, ty + ts - 1, ts, 1, tc[3]);
          px(ctx, tx + ts - 1, ty, 1, ts, tc[3]);
          // Top-left glint
          px(ctx, tx + 1, ty + 1, 2, 1, tc[2]);
        }
      }
    } else if (st === 'concrete') {
      var cc = o.color
        ? [o.color, shadeHex(o.color, -10), shadeHex(o.color, 12), shadeHex(o.color, -24)]
        : theme.concrete;
      px(ctx, ix, iy, iw, ih, cc[0]);
      // Slab joints every 16px
      for (var sy = iy; sy < iy + ih; sy += 16) {
        px(ctx, ix, sy, iw, 1, cc[3]);
        px(ctx, ix, sy + 1, iw, 1, cc[2]);
      }
      for (var sx = ix; sx < ix + iw; sx += 16) {
        px(ctx, sx, iy, 1, ih, cc[3]);
      }
      // Industrial speckle dithering
      for (var dy = iy + 2; dy < iy + ih; dy += 4) {
        for (var dx = ix + 2; dx < ix + iw; dx += 4) {
          var hv = hash2D(dx, dy);
          if ((hv & 7) === 0) px(ctx, dx, dy, 1, 1, cc[1]);
          else if ((hv & 15) === 1) px(ctx, dx + 1, dy, 1, 1, cc[2]);
        }
      }
    } else if (st === 'grass') {
      var gc = o.color
        ? [o.color, shadeHex(o.color, -14), shadeHex(o.color, 18), shadeHex(o.color, -30)]
        : theme.grass;
      px(ctx, ix, iy, iw, ih, gc[0]);
      // Soft meadow patches + pixel grass blades + occasional tiny flower
      for (var gy = iy; gy < iy + ih; gy += 6) {
        for (var gx = ix; gx < ix + iw; gx += 6) {
          var gv = hash2D(gx, gy);
          if ((gv & 3) === 0) {
            px(ctx, gx, gy + 1, 3, 2, gc[1]);
          }
          if ((gv & 7) === 2) {
            // Grass tuft
            px(ctx, gx + 1, gy + 2, 1, 2, gc[3]);
            px(ctx, gx + 2, gy + 1, 1, 3, gc[2]);
            px(ctx, gx + 3, gy + 2, 1, 2, gc[2]);
          } else if ((gv & 31) === 5) {
            // Tiny wildflower dot
            var fc = (gv & 64) ? '#f7e06b' : '#f48fa8';
            px(ctx, gx + 2, gy + 2, 1, 1, fc);
            px(ctx, gx + 2, gy + 3, 1, 1, gc[3]);
          }
        }
      }
    } else {
      px(ctx, ix, iy, iw, ih, resolveColor(o.color, theme));
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // 2. Wall Renderer
  // ---------------------------------------------------------------------------
  function drawWall(ctx, x, y, w, h, color, opts) {
    var ix = x | 0;
    var iy = y | 0;
    var iw = w | 0;
    var ih = h | 0;
    if (iw <= 0 || ih <= 0) return;

    var o = opts || {};
    var theme = getTheme(o);
    var base = resolveColor(color, theme);
    var topCol = theme.depts[color] ? theme.depts[color].wallTop : mixHex(base, '#ffffff', 0.28);
    var darkCol = theme.depts[color] ? theme.depts[color].wallDark : shadeHex(base, -34);
    var trimCol = shadeHex(base, -48);
    var out = theme.outline;

    // Cast drop shadow onto floor below wall
    if (o.shadow !== false) {
      ctx.fillStyle = theme.shadow;
      ctx.fillRect(ix, iy + ih, iw, 3);
    }

    // Main outer frame
    px(ctx, ix, iy, iw, ih, out);
    if (iw <= 2 || ih <= 2) return;

    // Wall interior
    px(ctx, ix + 1, iy + 1, iw - 2, ih - 2, base);

    // Top beveled cap highlight (2.5D top edge)
    var capH = ih >= 10 ? 3 : (ih >= 6 ? 2 : 1);
    px(ctx, ix + 1, iy + 1, iw - 2, capH, topCol);
    if (ih >= 8) {
      px(ctx, ix + 1, iy + 1 + capH, iw - 2, 1, shadeHex(base, 14));
    }

    // Subtle vertical plaster / brick ribbing on taller walls
    if (ih >= 12) {
      var panelCol = shadeHex(base, -10);
      for (var vx = ix + 8; vx < ix + iw - 3; vx += 8) {
        px(ctx, vx, iy + capH + 2, 1, ih - capH - 5, panelCol);
      }
      // Subtle brick horizontal accent
      var brickY = iy + capH + (((ih - capH - 4) / 2) | 0);
      px(ctx, ix + 1, brickY, iw - 2, 1, shadeHex(base, -7));
    }

    // Bottom baseboard trim
    if (ih >= 7) {
      px(ctx, ix + 1, iy + ih - 3, iw - 2, 2, darkCol);
      px(ctx, ix + 1, iy + ih - 2, iw - 2, 1, trimCol);
    } else if (ih >= 5) {
      px(ctx, ix + 1, iy + ih - 2, iw - 2, 1, darkCol);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Room Sign Plaque Renderer
  // ---------------------------------------------------------------------------
  function drawRoomSign(ctx, x, y, text, color, opts) {
    var o = opts || {};
    var theme = getTheme(o);
    var label = String(text == null ? '' : text);
    var fontSize = o.fontSize || 9;
    var font = '700 ' + fontSize + 'px "Noto Sans Thai", "Sarabun", "Segoe UI", system-ui, sans-serif';

    ctx.save();
    ctx.font = font;
    var measured = ctx.measureText(label).width;
    var padX = o.padX != null ? o.padX : 7;
    var w = Math.max(o.minWidth || 38, Math.ceil(measured + padX * 2));
    if (o.w) w = o.w | 0;
    var h = o.h || (fontSize + 7);

    var align = o.align || 'center';
    var bx = align === 'left' ? (x | 0) : ((x - w / 2) | 0);
    var by = (y | 0);

    var fill = theme.depts[color] ? theme.depts[color].sign : resolveColor(color, theme);
    var hi = mixHex(fill, '#ffffff', 0.22);
    var lo = shadeHex(fill, -26);

    // Subtle shadow behind plaque
    ctx.fillStyle = 'rgba(10, 8, 22, 0.42)';
    ctx.fillRect(bx + 1, by + 2, w, h);

    // Dark pixel outline
    px(ctx, bx, by, w, h, theme.outline);
    // Crisp white/cream inner border (like reference image signs!)
    px(ctx, bx + 1, by + 1, w - 2, h - 2, theme.signBorder);
    // Inner colored plaque fill
    px(ctx, bx + 2, by + 2, w - 4, h - 4, fill);
    // Glossy top strip & bottom bevel
    px(ctx, bx + 2, by + 2, w - 4, 1, hi);
    px(ctx, bx + 2, by + h - 3, w - 4, 1, lo);

    // Corner rivets
    px(ctx, bx + 3, by + 3, 1, 1, theme.signBorder);
    px(ctx, bx + w - 4, by + 3, 1, 1, theme.signBorder);

    // Bold crisp text with 1px dark drop shadow
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var tx = bx + (w / 2);
    var ty = by + (h / 2) + 0.5;
    ctx.fillStyle = 'rgba(12, 8, 24, 0.72)';
    ctx.fillText(label, tx + 1, ty + 1);
    ctx.fillStyle = o.textColor || theme.signText;
    ctx.fillText(label, tx, ty);
    ctx.restore();

    return { x: bx, y: by, w: w, h: h };
  }

  // ---------------------------------------------------------------------------
  // 4. Door Renderer
  // ---------------------------------------------------------------------------
  function drawDoor(ctx, x, y, open, opts) {
    var ix = x | 0;
    var iy = y | 0;
    var o = opts || {};
    var theme = getTheme(o);
    var out = theme.outline;
    var w = (o.w || TILE) | 0;
    var h = (o.h || TILE) | 0;
    var vertical = o.orient === 'vertical';
    var frameCol = o.frameColor || '#5e493b';
    var doorCol = o.color || '#9a653c';
    var doorHi = shadeHex(doorCol, 24);
    var doorLo = shadeHex(doorCol, -24);
    var glassCol = theme.name === 'light' ? '#9fd8fa' : '#4a85b8';

    if (!vertical) {
      // Threshold mat
      px(ctx, ix + 1, iy + h - 3, w - 2, 3, 'rgba(18, 14, 28, 0.25)');
      // Door jamb pillars
      box(ctx, ix, iy, 3, h, frameCol, out, shadeHex(frameCol, 18), shadeHex(frameCol, -18));
      box(ctx, ix + w - 3, iy, 3, h, frameCol, out, shadeHex(frameCol, 18), shadeHex(frameCol, -18));

      if (open) {
        // Open doorway: top lintel beam, light threshold strip & neatly swung leaf
        box(ctx, ix, iy, w, 3, frameCol, out, shadeHex(frameCol, 20), shadeHex(frameCol, -20));
        px(ctx, ix + 3, iy + 3, w - 6, h - 4, 'rgba(255, 248, 224, 0.14)');
        px(ctx, ix + 4, iy + h - 4, w - 8, 2, 'rgba(20, 16, 30, 0.22)');
        // Swung wooden leaf resting neatly inside right jamb
        box(ctx, ix + w - 5, iy + 2, 4, h - 3, doorCol, out, doorHi, doorLo);
        px(ctx, ix + w - 4, iy + ((h / 2) | 0), 1, 2, '#f2cf66');
      } else {
        // Closed double/single wooden + glass office door
        box(ctx, ix + 2, iy + 2, w - 4, h - 4, doorCol, out, doorHi, doorLo);
        // Glass window inset
        if (w >= 14 && h >= 12) {
          box(ctx, ix + 4, iy + 4, w - 8, 5, glassCol, out, '#d6f1ff', null);
          px(ctx, ix + 5, iy + 5, 2, 1, '#ffffff');
        }
        // Brass handle
        px(ctx, ix + w - 5, iy + ((h / 2) | 0) + 1, 2, 2, '#f5d264');
      }
    } else {
      // Vertical wall doorway
      box(ctx, ix, iy, w, 3, frameCol, out, shadeHex(frameCol, 18), shadeHex(frameCol, -18));
      box(ctx, ix, iy + h - 3, w, 3, frameCol, out, shadeHex(frameCol, 18), shadeHex(frameCol, -18));
      if (open) {
        px(ctx, ix + ((w / 2) | 0) - 1, iy + 3, 2, h - 6, 'rgba(255, 245, 220, 0.16)');
        box(ctx, ix + 4, iy + 2, w - 2, 4, doorCol, out, doorHi, doorLo);
      } else {
        box(ctx, ix + 2, iy + 2, w - 4, h - 4, doorCol, out, doorHi, doorLo);
        px(ctx, ix + ((w / 2) | 0), iy + h - 6, 2, 2, '#f5d264');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Pixel Speech / Thought Bubble Renderer
  // ---------------------------------------------------------------------------
  function drawBubble(ctx, x, y, emojiOrText, opts) {
    var o = opts || {};
    var theme = getTheme(o);
    var content = String(emojiOrText == null ? '' : emojiOrText);
    if (!content) return null;

    var fontSize = o.fontSize || (content.length <= 2 ? 10 : 8);
    var font = '600 ' + fontSize + 'px "Noto Sans Thai", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

    ctx.save();
    ctx.font = font;
    var tw = ctx.measureText(content).width;
    var padX = content.length <= 2 ? 4 : 5;
    var w = Math.max(16, Math.ceil(tw + padX * 2));
    var h = o.h || 15;

    // Anchor: centered horizontally on x, tail tip sits at y
    var tailH = 4;
    var bx = (x - w / 2) | 0;
    var by = (y - h - tailH) | 0;
    var out = o.borderColor || theme.outline;
    var bg = o.bg || theme.bubbleBg;
    var shade = o.shade || theme.bubbleShade;

    // Soft drop shadow
    ctx.fillStyle = 'rgba(10, 8, 22, 0.25)';
    ctx.fillRect(bx + 2, by + 2, w - 2, h);

    // Pixel-rounded rectangle outline (cut 1px corners)
    px(ctx, bx + 1, by, w - 2, 1, out);
    px(ctx, bx + 1, by + h - 1, w - 2, 1, out);
    px(ctx, bx, by + 1, 1, h - 2, out);
    px(ctx, bx + w - 1, by + 1, 1, h - 2, out);

    // Fill body
    px(ctx, bx + 1, by + 1, w - 2, h - 2, bg);
    // Subtle inner bottom shading
    px(ctx, bx + 1, by + h - 2, w - 2, 1, shade);

    var cx = (x | 0);
    if (o.style === 'thought') {
      // Thought bubble dots
      px(ctx, cx - 2, by + h, 3, 2, out);
      px(ctx, cx - 1, by + h, 1, 1, bg);
      px(ctx, cx - 1, by + h + 2, 2, 2, out);
    } else {
      // Sharp pixel pointer tail connected seamlessly to bottom
      px(ctx, cx - 2, by + h - 1, 5, 1, bg);
      px(ctx, cx - 2, by + h, 1, 1, out);
      px(ctx, cx - 1, by + h, 3, 1, bg);
      px(ctx, cx + 2, by + h, 1, 1, out);
      px(ctx, cx - 1, by + h + 1, 1, 1, out);
      px(ctx, cx, by + h + 1, 1, 1, bg);
      px(ctx, cx + 1, by + h + 1, 1, 1, out);
      px(ctx, cx, by + h + 2, 1, 1, out);
    }

    // Content text / emoji
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = o.textColor || theme.bubbleText;
    ctx.fillText(content, bx + w / 2, by + h / 2 + 0.5);
    ctx.restore();

    return { x: bx, y: by, w: w, h: h + tailH };
  }

  // ---------------------------------------------------------------------------
  // 6. Furniture Library (>= 30 Procedural Pixel-Art Types)
  // ---------------------------------------------------------------------------
  var FURNITURE_SIZES = {
    desk: { w: 32, h: 18 },
    pc: { w: 16, h: 16 },
    dual_monitor: { w: 28, h: 16 },
    chair: { w: 14, h: 14 },
    server_rack: { w: 18, h: 30 },
    whiteboard: { w: 36, h: 22 },
    plant: { w: 14, h: 20 },
    bookshelf: { w: 24, h: 28 },
    coffee_machine: { w: 22, h: 22 },
    water_cooler: { w: 14, h: 24 },
    sofa: { w: 36, h: 18 },
    card_table: { w: 26, h: 22 },
    treadmill: { w: 26, h: 16 },
    dumbbell: { w: 22, h: 14 },
    pingpong_table: { w: 36, h: 22 },
    mic_booth: { w: 24, h: 26 },
    easel: { w: 18, h: 26 },
    mixing_console: { w: 30, h: 18 },
    film_camera: { w: 16, h: 22 },
    rocket_antenna: { w: 20, h: 26 },
    clock: { w: 14, h: 14 },
    calendar_board: { w: 28, h: 20 },
    kanban_board: { w: 34, h: 22 },
    printer: { w: 20, h: 18 },
    vending_machine: { w: 20, h: 28 },
    rug: { w: 48, h: 32 },
    window_city: { w: 36, h: 18 },
    tree: { w: 24, h: 30 },
    bench: { w: 28, h: 14 },
    cabinet: { w: 16, h: 24 }
  };

  function drawMonitorScreen(ctx, sx, sy, sw, sh, on, glow, col, frame) {
    var out = '#151020';
    if (!on) {
      px(ctx, sx, sy, sw, sh, '#182030');
      px(ctx, sx + 1, sy + 1, 2, 1, '#2d3b54');
      return;
    }
    var sc = col || '#36e3c0';
    var darkSc = mixHex(sc, '#08131f', 0.72);
    px(ctx, sx, sy, sw, sh, darkSc);
    // Subtle screen scan / glow pulse
    var pulse = glow ? (0.55 + 0.45 * Math.sin((frame || 0) * 0.35)) : 0.4;
    if (glow) {
      ctx.fillStyle = rgbaFromHex(sc, (0.18 + 0.14 * pulse).toFixed(2));
      ctx.fillRect(sx - 2, sy - 2, sw + 4, sh + 4);
    }
    // Code/chart bars inside monitor
    var shift = (frame || 0) % 3;
    px(ctx, sx + 1, sy + 1, Math.max(2, sw - 4), 1, sc);
    if (sh >= 5) {
      px(ctx, sx + 1, sy + 3, Math.max(2, sw - 3 - shift), 1, mixHex(sc, '#ffffff', 0.45));
    }
    if (sh >= 7) {
      px(ctx, sx + 1, sy + 5, Math.max(2, ((sw * 0.6) | 0)), 1, '#f7d560');
      px(ctx, sx + sw - 3, sy + 5, 2, 1, '#ff7b9c');
    }
    // Corner specular pixel
    px(ctx, sx + sw - 2, sy + 1, 1, 1, '#ffffff');
    // Outer bezel crisp check
    void out;
  }

  var FURNITURE_DRAWERS = {
    desk: function (ctx, x, y, o, theme) {
      var w = (o.w || 32) | 0;
      var h = (o.h || 18) | 0;
      var out = theme.outline;
      var base = o.color || theme.desk[0];
      var dark = shadeHex(base, -26);
      var hi = shadeHex(base, 24);
      var deep = shadeHex(base, -44);

      dropShadow(ctx, x + 1, y + h - 2, w, 4, 0.32);
      // Tabletop
      var topH = Math.max(8, (h * 0.56) | 0);
      box(ctx, x, y, w, topH, base, out, hi, dark);
      // Wood grain lines on top
      px(ctx, x + 3, y + 3, w - 10, 1, shadeHex(base, -10));
      px(ctx, x + 7, y + 5, w - 12, 1, shadeHex(base, 10));

      // Front apron & drawers
      var frontY = y + topH - 1;
      var frontH = h - topH + 1;
      box(ctx, x + 1, frontY, w - 2, frontH, dark, out, null, deep);
      // Center leg cutout
      var cutW = Math.max(8, w - 18);
      var cutX = x + ((w - cutW) / 2) | 0;
      px(ctx, cutX, frontY + 2, cutW, frontH - 2, deep);
      // Right drawer pedestal with brass handles
      if (w >= 26) {
        var dx = x + w - 10;
        box(ctx, dx, frontY + 1, 8, frontH - 2, base, out, hi, dark);
        px(ctx, dx + 2, frontY + 3, 4, 1, '#f5d264');
        if (frontH >= 7) px(ctx, dx + 2, frontY + 6, 4, 1, '#f5d264');
      }
      // Left leg accent
      px(ctx, x + 2, frontY + 1, 2, frontH - 2, shadeHex(base, -14));
    },

    pc: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var on = o.screenOn !== false;
      var glow = o.glow !== undefined ? !!o.glow : on;
      var frame = o.frame || 0;
      var col = o.screenColor || theme.screenGlow;

      dropShadow(ctx, x + 1, y + 13, 14, 3, 0.28);
      // Monitor casing
      box(ctx, x + 1, y, 14, 10, '#363e52', out, '#586480', '#232836');
      drawMonitorScreen(ctx, x + 2, y + 1, 12, 8, on, glow, col, frame);
      // Power LED
      px(ctx, x + 12, y + 9, 1, 1, on ? '#4bf28a' : '#d94848');
      // Stand neck & base
      px(ctx, x + 6, y + 10, 4, 2, '#2a3040');
      box(ctx, x + 4, y + 11, 8, 2, '#485268', out, '#6a7691', null);
      // Keyboard & mouse in front
      box(ctx, x + 1, y + 13, 10, 3, '#c8d0dc', out, '#eef2f8', '#8d96a8');
      px(ctx, x + 2, y + 14, 2, 1, '#586278');
      px(ctx, x + 5, y + 14, 2, 1, '#586278');
      px(ctx, x + 8, y + 14, 2, 1, '#586278');
      // Mouse
      box(ctx, x + 12, y + 13, 3, 3, '#cfd6e2', out, '#ffffff', null);
    },

    dual_monitor: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var on = o.screenOn !== false;
      var glow = o.glow !== undefined ? !!o.glow : on;
      var frame = o.frame || 0;
      var col1 = o.screenColor || '#38e8c6';
      var col2 = o.screenColor2 || '#8c7aff';

      dropShadow(ctx, x + 1, y + 13, 26, 3, 0.30);
      // Left monitor
      box(ctx, x, y, 13, 10, '#363e52', out, '#5a6682', '#232836');
      drawMonitorScreen(ctx, x + 1, y + 1, 11, 8, on, glow, col1, frame);
      // Right monitor
      box(ctx, x + 14, y, 13, 10, '#363e52', out, '#5a6682', '#232836');
      drawMonitorScreen(ctx, x + 15, y + 1, 11, 8, on, glow, col2, frame + 2);
      // Dual arm stand
      px(ctx, x + 5, y + 10, 17, 2, '#282e3d');
      box(ctx, x + 10, y + 10, 7, 3, '#485268', out, '#6c7894', null);
      // Mechanical keyboard (RGB strip if glowing!)
      box(ctx, x + 6, y + 13, 13, 3, '#2d3345', out, on ? '#5de6d2' : '#4a5268', '#1d212e');
      px(ctx, x + 8, y + 14, 9, 1, '#aeb8cc');
      // Mouse pad & mouse
      px(ctx, x + 20, y + 13, 6, 3, '#1f2536');
      box(ctx, x + 22, y + 13, 3, 3, '#d7deea', out, '#ffffff', null);
    },

    chair: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var col = o.color || '#3e5378';
      var hi = shadeHex(col, 24);
      var lo = shadeHex(col, -24);
      var dir = o.dir || 'down';

      dropShadow(ctx, x + 2, y + 11, 10, 3, 0.30);
      // Caster wheel base
      px(ctx, x + 3, y + 12, 8, 1, '#262b38');
      px(ctx, x + 6, y + 10, 2, 3, '#4e586e');

      if (dir === 'up') {
        // Backrest facing viewer
        box(ctx, x + 2, y + 1, 10, 9, col, out, hi, lo);
        px(ctx, x + 4, y + 3, 6, 4, lo);
        px(ctx, x + 1, y + 6, 2, 4, '#2a3040');
        px(ctx, x + 11, y + 6, 2, 4, '#2a3040');
      } else {
        // Backrest behind seat
        box(ctx, x + 2, y, 10, 6, col, out, hi, lo);
        // Seat cushion
        box(ctx, x + 1, y + 5, 12, 6, shadeHex(col, 8), out, shadeHex(col, 28), lo);
        // Armrests
        px(ctx, x + 1, y + 4, 2, 5, '#2b3142');
        px(ctx, x + 11, y + 4, 2, 5, '#2b3142');
      }
    },

    server_rack: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var leds = o.leds != null ? o.leds : 6;
      var alert = !!o.alert;
      var frame = o.frame || 0;
      var blink = (frame >> 2) & 1;

      dropShadow(ctx, x + 1, y + 27, 16, 4, 0.38);
      // Tall dark metal chassis
      box(ctx, x, y, 18, 29, '#232938', out, '#454f68', '#151924');
      // Inner recessed rails
      px(ctx, x + 2, y + 2, 14, 24, '#131722');
      // Top alert / status bar
      var topLed = alert ? (blink ? '#ff3b5c' : '#ff9838') : '#38e89e';
      px(ctx, x + 3, y + 2, 12, 2, alert ? '#4a1220' : '#1b2838');
      px(ctx, x + 4, y + 2, alert ? 10 : 4, 1, topLed);
      if (alert && blink) {
        ctx.fillStyle = 'rgba(255, 59, 92, 0.25)';
        ctx.fillRect(x - 2, y - 1, 22, 6);
      }

      // 6 horizontal blade units
      for (var i = 0; i < 6; i++) {
        var by = y + 5 + i * 3.5 | 0;
        px(ctx, x + 3, by, 12, 3, '#2d3548');
        px(ctx, x + 3, by, 12, 1, '#3d4760');
        // Ventilation slots
        px(ctx, x + 4, by + 1, 5, 1, '#151a26');
        // Status LEDs
        if (i < leds) {
          var ledCol = alert && i === 0
            ? (blink ? '#ff3b5c' : '#ffb84d')
            : (((frame + i) % 5 === 0) ? '#44d7ff' : '#3ee68a');
          px(ctx, x + 11, by + 1, 1, 1, ledCol);
          px(ctx, x + 13, by + 1, 1, 1, ((frame + i * 2) % 3 === 0) ? '#f7d358' : '#2a8058');
        }
      }
      // Feet
      px(ctx, x + 2, y + 29, 3, 1, out);
      px(ctx, x + 13, y + 29, 3, 1, out);
    },

    whiteboard: function (ctx, x, y, o, theme) {
      var w = (o.w || 36) | 0;
      var h = (o.h || 22) | 0;
      var out = theme.outline;
      var variant = o.variant || 'chart';

      // Wall shadow
      ctx.fillStyle = 'rgba(10, 8, 22, 0.28)';
      ctx.fillRect(x + 1, y + 2, w, h);

      // Aluminum frame + crisp white surface
      box(ctx, x, y, w, h, '#eef3f9', out, '#ffffff', '#cfd9e6');
      px(ctx, x + 1, y + 1, w - 2, 1, '#9aa8bd');
      px(ctx, x + 1, y + h - 2, w - 2, 1, '#8492a8');

      if (variant === 'checklist') {
        // Green checkmarks + text bars
        for (var r = 0; r < 4; r++) {
          var ry = y + 4 + r * 4;
          px(ctx, x + 4, ry, 2, 2, r < 3 ? '#38b874' : '#d9667a');
          px(ctx, x + 8, ry + 1, w - 14 - (r % 2) * 4, 1, '#4b5a73');
        }
      } else {
        // Mini bar/line chart (like reference image!)
        px(ctx, x + 4, y + 4, 1, h - 9, '#7a879c');
        px(ctx, x + 4, y + h - 6, w - 9, 1, '#7a879c');
        // Rising red/coral graph line
        px(ctx, x + 6, y + h - 8, 3, 1, '#e04f6b');
        px(ctx, x + 9, y + h - 10, 3, 2, '#e04f6b');
        px(ctx, x + 12, y + h - 12, 3, 2, '#e04f6b');
        px(ctx, x + 15, y + h - 11, 3, 1, '#e04f6b');
        px(ctx, x + 18, y + h - 15, 4, 2, '#e04f6b');
        // Accent sticky bars on right
        px(ctx, x + w - 11, y + 4, 6, 3, '#5798e6');
        px(ctx, x + w - 11, y + 8, 5, 3, '#f2c14e');
        px(ctx, x + w - 11, y + 12, 6, 3, '#4ec788');
      }
      // Marker tray at bottom
      px(ctx, x + 5, y + h - 1, 14, 2, '#5a6578');
      px(ctx, x + 7, y + h - 1, 3, 1, '#e6485b');
      px(ctx, x + 11, y + h - 1, 3, 1, '#3b82f6');
      px(ctx, x + 15, y + h - 1, 2, 1, '#222222');
    },

    plant: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var potCol = o.potColor || '#b8623d';
      dropShadow(ctx, x + 2, y + 17, 10, 3, 0.30);

      // Terracotta pot
      box(ctx, x + 3, y + 12, 8, 7, potCol, out, shadeHex(potCol, 28), shadeHex(potCol, -28));
      box(ctx, x + 2, y + 11, 10, 3, shadeHex(potCol, 14), out, shadeHex(potCol, 34), shadeHex(potCol, -18));
      // Soil
      px(ctx, x + 4, y + 12, 6, 1, '#3d281b');

      // Lush 3-tone leafy bush (outlined silhouette)
      px(ctx, x + 2, y + 3, 10, 8, out);
      px(ctx, x + 1, y + 5, 12, 5, out);
      px(ctx, x + 4, y + 1, 6, 10, out);

      // Base dark green foliage
      px(ctx, x + 3, y + 4, 8, 7, '#276b3d');
      px(ctx, x + 2, y + 6, 10, 4, '#276b3d');
      // Mid vibrant green clusters
      px(ctx, x + 5, y + 2, 4, 5, '#3ca355');
      px(ctx, x + 2, y + 5, 4, 3, '#3ca355');
      px(ctx, x + 8, y + 5, 4, 3, '#3ca355');
      px(ctx, x + 5, y + 7, 4, 3, '#3ca355');
      // Bright leaf highlights
      px(ctx, x + 5, y + 2, 2, 2, '#6fd472');
      px(ctx, x + 3, y + 5, 2, 1, '#6fd472');
      px(ctx, x + 9, y + 6, 2, 1, '#6fd472');
    },

    bookshelf: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var wood = o.color || '#7c4f2d';
      var hi = shadeHex(wood, 22);
      var lo = shadeHex(wood, -28);

      dropShadow(ctx, x + 1, y + 25, 22, 4, 0.34);
      // Outer wooden frame
      box(ctx, x, y, 24, 27, wood, out, hi, lo);
      // 3 shelf recesses
      var bookPalette = ['#d94e64', '#3b82d6', '#e6b83e', '#43a871', '#8b5cd6', '#e07a3c', '#45b5c4'];
      for (var s = 0; s < 3; s++) {
        var sy = y + 3 + s * 8;
        px(ctx, x + 2, sy, 20, 6, '#2b1b12');
        // Books packed across shelf
        var bx = x + 3;
        var idx = s * 5;
        while (bx < x + 20) {
          var bw = (idx % 3 === 0) ? 3 : 2;
          var bh = 4 + (idx % 2);
          var bc = bookPalette[idx % bookPalette.length];
          if (bx + bw <= x + 21) {
            px(ctx, bx, sy + (6 - bh), bw, bh, bc);
            px(ctx, bx, sy + (6 - bh), bw, 1, shadeHex(bc, 30));
          }
          bx += bw + (idx % 4 === 3 ? 2 : 0);
          idx++;
        }
        // Shelf plank below books
        px(ctx, x + 2, sy + 6, 20, 2, hi);
        px(ctx, x + 2, sy + 7, 20, 1, lo);
      }
    },

    coffee_machine: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var frame = o.frame || 0;
      dropShadow(ctx, x + 1, y + 19, 20, 4, 0.30);

      // Cafe wooden counter base
      box(ctx, x, y + 10, 22, 11, '#7d5434', out, '#a6744c', '#54351e');
      px(ctx, x + 1, y + 11, 20, 2, '#d9cfc1'); // marble countertop
      // Espresso machine unit
      box(ctx, x + 2, y + 1, 12, 11, '#4c566b', out, '#8894ad', '#2d3444');
      px(ctx, x + 4, y + 5, 8, 5, '#1d222e'); // brew bay
      // Group head & drip
      px(ctx, x + 6, y + 5, 4, 2, '#8b96ad');
      // Coffee mug brewing
      box(ctx, x + 6, y + 7, 4, 3, '#fff9ee', out, null, '#cfc6b8');
      px(ctx, x + 7, y + 6, 1, 1, '#5c341d');
      // Status LEDs
      px(ctx, x + 4, y + 3, 1, 1, '#44eb8a');
      px(ctx, x + 6, y + 3, 1, 1, '#ff5964');
      // Stacked spare cups on right
      box(ctx, x + 15, y + 7, 5, 4, '#f5efe6', out, '#ffffff', '#cfc6b8');
      box(ctx, x + 16, y + 4, 4, 3, '#f5efe6', out, '#ffffff', '#cfc6b8');
      // Animated warm steam wisps
      var st = (frame >> 2) % 3;
      px(ctx, x + 7 + (st & 1), y - 1 - st, 1, 2, 'rgba(255,255,255,0.65)');
      px(ctx, x + 10 - (st & 1), y - st, 1, 1, 'rgba(255,255,255,0.45)');
    },

    water_cooler: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      dropShadow(ctx, x + 2, y + 21, 10, 3, 0.28);
      // Translucent blue water jug on top
      box(ctx, x + 3, y, 8, 10, '#5ec2f7', out, '#b0e6ff', '#2e8bc7');
      px(ctx, x + 4, y + 2, 2, 5, '#b8ebff'); // glossy reflection
      px(ctx, x + 5, y + 1, 4, 1, '#ffffff');
      // Dispenser body
      box(ctx, x + 2, y + 9, 10, 14, '#e6ebf2', out, '#ffffff', '#aeb8c7');
      // Recessed tap niche
      px(ctx, x + 4, y + 12, 6, 5, '#3b4559');
      // Red hot & blue cold spigots
      px(ctx, x + 5, y + 13, 1, 2, '#eb4d5c');
      px(ctx, x + 8, y + 13, 1, 2, '#3b9eff');
      // Drip tray
      px(ctx, x + 4, y + 16, 6, 1, '#8c99ad');
      // Lower cabinet seam
      px(ctx, x + 3, y + 19, 8, 1, '#b8c2d1');
    },

    sofa: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var col = o.color || '#c45b68';
      var hi = shadeHex(col, 24);
      var lo = shadeHex(col, -26);
      var w = (o.w || 36) | 0;
      var h = (o.h || 18) | 0;

      dropShadow(ctx, x + 1, y + h - 2, w, 4, 0.32);
      // Wooden legs
      px(ctx, x + 2, y + h - 1, 3, 2, '#4a2e1a');
      px(ctx, x + w - 5, y + h - 1, 3, 2, '#4a2e1a');
      // Backrest
      box(ctx, x + 2, y, w - 4, 8, col, out, hi, lo);
      // 3 Seat cushions
      var cw = ((w - 8) / 3) | 0;
      for (var i = 0; i < 3; i++) {
        box(ctx, x + 4 + i * cw, y + 6, cw + 1, h - 8, shadeHex(col, 10), out, shadeHex(col, 30), lo);
      }
      // Armrests
      box(ctx, x, y + 3, 5, h - 4, shadeHex(col, -8), out, hi, lo);
      box(ctx, x + w - 5, y + 3, 5, h - 4, shadeHex(col, -8), out, hi, lo);
      // Cozy accent throw pillow
      box(ctx, x + 6, y + 4, 6, 5, '#f2cc59', out, '#ffea94', '#c29827');
    },

    card_table: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      dropShadow(ctx, x + 1, y + 19, 24, 4, 0.30);
      // Wood frame + green felt playing surface
      box(ctx, x, y, 26, 20, '#784a28', out, '#a36b40', '#4f2e17');
      box(ctx, x + 2, y + 2, 22, 14, '#2d8252', out, '#40a66b', '#1f5e3b');
      // Scattered playing cards on felt
      px(ctx, x + 6, y + 5, 3, 4, '#ffffff');
      px(ctx, x + 7, y + 6, 1, 1, '#e63946');
      px(ctx, x + 11, y + 7, 3, 4, '#ffffff');
      px(ctx, x + 12, y + 8, 1, 1, '#1d1e2c');
      px(ctx, x + 16, y + 5, 3, 4, '#ffffff');
      px(ctx, x + 17, y + 6, 1, 1, '#e63946');
      // Poker chips stack
      px(ctx, x + 10, y + 12, 2, 2, '#f2c94c');
      px(ctx, x + 13, y + 12, 2, 2, '#eb5757');
      px(ctx, x + 16, y + 12, 2, 2, '#4ea8de');
      // Table legs
      px(ctx, x + 2, y + 19, 3, 3, '#4f2e17');
      px(ctx, x + 21, y + 19, 3, 3, '#4f2e17');
    },

    treadmill: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var frame = o.frame || 0;
      var active = o.active !== false;
      dropShadow(ctx, x + 1, y + 13, 24, 3, 0.30);

      // Running deck
      box(ctx, x, y + 6, 20, 9, '#394154', out, '#5b6680', '#232836');
      px(ctx, x + 2, y + 8, 16, 5, '#1d212e');
      // Moving belt stripes
      var offset = active ? (frame % 4) : 0;
      for (var bx = x + 3 + offset; bx < x + 17; bx += 4) {
        px(ctx, bx, y + 8, 1, 5, '#343c52');
      }
      // Upright console & handrails on right
      box(ctx, x + 17, y, 8, 14, '#4b556b', out, '#74829e', '#2a3040');
      // Glowing digital display
      px(ctx, x + 19, y + 2, 4, 4, '#132030');
      px(ctx, x + 20, y + 3, 2, 1, active ? '#44eb8a' : '#e65563');
      px(ctx, x + 20, y + 4, 2, 1, '#f7cf54');
      // Side handrail bar
      px(ctx, x + 12, y + 4, 6, 2, out);
      px(ctx, x + 13, y + 4, 5, 1, '#98a6bf');
    },

    dumbbell: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      dropShadow(ctx, x + 1, y + 11, 20, 3, 0.28);
      // Steel rack frame
      box(ctx, x, y + 2, 22, 10, '#3a4254', out, '#606d87', '#232836');
      px(ctx, x + 2, y + 4, 18, 6, '#1c202b');
      // 3 pairs of dumbbells on top/bottom shelves
      for (var i = 0; i < 3; i++) {
        var dx = x + 3 + i * 6;
        // Top row
        px(ctx, dx, y + 3, 1, 3, '#11131a');
        px(ctx, dx + 1, y + 4, 2, 1, '#c8d2e3');
        px(ctx, dx + 3, y + 3, 1, 3, '#11131a');
        // Bottom row (heavier)
        px(ctx, dx, y + 7, 1, 3, '#191d28');
        px(ctx, dx + 1, y + 8, 2, 1, '#e0e7f2');
        px(ctx, dx + 3, y + 7, 1, 3, '#191d28');
      }
    },

    pingpong_table: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var frame = o.frame || 0;
      dropShadow(ctx, x + 1, y + 19, 34, 4, 0.30);

      // Legs
      px(ctx, x + 3, y + 17, 3, 5, '#2b3142');
      px(ctx, x + 30, y + 17, 3, 5, '#2b3142');
      // Classic teal-blue table surface
      box(ctx, x, y, 36, 18, '#286da8', out, '#4a93d1', '#1a4973');
      // Crisp white court border & center line
      px(ctx, x + 2, y + 2, 32, 1, '#eef5ff');
      px(ctx, x + 2, y + 15, 32, 1, '#eef5ff');
      px(ctx, x + 2, y + 2, 1, 14, '#eef5ff');
      px(ctx, x + 33, y + 2, 1, 14, '#eef5ff');
      px(ctx, x + 2, y + 8, 32, 1, '#cce2fa');

      // Net across middle
      px(ctx, x + 17, y - 1, 2, 20, out);
      for (var ny = y; ny < y + 18; ny += 2) {
        px(ctx, x + 17, ny, 2, 1, '#e8eef5');
      }
      // Red & black paddles
      px(ctx, x + 5, y + 5, 3, 3, '#e04858');
      px(ctx, x + 4, y + 7, 2, 2, '#9e6b3f');
      px(ctx, x + 28, y + 10, 3, 3, '#252a38');
      px(ctx, x + 30, y + 12, 2, 2, '#9e6b3f');

      // White ball (bounces across net when active)
      var bx = o.active ? (x + 8 + ((Math.sin(frame * 0.45) * 0.5 + 0.5) * 18 | 0)) : (x + 13);
      var by = o.active ? (y + 6 + ((Math.cos(frame * 0.9) * 2) | 0)) : (y + 7);
      px(ctx, bx, by, 2, 2, '#ffffff');
    },

    mic_booth: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var active = o.active !== false;
      var frame = o.frame || 0;
      dropShadow(ctx, x + 1, y + 23, 22, 4, 0.32);

      // Acoustic foam booth backdrop
      box(ctx, x, y, 24, 24, '#32364a', out, '#4f5573', '#1e202e');
      // Charcoal acoustic pyramid grid
      for (var ay = y + 3; ay < y + 15; ay += 3) {
        for (var ax = x + 3; ax < x + 21; ax += 3) {
          px(ctx, ax, ay, 2, 2, '#222536');
          px(ctx, ax, ay, 1, 1, '#444a66');
        }
      }
      // ON AIR sign at top
      var blink = ((frame >> 3) & 1) === 0;
      box(ctx, x + 5, y + 1, 14, 5, active ? (blink ? '#e63946' : '#a82330') : '#3b242a', out, null, null);
      px(ctx, x + 7, y + 3, 10, 1, active ? '#ffecee' : '#73585e');
      if (active && blink) {
        ctx.fillStyle = 'rgba(230, 57, 70, 0.22)';
        ctx.fillRect(x + 3, y - 1, 18, 9);
      }
      // Small vocal desk + boom condenser mic
      box(ctx, x + 2, y + 16, 20, 8, '#754b2c', out, '#9e6b43', '#4d2e18');
      // Boom arm & condenser mic
      px(ctx, x + 5, y + 16, 2, 4, '#1b1f2b');
      px(ctx, x + 6, y + 11, 2, 6, '#626d85');
      px(ctx, x + 8, y + 10, 5, 2, '#8b97b0');
      box(ctx, x + 12, y + 8, 4, 5, '#d4dce8', out, '#ffffff', '#7e8a9e');
      // Pop filter circle
      px(ctx, x + 10, y + 10, 2, 3, '#191d28');
    },

    easel: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      dropShadow(ctx, x + 2, y + 23, 14, 3, 0.28);
      // Wooden A-frame tripod legs
      px(ctx, x + 8, y, 2, 24, '#7d4f2a');
      px(ctx, x + 4, y + 16, 2, 9, '#6e4322');
      px(ctx, x + 12, y + 16, 2, 9, '#6e4322');
      // Canvas frame
      box(ctx, x + 2, y + 3, 14, 14, '#f8f5ee', out, '#ffffff', '#d8d0c1');
      // Colorful miniature pixel painting inside canvas!
      px(ctx, x + 4, y + 5, 10, 5, '#6ec5f7'); // sky
      px(ctx, x + 11, y + 6, 2, 2, '#ffd95e'); // sun
      px(ctx, x + 4, y + 9, 5, 3, '#6b53b5');  // mountain
      px(ctx, x + 8, y + 8, 6, 4, '#d9667a');  // peak
      px(ctx, x + 4, y + 12, 10, 3, '#47a866'); // meadow
      // Wooden ledge with paint dots
      box(ctx, x + 1, y + 16, 16, 3, '#9a653c', out, '#bd8355', '#6b4122');
      px(ctx, x + 3, y + 16, 2, 1, '#e6485b');
      px(ctx, x + 6, y + 16, 2, 1, '#f5c542');
      px(ctx, x + 9, y + 16, 2, 1, '#3b82f6');
    },

    mixing_console: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var frame = o.frame || 0;
      var active = o.active !== false;
      dropShadow(ctx, x + 1, y + 15, 28, 4, 0.32);

      // Console angled chassis
      box(ctx, x, y, 30, 16, '#2b3142', out, '#4f5975', '#181c26');
      // Top VU meter strip
      px(ctx, x + 2, y + 2, 26, 4, '#121621');
      for (var ch = 0; ch < 6; ch++) {
        var level = active ? (1 + ((frame + ch * 3) % 4)) : 1;
        var mx = x + 3 + ch * 4;
        px(ctx, mx, y + 4, 3, 1, '#3ee68a');
        if (level >= 2) px(ctx, mx, y + 3, 3, 1, '#f2d04e');
        if (level >= 4) px(ctx, mx, y + 2, 3, 1, '#ff5468');
      }
      // Motorized fader channels
      for (var f = 0; f < 6; f++) {
        var fx = x + 3 + f * 4;
        px(ctx, fx + 1, y + 7, 1, 7, '#141824');
        var knobY = y + 8 + ((f * 2 + (active ? (frame >> 2) : 0)) % 4);
        px(ctx, fx, knobY, 3, 2, f === 5 ? '#e65563' : '#dce4f2');
      }
      // Right transport buttons / jog wheel
      px(ctx, x + 26, y + 8, 2, 2, '#3ee68a');
      px(ctx, x + 26, y + 11, 2, 2, '#e65563');
    },

    film_camera: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var active = o.active !== false;
      var frame = o.frame || 0;
      dropShadow(ctx, x + 2, y + 19, 12, 3, 0.28);

      // Tripod legs
      px(ctx, x + 7, y + 12, 2, 9, '#232836');
      px(ctx, x + 4, y + 14, 2, 7, '#353d52');
      px(ctx, x + 10, y + 14, 2, 7, '#353d52');
      // Twin film reels on top
      box(ctx, x + 2, y + 1, 5, 5, '#3b4359', out, '#687594', '#222736');
      box(ctx, x + 7, y + 1, 5, 5, '#3b4359', out, '#687594', '#222736');
      px(ctx, x + 4, y + 3, 1, 1, '#dce4f2');
      px(ctx, x + 9, y + 3, 1, 1, '#dce4f2');
      // Camera body
      box(ctx, x + 2, y + 5, 10, 7, '#2a3040', out, '#4f5a75', '#171a24');
      // Matte box lens pointing right
      box(ctx, x + 11, y + 6, 5, 5, '#1d222e', out, '#58a6ff', null);
      px(ctx, x + 14, y + 7, 1, 3, '#7cc6ff');
      // REC tally light
      var recOn = active && (((frame >> 2) & 1) === 0);
      px(ctx, x + 4, y + 7, 2, 2, recOn ? '#ff3b5c' : '#612530');
      if (recOn) {
        ctx.fillStyle = 'rgba(255, 59, 92, 0.26)';
        ctx.fillRect(x + 2, y + 5, 6, 6);
      }
    },

    rocket_antenna: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var frame = o.frame || 0;
      var active = o.active !== false;
      dropShadow(ctx, x + 2, y + 23, 16, 3, 0.30);

      // Base telemetry console
      box(ctx, x + 3, y + 16, 14, 9, '#394359', out, '#647394', '#222838');
      px(ctx, x + 5, y + 18, 6, 4, '#112233');
      px(ctx, x + 6, y + 19, 4, 1, '#44e5c2');
      px(ctx, x + 13, y + 18, 2, 2, '#f5c542');
      // Mast & parabolic dish
      px(ctx, x + 9, y + 6, 2, 11, '#7a87a3');
      box(ctx, x + 4, y + 4, 12, 7, '#dce5f2', out, '#ffffff', '#94a2ba');
      px(ctx, x + 6, y + 6, 8, 3, '#b5c2d9');
      // Beacon spire & animated signal waves
      px(ctx, x + 9, y + 1, 2, 5, '#e65563');
      var pulse = (frame >> 2) % 3;
      if (active) {
        px(ctx, x + 9, y, 2, 2, pulse === 0 ? '#ff6b7a' : '#ffd166');
        if (pulse >= 1) {
          px(ctx, x + 6, y + 1, 1, 2, '#4ee6ff');
          px(ctx, x + 13, y + 1, 1, 2, '#4ee6ff');
        }
        if (pulse === 2) {
          px(ctx, x + 4, y, 1, 3, 'rgba(78, 230, 255, 0.65)');
          px(ctx, x + 15, y, 1, 3, 'rgba(78, 230, 255, 0.65)');
        }
      }
    },

    clock: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var frame = o.frame || 0;
      // Round-ish pixel wall clock
      px(ctx, x + 2, y, 10, 14, out);
      px(ctx, x, y + 2, 14, 10, out);
      px(ctx, x + 1, y + 1, 12, 12, out);
      // Rim & white dial
      px(ctx, x + 2, y + 1, 10, 12, '#c9a23a');
      px(ctx, x + 1, y + 2, 12, 10, '#c9a23a');
      px(ctx, x + 3, y + 2, 8, 10, '#fffdf7');
      px(ctx, x + 2, y + 3, 10, 8, '#fffdf7');
      // 12/3/6/9 ticks
      px(ctx, x + 6, y + 3, 2, 1, '#4b556b');
      px(ctx, x + 6, y + 10, 2, 1, '#4b556b');
      px(ctx, x + 3, y + 6, 1, 2, '#4b556b');
      px(ctx, x + 10, y + 6, 1, 2, '#4b556b');
      // Hour & minute hands
      px(ctx, x + 6, y + 4, 1, 3, '#1e2230');
      var mdir = (frame >> 4) % 4;
      if (mdir === 0) px(ctx, x + 7, y + 6, 3, 1, '#d9485b');
      else if (mdir === 1) px(ctx, x + 6, y + 7, 1, 3, '#d9485b');
      else if (mdir === 2) px(ctx, x + 4, y + 6, 3, 1, '#d9485b');
      else px(ctx, x + 7, y + 4, 2, 2, '#d9485b');
      px(ctx, x + 6, y + 6, 2, 2, '#1e2230');
    },

    calendar_board: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      ctx.fillStyle = 'rgba(10, 8, 22, 0.28)';
      ctx.fillRect(x + 1, y + 2, 28, 20);

      box(ctx, x, y, 28, 20, '#f5f2e9', out, '#ffffff', '#d6cfc0');
      // Top mustard/coral calendar header bar
      px(ctx, x + 1, y + 1, 26, 4, '#c94c5b');
      px(ctx, x + 4, y + 2, 2, 2, '#ffffff');
      px(ctx, x + 22, y + 2, 2, 2, '#ffffff');
      px(ctx, x + 9, y + 2, 10, 1, '#ffdfe3');
      // 4x3 grid of scheduled cron tiles
      var colors = ['#d9dfe8', '#4ec788', '#d9dfe8', '#f2c14e', '#6d4bc4', '#d9dfe8', '#4ec788', '#e66378', '#d9dfe8', '#4a90e2', '#f2c14e', '#4ec788'];
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 4; c++) {
          var gx = x + 3 + c * 6;
          var gy = y + 7 + r * 4;
          px(ctx, gx, gy, 4, 3, colors[r * 4 + c]);
        }
      }
    },

    kanban_board: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      ctx.fillStyle = 'rgba(10, 8, 22, 0.28)';
      ctx.fillRect(x + 1, y + 2, 34, 22);

      box(ctx, x, y, 34, 22, '#e8eef5', out, '#ffffff', '#c5d0de');
      // 3 columns: TODO / DOING / DONE
      var colHeads = ['#d9667a', '#e6b83e', '#3f9e6f'];
      var cardCols = [
        ['#ffb3c1', '#ffd6a5', '#caffbf'],
        ['#a0c4ff', '#bdb2ff'],
        ['#9bf6ff', '#caffbf', '#fdffb6']
      ];
      for (var col = 0; col < 3; col++) {
        var cx = x + 2 + col * 10;
        px(ctx, cx, y + 2, 9, 3, colHeads[col]);
        px(ctx, cx, y + 5, 9, 15, '#d7e0eb');
        var cards = cardCols[col];
        for (var k = 0; k < cards.length; k++) {
          var cy = y + 6 + k * 4;
          px(ctx, cx + 1, cy, 7, 3, cards[k]);
          px(ctx, cx + 2, cy + 1, 4, 1, 'rgba(30, 34, 50, 0.45)');
        }
      }
    },

    printer: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      dropShadow(ctx, x + 1, y + 15, 18, 3, 0.28);
      // Top paper input tray
      box(ctx, x + 4, y, 12, 5, '#ffffff', out, null, '#cfd6e2');
      // Main printer housing
      box(ctx, x, y + 4, 20, 12, '#cfd6e2', out, '#eef2f8', '#98a3b8');
      // Dark slot + keypad
      px(ctx, x + 2, y + 6, 11, 2, '#2d3446');
      px(ctx, x + 15, y + 6, 2, 1, '#3ee68a');
      px(ctx, x + 15, y + 8, 3, 2, '#5a657d');
      // Printed document sticking out bottom
      box(ctx, x + 4, y + 12, 11, 6, '#ffffff', out, null, '#d8dfe8');
      px(ctx, x + 6, y + 14, 7, 1, '#7a879e');
      px(ctx, x + 6, y + 16, 5, 1, '#7a879e');
    },

    vending_machine: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var body = o.color || '#c94356';
      dropShadow(ctx, x + 1, y + 25, 18, 4, 0.34);

      // Machine shell
      box(ctx, x, y, 20, 27, body, out, shadeHex(body, 28), shadeHex(body, -30));
      // Illuminated glass display window
      box(ctx, x + 2, y + 2, 11, 16, '#1f2b3d', out, '#4a6485', null);
      // Colorful snack & drink rows
      var items = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#f08a5d', '#b83b5e'];
      for (var r = 0; r < 4; r++) {
        var ry = y + 4 + r * 3.5 | 0;
        px(ctx, x + 3, ry + 2, 9, 1, '#586a85');
        for (var c = 0; c < 3; c++) {
          px(ctx, x + 3 + c * 3, ry, 2, 2, items[(r * 3 + c) % items.length]);
        }
      }
      // Keypad & coin slot on right panel
      px(ctx, x + 14, y + 4, 4, 6, '#232938');
      px(ctx, x + 15, y + 5, 2, 1, '#44eb8a');
      px(ctx, x + 15, y + 7, 2, 2, '#cfd6e2');
      px(ctx, x + 15, y + 11, 2, 2, '#ffd166');
      // Pickup flap at bottom
      box(ctx, x + 2, y + 20, 14, 5, '#252a38', out, '#3f475e', null);
    },

    rug: function (ctx, x, y, o, theme) {
      var w = (o.w || 48) | 0;
      var h = (o.h || 32) | 0;
      var base = o.color || '#3d5894';
      var border = shadeHex(base, -26);
      var accent = o.accent || '#e6c15a';
      var inner = shadeHex(base, 14);

      // Fringes on left and right edges
      for (var fy = y + 1; fy < y + h - 1; fy += 2) {
        px(ctx, x - 2, fy, 2, 1, '#e6dcc8');
        px(ctx, x + w, fy, 2, 1, '#e6dcc8');
      }
      // Rug body
      box(ctx, x, y, w, h, base, border, inner, border);
      // Ornamental inner gold border
      if (w > 12 && h > 10) {
        px(ctx, x + 3, y + 3, w - 6, 1, accent);
        px(ctx, x + 3, y + h - 4, w - 6, 1, accent);
        px(ctx, x + 3, y + 3, 1, h - 6, accent);
        px(ctx, x + w - 4, y + 3, 1, h - 6, accent);
        // Center diamond medallion
        var cx = (x + w / 2) | 0;
        var cy = (y + h / 2) | 0;
        px(ctx, cx - 5, cy - 1, 10, 3, inner);
        px(ctx, cx - 3, cy - 3, 6, 7, inner);
        px(ctx, cx - 2, cy - 1, 4, 3, accent);
      }
    },

    window_city: function (ctx, x, y, o, theme) {
      var w = (o.w || 36) | 0;
      var h = (o.h || 18) | 0;
      var out = theme.outline;
      var isLight = theme.name === 'light';

      // Window frame
      box(ctx, x, y, w, h, isLight ? '#7ec4fa' : '#111d38', out, '#b5c2d4', '#4d586e');
      // Sky gradient bands
      var iw = w - 2;
      var ih = h - 2;
      px(ctx, x + 1, y + 1, iw, (ih / 2) | 0, isLight ? '#5ca9ed' : '#0b142b');
      px(ctx, x + 1, y + 1 + ((ih / 2) | 0), iw, ih - ((ih / 2) | 0), isLight ? '#a6dcff' : '#1b2b52');

      if (isLight) {
        // Fluffy daytime pixel clouds
        px(ctx, x + 4, y + 3, 7, 2, '#ffffff');
        px(ctx, x + 5, y + 2, 4, 1, '#ffffff');
        px(ctx, x + w - 13, y + 4, 8, 2, '#ffffff');
        px(ctx, x + w - 11, y + 3, 4, 1, '#ffffff');
      } else {
        // Night stars & tiny moon
        px(ctx, x + 5, y + 3, 1, 1, '#fff5b8');
        px(ctx, x + 14, y + 2, 1, 1, '#d8e8ff');
        px(ctx, x + w - 8, y + 3, 2, 2, '#ffe89e');
      }

      // City skyline silhouettes
      var bldCol = isLight ? '#6f85a6' : '#10182b';
      var bldHi = isLight ? '#8ea6c7' : '#1b2640';
      var litWin = isLight ? '#dcefff' : '#ffd966';
      var litAlt = isLight ? '#ffffff' : '#52e3ff';
      var bx = x + 2;
      var idx = 0;
      while (bx < x + w - 3) {
        var bw = 5 + (idx % 3);
        var bh = 5 + ((idx * 3) % Math.max(4, ih - 5));
        if (bx + bw > x + w - 1) bw = (x + w - 1) - bx;
        var by = y + h - 1 - bh;
        px(ctx, bx, by, bw, bh, idx % 2 === 0 ? bldCol : bldHi);
        // Tiny lit office windows
        for (var wy = by + 1; wy < y + h - 2; wy += 2) {
          for (var wx = bx + 1; wx < bx + bw - 1; wx += 2) {
            if (((wx + wy + idx) & 1) === 0) {
              px(ctx, wx, wy, 1, 1, ((wx + idx) % 3 === 0) ? litAlt : litWin);
            }
          }
        }
        bx += bw + 1;
        idx++;
      }

      // Window mullion divider & sill
      px(ctx, x + ((w / 2) | 0), y + 1, 1, h - 2, '#4a556b');
      px(ctx, x, y + h - 1, w, 2, '#9ba8bd');
      px(ctx, x, y + h, w, 1, out);
    },

    tree: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      dropShadow(ctx, x + 3, y + 25, 18, 5, 0.32);

      // Textured bark trunk
      box(ctx, x + 9, y + 16, 6, 12, '#6e4526', out, '#8f5d38', '#472a15');
      px(ctx, x + 11, y + 18, 1, 7, '#4f2f18');
      // Rounded multi-layered pixel canopy
      px(ctx, x + 4, y + 2, 16, 16, out);
      px(ctx, x + 2, y + 5, 20, 11, out);
      px(ctx, x + 6, y, 12, 18, out);

      // Deep shadow canopy base
      px(ctx, x + 3, y + 6, 18, 10, '#1f5c34');
      px(ctx, x + 5, y + 3, 14, 14, '#1f5c34');
      // Mid lush foliage
      px(ctx, x + 4, y + 5, 16, 9, '#328748');
      px(ctx, x + 6, y + 2, 12, 12, '#328748');
      // Bright sun-kissed leaf puffs
      px(ctx, x + 7, y + 2, 8, 4, '#54b85e');
      px(ctx, x + 4, y + 6, 6, 4, '#54b85e');
      px(ctx, x + 13, y + 5, 6, 4, '#54b85e');
      // Top specular pixels
      px(ctx, x + 8, y + 2, 3, 2, '#86e07e');
      px(ctx, x + 5, y + 6, 2, 1, '#86e07e');
    },

    bench: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var w = (o.w || 28) | 0;
      dropShadow(ctx, x + 1, y + 11, w - 2, 3, 0.30);

      // Cast-iron legs & armrests
      px(ctx, x + 1, y + 2, 2, 11, '#262b38');
      px(ctx, x + w - 3, y + 2, 2, 11, '#262b38');
      // Warm wooden backrest slats
      box(ctx, x + 2, y, w - 4, 5, '#9e673d', out, '#c48858', '#6e4323');
      px(ctx, x + 3, y + 2, w - 6, 1, '#6e4323');
      // Wooden seat slats
      box(ctx, x + 1, y + 5, w - 2, 5, '#b07648', out, '#d19766', '#784a27');
      px(ctx, x + 2, y + 7, w - 4, 1, '#784a27');
      // Armrest tops
      px(ctx, x, y + 4, 3, 2, '#454e63');
      px(ctx, x + w - 3, y + 4, 3, 2, '#454e63');
    },

    cabinet: function (ctx, x, y, o, theme) {
      var out = theme.outline;
      var col = o.color || '#647087';
      var hi = shadeHex(col, 24);
      var lo = shadeHex(col, -24);

      dropShadow(ctx, x + 1, y + 21, 14, 3, 0.30);
      // Metal cabinet shell
      box(ctx, x, y, 16, 23, col, out, hi, lo);
      // 3 filing drawers with label slots & chrome handles
      for (var d = 0; d < 3; d++) {
        var dy = y + 2 + d * 7;
        box(ctx, x + 2, dy, 12, 6, shadeHex(col, 6), out, hi, lo);
        px(ctx, x + 5, dy + 1, 6, 2, '#eef2f8'); // label card
        px(ctx, x + 6, dy + 4, 4, 1, '#2a3040'); // recessed handle
      }
    }
  };

  var FURNITURE_TYPES = Object.keys(FURNITURE_DRAWERS);

  function drawFurniture(ctx, type, x, y, opts) {
    var o = opts || {};
    var theme = getTheme(o);
    var fn = FURNITURE_DRAWERS[type];
    if (!fn) {
      // Safe placeholder crate for unknown type
      box(ctx, x | 0, y | 0, 16, 16, '#8a6a4a', theme.outline, '#b08b63', '#5c432c');
      return;
    }
    fn(ctx, x | 0, y | 0, o, theme);
  }

  // ---------------------------------------------------------------------------
  // 7. Deterministic Character Look Generator
  // ---------------------------------------------------------------------------
  var SKIN_TONES = ['#fbd5b5', '#f2c29b', '#e2a97e', '#c98a5e', '#9c6442', '#73472d'];
  var HAIR_COLORS = ['#261c1a', '#4a3123', '#7a4b2a', '#c98a3c', '#2d3b5e', '#8c3348', '#5e458c', '#b8bec9'];
  var SHIRT_COLORS = ['#6d4bc4', '#d9667a', '#c9a23a', '#3d6fb6', '#3f8f6a', '#d97841', '#4599a8', '#5e6b85', '#b84b8c'];
  var PANTS_COLORS = ['#252c40', '#2d384f', '#3b3347', '#3d332a', '#1f2636', '#454f5e'];
  var ACCESSORIES = ['none', 'none', 'none', 'glasses', 'headset', 'cap'];

  function randomLook(seed, overrides) {
    var rng = mulberry32(hashSeed(seed));
    var pick = function (arr) { return arr[(rng() * arr.length) | 0]; };
    var look = {
      skin: pick(SKIN_TONES),
      hair: pick(HAIR_COLORS),
      hairStyle: (rng() * 4) | 0,
      shirt: pick(SHIRT_COLORS),
      pants: pick(PANTS_COLORS),
      accessory: pick(ACCESSORIES)
    };
    if (overrides && typeof overrides === 'object') {
      if (overrides.skin) look.skin = overrides.skin;
      if (overrides.hair) look.hair = overrides.hair;
      if (overrides.hairStyle != null) look.hairStyle = overrides.hairStyle;
      if (overrides.shirt) look.shirt = overrides.shirt;
      if (overrides.pants) look.pants = overrides.pants;
      if (overrides.accessory) look.accessory = overrides.accessory;
    }
    return look;
  }

  // ---------------------------------------------------------------------------
  // 8. Chibi Pixel Character Renderer (~12w x 20h, 4 dirs, 10 poses)
  // ---------------------------------------------------------------------------
  function drawCharacter(ctx, x, y, opts) {
    var o = opts || {};
    var look = o.look || o;
    var skin = look.skin || o.skin || '#f2c29b';
    var skinLo = shadeHex(skin, -22);
    var hair = look.hair || o.hair || '#3a2618';
    var hairHi = shadeHex(hair, 26);
    var hairLo = shadeHex(hair, -22);
    var hairStyle = (look.hairStyle != null ? look.hairStyle : (o.hairStyle != null ? o.hairStyle : 0)) & 3;
    var shirt = look.shirt || o.shirt || '#3d6fb6';
    var shirtHi = shadeHex(shirt, 24);
    var shirtLo = shadeHex(shirt, -26);
    var pants = look.pants || o.pants || '#283148';
    var pantsLo = shadeHex(pants, -18);
    var accessory = look.accessory || o.accessory || 'none';
    var dir = o.dir || 'down';
    var pose = o.pose || 'idle';
    var frame = (o.frame || 0) | 0;
    var out = '#181322';

    // Anchor handling: default 'foot' (feet sit around y, body rises to y-19, width 12 centered on x)
    var cx = x | 0;
    var fy = y | 0;
    if (o.anchor === 'topleft') {
      cx = (x + 6) | 0;
      fy = (y + 19) | 0;
    } else if (o.anchor === 'center') {
      fy = (y + 9) | 0;
    }

    var isSit = (pose === 'sit' || pose === 'type' || pose === 'sleep');
    var walkStep = frame & 3; // 0..3
    var bobY = 0;
    if (pose === 'walk' || (pose === 'carry' && (frame & 1))) {
      bobY = (walkStep === 1 || walkStep === 3) ? -1 : 0;
    } else if (pose === 'idle') {
      bobY = ((frame >> 3) & 1) ? -1 : 0;
    } else if (pose === 'type') {
      bobY = (frame & 1) ? 0 : 1;
    } else if (pose === 'lift') {
      bobY = (walkStep === 2) ? -1 : 0;
    }

    var sitDrop = isSit ? 2 : 0;
    var leftX = cx - 6;
    var topY = fy - 19 + bobY + sitDrop;

    // 1) Ground shadow
    dropShadow(ctx, cx - 5, fy - 2, 10, 3, 0.34);

    // 2) Legs & Shoes
    var legY = topY + 14;
    if (isSit) {
      // Seated knees / tucked legs
      px(ctx, leftX + 2, legY, 8, 3, out);
      px(ctx, leftX + 3, legY, 3, 2, pants);
      px(ctx, leftX + 6, legY, 3, 2, pantsLo);
      px(ctx, leftX + 3, legY + 2, 2, 1, '#1d1c24');
      px(ctx, leftX + 7, legY + 2, 2, 1, '#1d1c24');
    } else {
      var lOff = 0;
      var rOff = 0;
      if (pose === 'walk' || pose === 'carry') {
        if (walkStep === 1) { lOff = -1; rOff = 1; }
        else if (walkStep === 3) { lOff = 1; rOff = -1; }
      }
      if (dir === 'left' || dir === 'right') {
        var stride = (pose === 'walk' || pose === 'carry')
          ? (walkStep === 1 ? 2 : (walkStep === 3 ? -2 : 0))
          : 0;
        // Back leg
        px(ctx, cx - 2 - stride, legY, 3, 4, out);
        px(ctx, cx - 1 - stride, legY, 2, 3, pantsLo);
        // Front leg
        px(ctx, cx - 1 + stride, legY, 3, 4, out);
        px(ctx, cx + stride, legY, 2, 3, pants);
        px(ctx, cx + stride, legY + 3, 2, 1, '#18171f');
      } else {
        // Left leg
        px(ctx, leftX + 2, legY + lOff, 4, 5 - Math.max(0, lOff), out);
        px(ctx, leftX + 3, legY + lOff, 2, 3, pants);
        px(ctx, leftX + 3, legY + 3 + lOff, 2, 1, '#1c1b24');
        // Right leg
        px(ctx, leftX + 6, legY + rOff, 4, 5 - Math.max(0, rOff), out);
        px(ctx, leftX + 7, legY + rOff, 2, 3, pantsLo);
        px(ctx, leftX + 7, legY + 3 + rOff, 2, 1, '#1c1b24');
      }
    }

    // 3) Torso / Shirt
    var torsoY = topY + 9;
    if (dir === 'left' || dir === 'right') {
      box(ctx, cx - 3, torsoY, 7, 6, shirt, out, shirtHi, shirtLo);
      // Collar highlight
      px(ctx, cx - 1, torsoY + 1, 3, 1, '#f2f5fa');
    } else {
      box(ctx, leftX + 2, torsoY, 8, 6, shirt, out, shirtHi, shirtLo);
      if (dir === 'down') {
        // Crisp white collar / tie detail
        px(ctx, cx - 1, torsoY + 1, 2, 1, '#f5f7fc');
        px(ctx, cx, torsoY + 2, 1, 2, shadeHex(shirt, -42));
      }
    }

    // 4) Arms (Pose-driven!)
    var armY = torsoY + 1;
    if (pose === 'type') {
      // Rapid alternating hands forward
      var tAlt = frame & 1;
      px(ctx, leftX + 1, armY, 2, 4, out);
      px(ctx, leftX + 1, armY + 1, 1, 2, shirt);
      px(ctx, leftX + 1, armY + 3 - tAlt, 2, 2, skin);

      px(ctx, leftX + 9, armY, 2, 4, out);
      px(ctx, leftX + 10, armY + 1, 1, 2, shirtLo);
      px(ctx, leftX + 9, armY + 2 + tAlt, 2, 2, skin);
    } else if (pose === 'lift') {
      // Lifting dumbbells overhead / mid
      var liftPhase = walkStep; // 0 down, 1 mid, 2 high, 3 mid
      var dy = liftPhase === 2 ? -5 : (liftPhase === 0 ? 0 : -3);
      // Left arm & dumbbell
      px(ctx, leftX, armY + dy, 3, 4, out);
      px(ctx, leftX + 1, armY + 1 + dy, 1, 2, skin);
      px(ctx, leftX - 2, armY - 1 + dy, 5, 2, '#1f2430');
      px(ctx, leftX - 1, armY - 1 + dy, 3, 1, '#cfd6e2');
      // Right arm & dumbbell
      px(ctx, leftX + 9, armY + dy, 3, 4, out);
      px(ctx, leftX + 10, armY + 1 + dy, 1, 2, skin);
      px(ctx, leftX + 9, armY - 1 + dy, 5, 2, '#1f2430');
      px(ctx, leftX + 10, armY - 1 + dy, 3, 1, '#cfd6e2');
    } else if (pose === 'drink') {
      // Left arm relaxed, right arm lifting warm mug
      px(ctx, leftX + 1, armY, 2, 4, out);
      px(ctx, leftX + 1, armY + 1, 1, 2, shirt);
      var sip = ((frame >> 1) & 1) ? -2 : 0;
      px(ctx, leftX + 9, armY + sip, 2, 4, out);
      px(ctx, leftX + 9, armY + 1 + sip, 1, 2, skin);
      // Coffee mug
      box(ctx, leftX + 10, armY - 1 + sip, 4, 4, '#fff8ed', out, null, '#d9cfc0');
      px(ctx, leftX + 11, armY - 3 + sip, 1, 2, 'rgba(255,255,255,0.72)');
    } else if (pose === 'cards') {
      // Holding fan of playing cards slightly forward-right
      px(ctx, leftX + 1, armY, 2, 4, out);
      px(ctx, leftX + 1, armY + 1, 1, 2, shirt);
      px(ctx, leftX + 9, armY, 2, 4, out);
      px(ctx, leftX + 10, armY + 1, 1, 2, shirtLo);
      var sway = frame & 1;
      box(ctx, cx, armY - 1 - sway, 5, 6, '#ffffff', out, null, '#dce3f0');
      px(ctx, cx + 2, armY + 1 - sway, 1, 2, '#e63946');
      box(ctx, cx + 3, armY - sway, 5, 6, '#ffffff', out, null, '#dce3f0');
      px(ctx, cx + 5, armY + 2 - sway, 1, 2, '#1d1f2e');
    } else if (pose === 'talk') {
      // Animated gesturing right hand
      var gest = (frame & 1) ? -2 : 0;
      px(ctx, leftX + 1, armY, 2, 4, out);
      px(ctx, leftX + 1, armY + 1, 1, 2, shirt);
      px(ctx, leftX + 9, armY + gest, 2, 4, out);
      px(ctx, leftX + 10, armY + 1 + gest, 1, 2, skin);
    } else if (pose === 'carry') {
      // Arms holding colored folder/package in front!
      var carryCol = o.carryColor || '#f2c14e';
      px(ctx, leftX + 1, armY + 1, 2, 3, shirt);
      px(ctx, leftX + 9, armY + 1, 2, 3, shirtLo);
      box(ctx, cx - 4, armY + 1, 8, 6, carryCol, out, shadeHex(carryCol, 28), shadeHex(carryCol, -28));
      px(ctx, cx - 2, armY + 3, 4, 1, '#ffffff'); // file label
      px(ctx, leftX + 2, armY + 3, 2, 2, skin);
      px(ctx, leftX + 8, armY + 3, 2, 2, skin);
    } else {
      // Normal walk / idle / sit / sleep arms
      var armSw = (pose === 'walk' && walkStep === 1) ? -1 : ((pose === 'walk' && walkStep === 3) ? 1 : 0);
      if (dir === 'left' || dir === 'right') {
        px(ctx, cx - 1 + armSw, armY, 3, 4, out);
        px(ctx, cx + armSw, armY + 1, 1, 2, shirtHi);
        px(ctx, cx + armSw, armY + 3, 1, 1, skin);
      } else {
        px(ctx, leftX + 1, armY + armSw, 2, 4, out);
        px(ctx, leftX + 1, armY + 1 + armSw, 1, 2, shirt);
        px(ctx, leftX + 1, armY + 3 + armSw, 1, 1, skin);

        px(ctx, leftX + 9, armY - armSw, 2, 4, out);
        px(ctx, leftX + 10, armY + 1 - armSw, 1, 2, shirtLo);
        px(ctx, leftX + 10, armY + 3 - armSw, 1, 1, skin);
      }
    }

    // 5) Chibi Head (10w x 9h centered on cx)
    var headY = topY + (pose === 'sleep' ? 1 : 0);
    var hx = leftX + 1;
    // Outer head outline (rounded pixel corners)
    px(ctx, hx + 1, headY, 8, 9, out);
    px(ctx, hx, headY + 1, 10, 7, out);
    // Face / skin fill
    px(ctx, hx + 1, headY + 1, 8, 7, skin);
    px(ctx, hx + 1, headY + 7, 8, 1, skinLo);

    // 6) Hair Styles (0..3)
    if (dir === 'up') {
      // Full back of head covered by hair
      px(ctx, hx + 1, headY + 1, 8, 6, hair);
      px(ctx, hx + 2, headY + 1, 5, 2, hairHi);
      px(ctx, hx + 1, headY + 6, 8, 1, hairLo);
      if (hairStyle === 1) {
        px(ctx, hx + 1, headY + 7, 8, 2, hairLo);
      } else if (hairStyle === 3) {
        box(ctx, cx - 2, headY - 2, 4, 3, hair, out, hairHi, null);
      }
    } else {
      // Hair crown
      px(ctx, hx + 1, headY + 1, 8, 2, hair);
      px(ctx, hx + 2, headY + 1, 5, 1, hairHi);
      if (dir === 'left') {
        // Side-profile back hair on right side of head
        px(ctx, hx + 6, headY + 2, 3, 5, hair);
        px(ctx, hx + 7, headY + 3, 2, 4, hairLo);
      } else if (dir === 'right') {
        // Side-profile back hair on left side of head
        px(ctx, hx + 1, headY + 2, 3, 5, hair);
        px(ctx, hx + 1, headY + 3, 2, 4, hairLo);
      }
      if (hairStyle === 0) {
        // Classic neat bangs
        px(ctx, hx + 1, headY + 3, 2, 1, hair);
        px(ctx, hx + 7, headY + 3, 2, 1, hair);
        px(ctx, hx + 4, headY + 3, 2, 1, hairLo);
      } else if (hairStyle === 1) {
        // Longer bob framing sides
        px(ctx, hx, headY + 2, 2, 6, hair);
        px(ctx, hx + 8, headY + 2, 2, 6, hairLo);
        px(ctx, hx + 2, headY + 3, 3, 1, hair);
      } else if (hairStyle === 2) {
        // Spiky energetic top
        px(ctx, hx + 1, headY - 1, 2, 2, hair);
        px(ctx, hx + 4, headY - 1, 3, 2, hairHi);
        px(ctx, hx + 7, headY, 2, 2, hair);
        px(ctx, hx + 1, headY + 3, 1, 2, hair);
        px(ctx, hx + 8, headY + 3, 1, 2, hair);
      } else {
        // Top bun / curly volume
        box(ctx, cx - 2, headY - 2, 4, 3, hair, out, hairHi, null);
        px(ctx, hx + 1, headY + 2, 2, 2, hair);
        px(ctx, hx + 7, headY + 2, 2, 2, hair);
      }
    }

    // 7) Facial features (eyes, blush, mouth)
    var blinkEyes = (pose === 'idle' && (frame % 48 === 0));
    if (dir === 'down') {
      if (pose === 'sleep' || blinkEyes) {
        px(ctx, hx + 2, headY + 5, 2, 1, '#261d2e');
        px(ctx, hx + 6, headY + 5, 2, 1, '#261d2e');
      } else {
        px(ctx, hx + 2, headY + 4, 2, 2, '#1a1426');
        px(ctx, hx + 6, headY + 4, 2, 2, '#1a1426');
        // Eye glint
        px(ctx, hx + 2, headY + 4, 1, 1, '#ffffff');
        px(ctx, hx + 6, headY + 4, 1, 1, '#ffffff');
      }
      // Subtle cheek blush
      px(ctx, hx + 1, headY + 6, 1, 1, 'rgba(235, 110, 125, 0.45)');
      px(ctx, hx + 8, headY + 6, 1, 1, 'rgba(235, 110, 125, 0.45)');
      // Talking mouth
      if (pose === 'talk' && (frame & 1)) {
        px(ctx, hx + 4, headY + 6, 2, 2, '#b84255');
      }
    } else if (dir === 'left') {
      if (pose === 'sleep' || blinkEyes) {
        px(ctx, hx + 2, headY + 5, 2, 1, '#261d2e');
      } else {
        px(ctx, hx + 2, headY + 4, 2, 2, '#1a1426');
        px(ctx, hx + 2, headY + 4, 1, 1, '#ffffff');
      }
      if (pose === 'talk' && (frame & 1)) {
        px(ctx, hx + 2, headY + 6, 2, 1, '#b84255');
      }
    } else if (dir === 'right') {
      if (pose === 'sleep' || blinkEyes) {
        px(ctx, hx + 6, headY + 5, 2, 1, '#261d2e');
      } else {
        px(ctx, hx + 6, headY + 4, 2, 2, '#1a1426');
        px(ctx, hx + 7, headY + 4, 1, 1, '#ffffff');
      }
      if (pose === 'talk' && (frame & 1)) {
        px(ctx, hx + 6, headY + 6, 2, 1, '#b84255');
      }
    }

    // 8) Accessories ('glasses' | 'headset' | 'cap')
    if (accessory === 'glasses' && dir !== 'up') {
      var gCol = '#2a344d';
      var lensCol = 'rgba(130, 220, 255, 0.55)';
      if (dir === 'down') {
        px(ctx, hx + 1, headY + 4, 3, 2, gCol);
        px(ctx, hx + 6, headY + 4, 3, 2, gCol);
        px(ctx, hx + 4, headY + 4, 2, 1, gCol);
        px(ctx, hx + 2, headY + 4, 1, 1, lensCol);
        px(ctx, hx + 7, headY + 4, 1, 1, lensCol);
      } else if (dir === 'left') {
        px(ctx, hx + 1, headY + 4, 3, 2, gCol);
        px(ctx, hx + 2, headY + 4, 1, 1, lensCol);
      } else {
        px(ctx, hx + 6, headY + 4, 3, 2, gCol);
        px(ctx, hx + 7, headY + 4, 1, 1, lensCol);
      }
    } else if (accessory === 'headset') {
      // Over-head band + earcups + mic boom
      px(ctx, hx + 1, headY, 8, 1, '#363f57');
      px(ctx, hx - 1, headY + 3, 2, 3, '#232836');
      px(ctx, hx + 9, headY + 3, 2, 3, '#232836');
      px(ctx, hx - 1, headY + 4, 1, 1, '#44d7ff');
      px(ctx, hx + 10, headY + 4, 1, 1, '#44d7ff');
      if (dir !== 'up') {
        px(ctx, hx + 7, headY + 6, 3, 1, '#1f2430');
      }
    } else if (accessory === 'cap') {
      var capCol = shadeHex(shirt, 10);
      var capHi = shadeHex(capCol, 28);
      box(ctx, hx, headY - 1, 10, 4, capCol, out, capHi, null);
      if (dir === 'right') {
        px(ctx, hx + 7, headY + 2, 5, 1, out);
        px(ctx, hx + 7, headY + 1, 4, 1, shadeHex(capCol, -18));
      } else if (dir === 'left') {
        px(ctx, hx - 2, headY + 2, 5, 1, out);
        px(ctx, hx - 1, headY + 1, 4, 1, shadeHex(capCol, -18));
      } else {
        px(ctx, hx + 1, headY + 2, 8, 1, shadeHex(capCol, -24));
      }
    }

    // 9) Pose FX overlays (sweat drop when urgent typing, Zzz when sleeping, motion spark)
    if (pose === 'type') {
      // Animated sweat drop + hustle spark
      var swY = headY + 1 + (frame & 1);
      px(ctx, hx + 10, swY, 2, 3, '#4dc9ff');
      px(ctx, hx + 10, swY, 1, 1, '#ffffff');
    } else if (pose === 'sleep') {
      var zStep = (frame >> 2) % 3;
      ctx.save();
      ctx.font = '700 7px monospace';
      ctx.fillStyle = '#9fd8ff';
      ctx.fillText('z', hx + 9, headY - zStep);
      if (zStep >= 1) ctx.fillText('Z', hx + 12, headY - 3 - zStep);
      ctx.restore();
    } else if (pose === 'lift' && walkStep === 2) {
      px(ctx, cx - 1, headY - 3, 2, 1, '#ffd95e');
      px(ctx, cx + 3, headY - 2, 1, 1, '#ffd95e');
    }
  }

  // ---------------------------------------------------------------------------
  // Public API Export
  // ---------------------------------------------------------------------------
  var api = {
    TILE: TILE,
    PALETTE: PALETTE,
    FURNITURE_TYPES: FURNITURE_TYPES,
    FURNITURE_SIZES: FURNITURE_SIZES,
    getTheme: getTheme,
    shadeHex: shadeHex,
    mixHex: mixHex,
    randomLook: randomLook,
    drawFloor: drawFloor,
    drawWall: drawWall,
    drawRoomSign: drawRoomSign,
    drawDoor: drawDoor,
    drawBubble: drawBubble,
    drawFurniture: drawFurniture,
    drawCharacter: drawCharacter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.PixelOfficeArt = api;
  }

  // ---------------------------------------------------------------------------
  // Lightweight Opt-In Self-Test (only when window.__PO_ART_SELFTEST === true)
  // ---------------------------------------------------------------------------
  if (typeof window !== 'undefined' && window.__PO_ART_SELFTEST === true) {
    var errors = [];
    var requiredFns = [
      'drawFloor', 'drawWall', 'drawRoomSign', 'drawDoor',
      'drawBubble', 'drawFurniture', 'drawCharacter', 'randomLook'
    ];
    for (var i = 0; i < requiredFns.length; i++) {
      if (typeof api[requiredFns[i]] !== 'function') {
        errors.push('Missing function: ' + requiredFns[i]);
      }
    }
    if (api.TILE !== 16) errors.push('TILE !== 16');
    if (api.FURNITURE_TYPES.length < 30) {
      errors.push('Expected >= 30 furniture types, got ' + api.FURNITURE_TYPES.length);
    }
    var l1 = api.randomLook('agent-alpha');
    var l2 = api.randomLook('agent-alpha');
    if (JSON.stringify(l1) !== JSON.stringify(l2)) {
      errors.push('randomLook is not deterministic');
    }
    window.__PO_ART_SELFTEST_RESULT = {
      ok: errors.length === 0,
      furnitureCount: api.FURNITURE_TYPES.length,
      errors: errors
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);

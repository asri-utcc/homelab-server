'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FLOW_URLS = [
  'https://labs.google/fx/tools/flow',
  'https://flow.google',
];

const FLOW_PRIMARY_URL = FLOW_URLS[0];
const FLOW_CANONICAL_HOST = 'flow.google.com';
const DEFAULT_OUTPUT_DIR = '/home/dev/.gemini/outputs/google-flow';
const DASHBOARD_BASE_URL = 'https://homelab.tail285279.ts.net';

const SAFE_OUTPUT_ROOTS = [
  '/home/dev/.gemini',
  '/home/dev/projects',
  '/tmp',
];

const MIN_IMAGE_DIMENSION = 256;
const MIN_IMAGE_BYTES = 15 * 1024; // 15 KB
const MIN_ABSOLUTE_ICON_DIMENSION = 64;

const ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'];

/**
 * Multi-layered DOM selectors for Google Flow.
 * Order: verified selectors from live recon (/tmp/google-flow-recon.json) first,
 * followed by semantic / ARIA / role / bilingual (TH + EN) fallbacks.
 */
const SELECTORS = {
  newProjectButton: [
    'button.new-project-button',
    'button:has-text("โปรเจ็กต์ใหม่")',
    'button:has-text("New project")',
    'button[aria-label*="โปรเจ็กต์ใหม่"]',
    'button[aria-label*="New project" i]',
  ],
  projectLinks: [
    'a[href*="/project/"]',
  ],
  onboardingDialog: [
    'mat-dialog-container',
    '[role="dialog"]',
  ],
  onboardingDismissButtons: [
    'mat-dialog-container button:has-text("เริ่มต้นใช้งาน")',
    'mat-dialog-container button:has-text("Get started")',
    'mat-dialog-container button:has-text("เข้าใจแล้ว")',
    'mat-dialog-container button:has-text("Got it")',
    'mat-dialog-container button:has-text("ข้าม")',
    'mat-dialog-container button:has-text("Skip")',
    'mat-dialog-container button[aria-label*="ปิด"]',
    'mat-dialog-container button[aria-label*="Close" i]',
    '[role="dialog"] button:has-text("เริ่มต้นใช้งาน")',
    '[role="dialog"] button:has-text("Get started")',
    '[role="dialog"] button[aria-label*="Close" i]',
  ],
  imageModeToggle: [
    'button:has-text("รูปภาพ")',
    'button:has-text("Create Image")',
    'button:has-text("Images")',
    'button[role="tab"]:has-text("รูปภาพ")',
    'button[role="tab"]:has-text("Image")',
    'button[role="radio"]:has-text("Image")',
    'button[aria-label*="รูปภาพ"]',
    'button[aria-label*="Create image" i]',
    'button[aria-label*="Images" i]',
  ],
  settingsTriggerButton: [
    'button.settings-trigger-button[aria-label="ทริกเกอร์การตั้งค่า"]',
    'button.settings-trigger-button',
    'button[aria-label*="การตั้งค่า"]',
    'button[aria-label*="Settings" i]',
  ],
  aspectRatioOptions: [
    '.cdk-overlay-container button[role="radio"].mat-button-toggle-button',
    '.cdk-overlay-container [role="radio"]',
    'button[role="radio"].mat-button-toggle-button',
    '[role="menuitemradio"]',
  ],
  modelSelectorButton: [
    'button[aria-label="เลือกกลุ่มผลิตภัณฑ์โมเดล"]',
    'button[aria-label*="โมเดล"]',
    'button[aria-label*="Model" i]',
    '.cdk-overlay-container button[aria-haspopup="listbox"]',
  ],
  countSelectorOptions: [
    '.cdk-overlay-container [role="listbox"] [role="option"]',
    '.cdk-overlay-container button[aria-label*="Outputs" i]',
    '.cdk-overlay-container button[aria-label*="จำนวน"]',
  ],
  promptTextbox: [
    'div.ProseMirror[role="textbox"][aria-label="คุณต้องการสร้างอะไร"]',
    'div.ProseMirror[role="textbox"]',
    'div.ProseMirror[contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
    'textarea[aria-label*="สร้าง"]',
    'textarea[placeholder*="create" i]',
    'textarea[placeholder*="prompt" i]',
    'textarea',
    '[contenteditable="true"]',
  ],
  generateButton: [
    'button.generate-icon-button[aria-label="เริ่มสร้าง"]',
    'button.generate-icon-button',
    'button[aria-label="เริ่มสร้าง"]',
    'button[aria-label="Generate" i]',
    'button[aria-label="Create" i]',
    'button:has-text("เริ่มสร้าง")',
    'button:has-text("Generate")',
    'button:has-text("Create")',
  ],
  generatingIndicators: [
    'mat-progress-spinner',
    'mat-progress-bar',
    '[role="progressbar"]',
    '[aria-busy="true"]',
    'flow-image-tile .loading',
    'flow-image-tile .generating',
    '[data-generating="true"]',
  ],
  imageTile: [
    'flow-image-tile',
  ],
  imageResult: [
    'flow-image-tile img.image',
    'flow-image-tile img[src*="/asb/"]',
    'img[src*="flow.google.com/asb/"]',
    'img[alt="การ์ดแสดงรูปภาพผู้ใช้"]',
    'flow-image-tile img',
    'main img',
  ],
  tileMoreOptionsButton: [
    'button[aria-label="ตัวเลือกเพิ่มเติม"]',
    'button[aria-label*="More options" i]',
    'button[aria-label*="More" i]',
    'button:has-text("more_vert")',
  ],
  downloadButton: [
    '[role="menuitem"]:has-text("ดาวน์โหลด")',
    '[role="menuitem"]:has-text("Download")',
    'button:has-text("ดาวน์โหลด")',
    'button:has-text("Download")',
    'a[download]',
    'button[aria-label*="ดาวน์โหลด"]',
    'button[aria-label*="Download" i]',
  ],
  recaptchaEnterpriseIframe: [
    'iframe[src*="recaptcha/enterprise/anchor"]',
  ],
};

function isFlowUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'flow.google.com' ||
      host === 'flow.google' ||
      (host === 'labs.google' && parsed.pathname.toLowerCase().includes('/flow'))
    );
  } catch (_) {
    return false;
  }
}

function isFlowProjectUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.hostname.toLowerCase() === 'flow.google.com' && /^\/project\/[^/]+/i.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

/**
 * Detect login redirects, visible CAPTCHA challenges, Terms of Service modals,
 * or region-unavailable gates.
 * Deliberately avoids false positives from invisible reCAPTCHA Enterprise iframes.
 */
function detectAuthOrGate(url = '', pageText = '', extra = {}) {
  const urlStr = String(url || '').trim();
  const urlLower = urlStr.toLowerCase();
  const text = String(pageText || '');
  const textLower = text.toLowerCase();

  // 1. Google Sign-In redirect
  let host = '';
  let pathname = '';
  try {
    if (urlStr) {
      const parsed = new URL(urlStr);
      host = parsed.hostname.toLowerCase();
      pathname = parsed.pathname.toLowerCase();
    }
  } catch (_) {
    // ignore invalid URL
  }

  if (
    host === 'accounts.google.com' ||
    host.endsWith('.accounts.google.com') ||
    urlLower.includes('accounts.google.com/v3/signin') ||
    urlLower.includes('accounts.google.com/servicelogin') ||
    /\/(signin|login|oauth2|ServiceLogin)\b/i.test(pathname)
  ) {
    return {
      blocked: true,
      needsLogin: true,
      kind: 'LOGIN',
      reason: 'redirected_to_google_signin',
      message: 'Google Flow requires Google Sign-In. Run `google-flow login --session <bv_sess>` and sign in via Browser Vision.',
    };
  }

  // 2. Visible CAPTCHA / anti-bot sorry gate (never false-positive on invisible reCAPTCHA)
  if (
    extra.visibleCaptcha === true ||
    /\/sorry\/index/i.test(urlLower) ||
    /unusual traffic from your computer network|verify you are human|complete the security check|ยืนยันว่าคุณไม่ใช่โปรแกรมอัตโนมัติ|มีการรับส่งข้อมูลที่ผิดปกติ/i.test(text)
  ) {
    return {
      blocked: true,
      needsLogin: false,
      kind: 'CAPTCHA',
      reason: 'visible_captcha_challenge',
      message: 'Visible CAPTCHA / human verification detected. Please complete it manually in Browser Vision.',
    };
  }

  // 3. Region / country unavailable or waitlist gate
  if (
    /not available in your country|isn't available in your country|currently unavailable in your region|ไม่พร้อมใช้งานในประเทศของคุณ|ยังไม่เปิดให้บริการในประเทศของคุณ|join the waitlist/i.test(text)
  ) {
    return {
      blocked: true,
      needsLogin: false,
      kind: 'REGION',
      reason: 'region_unavailable',
      message: 'Google Flow reports that the service is unavailable in this region or requires waitlist access.',
    };
  }

  // 4. Terms of Service / consent gate (only when page looks like a blocking gate, not normal workspace)
  const hasWorkspaceMarkers = Boolean(
    extra.hasWorkspaceControls ||
    /โปรเจ็กต์ใหม่|new project|คุณต้องการสร้างอะไร|what do you want to create/i.test(text)
  );

  if (
    !hasWorkspaceMarkers &&
    (
      /accept terms of service|agree to the terms|generative ai additional terms|ยอมรับข้อกำหนดในการให้บริการ|ข้อกำหนดเพิ่มเติมสำหรับ/i.test(text) ||
      host === 'consent.google.com'
    )
  ) {
    return {
      blocked: true,
      needsLogin: false,
      kind: 'TOS',
      reason: 'terms_of_service_gate',
      message: 'Google Flow requires accepting Terms of Service or consent in Browser Vision.',
    };
  }

  // 5. Unauthenticated landing page asking to sign in (no workspace controls present)
  if (
    !hasWorkspaceMarkers &&
    (
      /\bsign in with google\b|\bsign in to continue\b|ลงชื่อเข้าใช้ด้วย google|ลงชื่อเข้าใช้เพื่อดำเนินการต่อ/i.test(text) ||
      (isFlowUrl(urlStr) && /\bcreate with flow\b/i.test(textLower) && /\bsign in\b/i.test(textLower))
    )
  ) {
    return {
      blocked: true,
      needsLogin: true,
      kind: 'LOGIN',
      reason: 'signin_prompt_detected',
      message: 'Google Flow is showing a sign-in gate. Please sign in via Browser Vision (`google-flow login --session <bv_sess>`).',
    };
  }

  return {
    blocked: false,
    needsLogin: false,
    kind: null,
    reason: null,
    message: null,
  };
}

function validateSafeOutputPath(outPath) {
  if (typeof outPath !== 'string' || !outPath.trim()) {
    throw new Error('Output path must be a non-empty string');
  }
  if (outPath.includes('\0')) {
    throw new Error('Output path contains null byte');
  }
  const resolved = path.resolve(outPath.trim());
  const allowed = SAFE_OUTPUT_ROOTS.some((root) => {
    const rel = path.relative(root, resolved);
    return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (!allowed) {
    throw new Error(
      `Unsafe output path "${outPath}" (resolved: "${resolved}"). Allowed roots: ${SAFE_OUTPUT_ROOTS.join(', ')}`
    );
  }
  return resolved;
}

function formatTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function slugifyPrompt(prompt, maxLen = 48) {
  const raw = String(prompt || '').trim();
  const hash = crypto.createHash('sha256').update(raw || 'google-flow').digest('hex').slice(0, 8);
  if (!raw) return `flow-${hash}`;

  const ascii = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // If prompt has meaningful ASCII letters, use clean slug
  if (/[a-z]/.test(ascii)) {
    return ascii.slice(0, maxLen).replace(/-+$/g, '') || `flow-${hash}`;
  }

  // Non-ASCII prompt (e.g. Thai): include any digits + deterministic short hash for safe URLs/paths
  const digits = ascii.replace(/^-+|-+$/g, '').slice(0, 16);
  const combined = digits ? `flow-${digits}-${hash}` : `flow-${hash}`;
  return combined.slice(0, maxLen).replace(/-+$/g, '');
}

function buildOutputPath(outArg, prompt, index = 0, ext = 'png', opts = {}) {
  const cleanExt = String(ext || 'png').replace(/^\./, '').toLowerCase() || 'png';
  const ts = opts.timestamp || formatTimestamp(opts.now || new Date());
  const slug = slugifyPrompt(prompt);
  const idx = Number.isInteger(index) && index >= 0 ? index : 0;
  const total = Number.isInteger(opts.total) && opts.total > 0 ? opts.total : 1;
  const suffix = (idx > 0 || total > 1) ? `_${idx + 1}` : '';

  if (!outArg) {
    const filename = `${ts}_${slug}${suffix}.${cleanExt}`;
    return validateSafeOutputPath(path.join(DEFAULT_OUTPUT_DIR, filename));
  }

  const rawOut = String(outArg).trim();
  if (!rawOut) {
    const filename = `${ts}_${slug}${suffix}.${cleanExt}`;
    return validateSafeOutputPath(path.join(DEFAULT_OUTPUT_DIR, filename));
  }

  const endsWithSep = rawOut.endsWith('/') || rawOut.endsWith(path.sep);
  let isDir = endsWithSep;
  if (!isDir) {
    try {
      const st = fs.statSync(path.resolve(rawOut));
      if (st.isDirectory()) isDir = true;
    } catch (_) {
      // path does not exist yet
    }
  }

  if (isDir) {
    const filename = `${ts}_${slug}${suffix}.${cleanExt}`;
    return validateSafeOutputPath(path.join(rawOut, filename));
  }

  const resolved = validateSafeOutputPath(rawOut);
  const parsed = path.parse(resolved);
  const knownImageExt = /^\.(png|jpe?g|webp|gif)$/i.test(parsed.ext);
  const targetExt = knownImageExt && !opts.forceExt ? parsed.ext : `.${cleanExt}`;
  const baseName = knownImageExt ? parsed.name : parsed.base;
  const numbered = idx > 0 ? `${baseName}_${idx + 1}` : baseName;

  return validateSafeOutputPath(path.join(parsed.dir, `${numbered}${targetExt}`));
}

function buildDashboardUrls(filePath, baseUrl = DASHBOARD_BASE_URL) {
  const abs = path.resolve(String(filePath || ''));
  const base = String(baseUrl || DASHBOARD_BASE_URL).replace(/\/+$/, '');
  const encoded = encodeURIComponent(abs);
  return {
    viewUrl: `${base}/api/gemini/local-image?path=${encoded}`,
    downloadUrl: `${base}/api/gemini/local-file?path=${encoded}&download=1`,
  };
}

function detectImageMagic(buf) {
  if (!buf) return null;
  const b = Buffer.isBuffer(buf) ? buf : (buf instanceof Uint8Array ? Buffer.from(buf) : null);
  if (!b || b.length < 3) return null;

  // PNG: 89 50 4E 47
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // WEBP: RIFF....WEBP
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  // GIF: GIF8
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'GIF8') {
    return { mime: 'image/gif', ext: 'gif' };
  }
  return null;
}

function parseImageDimensions(buf, ext) {
  if (!Buffer.isBuffer(buf)) return { width: null, height: null };

  // PNG IHDR
  if (ext === 'png' && buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }

  // GIF logical screen descriptor
  if (ext === 'gif' && buf.length >= 10) {
    return {
      width: buf.readUInt16LE(6),
      height: buf.readUInt16LE(8),
    };
  }

  // JPEG SOF marker scan
  if (ext === 'jpg' && buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (offset < buf.length && buf[offset] === 0xff) offset++;
      if (offset >= buf.length) break;
      const marker = buf[offset++];
      // Standalone markers without length
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        continue;
      }
      if (offset + 2 > buf.length) break;
      const segLen = buf.readUInt16BE(offset);
      if (segLen < 2 || offset + segLen > buf.length) break;

      const isSof = (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      );
      if (isSof && offset + 7 <= buf.length) {
        return {
          height: buf.readUInt16BE(offset + 3),
          width: buf.readUInt16BE(offset + 5),
        };
      }
      offset += segLen;
    }
  }

  // WEBP (VP8X, VP8L, VP8 )
  if (ext === 'webp' && buf.length >= 30 && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buf.length >= 30) {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width, height };
    }
    if (chunk === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
      const bits = buf.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height };
    }
    if (chunk === 'VP8 ' && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
  }

  return { width: null, height: null };
}

function validateImageBuffer(buf, meta = {}) {
  const b = Buffer.isBuffer(buf) ? buf : (buf instanceof Uint8Array ? Buffer.from(buf) : null);
  if (!b || b.length === 0) {
    return { ok: false, reason: 'empty_buffer', message: 'Image buffer is empty' };
  }

  const detected = detectImageMagic(b);
  if (!detected || (detected.ext !== 'png' && detected.ext !== 'jpg' && detected.ext !== 'webp')) {
    return {
      ok: false,
      reason: 'invalid_magic_bytes',
      message: `Expected PNG, JPEG, or WEBP magic bytes (got ${detected ? detected.mime : 'non-image'}, ${b.length} bytes)`,
    };
  }

  const parsedDims = parseImageDimensions(b, detected.ext);
  const width = Number.isFinite(Number(parsedDims.width)) && parsedDims.width > 0
    ? parsedDims.width
    : (Number.isFinite(Number(meta.width)) && Number(meta.width) > 0 ? Number(meta.width) : null);
  const height = Number.isFinite(Number(parsedDims.height)) && parsedDims.height > 0
    ? parsedDims.height
    : (Number.isFinite(Number(meta.height)) && Number(meta.height) > 0 ? Number(meta.height) : null);

  if (
    width !== null &&
    height !== null &&
    (width < MIN_ABSOLUTE_ICON_DIMENSION || height < MIN_ABSOLUTE_ICON_DIMENSION)
  ) {
    return {
      ok: false,
      reason: 'icon_dimension_rejected',
      mime: detected.mime,
      ext: detected.ext,
      width,
      height,
      sizeBytes: b.length,
      message: `Image dimensions ${width}x${height} are below minimum icon guard (${MIN_ABSOLUTE_ICON_DIMENSION}px)`,
    };
  }

  const meetsDimensions = width !== null && height !== null &&
    width >= MIN_IMAGE_DIMENSION && height >= MIN_IMAGE_DIMENSION;
  const meetsBytes = b.length >= MIN_IMAGE_BYTES;

  if (!meetsDimensions && !meetsBytes) {
    return {
      ok: false,
      reason: 'image_too_small',
      mime: detected.mime,
      ext: detected.ext,
      width,
      height,
      sizeBytes: b.length,
      message: `Image too small (${width || '?'}x${height || '?'}, ${b.length} bytes; require >= ${MIN_IMAGE_DIMENSION}px or >= ${MIN_IMAGE_BYTES} bytes)`,
    };
  }

  return {
    ok: true,
    mime: detected.mime,
    ext: detected.ext,
    width,
    height,
    sizeBytes: b.length,
  };
}

function isLikelyResultImage(imgInfo = {}) {
  const src = String(imgInfo.src || imgInfo.currentSrc || '').trim();
  if (!src) return false;
  if (!/^(https?:\/\/|blob:|data:image\/)/i.test(src)) return false;

  const srcLower = src.toLowerCase();
  const alt = String(imgInfo.alt || '').toLowerCase();
  const cls = String(imgInfo.className || '').toLowerCase();

  // Exclude avatars, profile photos, UI icons, and video thumbnails
  if (
    srcLower.includes('googleusercontent.com/a/') ||
    srcLower.includes('googleusercontent.com/a-') ||
    srcLower.includes('gravatar.com') ||
    srcLower.includes('favicon') ||
    srcLower.endsWith('.svg') ||
    /\b(avatar|icon|logo|emoji|badge)\b/.test(cls) ||
    /\b(avatar|profile photo|icon)\b/.test(alt) ||
    alt.includes('ภาพปกวิดีโอ') ||
    alt.includes('video thumbnail') ||
    (/\bthumbnail\b/.test(cls) && !imgInfo.inImageTile)
  ) {
    return false;
  }

  const nw = Number(imgInfo.naturalWidth || imgInfo.width || 0);
  const nh = Number(imgInfo.naturalHeight || imgInfo.height || 0);

  if (nw > 0 && nh > 0) {
    return nw >= MIN_IMAGE_DIMENSION && nh >= MIN_IMAGE_DIMENSION;
  }

  // If dimensions aren't loaded yet, only allow verified Flow ASB image tile URLs
  return Boolean(imgInfo.inImageTile && srcLower.includes('/asb/'));
}

module.exports = {
  FLOW_URLS,
  FLOW_PRIMARY_URL,
  FLOW_CANONICAL_HOST,
  DEFAULT_OUTPUT_DIR,
  DASHBOARD_BASE_URL,
  SAFE_OUTPUT_ROOTS,
  MIN_IMAGE_DIMENSION,
  MIN_IMAGE_BYTES,
  MIN_ABSOLUTE_ICON_DIMENSION,
  ASPECT_RATIOS,
  SELECTORS,
  isFlowUrl,
  isFlowProjectUrl,
  detectAuthOrGate,
  validateSafeOutputPath,
  formatTimestamp,
  slugifyPrompt,
  buildOutputPath,
  buildDashboardUrls,
  detectImageMagic,
  parseImageDimensions,
  validateImageBuffer,
  isLikelyResultImage,
};

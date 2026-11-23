import React from 'react';
import { random, useCurrentFrame } from 'remotion';

export interface FilmGrainVignetteProps {
  /** Film grain intensity 0..1 (default 0.06) */
  grain?: number;
  /** Radial vignette edge darkness 0..1 (default 0.55) */
  vignette?: number;
  /** Vignette tint color in hex (default '#050816') */
  vignetteColor?: string;
  /** feTurbulence baseFrequency controlling grain fineness (default 0.78) */
  grainFrequency?: number;
  /** Change deterministic grain seed every N frames (default 2) */
  updateEveryFrames?: number;
  style?: React.CSSProperties;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(5, 8, 22, ${alpha.toFixed(3)})`;
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

const GRAIN_TILE_SIZE = 96;

// Minimal deterministic CRC32 + Adler32 for building a cached raw grayscale PNG grain tile (zero SVG/feTurbulence CPU cost)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function buildGrainPngDataUri(size = GRAIN_TILE_SIZE): string {
  // Raw PNG scanlines: filter byte (0) + `size` grayscale bytes per row
  const rowBytes = 1 + size;
  const raw = new Uint8Array(rowBytes * size);
  for (let y = 0; y < size; y += 1) {
    const rowOff = y * rowBytes;
    raw[rowOff] = 0;
    for (let x = 0; x < size; x += 1) {
      // Triangular-distributed monochrome film grain around neutral mid-gray
      const r1 = random(`fg-n1-${y * size + x}`);
      const r2 = random(`fg-n2-${y * size + x}`);
      raw[rowOff + 1 + x] = Math.round(((r1 + r2) * 0.5) * 255);
    }
  }

  // Zlib wrapper with single uncompressed DEFLATE block (raw.length = 9312 < 65535)
  const len = raw.length;
  const zlib = new Uint8Array(2 + 5 + len + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  zlib[2] = 0x01; // BFINAL=1, BTYPE=00 (stored)
  zlib[3] = len & 0xff;
  zlib[4] = (len >>> 8) & 0xff;
  zlib[5] = (~len) & 0xff;
  zlib[6] = ((~len) >>> 8) & 0xff;
  zlib.set(raw, 7);
  const adler = adler32(raw);
  const dvZ = new DataView(zlib.buffer);
  dvZ.setUint32(7 + len, adler);

  const ihdr = new Uint8Array(13);
  const dvH = new DataView(ihdr.buffer);
  dvH.setUint32(0, size);
  dvH.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const cIHDR = pngChunk('IHDR', ihdr);
  const cIDAT = pngChunk('IDAT', zlib);
  const cIEND = pngChunk('IEND', new Uint8Array(0));

  const full = new Uint8Array(sig.length + cIHDR.length + cIDAT.length + cIEND.length);
  let pos = 0;
  for (const part of [sig, cIHDR, cIDAT, cIEND]) {
    full.set(part, pos);
    pos += part.length;
  }

  let bin = '';
  for (let i = 0; i < full.length; i += 1) bin += String.fromCharCode(full[i]);
  return `url("data:image/png;base64,${btoa(bin)}")`;
}

let cachedGrainUri: string | null = null;
function getCachedGrainTile(_freq: number): string {
  if (!cachedGrainUri) {
    cachedGrainUri = buildGrainPngDataUri(GRAIN_TILE_SIZE);
  }
  return cachedGrainUri;
}

export const FilmGrainVignette: React.FC<FilmGrainVignetteProps> = ({
  grain = 0.06,
  vignette = 0.55,
  vignetteColor = '#050816',
  grainFrequency = 0.78,
  updateEveryFrames = 2,
  style,
}) => {
  const frame = useCurrentFrame();

  const step = Math.max(1, Math.round(updateEveryFrames));
  const seed = Math.floor(frame / step) + 1;

  const clampedGrain = Math.max(0, Math.min(1, grain));
  const clampedVignette = Math.max(0, Math.min(1, vignette));

  // Cached small seamless noise tile shifted deterministically every N frames (zero SVG filters)
  const tileUri = getCachedGrainTile(grainFrequency);
  const offsetX = Math.round(random(`fg-x-${seed}`) * GRAIN_TILE_SIZE);
  const offsetY = Math.round(random(`fg-y-${seed}`) * GRAIN_TILE_SIZE);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 90,
        ...style,
      }}
    >
      {/* Deterministic organic cinema film grain */}
      {clampedGrain > 0.001 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: tileUri,
            backgroundRepeat: 'repeat',
            backgroundSize: `${GRAIN_TILE_SIZE}px ${GRAIN_TILE_SIZE}px`,
            backgroundPosition: `${offsetX}px ${offsetY}px`,
            opacity: clampedGrain * 0.85,
          }}
        />
      )}

      {/* Smooth radial lens vignette */}
      {clampedVignette > 0.001 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse 76% 70% at 50% 48%, ${hexToRgba(
              vignetteColor,
              0,
            )} 46%, ${hexToRgba(vignetteColor, clampedVignette * 0.42)} 76%, ${hexToRgba(
              vignetteColor,
              clampedVignette,
            )} 100%)`,
          }}
        />
      )}
    </div>
  );
};

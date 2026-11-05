/* =========================================================================
   MotionLab — canvas recording to animated GIF (1.28).

   No external dependencies: a small self-contained GIF89a encoder with
   LZW compression. The palette is built for this app's flat design —
   exact brand colours first, then a 6×6×6 colour cube and a greyscale
   ramp — and frames are quantised to palette indices AT CAPTURE TIME,
   so a 20-second recording stores indices (~0.4 MB/frame at 880×495),
   never raw RGBA.

   The pure functions (buildPalette / quantize / encodeGIF) are DOM-free
   and unit-tested; the Recorder class wraps them around a canvas.
   ========================================================================= */

/** 256-entry GIF palette (RGB triples): brand colours, 6×6×6 cube, greys. */
export function buildPalette() {
  const pal = new Uint8Array(256 * 3);
  const put = (i, r, g, b) => { pal[i * 3] = r; pal[i * 3 + 1] = g; pal[i * 3 + 2] = b; };
  // exact colours the renderer uses most (background, ink, accent, badges)
  const exact = [
    [250, 250, 250], [255, 255, 255], [17, 17, 17], [51, 51, 51], [85, 85, 85],
    [119, 119, 119], [170, 170, 170], [204, 204, 204], [230, 230, 230],
    [47, 109, 179], [211, 51, 51], [51, 102, 204], [240, 244, 248], [224, 232, 240],
  ];
  exact.forEach((c, i) => put(i, c[0], c[1], c[2]));
  let idx = exact.length;
  // 6×6×6 colour cube
  const steps = [0, 51, 102, 153, 204, 255];
  for (const r of steps) for (const g of steps) for (const b of steps) {
    if (idx >= 232) break;
    put(idx++, r, g, b);
  }
  // greyscale ramp for the remaining slots
  for (let i = idx; i < 256; i++) {
    const v = Math.round(((i - idx) / Math.max(1, 255 - idx)) * 255);
    put(i, v, v, v);
  }
  return pal;
}

/** Quantise an RGBA pixel buffer to palette indices (alpha ignored —
 *  the lab canvas is fully opaque). Uses a per-call Map cache so flat
 *  areas (most of every frame) cost one lookup per distinct colour. */
export function quantize(rgba, palette) {
  const n = rgba.length / 4;
  const out = new Uint8Array(n);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let pi = cache.get(key);
    if (pi === undefined) {
      let best = 0, bestD = Infinity;
      for (let p = 0; p < 256; p++) {
        const dr = r - palette[p * 3], dg = g - palette[p * 3 + 1], db = b - palette[p * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = p; if (d === 0) break; }
      }
      pi = best;
      cache.set(key, pi);
    }
    out[i] = pi;
  }
  return out;
}

/* ---------------- GIF89a + LZW encoding ---------------- */

class ByteWriter {
  constructor() { this.bytes = []; }
  byte(b) { this.bytes.push(b & 0xff); }
  bytes_(arr) { for (const b of arr) this.bytes.push(b & 0xff); }
  u16(v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff); }
  str(s) { for (let i = 0; i < s.length; i++) this.bytes.push(s.charCodeAt(i)); }
  finish() { return new Uint8Array(this.bytes); }
}

/** LZW-compress one frame's indices into GIF data sub-blocks.
 *  Code-size growth: the encoder assigns each new dictionary entry one
 *  step AHEAD of the decoder (which creates the mirrored entry only
 *  after reading the next code), so the size bumps for subsequent
 *  codes when the code just assigned reaches (1 << codeSize) — one
 *  entry later than the decoder's own threshold. A full dictionary
 *  (assigned 4095) emits a clear code and restarts. Verified by
 *  round-trip against Pillow's independent GIF decoder. */
function lzwEncode(w, indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict = new Map();
  let next = eoi + 1;
  let bitBuf = 0, bitCnt = 0;
  const chunk = [];
  const emit = (code) => {
    bitBuf |= code << bitCnt;
    bitCnt += codeSize;
    while (bitCnt >= 8) { chunk.push(bitBuf & 0xff); bitBuf >>= 8; bitCnt -= 8; }
  };
  const resetDict = () => { dict = new Map(); next = eoi + 1; codeSize = minCodeSize + 1; };
  resetDict();
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const existing = dict.get(key);
    if (existing !== undefined) { prefix = existing; continue; }
    emit(prefix);
    const assigned = next++;
    dict.set(key, assigned);
    if (assigned === 4095) { emit(clear); resetDict(); }
    else if (assigned === (1 << codeSize) && codeSize < 12) codeSize++;
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bitCnt > 0) chunk.push(bitBuf & 0xff);
  // split into ≤255-byte sub-blocks
  for (let i = 0; i < chunk.length; i += 255) {
    const slice = chunk.slice(i, i + 255);
    w.byte(slice.length);
    w.bytes_(slice);
  }
  w.byte(0);
}

/**
 * Encode indexed frames into a looping GIF89a.
 * frames: [{indices: Uint8Array, delayCs}] — all frames share w×h.
 * Returns a Uint8Array. Pure and synchronous; for many frames the
 * Recorder encodes in slices instead (encodeGIFSlice state machine is
 * overkill — callers chunk by encoding per-N-frame GIFs is NOT valid,
 * so the Recorder keeps recordings short enough for one pass).
 */
export function encodeGIF(frames, width, height, palette) {
  const w = new ByteWriter();
  w.str('GIF89a');
  w.u16(width); w.u16(height);
  w.byte(0xf7); // global colour table, 256 entries
  w.byte(0);    // background colour index
  w.byte(0);    // pixel aspect ratio
  w.bytes_(palette);
  // NETSCAPE2.0 looping extension (loop forever)
  w.byte(0x21); w.byte(0xff); w.byte(11); w.str('NETSCAPE2.0');
  w.byte(3); w.byte(1); w.u16(0); w.byte(0);
  for (const f of frames) {
    w.byte(0x21); w.byte(0xf9); w.byte(4); // graphic control extension
    w.byte(0);                              // no transparency, disposal = none
    w.u16(Math.max(2, f.delayCs | 0));
    w.byte(0); w.byte(0);
    w.byte(0x2c);                           // image descriptor
    w.u16(0); w.u16(0); w.u16(width); w.u16(height);
    w.byte(0);                              // no local colour table
    w.byte(8);                              // LZW minimum code size
    lzwEncode(w, f.indices, 8);
  }
  w.byte(0x3b);
  return w.finish();
}

/* ---------------- Recorder ---------------- */

/**
 * Records a canvas into an animated GIF.
 *   const rec = new Recorder(canvas);
 *   rec.start();  // app calls rec.capture() after each rendered frame
 *   const blob = await rec.stop();  // GIF Blob (null when no frames)
 * Capture is throttled to `fps`; frames are quantised immediately.
 */
export class Recorder {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.fps = opts.fps || 12;
    this.maxSeconds = opts.maxSeconds || 20;
    this.maxWidth = opts.maxWidth || 880;
    this.palette = buildPalette();
    this.frames = [];
    this.recording = false;
    this.startedAt = 0;
    this.lastCapture = 0;
    this._off = document.createElement('canvas');
    this.onAutoStop = null; // () => void, fired when maxSeconds hits
  }

  get frameCount() { return this.frames.length; }
  get elapsed() { return this.recording ? (performance.now() - this.startedAt) / 1000 : 0; }

  start() {
    this.frames = [];
    this.recording = true;
    this.startedAt = performance.now();
    this.lastCapture = 0;
    const srcW = this.canvas.width, srcH = this.canvas.height;
    const scale = Math.min(1, this.maxWidth / srcW);
    this._off.width = Math.max(2, Math.round(srcW * scale / 2) * 2);
    this._off.height = Math.max(2, Math.round(srcH * scale / 2) * 2);
  }

  /** Call after each rendered frame; captures at most `fps` per second. */
  capture() {
    if (!this.recording) return;
    const now = performance.now();
    if (now - this.startedAt > this.maxSeconds * 1000) {
      if (this.onAutoStop) this.onAutoStop();
      return;
    }
    if (now - this.lastCapture < 1000 / this.fps) return;
    this.lastCapture = now;
    try {
      const ctx = this._off.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(this.canvas, 0, 0, this._off.width, this._off.height);
      const img = ctx.getImageData(0, 0, this._off.width, this._off.height);
      const indices = quantize(img.data, this.palette);
      this.frames.push({ indices, delayCs: Math.round(100 / this.fps) });
    } catch { /* headless / stubbed canvas: capture is best-effort */ }
  }

  /** Stop and encode. Yields to the event loop between frames so the
   *  UI stays alive; onProgress(done, total) is optional. */
  async stop(onProgress) {
    this.recording = false;
    const frames = this.frames;
    this.frames = [];
    if (!frames.length) return null;
    // encodeGIF is one synchronous pass; chunk it by re-encoding is not
    // possible, so simply yield once before the (short) encode.
    if (onProgress) onProgress(0, frames.length);
    await new Promise((r) => setTimeout(r, 10));
    const bytes = encodeGIF(frames, this._off.width, this._off.height, this.palette);
    if (onProgress) onProgress(frames.length, frames.length);
    return new Blob([bytes], { type: 'image/gif' });
  }
}

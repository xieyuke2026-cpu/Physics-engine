/* =========================================================================
   MotionLab — canvas video recording (1.52).

   Real-time capture of the stage canvas via captureStream +
   MediaRecorder. MP4 is preferred (WebKit/Safari records H.264 MP4
   natively; Chromium offers it on recent versions), WebM is the
   fallback. This is a SCREEN recording: it inherits the live frame
   rate, judder included. For frame-exact reproduction the
   deterministic replay (.replay.json) remains the lossless format —
   the two features complement each other (share vs verify).
   ========================================================================= */

/** MIME candidates in preference order. */
export const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** First candidate the platform accepts, or '' when none works. */
export function pickVideoMime(isTypeSupported) {
  for (const m of VIDEO_MIME_CANDIDATES) {
    try { if (isTypeSupported(m)) return m; } catch { /* keep looking */ }
  }
  return '';
}

/** Download extension for a recorder MIME type. */
export function videoExt(mime) {
  return typeof mime === 'string' && mime.includes('mp4') ? 'mp4' : 'webm';
}

/** True when this browser can record a canvas to video at all. */
export function videoSupported(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  return !!(w && w.MediaRecorder
    && w.HTMLCanvasElement && w.HTMLCanvasElement.prototype
    && typeof w.HTMLCanvasElement.prototype.captureStream === 'function');
}

/**
 * Create a recorder for a canvas. Returns null when unsupported.
 * onStop(blob, ext, mime) fires once, after stop() flushes.
 */
export function createVideoRecorder(canvas, { fps = 60, videoBitsPerSecond = 12_000_000, onStop } = {}) {
  if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') return null;
  const mime = pickVideoMime((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) return null;
  let rec;
  try {
    rec = new MediaRecorder(canvas.captureStream(fps), { mimeType: mime, videoBitsPerSecond });
  } catch { return null; }
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (onStop) onStop(blob, videoExt(mime), mime);
  };
  return {
    mime,
    get recording() { return rec.state === 'recording'; },
    start() { if (rec.state === 'inactive') rec.start(250); },
    stop() { if (rec.state !== 'inactive') rec.stop(); },
  };
}

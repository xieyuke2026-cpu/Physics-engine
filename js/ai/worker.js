/* MotionLab AI assistant — inference worker (1.50).
   Runs SmolLM2-360M-Instruct locally via Transformers.js (ONNX Runtime Web):
   WebGPU when available, WASM otherwise. The model (~390MB, q4) downloads
   once from a Hugging Face mirror and is cached by the browser; nothing is
   sent to any server at inference time. Loaded lazily, only when the user
   first talks to the assistant. */
import { pipeline, env, TextStreamer } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/+esm';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Leave CPU headroom for the 60 FPS lab while WASM inference runs.
if (env.backends?.onnx?.wasm && self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
// (Without cross-origin isolation there is no SharedArrayBuffer; asking the
//  WASM runtime for threads anyway hung session creation on iOS WebKit —
//  download sat at 100% forever, worker spinning, lab FPS in single digits.
//  Single-threaded WASM is the configuration verified end-to-end on desktop.)

const MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct';
const HOSTS = ['https://hf-mirror.com/', 'https://huggingface.co/'];
let generator = null;
let deviceUsed = null;

async function hasGpuAdapter() {
  // iOS/iPadOS WebKit: its WebGPU is brand new (iOS 26) and session creation
  // for this runtime killed the tab outright in Ryan's iPad test (page died
  // right after download, "ready" never shown). On Apple mobile WebKit we
  // deliberately take the proven WASM path instead.
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return false;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return false;
  try {
    if (!navigator.gpu) return false;
    const a = await navigator.gpu.requestAdapter();
    return !!a;
  } catch { return false; }
}

async function load(forceWasm) {
  let lastErr = null;
  // Probe first: requesting WebGPU without an adapter poisons the ORT
  // session state and even the WASM retry fails ("no available backend
  // found") — seen in the 1.50 live check. No adapter → straight to WASM.
  const devices = (!forceWasm && (await hasGpuAdapter())) ? ['webgpu', 'wasm'] : ['wasm'];
  for (const host of HOSTS) {
    env.remoteHost = host;
    for (const device of devices) {
      try {
        const gen = await pipeline('text-generation', MODEL, {
          device, dtype: 'q4',
          progress_callback: (p) => {
            if (p && p.status === 'progress' && p.file && p.file.endsWith('.onnx')) {
              postMessage({ type: 'progress', file: p.file, loaded: p.loaded || 0, total: p.total || 0 });
            } else if (p && p.status === 'ready') {
              postMessage({ type: 'progress', file: 'ready', loaded: 1, total: 1 });
            }
          },
        });
        generator = gen; deviceUsed = device;
        postMessage({ type: 'loaded', device });
        return;
      } catch (e) { lastErr = e; }
    }
  }
  postMessage({ type: 'loadError', error: String(lastErr && lastErr.message || lastErr || 'unknown') });
}

onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'load') { if (!generator) await load(!!msg.forceWasm); else postMessage({ type: 'loaded', device: deviceUsed }); return; }
  if (msg.type === 'chat') {
    if (!generator) { postMessage({ type: 'error', id: msg.id, error: 'model not loaded' }); return; }
    try {
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true, skip_special_tokens: true,
        callback_function: (t) => postMessage({ type: 'token', id: msg.id, text: t }),
      });
      const out = await generator(msg.messages, {
        max_new_tokens: 320, do_sample: true, temperature: 0.7, top_p: 0.9, streamer,
      });
      const gt = out && out[0] && out[0].generated_text;
      const text = Array.isArray(gt) ? String(gt[gt.length - 1]?.content || '') : String(gt || '');
      postMessage({ type: 'done', id: msg.id, text });
    } catch (e) {
      postMessage({ type: 'error', id: msg.id, error: String(e && e.message || e) });
    }
  }
};

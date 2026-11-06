/* MotionLab AI assistant — inference worker (1.50).
   Runs Qwen2.5-0.5B-Instruct locally via Transformers.js (ONNX Runtime Web):
   WebGPU when available, WASM otherwise. The model (~350MB, q4) downloads
   once from a Hugging Face mirror and is cached by the browser; nothing is
   sent to any server at inference time. Loaded lazily, only when the user
   first talks to the assistant. */
import { pipeline, env, TextStreamer } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/+esm';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
const HOSTS = ['https://hf-mirror.com/', 'https://huggingface.co/'];
let generator = null;
let deviceUsed = null;

async function load() {
  let lastErr = null;
  for (const host of HOSTS) {
    env.remoteHost = host;
    for (const device of ['webgpu', 'wasm']) {
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
  if (msg.type === 'load') { if (!generator) await load(); else postMessage({ type: 'loaded', device: deviceUsed }); return; }
  if (msg.type === 'chat') {
    if (!generator) { postMessage({ type: 'error', id: msg.id, error: 'model not loaded' }); return; }
    try {
      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true, skip_special_tokens: true,
        callback_function: (t) => postMessage({ type: 'token', id: msg.id, text: t }),
      });
      const out = await generator(msg.messages, {
        max_new_tokens: 420, do_sample: true, temperature: 0.7, top_p: 0.9, streamer,
      });
      const gt = out && out[0] && out[0].generated_text;
      const text = Array.isArray(gt) ? String(gt[gt.length - 1]?.content || '') : String(gt || '');
      postMessage({ type: 'done', id: msg.id, text });
    } catch (e) {
      postMessage({ type: 'error', id: msg.id, error: String(e && e.message || e) });
    }
  }
};

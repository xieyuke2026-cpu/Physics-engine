/* share.js — scene share links: a whole scene travels inside the URL hash.
   Payload format: the first character is the codec tag —
     'g' — scene JSON, UTF-8, gzip-compressed (CompressionStream), base64url
     'r' — scene JSON, UTF-8, raw base64url (fallback when CompressionStream
           is unavailable or compression fails)
   The payload rides in location.hash (#s=...), so it is never sent to a
   server and works on any static host. Decoding does NOT validate the
   scene — callers must run validateScene() on the result before use.
   Typical scenes compress to a few hundred characters; very large scenes
   can exceed what some chat apps tolerate in a link, which is a soft
   limit, not an error. */

function bytesToB64url(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64urlToBytes(text) {
  const b64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Scene object -> payload string ('g…' or 'r…'). */
export async function encodeScenePayload(scene) {
  const bytes = new TextEncoder().encode(JSON.stringify(scene));
  if (typeof CompressionStream !== 'undefined') {
    try { return 'g' + bytesToB64url(await gzipBytes(bytes)); } catch { /* fall through to raw */ }
  }
  return 'r' + bytesToB64url(bytes);
}

/** Payload string -> parsed scene object, or null on any failure. */
export async function decodeScenePayload(payload) {
  try {
    if (!payload || payload.length < 2) return null;
    const tag = payload[0];
    const bytes = b64urlToBytes(payload.slice(1));
    if (tag === 'g') {
      if (typeof DecompressionStream === 'undefined') return null;
      const raw = await gunzipBytes(bytes);
      return JSON.parse(new TextDecoder().decode(raw));
    }
    if (tag === 'r') return JSON.parse(new TextDecoder().decode(bytes));
    return null;
  } catch { return null; }
}

/** Extract the payload from a location.hash string, or null. */
export function payloadFromHash(hash) {
  const m = /^#s=([A-Za-z0-9\-_]+)$/.exec(typeof hash === 'string' ? hash : '');
  return m ? m[1] : null;
}

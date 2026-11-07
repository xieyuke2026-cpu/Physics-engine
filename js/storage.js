/* storage.js — localStorage persistence: named scenes, autosave, UI settings.
   All reads are defensive: corrupt data falls back instead of throwing. */

import { validateScene } from './scene.js';
import { validateScene3D } from './scene3d.js';

const KEY_SCENES = 'motionlab.scenes.v1';
const KEY_CHAL = 'motionlab.challenges.v1';
const KEY_AUTO = 'motionlab.autosave.v1';
const KEY_SCENES_3D = 'motionlab.scenes3d.v1';
const KEY_AUTO_3D = 'motionlab.autosave3d.v1';
const KEY_UI = 'motionlab.ui.v1';
const KEY_VISITED = 'motionlab.visited.v1';

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; } // quota / private mode — caller surfaces a toast
}

/** @returns {Object<string, object>} name -> sceneData */
export function loadScenes() {
  const obj = readJSON(KEY_SCENES);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [name, raw] of Object.entries(obj)) {
    const v = validateScene(raw);
    if (v.ok) out[name] = v.scene;
  }
  return out;
}

export function saveSceneToLibrary(scene) {
  const scenes = loadScenes();
  scenes[scene.name] = { ...scene, updatedAt: Date.now() };
  return writeJSON(KEY_SCENES, scenes);
}

export function deleteSceneFromLibrary(name) {
  const scenes = loadScenes();
  delete scenes[name];
  return writeJSON(KEY_SCENES, scenes);
}

export function renameSceneInLibrary(oldName, newName) {
  const scenes = loadScenes();
  if (!scenes[oldName] || scenes[newName]) return false;
  scenes[newName] = { ...scenes[oldName], name: newName, updatedAt: Date.now() };
  delete scenes[oldName];
  return writeJSON(KEY_SCENES, scenes);
}

export function saveAutosave(scene) { return writeJSON(KEY_AUTO, scene); }

export function loadAutosave() {
  const raw = readJSON(KEY_AUTO);
  if (!raw) return null;
  const v = validateScene(raw);
  return v.ok ? v.scene : null;
}

/* ---------------- 3D library (kept fully separate from 2D) ---------------- */
export function loadScenes3D() {
  const obj = readJSON(KEY_SCENES_3D);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [name, raw] of Object.entries(obj)) {
    const v = validateScene3D(raw);
    if (v.ok) out[name] = v.scene;
  }
  return out;
}

export function saveScene3DToLibrary(scene) {
  const scenes = loadScenes3D();
  scenes[scene.name] = { ...scene, updatedAt: Date.now() };
  return writeJSON(KEY_SCENES_3D, scenes);
}

export function deleteScene3DFromLibrary(name) {
  const scenes = loadScenes3D();
  delete scenes[name];
  return writeJSON(KEY_SCENES_3D, scenes);
}

export function renameScene3DInLibrary(oldName, newName) {
  const scenes = loadScenes3D();
  if (!scenes[oldName] || scenes[newName]) return false;
  scenes[newName] = { ...scenes[oldName], name: newName, updatedAt: Date.now() };
  delete scenes[oldName];
  return writeJSON(KEY_SCENES_3D, scenes);
}

export function saveAutosave3D(scene) { return writeJSON(KEY_AUTO_3D, scene); }

export function loadAutosave3D() {
  const raw = readJSON(KEY_AUTO_3D);
  if (!raw) return null;
  const v = validateScene3D(raw);
  return v.ok ? v.scene : null;
}

export function loadUISettings() {
  const obj = readJSON(KEY_UI);
  return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
}
export function saveUISettings(ui) { return writeJSON(KEY_UI, ui); }

/** First-run flag for the landing page: shown once, then the app opens directly. */
export function loadVisited() {
  try { return localStorage.getItem(KEY_VISITED) === '1'; } catch { return false; }
}
export function saveVisited() {
  try { localStorage.setItem(KEY_VISITED, '1'); } catch { /* private mode: landing reappears, harmless */ }
}
/** Factory reset: remove EVERY MotionLab key (2D + 3D libraries, both
 *  autosaves, UI prefs, visited flag) so the next boot is a true first run. */
export function resetAllData() {
  for (const key of [KEY_SCENES, KEY_AUTO, KEY_SCENES_3D, KEY_AUTO_3D, KEY_UI, KEY_VISITED]) {
    try { localStorage.removeItem(key); } catch {}
  }
}

/* ---------------- challenge progress (1.50) ----------------
 * { [challengeId]: {stars, bestPieces, bestSec} } — best values only ever
 * improve; stars keep the maximum earned. */
export function loadChallengeProgress() {
  const obj = readJSON(KEY_CHAL);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  return obj;
}

export function saveChallengeResult(id, { stars, pieces, sec }) {
  const all = loadChallengeProgress();
  const prev = all[id] || { stars: 0, bestPieces: null, bestSec: null };
  all[id] = {
    stars: Math.max(prev.stars || 0, stars || 0),
    bestPieces: prev.bestPieces == null ? pieces : Math.min(prev.bestPieces, pieces),
    bestSec: prev.bestSec == null ? sec : Math.min(prev.bestSec, sec),
  };
  return writeJSON(KEY_CHAL, all);
}

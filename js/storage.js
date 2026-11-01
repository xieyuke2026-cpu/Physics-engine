/* storage.js — localStorage persistence: named scenes, autosave, UI settings.
   All reads are defensive: corrupt data falls back instead of throwing. */

import { validateScene } from './scene.js';

const KEY_SCENES = 'motionlab.scenes.v1';
const KEY_AUTO = 'motionlab.autosave.v1';
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

export function clearAutosave() { try { localStorage.removeItem(KEY_AUTO); } catch {} }

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
export function clearVisited() { try { localStorage.removeItem(KEY_VISITED); } catch {} }

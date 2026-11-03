/* pf-lab.js — PFLab module entry and lifecycle.
   Two layers:
   - PFMatch: the whole game as pure logic (physics + characters + combat +
     AI + win/lose). No DOM — this is what the Node tests exercise.
   - PFLab: the DOM shell (overlay, loop, debug panel, result banner) that
     app.js enters and exits. Exiting cancels the loop, detaches every input
     listener and drops the physics world, leaving no residue behind. */

import { PFPhysics } from './pf-physics.js';
import { Character } from './pf-character.js';
import { Combat } from './pf-combat.js';
import { FighterAI } from './pf-ai.js';
import { PFRenderer } from './pf-renderer.js';
import { PFInput } from './pf-input.js';
import { PLATFORMS, SPAWNS, isBlasted } from './pf-stage.js';
import { STEP_MS, MAX_FRAME_MS, MAX_STEPS_PER_FRAME, DEBUG, PF_VERSION, WORLD, FIGHTER, ATTACK, AI, BLAST } from './pf-config.js';
import { t } from '../i18n.js';

export class PFMatch {
  /** @param {object} [opts] opts.ai: AI profile name or overrides for the dummy. */
  constructor(opts = {}) {
    this.aiProfile = opts.ai;
    this.reset();
  }

  reset() {
    this.physics = new PFPhysics();
    for (const p of PLATFORMS) this.physics.addPlatform(p);
    this.player = new Character(this.physics, 'player', SPAWNS[0]);
    this.dummy = new Character(this.physics, 'dummy', SPAWNS[1]);
    this.ai = new FighterAI(this.aiProfile);
    this.combat = new Combat();
    this.state = 'fight';      // 'fight' | 'over'
    this.winner = null;        // 'player' | 'dummy' | 'draw'
    this.paused = false;
    this.stepCount = 0;
    this.fx = [];
  }

  get lastHit() { return this.combat.lastHit; }

  /** Advance the match by one fixed step. Returns the step's events. */
  step(playerIntent) {
    if (this.state !== 'fight' || this.paused) return [];
    this.stepCount++;

    this.player.setIntent(playerIntent);
    this.dummy.setIntent(this.ai.think(this.dummy, this.player));

    this.player.preStep();
    this.dummy.preStep();
    this.physics.step();
    this.player.postStep();
    this.dummy.postStep();

    const events = this.combat.resolve(this.player, this.dummy, this.stepCount);
    for (const ev of events) this.fx.push({ x: ev.x, y: ev.y, step: ev.step });
    this.fx = this.fx.filter((s) => this.stepCount - s.step < 8);

    const losers = [];
    if (isBlasted(this.player.x, this.player.y)) losers.push('player');
    if (isBlasted(this.dummy.x, this.dummy.y)) losers.push('dummy');
    if (losers.length) {
      this.state = 'over';
      this.winner = losers.length === 2 ? 'draw' : losers[0] === 'player' ? 'dummy' : 'player';
      for (const id of losers) (id === 'player' ? this.player : this.dummy).state = 'ko';
      events.push({ type: 'ko', losers, winner: this.winner, step: this.stepCount });
    }
    return events;
  }

  debugInfo() {
    const f = (c) => ({
      state: c.state, damage: Math.round(c.damage),
      vx: c.vx, vy: c.vy, x: Math.round(c.x), y: Math.round(c.y),
      grounded: c.grounded,
    });
    return {
      player: f(this.player), dummy: f(this.dummy),
      aiState: this.ai.state, step: this.stepCount,
      lastHit: this.combat.lastHit,
    };
  }
}

/* ------------------------------ DOM shell ------------------------------ */

const $ = (id) => document.getElementById(id);

export class PFLab {
  constructor(onExit) {
    this.onExit = onExit;
    this.input = new PFInput();
    this.renderer = null;
    this.match = null;
    this._raf = 0;
    this._active = false;
    $('btnPFBack').addEventListener('click', () => this.exit());
    $('btnPFPause').addEventListener('click', () => this.togglePause());
    $('btnPFRestart').addEventListener('click', () => this.restart());
    $('btnPFRematch').addEventListener('click', () => this.restart());
    // Language switched mid-match: re-apply the dynamic labels applyI18n
    // cannot know about (pause state, match status, result banner).
    window.addEventListener('ml-lang', () => this._syncLang());
  }

  _syncLang() {
    if (!this.match) return;
    $('btnPFPause').textContent = this.match.paused ? t('pf.resume') : t('pf.pause');
    if (this.match.state === 'over') {
      this._setStatus(t('pf.over'));
      if (!$('pfResult').hidden) {
        const w = this.match.winner;
        $('pfResultText').textContent = w === 'draw' ? t('pf.draw') : w === 'player' ? t('pf.winPlayer') : t('pf.winAI');
      }
    } else {
      this._setStatus(this.match.paused ? t('pf.paused') : t('pf.fighting'));
    }
  }

  enter() {
    if (this._active) this._teardown();
    this.match = new PFMatch();
    if (!this.renderer) this.renderer = new PFRenderer($('pfCanvas'));
    this.input.attach();
    this.input.bindButton($('pfTLeft'), 'left');
    this.input.bindButton($('pfTRight'), 'right');
    this.input.bindButton($('pfTJump'), 'jump');
    this.input.bindButton($('pfTAttack'), 'attack');
    this.input.bindButton($('pfTDash'), 'dash');
    $('pfResult').hidden = true;
    $('btnPFPause').textContent = t('pf.pause');
    this._setStatus(t('pf.fighting'));
    $('pfLab').hidden = false;
    this._active = true;
    this._acc = 0;
    this._last = performance.now();
    this._fps = 60;
    this._frames = 0;
    this._raf = requestAnimationFrame(this._loop);
  }

  exit() {
    if (!this._active) return;
    this._teardown();
    this.onExit();
  }

  _teardown() {
    cancelAnimationFrame(this._raf);
    this.input.detach();
    if (this.match) this.match.physics.clear();
    this.match = null;
    $('pfLab').hidden = true;
    this._active = false;
  }

  togglePause() {
    if (!this.match || this.match.state !== 'fight') return;
    this.match.paused = !this.match.paused;
    $('btnPFPause').textContent = this.match.paused ? t('pf.resume') : t('pf.pause');
    this._setStatus(this.match.paused ? t('pf.paused') : t('pf.fighting'));
  }

  restart() {
    if (!this.match) return;
    this.match.reset();
    $('pfResult').hidden = true;
    $('btnPFPause').textContent = t('pf.pause');
    this._setStatus(t('pf.fighting'));
  }

  _setStatus(text) { $('pfStatus').textContent = text; }

  _loop = (ts) => {
    if (!this._active) return;
    this._raf = requestAnimationFrame(this._loop);
    const dt = ts - this._last;
    this._last = ts;
    if (dt > 0 && dt < 1000) this._fps += ((1000 / dt) - this._fps) * 0.05;
    this._acc += Math.min(Math.max(dt, 0), MAX_FRAME_MS);
    let n = 0;
    while (this._acc >= STEP_MS && n < MAX_STEPS_PER_FRAME) {
      const events = this.match.step(this.input.snapshot());
      this._acc -= STEP_MS;
      n++;
      if (events.some((e) => e.type === 'ko')) this._showResult();
    }
    if (n === MAX_STEPS_PER_FRAME) this._acc = 0;
    this.renderer.draw(this.match);
    this._frames++;
    if (this._frames % 4 === 0) this._updateDebug();
  };

  _showResult() {
    const w = this.match.winner;
    $('pfResultText').textContent = w === 'draw' ? t('pf.draw') : w === 'player' ? t('pf.winPlayer') : t('pf.winAI');
    $('pfResult').hidden = false;
    this._setStatus(t('pf.over'));
  }

  _updateDebug() {
    if (!this.match) return;
    const d = this.match.debugInfo();
    const vel = (v) => `${v.vx.toFixed(1)}, ${v.vy.toFixed(1)}`;
    $('pfDbgPState').textContent = `${d.player.state} · (${d.player.x}, ${d.player.y})`;
    $('pfDbgAState').textContent = `${d.dummy.state} · (${d.dummy.x}, ${d.dummy.y})`;
    $('pfDbgAIState').textContent = d.aiState;
    $('pfDbgPDmg').textContent = `${d.player.damage}%`;
    $('pfDbgADmg').textContent = `${d.dummy.damage}%`;
    $('pfDbgPVel').textContent = vel(d.player);
    $('pfDbgAVel').textContent = vel(d.dummy);
    $('pfDbgFps').textContent = `${Math.round(this._fps)} · step ${d.step}`;
    $('pfDbgHit').textContent = d.lastHit
      ? t('pf.hitLine', { step: d.lastHit.step, who: t(d.lastHit.attacker === 'player' ? 'pf.whoPlayer' : 'pf.whoAI'), dmg: Math.round(d.lastHit.damage), kb: d.lastHit.speed.toFixed(1) })
      : '—';
    if (this._frames % (4 * DEBUG.panelEverySteps) === 0) { /* panel cadence marker (writes above are cheap) */ }
  }
}

/* ------------------------- PFEngine facade -------------------------
   The public entry point for embedding the platform-fighter engine in
   another page or tool (see docs/DEVELOPER.md, "PF 引擎调用方式"):
   - createMatch(): a headless, DOM-free match you step yourself.
   - createLab():   the full-screen UI shell MotionLab itself uses.
   - tune():        adjust the shared tuning tables for future matches. */
export const PFEngine = {
  VERSION: PF_VERSION,
  createMatch(opts) { return new PFMatch(opts); },
  createLab(onExit) { return new PFLab(onExit); },
  /**
   * Merge partial overrides into the shared config tables, e.g.
   * PFEngine.tune({ attack: { damage: 9 }, ai: { decideEvery: 8 } }).
   * Sections: world / fighter / attack / ai / blast. Applies to matches
   * created afterwards (and to live reads of the same tables).
   */
  tune(patch = {}) {
    const tables = { world: WORLD, fighter: FIGHTER, attack: ATTACK, ai: AI, blast: BLAST };
    for (const [section, values] of Object.entries(patch)) {
      const table = tables[section];
      if (table && values && typeof values === 'object') Object.assign(table, values);
    }
  },
  config: { WORLD, FIGHTER, ATTACK, AI, BLAST },
  stage: { PLATFORMS, SPAWNS, isBlasted },
};

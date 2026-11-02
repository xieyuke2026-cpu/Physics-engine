/* pf-ai.js — the training dummy's brain: a deterministic finite-state
   machine, fully separated from rendering and from the character controller
   (it only produces the same intent objects a human player produces).

   States: idle / approach / attack / retreat / recover.
   Decisions are evaluated every `decideEvery` steps — never per frame and
   never randomly. Between decisions the previous intent is held (edge
   inputs fire only on the decision step itself). */

import { AI, AI_PROFILES } from './pf-config.js';
import { STAGE_SPAN, isOffStage } from './pf-stage.js';

const CENTER_X = (STAGE_SPAN.left + STAGE_SPAN.right) / 2;

export class FighterAI {
  /**
   * @param {string|object} [profile] an AI_PROFILES name ('calm' | 'normal'
   *   | 'sharp') or a partial AI override object. Merged over the AI defaults
   *   into this instance's own config — other fighters are unaffected.
   */
  constructor(profile) {
    const overrides = typeof profile === 'string' ? (AI_PROFILES[profile] || {}) : (profile || {});
    this.cfg = { ...AI, ...overrides };
    this.state = 'idle';
    this.stateT = 0;                    // steps left in the current state (retreat)
    this.decideIn = 0;                  // steps until the next evaluation
    this.atkCd = 0;                     // post-attack cooldown (steps)
    this.held = { move: 0, jump: false, attack: false, dash: false, face: 0 };
  }

  /**
   * Produce this step's intent for `self` fighting `foe`.
   * Called every step; re-evaluates the FSM on its decision cadence.
   */
  think(self, foe) {
    if (this.atkCd > 0) this.atkCd--;
    const out = { move: this.held.move, jump: false, attack: false, dash: false, face: this.held.face };
    if (self.state === 'hitstun' || self.state === 'ko') {
      this.state = 'idle';
      out.move = 0;
      return out;
    }
    if (this.decideIn > 0) {
      this.decideIn--;
      if (this.stateT > 0) this.stateT--;
      return out;
    }
    this.decideIn = this.cfg.decideEvery;
    this._decide(self, foe, out);
    this.held.move = out.move;
    this.held.face = out.face;
    return out;
  }

  _decide(self, foe, out) {
    const dx = foe.x - self.x;
    const dy = foe.y - self.y;
    const adx = Math.abs(dx);
    const towardFoe = dx > 0 ? 1 : -1;

    // 1) Survival first: off stage or knocked below it → recover.
    if (isOffStage(self.x, self.y) || (!self.grounded && self.y > STAGE_SPAN.top + 10)) {
      this.state = 'recover';
      const towardCenter = self.x < CENTER_X ? 1 : -1;
      out.move = towardCenter;
      out.face = towardCenter;
      const distToEdge = self.x < CENTER_X ? self.x - STAGE_SPAN.left : STAGE_SPAN.right - self.x;
      if (self.y > STAGE_SPAN.top - 30 && self.jumpsUsed < 2) out.jump = true; // below the lip: spend a jump
      if (Math.abs(distToEdge) > 130 && self.dashCooldown <= 0 && !self.grounded) out.dash = true;
      return;
    }

    // 2) Retreat timer already running: keep backing off unless cornered.
    if (this.state === 'retreat' && this.stateT > 0) {
      const retreatDir = -towardFoe;
      const distBehind = retreatDir < 0 ? self.x - STAGE_SPAN.left : STAGE_SPAN.right - self.x;
      if (distBehind < this.cfg.edgeMargin) {
        this.state = 'approach'; // cornered: stop retreating
      } else {
        out.move = retreatDir;
        out.face = towardFoe;
        return;
      }
    }

    // 3) In range and able → attack (subject to the post-attack cooldown).
    if (adx <= this.cfg.attackRangeX && Math.abs(dy) <= this.cfg.attackRangeY && !self.attacking && this.atkCd <= 0) {
      this.state = 'attack';
      this.atkCd = this.cfg.attackCooldown;
      out.move = 0;
      out.face = towardFoe;
      out.attack = true;
      return;
    }

    // 4) Hurt and pressured → start retreating.
    if (self.damage >= this.cfg.retreatDamage && adx < 120 && self.grounded) {
      this.state = 'retreat';
      this.stateT = this.cfg.retreatSteps;
      out.move = -towardFoe;
      out.face = towardFoe;
      return;
    }

    // 5) Otherwise close the distance (chasing a higher foe means jumping).
    if (adx > this.cfg.attackRangeX * 0.75 || Math.abs(dy) > this.cfg.attackRangeY) {
      this.state = 'approach';
      out.move = towardFoe;
      out.face = towardFoe;
      if (dy < -70 && self.grounded) out.jump = true;
      return;
    }

    // 6) In range but on attack cooldown → hold position, keep facing the foe.
    this.state = 'idle';
    out.move = 0;
    out.face = towardFoe;
  }
}

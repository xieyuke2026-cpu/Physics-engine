/* pf-combat.js — attack resolution between two fighters.
   Attacks use a dedicated hitbox (never body contact): while the attacker's
   attack is in its active window, the hitbox rectangle is tested against the
   victim's body rectangle. Each attack (unique attackId) can hit a given
   victim at most once. Knockback grows with the victim's accumulated
   damage: speed = base + growth * damageAfter. */

import { ATTACK } from './pf-config.js';

function overlap(a, b) {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

export class Combat {
  constructor() {
    this.lastHit = null; // { step, attacker, victim, damage, speed }
  }

  /** Resolve both directions; returns hit events (possibly empty). */
  resolve(a, b, step) {
    const events = [];
    this._tryHit(a, b, step, events);
    this._tryHit(b, a, step, events);
    return events;
  }

  _tryHit(attacker, victim, step, events) {
    const hb = attacker.hitbox();
    if (!hb) return;
    if (victim.lastHitAttackId === attacker.attackId) return; // one hit per attack
    if (!overlap(hb, victim.rect())) return;
    victim.lastHitAttackId = attacker.attackId;
    const damageAfter = victim.damage + ATTACK.damage;
    const speed = ATTACK.baseKnockback + ATTACK.knockbackGrowth * damageAfter;
    const dirX = attacker.facing >= 0 ? 1 : -1;
    victim.applyHit({ damage: ATTACK.damage, dirX, speed });
    const ev = {
      type: 'hit', step,
      attacker: attacker.id, victim: victim.id,
      damage: damageAfter, speed,
      x: victim.x, y: victim.y - 10,
    };
    this.lastHit = ev;
    events.push(ev);
  }
}

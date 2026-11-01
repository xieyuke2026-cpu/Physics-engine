/* pf-character.js — fighter controller.
   The body lives in the physics engine, but ALL movement decisions are made
   here: the controller writes velocities before each fixed step and reads
   the resulting pose back afterwards. Ground detection probes the engine
   below the feet (two points, swept when falling fast); jumping supports
   coyote time and input buffering; dashing and hitstun are timed states.
   Intents are plain data: { move: -1|0|1, face?, jump, attack, dash } where
   jump/attack/dash are edge-triggered ("pressed this step"). */

import { FIGHTER, ATTACK } from './pf-config.js';

let attackSeq = 0;

export class Character {
  constructor(physics, id, spawn) {
    this.physics = physics;
    this.id = id;
    this.spawn = spawn;
    this.body = physics.addFighter(id, spawn);
    this.intent = { move: 0, jump: false, attack: false, dash: false };
    this.reset();
  }

  reset() {
    this.physics.setPosition(this.body, this.spawn.x, this.spawn.y);
    this.physics.setVelocity(this.body, 0, 0);
    this.facing = this.spawn.facing;
    this.damage = 0;
    this.x = this.spawn.x; this.y = this.spawn.y; this.vx = 0; this.vy = 0;
    this.grounded = false;
    this.coyote = 0;
    this.jumpsUsed = 0;
    this.jumpBuffer = 0;
    this.dashT = 0;
    this.dashCooldown = 0;
    this.attackT = 0;          // 0 = not attacking; otherwise steps since attack start
    this.attackId = 0;         // unique per attack, prevents multi-hits
    this.lastHitAttackId = 0;  // last attack that connected on this fighter
    this.hitstun = 0;
    this.state = 'air';
    this.landedSteps = 0;      // steps spent grounded (diagnostics)
  }

  setIntent(intent) { this.intent = intent || this.intent; }

  get attacking() { return this.attackT > 0; }

  attackPhase() {
    if (!this.attacking) return null;
    if (this.attackT <= ATTACK.startup) return 'startup';
    if (this.attackT <= ATTACK.startup + ATTACK.active) return 'active';
    return 'recovery';
  }

  /** Controller decisions + velocity writes. Runs BEFORE the physics step. */
  preStep() {
    this._prevFeet = this.y + FIGHTER.height / 2;
    const it = this.intent;
    let vx = this.vx;
    let vy = this.vy;
    let vySet = false;

    if (this.dashCooldown > 0) this.dashCooldown--;
    if (this.jumpBuffer > 0) this.jumpBuffer--;

    if (this.hitstun > 0) {
      this.hitstun--;
      vx = this.vx * FIGHTER.hitstunDrag; // knockback decays, no control
      this.physics.setVelocity(this.body, vx, vy);
      return;
    }

    if (this.attacking) {
      this.attackT++;
      if (this.attackT > ATTACK.startup + ATTACK.active + ATTACK.recovery) this.attackT = 0;
    }

    if (this.dashT > 0) {
      // Dash: fixed burst, gravity suspended, direction locked.
      this.dashT--;
      this.physics.setVelocity(this.body, this.facing * FIGHTER.dashSpeed, 0);
      return;
    }

    // Facing follows movement intent (or an explicit face hint from the AI).
    if (it.move !== 0) this.facing = it.move > 0 ? 1 : -1;
    else if (it.face) this.facing = it.face;

    // Horizontal movement: snappy on the ground, driftier in the air.
    if (this.attacking && this.grounded) {
      vx = 0; // rooted during a grounded attack
    } else if (!this.attacking) {
      const target = it.move * FIGHTER.moveSpeed;
      const k = this.grounded ? FIGHTER.groundAccel : FIGHTER.airAccel;
      vx = this.vx + (target - this.vx) * k;
    }

    // Jumping: buffer the press, spend coyote time before the double jump.
    if (it.jump) this.jumpBuffer = FIGHTER.jumpBufferSteps;
    if (this.jumpBuffer > 0 && !this.attacking) {
      if (this.grounded || this.coyote > 0) {
        vy = -FIGHTER.jumpVel; vySet = true;
        this.jumpsUsed = 1; this.jumpBuffer = 0; this.coyote = 0; this.grounded = false;
      } else if (this.jumpsUsed < FIGHTER.maxJumps) {
        vy = -FIGHTER.doubleJumpVel; vySet = true;
        this.jumpsUsed++; this.jumpBuffer = 0;
      }
    }

    // Dash start.
    if (it.dash && this.dashCooldown <= 0 && !this.attacking) {
      this.dashT = FIGHTER.dashSteps;
      this.dashCooldown = FIGHTER.dashSteps + FIGHTER.dashCooldown;
      this.physics.setVelocity(this.body, this.facing * FIGHTER.dashSpeed, 0);
      return;
    }

    // Attack start.
    if (it.attack && !this.attacking) {
      this.attackT = 1;
      this.attackId = ++attackSeq;
    }

    this.physics.setVelocity(this.body, vx, vySet ? vy : this.vy);
  }

  /** Read back the pose and refresh grounding/state. Runs AFTER the physics step. */
  postStep() {
    const p = this.physics.pose(this.body);
    this.x = p.x; this.y = p.y; this.vx = p.vx; this.vy = p.vy;

    // One-way platforms first: a successful landing snap is also grounding.
    const ow = this.physics.tryOneWayLand(
      this.body, this._prevFeet ?? this.y + FIGHTER.height / 2,
      FIGHTER.height / 2, FIGHTER.width / 2,
    );
    if (ow) {
      this.y = ow.top - FIGHTER.height / 2;
      this.vy = 0;
    }

    const wasGrounded = this.grounded;
    this.grounded = ow ? true : this._probeGround();
    if (this.grounded) {
      this.coyote = FIGHTER.coyoteSteps;
      this.jumpsUsed = 0;
      this.landedSteps++;
    } else if (wasGrounded) {
      this.landedSteps = 0;
    } else if (this.coyote > 0) {
      this.coyote--;
      if (this.coyote === 0 && this.jumpsUsed === 0) this.jumpsUsed = 1; // ledge walk-off spends the ground jump
    }

    if (this.hitstun > 0) this.state = 'hitstun';
    else if (this.attacking) this.state = 'attack';
    else if (this.dashT > 0) this.state = 'dash';
    else if (!this.grounded) this.state = 'air';
    else if (Math.abs(this.vx) > 0.3) this.state = 'run';
    else this.state = 'idle';
  }

  _probeGround() {
    if (this.vy < -1) return false; // moving up fast: never grounded
    const feet = this.y + FIGHTER.height / 2;
    const inset = FIGHTER.width / 2 - 5;
    // Swept probes so a fast fall cannot skip past the check between steps.
    const reach = Math.max(3, Math.min(14, this.vy));
    for (let d = 2; d <= reach + 2; d += 3) {
      if (this.physics.probePlatform(this.x - inset, feet + d)) return true;
      if (this.physics.probePlatform(this.x + inset, feet + d)) return true;
    }
    return false;
  }

  /**
   * Take a hit: accumulate damage, launch with damage-scaled knockback and
   * enter hitstun. Cancels any attack/dash in progress.
   */
  applyHit({ damage, dirX, speed }) {
    this.damage += damage;
    this.attackT = 0;
    this.dashT = 0;
    const kb = speed;
    this.physics.setVelocity(this.body, dirX * kb, -kb * ATTACK.knockbackUpRatio);
    this.vx = dirX * kb; this.vy = -kb * ATTACK.knockbackUpRatio;
    this.hitstun = Math.min(
      ATTACK.hitstunMax,
      Math.round(ATTACK.hitstunBase + this.damage * ATTACK.hitstunPerDamage),
    );
    this.grounded = false;
  }

  /** Current attack hitbox in world space, or null when not in the active window. */
  hitbox() {
    if (this.attackPhase() !== 'active') return null;
    const w = ATTACK.hitboxW, h = ATTACK.hitboxH;
    const cx = this.x + this.facing * (FIGHTER.width / 2 + ATTACK.reach + w / 2);
    return { x: cx, y: this.y, w, h };
  }

  /** Body rectangle in world space (for hit tests and rendering). */
  rect() {
    return { x: this.x, y: this.y, w: FIGHTER.width, h: FIGHTER.height };
  }
}

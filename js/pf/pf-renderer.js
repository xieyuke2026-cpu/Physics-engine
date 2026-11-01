/* pf-renderer.js — PFLab canvas rendering (Canvas 2D, flat lab styling).
   Reads plain match state only; knows nothing about game rules. World
   coordinates are the stage's 960x540 space; the canvas backing store is
   scaled by devicePixelRatio for sharpness on retina/iPad screens. */

import { PLATFORMS } from './pf-stage.js';
import { WORLD, FIGHTER, DEBUG } from './pf-config.js';

const COL = {
  bg: '#fafafa', grid: '#eeeeef',
  platformFill: '#ffffff', platformEdge: '#c9ccd1', platformTop: '#9db8d2',
  oneWayFill: '#f2f5f8',
  player: '#2f6db3', playerFill: '#e8f0f8',
  dummy: '#55585e', dummyFill: '#f0f0f1',
  text: '#26282c', hit: '#b3402f',
  hitboxFill: 'rgba(47,109,179,.16)', hitboxEdge: '#2f6db3',
};

export class PFRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    canvas.width = WORLD.width * dpr;
    canvas.height = WORLD.height * dpr;
    this.dpr = dpr;
  }

  draw(match) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    this._grid();
    for (const p of PLATFORMS) this._platform(p);
    this._fighter(match.dummy, COL.dummy, COL.dummyFill);
    this._fighter(match.player, COL.player, COL.playerFill);
    if (DEBUG.showHitboxes) {
      this._hitbox(match.player);
      this._hitbox(match.dummy);
    }
    this._fx(match);
    if (match.paused && match.state === 'fight') {
      ctx.fillStyle = 'rgba(250,250,250,.55)';
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.fillStyle = COL.text;
      ctx.font = '600 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已暂停', WORLD.width / 2, WORLD.height / 2);
    }
  }

  _grid() {
    const { ctx } = this;
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < WORLD.width; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.height); }
    for (let y = 40; y < WORLD.height; y += 40) { ctx.moveTo(0, y); ctx.lineTo(WORLD.width, y); }
    ctx.stroke();
  }

  _platform(p) {
    const { ctx } = this;
    const x = p.x - p.w / 2, y = p.y - p.h / 2;
    ctx.fillStyle = p.oneWay ? COL.oneWayFill : COL.platformFill;
    ctx.strokeStyle = COL.platformEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x, y, p.w, p.h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COL.platformTop;
    ctx.fillRect(x, y, p.w, 3);
  }

  _fighter(f, edge, fill) {
    if (f.state === 'ko') return;
    const { ctx } = this;
    const w = FIGHTER.width, h = FIGHTER.height;
    const x = f.x - w / 2, y = f.y - h / 2;

    // Dash ghosts.
    if (f.state === 'dash') {
      ctx.fillStyle = 'rgba(47,109,179,.12)';
      for (let i = 1; i <= 2; i++) ctx.fillRect(x - f.facing * i * 14, y, w, h);
    }
    // Body.
    ctx.fillStyle = fill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x, y + 12, w, h - 12);
    ctx.fill();
    ctx.stroke();
    // Head.
    ctx.beginPath();
    ctx.arc(f.x, y + 10, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Facing eye.
    ctx.fillStyle = edge;
    ctx.fillRect(f.x + f.facing * 4 - 1.5, y + 8, 3, 3);
    // Hitstun flash.
    if (f.state === 'hitstun') {
      ctx.fillStyle = 'rgba(179,64,47,.18)';
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    }
    // Damage percent above the head.
    const dmg = Math.round(f.damage);
    ctx.font = '700 13px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = dmg >= 100 ? COL.hit : dmg >= 50 ? '#8a6d1f' : COL.text;
    ctx.fillText(`${dmg}%`, f.x, y - 8);
  }

  _hitbox(f) {
    const hb = f.hitbox();
    if (!hb) return;
    const { ctx } = this;
    ctx.fillStyle = COL.hitboxFill;
    ctx.strokeStyle = COL.hitboxEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(hb.x - hb.w / 2, hb.y - hb.h / 2, hb.w, hb.h);
    ctx.fill();
    ctx.stroke();
  }

  _fx(match) {
    const { ctx } = this;
    for (const s of match.fx) {
      const age = match.stepCount - s.step;
      const a = Math.max(0, 1 - age / 8);
      ctx.strokeStyle = `rgba(179,64,47,${(a * 0.85).toFixed(2)})`;
      ctx.lineWidth = 2;
      const r = 8 + age * 2.2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + 0.4;
        ctx.moveTo(s.x + Math.cos(ang) * r * 0.4, s.y + Math.sin(ang) * r * 0.4);
        ctx.lineTo(s.x + Math.cos(ang) * r, s.y + Math.sin(ang) * r);
      }
      ctx.stroke();
    }
  }
}

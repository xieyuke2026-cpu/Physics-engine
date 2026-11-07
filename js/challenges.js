/* =========================================================================
   MotionLab — challenge mode (1.50).

   A challenge is a fixed setup scene plus a goal: move the target body
   (or any body you added) into the dashed goal zone and keep it there
   briefly, using at most `budget` added bodies, inside `timeSec`.
   Setup bodies are locked; only the player's own pieces can be edited.
   Stars: 1 for finishing, +1 for finishing within the piece par, +1 for
   finishing within the time par. This module is DOM-free (definitions,
   goal tracking, star maths) and unit-tested; the app owns the flow.
   ========================================================================= */

import { sceneData, bodyData, fluidData, windData, frameBodies } from './scene.js';

const GROUND = 540; // stage ground top (frameBodies convention)

/** Reusable goal tracker: counts consecutive steps inside the zone. */
export class GoalTracker {
  constructor(holdSteps) {
    this.holdSteps = Math.max(1, Math.floor(holdSteps) || 30);
    this.count = 0;
  }
  reset() { this.count = 0; }
  /** Feed one step's inside/outside; returns true once the hold completes. */
  update(inside) {
    this.count = inside ? this.count + 1 : 0;
    return this.count >= this.holdSteps;
  }
}

export function pointInZone(x, y, zone) {
  return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
}

/** 1 star for the win, +1 at/under the piece par, +1 at/under the time par. */
export function starsFor(pieces, sec, par) {
  let s = 1;
  if (par && pieces <= par.pieces) s++;
  if (par && sec <= par.sec) s++;
  return s;
}

function frameMinusGround() {
  return frameBodies().filter((b) => b.id !== 'bound-ground');
}
function groundSeg(id, x, w) {
  return bodyData({ id, type: 'rectangle', x, y: 560, width: w, height: 40, isStatic: true, isBound: true, friction: 0.6, label: 'Ground' });
}
function targetBall(x, y, extra = {}) {
  return bodyData({ id: 'chal-target', type: 'circle', x, y, radius: 18, restitution: 0.3, friction: 0.08, frictionAir: 0.001, label: '目标球 Target', ...extra });
}
function lip(x, y, w, h) {
  return bodyData({ type: 'rectangle', x, y, width: w, height: h, isStatic: true, friction: 0.4, label: '挡块 Stop' });
}

export const CHALLENGES = [
  {
    id: 'rollin',
    title: { zh: '滚进家门', en: 'Roll Home' },
    brief: {
      zh: '小球会顺坡滚下来，但半路有一堵矮墙。用最多 3 块木板搭个坡，让它翻过墙、停进右侧的虚线区。',
      en: 'The ball rolls down the ramp but a low wall blocks its way. Use up to 3 planks to get it over the wall and settled in the dashed zone on the right.',
    },
    budget: 3, timeSec: 60, holdSteps: 30, goalKind: 'target', targetId: 'chal-target',
    zone: { x: 1020, y: 440, w: 180, h: 100 },
    par: { pieces: 2, sec: 25 },
    build() {
      const bodies = frameBodies();
      bodies.push(bodyData({ type: 'rectangle', x: 300, y: 430, width: 420, height: 14, angle: 0.18, isStatic: true, friction: 0.15, label: '斜坡 Ramp' }));
      bodies.push(bodyData({ type: 'rectangle', x: 760, y: 500, width: 24, height: 80, isStatic: true, friction: 0.4, label: '矮墙 Wall' }));
      bodies.push(lip(1014, 527, 12, 26));
      bodies.push(targetBall(170, 350, { radius: 20 }));
      return sceneData({ name: '挑战 · 滚进家门', bodies });
    },
  },
  {
    id: 'bridge',
    title: { zh: '断桥', en: 'Broken Bridge' },
    brief: {
      zh: '小球正滚向一道 280 宽的断口。用最多 4 块木板把桥搭上，让它安全到达对岸的虚线区——掉进坑里就失败。',
      en: 'The ball is rolling toward a 280-wide gap. Bridge it with up to 4 planks and reach the dashed zone on the far side — falling into the pit fails the run.',
    },
    budget: 4, timeSec: 60, holdSteps: 30, goalKind: 'target', targetId: 'chal-target', lostY: 660,
    zone: { x: 1060, y: 440, w: 160, h: 100 },
    par: { pieces: 3, sec: 20 },
    build() {
      const bodies = frameMinusGround();
      bodies.push(groundSeg('ground-l', 270, 460));
      bodies.push(groundSeg('ground-r', 1010, 460));
      bodies.push(bodyData({ id: 'pit-floor', type: 'rectangle', x: 640, y: 706, width: 300, height: 24, isStatic: true, isBound: true, friction: 0.6, label: '坑底 Pit' }));
      bodies.push(lip(1052, 528, 12, 24));
      bodies.push(targetBall(150, 500, { vx: 4, friction: 0.04 }));
      return sceneData({ name: '挑战 · 断桥', bodies });
    },
  },
  {
    id: 'tower',
    title: { zh: '叠高高', en: 'Stack Up' },
    brief: {
      zh: '在平台上用最多 6 个物体叠高，让任意一个你放的物体稳稳停进上方蓝色带区（停满 1 秒）。',
      en: 'Stack up to 6 pieces on the platform so that one of YOUR pieces rests inside the high band for a full second.',
    },
    budget: 6, timeSec: 90, holdSteps: 60, goalKind: 'anyAdded',
    zone: { x: 520, y: 110, w: 240, h: 80 },
    par: { pieces: 5, sec: 45 },
    build() {
      const bodies = frameBodies();
      bodies.push(bodyData({ type: 'rectangle', x: 640, y: 524, width: 200, height: 32, isStatic: true, friction: 0.6, label: '平台 Platform' }));
      return sceneData({ name: '挑战 · 叠高高', bodies });
    },
  },
  {
    id: 'tailwind',
    title: { zh: '顺风车', en: 'Tailwind' },
    brief: {
      zh: '轻球会被风场往右吹，但落点离收集箱还差一截。用最多 3 个物体给它续程或导向，让它落进右侧箱子里。',
      en: 'The wind carries the light ball right, but not quite far enough. Use up to 3 pieces to extend or steer its flight into the bin on the right.',
    },
    budget: 3, timeSec: 60, holdSteps: 30, goalKind: 'target', targetId: 'chal-target',
    zone: { x: 1040, y: 440, w: 170, h: 100 },
    par: { pieces: 2, sec: 25 },
    build() {
      const bodies = frameBodies();
      bodies.push(bodyData({ type: 'rectangle', x: 210, y: 300, width: 200, height: 14, isStatic: true, friction: 0.05, label: '跳台 Ledge' }));
      bodies.push(lip(1032, 505, 14, 70));
      bodies.push(targetBall(250, 268, { density: 0.0004, frictionAir: 0.01, friction: 0.05 }));
      return sceneData({
        name: '挑战 · 顺风车', bodies,
        winds: [windData({ x: 575, y: 320, width: 750, height: 260, vx: 5, vy: 0, power: 1, gust: 0 })],
      });
    },
  },
  {
    id: 'magnet',
    title: { zh: '磁引力', en: 'Magnet Pull' },
    brief: {
      zh: '铁球（负极）躺在冰面上。用磁铁工具放最多 3 块磁石，把它吸到右侧的虚线区——磁石可以开「直拖静态」滑着走，牵着球走也行。',
      en: 'The iron ball (negative pole) rests on ice. Place up to 3 magnets to pull it into the zone on the right — arm "drag static" on a magnet and slide it to walk the ball over.',
    },
    budget: 3, timeSec: 75, holdSteps: 30, goalKind: 'target', targetId: 'chal-target',
    zone: { x: 1020, y: 450, w: 170, h: 90 },
    par: { pieces: 2, sec: 35 },
    build() {
      const bodies = frameBodies();
      bodies.push(bodyData({ type: 'rectangle', x: 640, y: 532, width: 1100, height: 16, isStatic: true, friction: 0.01, label: '冰面 Ice' }));
      bodies.push(lip(1012, 525, 12, 30));
      bodies.push(targetBall(240, 500, { radius: 16, magnet: -100, density: 0.004, friction: 0.02, frictionAir: 0.001, label: '铁球 Iron Ball' }));
      return sceneData({ name: '挑战 · 磁引力', bodies });
    },
  },
  {
    id: 'funnel',
    title: { zh: '漏斗归位', en: 'Funnel Home' },
    brief: {
      zh: '小球从左上方落下，偏离了漏斗口。用最多 2 个物体把它导进漏斗，让它掉进正中间的格子。',
      en: 'The ball drops from the upper left, missing the funnel mouth. Guide it in with up to 2 pieces so it lands in the centre bin.',
    },
    budget: 2, timeSec: 60, holdSteps: 30, goalKind: 'target', targetId: 'chal-target',
    zone: { x: 596, y: 450, w: 88, h: 90 },
    par: { pieces: 1, sec: 20 },
    build() {
      const bodies = frameBodies();
      bodies.push(bodyData({ type: 'line', x: 522, y: 257, width: 241, height: 6, angle: 0.697, isStatic: true, friction: 0.1, label: '漏斗 Funnel' }));
      bodies.push(bodyData({ type: 'line', x: 758, y: 257, width: 241, height: 6, angle: -0.697, isStatic: true, friction: 0.1, label: '漏斗 Funnel' }));
      bodies.push(bodyData({ type: 'rectangle', x: 590, y: 495, width: 12, height: 90, isStatic: true, friction: 0.3, label: '隔板 Divider' }));
      bodies.push(bodyData({ type: 'rectangle', x: 690, y: 495, width: 12, height: 90, isStatic: true, friction: 0.3, label: '隔板 Divider' }));
      bodies.push(targetBall(300, 110, { radius: 16, vx: 2.2 }));
      return sceneData({ name: '挑战 · 漏斗归位', bodies });
    },
  },
];

export function challengeById(id) {
  return CHALLENGES.find((c) => c.id === id) || null;
}

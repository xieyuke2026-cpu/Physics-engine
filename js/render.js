/* render.js — custom canvas renderer + camera.
   Draws the fine grid, bodies (flat scientific style), selection highlight and
   optional velocity vectors. No DOM rebuilding: one canvas, redrawn per frame. */

import { getLang } from './i18n.js';

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.zoom = 1; }
  worldToScreen(wx, wy, view) { return { x: (wx - this.x) * this.zoom + view.w / 2, y: (wy - this.y) * this.zoom + view.h / 2 }; }
  screenToWorld(sx, sy, view) { return { x: (sx - view.w / 2) / this.zoom + this.x, y: (sy - view.h / 2) / this.zoom + this.y }; }
  /** Frame the default world area (0..1280 x 0..620) inside the view. */
  fit(view) {
    const zw = view.w / 1340, zh = view.h / 700;
    this.zoom = Math.max(0.3, Math.min(zw, zh));
    this.x = 640; this.y = 300;
  }
  clampZoom() { this.zoom = Math.max(0.2, Math.min(3.5, this.zoom)); }
}

const COLORS = {
  dynamic: '#ffffff', dynamicEdge: '#3c4046',
  circle: '#eef4fa', polygon: '#f2f2f3',
  static: '#e9e9ec', staticEdge: '#9a9da3',
  bound: '#dedee2', boundEdge: '#a7aab0',
  accent: '#2f6db3', danger: '#b3402f',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = new Camera();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view = { w: 0, h: 0 };
    this.trails = new Map();   // dataId -> [{x,y}...] recent centre positions
    this._segs = [];           // reusable constraint-segment buffer (no per-frame alloc)
    this._alive = new Set();   // reusable set for trail bookkeeping
    this._frameBodies = [];    // reusable per-frame body list (no copy-out per frame)
  }

  clearTrails() { this.trails.clear(); }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.view = { w: Math.max(50, r.width), h: Math.max(50, r.height) };
    this.canvas.width = Math.round(this.view.w * this.dpr);
    this.canvas.height = Math.round(this.view.h * this.dpr);
  }

  draw(world, opts) {
    const { ctx, view, camera } = this;
    const { selectedId = null, selectedFluidId = null, selectedWindId = null, showGrid = true, showVectors = false, showTrails = false, preview = null, dragPoint = null, springPreview = null, blast = null } = opts;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, view.w, view.h);
    if (showGrid) this._grid();
    ctx.save();
    ctx.translate(view.w / 2, view.h / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    ctx.lineJoin = 'round';

    // fluid regions sit behind everything else (drawn first, under bodies)
    if (typeof world.forEachFluid === 'function') {
      world.forEachFluid((f) => this._fluid(f, f.id === selectedFluidId));
    } else if (typeof world.fluids === 'function') {
      for (const f of world.fluids()) this._fluid(f, f.id === selectedFluidId);
    }
    // wind regions share the back layer (above fluids, still under bodies)
    if (typeof world.forEachWind === 'function') {
      world.forEachWind((w) => this._wind(w, w.id === selectedWindId));
    } else if (typeof world.winds === 'function') {
      for (const w of world.winds()) this._wind(w, w.id === selectedWindId);
    }
    // fetch the body list ONCE per frame into a reused array (allBodies()
    // copies; this allocates nothing and trails/vectors reuse the list)
    const bodies = this._frameBodies;
    bodies.length = 0;
    if (typeof world.forEachBody === 'function') world.forEachBody((b) => bodies.push(b));
    else for (const b of world.allBodies()) bodies.push(b);
    if (showTrails) this._trails(world, bodies);
    else if (this.trails.size) this.trails.clear();
    for (const seg of world.constraintSegments(this._segs)) this._spring(seg);
    // viewport culling: skip bodies fully outside the visible world rect
    const tl = camera.screenToWorld(0, 0, view);
    const br = camera.screenToWorld(view.w, view.h, view);
    const pad = 40;
    for (const body of bodies) {
      const b = body.bounds;
      if (b.max.x < tl.x - pad || b.min.x > br.x + pad || b.max.y < tl.y - pad || b.min.y > br.y + pad) continue;
      this._body(body, world, selectedId);
    }
    if (blast) {
      // expanding shockwave ring (blast.age in seconds, drawn for ~0.35s)
      const t = Math.min(1, blast.age / 0.35);
      ctx.beginPath();
      ctx.arc(blast.x, blast.y, 20 + t * blast.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(47,109,179,${(1 - t) * 0.55})`;
      ctx.lineWidth = 2.5 / camera.zoom;
      ctx.stroke();
    }
    if (springPreview) {
      ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.3 / camera.zoom;
      ctx.setLineDash([5 / camera.zoom, 4 / camera.zoom]);
      ctx.beginPath(); ctx.moveTo(springPreview.a.x, springPreview.a.y); ctx.lineTo(springPreview.b.x, springPreview.b.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(springPreview.a.x, springPreview.a.y, 4 / camera.zoom, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.accent; ctx.fill();
    }
    if (showVectors) for (const body of bodies) this._vector(body);
    if (dragPoint && world.dragging) {
      ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.2 / camera.zoom;
      ctx.setLineDash([5 / camera.zoom, 4 / camera.zoom]);
      ctx.beginPath(); ctx.moveTo(dragPoint.bodyX, dragPoint.bodyY); ctx.lineTo(dragPoint.x, dragPoint.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (preview) this._preview(preview);
    ctx.restore();
  }

  /** A fluid (buoyancy) region: translucent fill, a firm surface line on the
   *  top edge, and a small caption so the region reads as water, not a box. */
  _fluid(f, isSel) {
    const { ctx, camera } = this;
    const x = f.x - f.width / 2, y = f.y - f.height / 2;
    ctx.fillStyle = 'rgba(47,109,179,0.10)';
    ctx.fillRect(x, y, f.width, f.height);
    ctx.strokeStyle = isSel ? COLORS.accent : 'rgba(47,109,179,0.45)';
    ctx.lineWidth = (isSel ? 2 : 1.2) / Math.sqrt(camera.zoom);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + f.width, y); ctx.stroke();
    ctx.strokeStyle = isSel ? COLORS.accent : 'rgba(47,109,179,0.25)';
    ctx.setLineDash([6 / camera.zoom, 5 / camera.zoom]);
    ctx.strokeRect(x, y, f.width, f.height);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(47,109,179,0.75)';
    ctx.font = `${12 / camera.zoom}px sans-serif`;
    ctx.fillText(getLang() === 'en' ? 'Fluid · Buoyancy' : '流体 Fluid · 浮力', x + 8 / camera.zoom, y + 16 / camera.zoom);
  }

  /** A wind region: pale slate fill, dashed outline, and flow arrows along
   *  the wind direction (arrow length grows with wind speed), plus a caption. */
  _wind(w, isSel) {
    const { ctx, camera } = this;
    const x = w.x - w.width / 2, y = w.y - w.height / 2;
    ctx.fillStyle = 'rgba(96,125,139,0.07)';
    ctx.fillRect(x, y, w.width, w.height);
    ctx.strokeStyle = isSel ? COLORS.accent : 'rgba(96,125,139,0.45)';
    ctx.lineWidth = (isSel ? 2 : 1.2) / Math.sqrt(camera.zoom);
    ctx.setLineDash([6 / camera.zoom, 5 / camera.zoom]);
    ctx.strokeRect(x, y, w.width, w.height);
    ctx.setLineDash([]);
    const sp = Math.hypot(w.vx, w.vy);
    if (sp > 0.1) {
      const ux = w.vx / sp, uy = w.vy / sp;
      const a = Math.atan2(uy, ux);
      const len = Math.min(46, 14 + sp * 6);
      const cols = Math.max(1, Math.min(12, Math.floor(w.width / 110)));
      const rows = Math.max(1, Math.min(8, Math.floor(w.height / 64)));
      ctx.strokeStyle = 'rgba(96,125,139,0.55)';
      ctx.lineWidth = 1.4 / Math.sqrt(camera.zoom);
      ctx.beginPath();
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const cx = x + (c + 0.5) * (w.width / cols), cy = y + (r + 0.5) * (w.height / rows);
        const x1 = cx - ux * len / 2, y1 = cy - uy * len / 2;
        const x2 = cx + ux * len / 2, y2 = cy + uy * len / 2;
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(a - 0.45) * 6, y2 - Math.sin(a - 0.45) * 6);
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - Math.cos(a + 0.45) * 6, y2 - Math.sin(a + 0.45) * 6);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(96,125,139,0.8)';
    ctx.font = `${12 / camera.zoom}px sans-serif`;
    ctx.fillText(getLang() === 'en' ? `Wind · (${w.vx}, ${w.vy})` : `风场 Wind · (${w.vx}, ${w.vy})`, x + 8 / camera.zoom, y + 16 / camera.zoom);
  }

  _grid() {
    const { ctx, view, camera } = this;
    const tl = camera.screenToWorld(0, 0, view);
    const br = camera.screenToWorld(view.w, view.h, view);
    const minor = 25, major = 100;
    // arithmetic projection inline — no per-line object allocation
    const sx = (wx) => (wx - camera.x) * camera.zoom + view.w / 2;
    const sy = (wy) => (wy - camera.y) * camera.zoom + view.h / 2;
    const drawSet = (step, style, width) => {
      ctx.strokeStyle = style; ctx.lineWidth = width;
      ctx.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        const px = sx(x); ctx.moveTo(px, 0); ctx.lineTo(px, view.h);
      }
      for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
        const py = sy(y); ctx.moveTo(0, py); ctx.lineTo(view.w, py);
      }
      ctx.stroke();
    };
    if (camera.zoom > 0.45) drawSet(minor, '#efeff1', 1);
    drawSet(major, '#e0e0e4', 1);
    // origin axes
    const ox = sx(0), oy = sy(0);
    ctx.strokeStyle = '#c9dcee'; ctx.lineWidth = 1;
    ctx.beginPath();
    if (oy >= 0 && oy <= view.h) { ctx.moveTo(0, oy); ctx.lineTo(view.w, oy); }
    if (ox >= 0 && ox <= view.w) { ctx.moveTo(ox, 0); ctx.lineTo(ox, view.h); }
    ctx.stroke();
  }

  _body(body, world, selectedId) {
    const { ctx, camera } = this;
    const type = world.typeOf(body);
    const dataId = world.dataIdOf(body);
    const verts = body.vertices;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
    ctx.closePath();
    const isSel = dataId === selectedId;
    if (body.isStatic) ctx.fillStyle = world.isBound(body) ? COLORS.bound : COLORS.static;
    else if (type === 'circle') ctx.fillStyle = COLORS.circle;
    else if (type === 'polygon') ctx.fillStyle = COLORS.polygon;
    else ctx.fillStyle = COLORS.dynamic;
    ctx.fill();
    ctx.strokeStyle = isSel ? COLORS.accent : (body.isStatic ? COLORS.staticEdge : COLORS.dynamicEdge);
    ctx.lineWidth = (isSel ? 2.2 : 1.3) / Math.sqrt(camera.zoom);
    ctx.stroke();
    // centre mark + orientation tick so rotation is visible
    ctx.beginPath();
    ctx.arc(body.position.x, body.position.y, 2.2 / Math.sqrt(camera.zoom), 0, Math.PI * 2);
    ctx.fillStyle = isSel ? COLORS.accent : '#8a8d93'; ctx.fill();
    if (type === 'circle' || type === 'polygon') {
      const r = body.circleRadius || 20;
      ctx.beginPath();
      ctx.moveTo(body.position.x, body.position.y);
      ctx.lineTo(body.position.x + Math.cos(body.angle) * r, body.position.y + Math.sin(body.angle) * r);
      ctx.strokeStyle = 'rgba(60,64,70,.45)'; ctx.lineWidth = 1 / Math.sqrt(camera.zoom); ctx.stroke();
    }
    if (isSel) {
      // selection bounding box
      const b = body.bounds;
      ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1 / camera.zoom;
      ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
      ctx.strokeRect(b.min.x - 4, b.min.y - 4, (b.max.x - b.min.x) + 8, (b.max.y - b.min.y) + 8);
      ctx.setLineDash([]);
    }
    // magnetic pole badge at the body's top-right bounds corner:
    // red N (positive) / blue S (negative)
    const mag = typeof world.magnetOf === 'function' ? world.magnetOf(body) : 0;
    if (mag !== 0) {
      const bx = body.bounds.max.x, by = body.bounds.min.y;
      const r = 7.5 / camera.zoom;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = mag > 0 ? COLORS.danger : COLORS.accent;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${9 / camera.zoom}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(mag > 0 ? 'N' : 'S', bx, by + 0.5 / camera.zoom);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
  }

  /** Spring drawn as a coil zig-zag; near-rigid constraints (stiffness >= 0.9) as a straight rod. */
  _spring(seg) {
    const { ctx, camera } = this;
    const { a, b, stiffness } = seg;
    ctx.strokeStyle = '#6d7278';
    ctx.lineWidth = 1.4 / Math.sqrt(camera.zoom);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (stiffness >= 0.9) {
      ctx.lineTo(b.x, b.y);
    } else {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, px = -uy, py = ux;
      const coils = Math.max(4, Math.min(16, Math.round(len / 14)));
      const amp = 6;
      for (let i = 1; i < coils; i++) {
        const t = i / coils;
        const off = (i % 2 === 0 ? -amp : amp) * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.06) / 0.88)));
        ctx.lineTo(a.x + dx * t + px * off, a.y + dy * t + py * off);
      }
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.fillStyle = '#6d7278';
    ctx.beginPath(); ctx.arc(a.x, a.y, 2.4 / Math.sqrt(camera.zoom), 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, 2.4 / Math.sqrt(camera.zoom), 0, Math.PI * 2); ctx.fill();
  }

  _trails(world, bodies) {
    const { ctx } = this;
    const alive = this._alive;
    alive.clear();
    for (const body of bodies) {
      if (body.isStatic || body.isSleeping) { if (!body.isStatic) alive.add(world.dataIdOf(body)); continue; }
      const id = world.dataIdOf(body);
      alive.add(id);
      let tr = this.trails.get(id);
      if (!tr) { tr = []; this.trails.set(id, tr); }
      const last = tr[tr.length - 1];
      if (!last || Math.hypot(body.position.x - last.x, body.position.y - last.y) > 3) {
        tr.push({ x: body.position.x, y: body.position.y });
        if (tr.length > 110) tr.shift();
      }
      if (tr.length > 1) {
        ctx.strokeStyle = 'rgba(47,109,179,.4)'; ctx.lineWidth = 1.2; ctx.beginPath();
        ctx.moveTo(tr[0].x, tr[0].y);
        for (let i = 1; i < tr.length; i++) ctx.lineTo(tr[i].x, tr[i].y);
        ctx.stroke();
      }
    }
    for (const id of [...this.trails.keys()]) if (!alive.has(id)) this.trails.delete(id);
  }

  _vector(body) {
    if (body.isStatic) return;
    const { ctx } = this;
    const v = body.velocity;
    const mag = Math.hypot(v.x, v.y);
    if (mag < 0.4) return;
    const scale = 7;
    const x2 = body.position.x + v.x * scale, y2 = body.position.y + v.y * scale;
    ctx.strokeStyle = COLORS.accent; ctx.fillStyle = COLORS.accent; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(body.position.x, body.position.y); ctx.lineTo(x2, y2); ctx.stroke();
    const a = Math.atan2(v.y, v.x);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(a - 0.42) * 7, y2 - Math.sin(a - 0.42) * 7);
    ctx.lineTo(x2 - Math.cos(a + 0.42) * 7, y2 - Math.sin(a + 0.42) * 7);
    ctx.closePath(); ctx.fill();
  }

  _preview(p) {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.accent; ctx.fillStyle = 'rgba(47,109,179,.08)'; ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    if (p.kind === 'circle' || p.kind === 'polygon') ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    else if (p.kind === 'line') { ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); }
    else ctx.rect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }
}

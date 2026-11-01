/* render.js — custom canvas renderer + camera.
   Draws the fine grid, bodies (flat scientific style), selection highlight and
   optional velocity vectors. No DOM rebuilding: one canvas, redrawn per frame. */

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
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.view = { w: Math.max(50, r.width), h: Math.max(50, r.height) };
    this.canvas.width = Math.round(this.view.w * this.dpr);
    this.canvas.height = Math.round(this.view.h * this.dpr);
  }

  draw(world, opts) {
    const { ctx, view, camera } = this;
    const { selectedId = null, showGrid = true, showVectors = false, preview = null, dragPoint = null } = opts;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, view.w, view.h);
    if (showGrid) this._grid();
    ctx.save();
    ctx.translate(view.w / 2, view.h / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    ctx.lineJoin = 'round';

    for (const body of world.allBodies()) this._body(body, world, selectedId);
    if (showVectors) for (const body of world.allBodies()) this._vector(body);
    if (dragPoint && world.dragging) {
      ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.2 / camera.zoom;
      ctx.setLineDash([5 / camera.zoom, 4 / camera.zoom]);
      ctx.beginPath(); ctx.moveTo(dragPoint.bodyX, dragPoint.bodyY); ctx.lineTo(dragPoint.x, dragPoint.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (preview) this._preview(preview);
    ctx.restore();
  }

  _grid() {
    const { ctx, view, camera } = this;
    const tl = camera.screenToWorld(0, 0, view);
    const br = camera.screenToWorld(view.w, view.h, view);
    const minor = 25, major = 100;
    const drawSet = (step, style, width) => {
      ctx.strokeStyle = style; ctx.lineWidth = width;
      ctx.beginPath();
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
        const s = camera.worldToScreen(x, 0, view); ctx.moveTo(s.x, 0); ctx.lineTo(s.x, view.h);
      }
      for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
        const s = camera.worldToScreen(0, y, view); ctx.moveTo(0, s.y); ctx.lineTo(view.w, s.y);
      }
      ctx.stroke();
    };
    if (camera.zoom > 0.45) drawSet(minor, '#efeff1', 1);
    drawSet(major, '#e0e0e4', 1);
    // origin axes
    const o = camera.worldToScreen(0, 0, view);
    ctx.strokeStyle = '#c9dcee'; ctx.lineWidth = 1;
    ctx.beginPath();
    if (o.y >= 0 && o.y <= view.h) { ctx.moveTo(0, o.y); ctx.lineTo(view.w, o.y); }
    if (o.x >= 0 && o.x <= view.w) { ctx.moveTo(o.x, 0); ctx.lineTo(o.x, view.h); }
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
    if (body.isStatic) ctx.fillStyle = body.plugin.motionlab.isBound ? COLORS.bound : COLORS.static;
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
      const r = body.circleRadius || (body._mlData && body._mlData.radius) || 20;
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

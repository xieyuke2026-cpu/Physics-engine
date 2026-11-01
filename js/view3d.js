/* view3d.js — 3D viewport for MotionLab: orbit camera + body rendering.
 *
 * Primary renderer: three.js (global THREE, vendored) with flat lights.
 * Fallback: if WebGL/THREE is unavailable, a software wireframe projector on
 * the 2D canvas keeps the lab fully usable (and testable).
 *
 * The view knows nothing about physics: lab3d feeds it body snapshots
 * ({id, kind, sizeX/Y/Z, radius, x, y, z, quaternion, isStatic, isBound})
 * every frame via sync(), and asks it for pick rays via rayFromEvent().
 */

const ACCENT = '#2f6db3';

export function createView3D(canvas) {
  const view = {
    mode: 'wire',
    theta: 0.75,          // azimuth
    phi: 1.02,            // polar from +Y
    dist: 17,
    target: { x: 0, y: 1.2, z: 0 },
    fov: 46,
  };

  /* ---------------- shared camera math ---------------- */
  function camPos() {
    const sp = Math.sin(view.phi), y = Math.cos(view.phi);
    return {
      x: view.target.x + view.dist * sp * Math.sin(view.theta),
      y: view.target.y + view.dist * y,
      z: view.target.z + view.dist * sp * Math.cos(view.theta),
    };
  }
  function basis() {
    const pos = camPos();
    let fx = view.target.x - pos.x, fy = view.target.y - pos.y, fz = view.target.z - pos.z;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    // right = f x up(0,1,0) normalized (guard near-vertical views)
    let rx = -fz, ry = 0, rz = fx;
    const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    return { pos, f: { x: fx, y: fy, z: fz }, r: { x: rx, y: ry, z: rz }, u: { x: ux, y: uy, z: uz } };
  }
  function rayFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((e.clientY - rect.top) / rect.height) * 2;
    const { pos, f, r, u } = basis();
    const t = Math.tan((view.fov * Math.PI / 180) / 2);
    const aspect = rect.width / Math.max(1, rect.height);
    const dx = f.x + r.x * nx * t * aspect + u.x * ny * t;
    const dy = f.y + r.y * nx * t * aspect + u.y * ny * t;
    const dz = f.z + r.z * nx * t * aspect + u.z * ny * t;
    const l = Math.hypot(dx, dy, dz) || 1;
    return { origin: pos, dir: { x: dx / l, y: dy / l, z: dz / l } };
  }

  /* ---------------- three.js path ---------------- */
  let three = null;
  try {
    if (typeof THREE !== 'undefined') {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf4f4f5);
      const camera = new THREE.PerspectiveCamera(view.fov, 1, 0.1, 500);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcc2, 0.95));
      const sun = new THREE.DirectionalLight(0xffffff, 0.55);
      sun.position.set(6, 12, 4);
      scene.add(sun);
      const grid = new THREE.GridHelper(44, 44, 0xc4c8cd, 0xdedfe2);
      grid.position.y = 0.01;
      scene.add(grid);
      three = { renderer, scene, camera, meshes: new Map() };
      view.mode = 'webgl';
    }
  } catch { three = null; view.mode = 'wire'; }

  const MAT = {
    dynamic: () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 }),
    static: () => new THREE.MeshStandardMaterial({ color: 0xd6d8db, roughness: 0.8, metalness: 0 }),
    bound: () => new THREE.MeshStandardMaterial({ color: 0xe3e4e6, roughness: 0.9, metalness: 0 }),
  };
  function threeSync(bodies, selectedId) {
    const seen = new Set();
    for (const b of bodies) {
      seen.add(b.id);
      let mesh = three.meshes.get(b.id);
      if (!mesh) {
        const geo = b.kind === 'sphere'
          ? new THREE.SphereGeometry(b.radius, 24, 18)
          : new THREE.BoxGeometry(b.sizeX, b.sizeY, b.sizeZ);
        mesh = new THREE.Mesh(geo, b.isBound ? MAT.bound() : (b.isStatic ? MAT.static() : MAT.dynamic()));
        if (!b.isBound) {
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo, 24),
            new THREE.LineBasicMaterial({ color: 0x9a9da3 }),
          );
          mesh.add(edges);
        }
        three.scene.add(mesh);
        three.meshes.set(b.id, mesh);
      }
      mesh.position.set(b.x, b.y, b.z);
      if (b.quaternion) mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      const isSel = b.id === selectedId;
      if (mesh.material && mesh.material.emissive) {
        mesh.material.emissive.setHex(isSel ? 0x2f6db3 : 0x000000);
        mesh.material.emissiveIntensity = isSel ? 0.45 : 0;
      }
    }
    for (const [id, mesh] of [...three.meshes]) {
      if (!seen.has(id)) { three.scene.remove(mesh); three.meshes.delete(id); }
    }
    const { pos } = basis();
    three.camera.position.set(pos.x, pos.y, pos.z);
    three.camera.lookAt(view.target.x, view.target.y, view.target.z);
    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
    three.camera.aspect = w / h;
    three.camera.updateProjectionMatrix();
    three.renderer.setSize(w, h, false);
    three.renderer.render(three.scene, three.camera);
  }

  /* ---------------- wireframe fallback ---------------- */
  const ctx2d = view.mode === 'wire' ? canvas.getContext('2d') : null;
  function quatMatrix(q) {
    if (!q) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const { x, y, z, w } = q;
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ];
  }
  function wireSync(bodies, selectedId) {
    if (!ctx2d) return;
    const W = canvas.width, H = canvas.height;
    const { pos, f, r, u } = basis();
    const t = Math.tan((view.fov * Math.PI / 180) / 2);
    const aspect = W / Math.max(1, H);
    const project = (p) => {
      const vx = p.x - pos.x, vy = p.y - pos.y, vz = p.z - pos.z;
      const cx = vx * r.x + vy * r.y + vz * r.z;
      const cy = vx * u.x + vy * u.y + vz * u.z;
      const cz = vx * f.x + vy * f.y + vz * f.z;
      if (cz < 0.1) return null;
      return [W / 2 + (cx / (cz * t * aspect)) * (W / 2), H / 2 - (cy / (cz * t)) * (H / 2), cz];
    };
    ctx2d.clearRect(0, 0, W, H);
    ctx2d.fillStyle = '#f4f4f5'; ctx2d.fillRect(0, 0, W, H);
    // ground grid
    ctx2d.strokeStyle = '#dedfe2'; ctx2d.lineWidth = 1;
    for (let i = -22; i <= 22; i += 2) {
      for (const [a, b] of [[{ x: i, y: 0, z: -22 }, { x: i, y: 0, z: 22 }], [{ x: -22, y: 0, z: i }, { x: 22, y: 0, z: i }]]) {
        const pa = project(a), pb = project(b);
        if (pa && pb) { ctx2d.beginPath(); ctx2d.moveTo(pa[0], pa[1]); ctx2d.lineTo(pb[0], pb[1]); ctx2d.stroke(); }
      }
    }
    const items = bodies.map((b) => {
      const c = project(b);
      return { b, depth: c ? c[2] : Infinity };
    }).sort((a, b2) => b2.depth - a.depth);
    for (const { b } of items) {
      const sel = b.id === selectedId;
      const stroke = sel ? ACCENT : (b.isStatic ? '#9a9da3' : '#3c4046');
      ctx2d.strokeStyle = stroke; ctx2d.lineWidth = sel ? 2 : 1.2;
      ctx2d.fillStyle = b.isBound ? '#e8e8ea' : (b.isStatic ? '#e0e1e4' : 'rgba(255,255,255,0.85)');
      if (b.kind === 'sphere') {
        const c = project(b); if (!c) continue;
        const e = project({ x: b.x + basis().r.x * b.radius, y: b.y + basis().r.y * b.radius, z: b.z + basis().r.z * b.radius });
        const rad = e ? Math.hypot(e[0] - c[0], e[1] - c[1]) : 8;
        ctx2d.beginPath(); ctx2d.arc(c[0], c[1], rad, 0, Math.PI * 2); ctx2d.fill(); ctx2d.stroke();
      } else {
        const m = quatMatrix(b.quaternion);
        const hx = b.sizeX / 2, hy = b.sizeY / 2, hz = b.sizeZ / 2;
        const corners = [];
        for (const [sx, sy, sz] of [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]) {
          const lx = sx * hx, ly = sy * hy, lz = sz * hz;
          corners.push(project({
            x: b.x + m[0] * lx + m[1] * ly + m[2] * lz,
            y: b.y + m[3] * lx + m[4] * ly + m[5] * lz,
            z: b.z + m[6] * lx + m[7] * ly + m[8] * lz,
          }));
        }
        if (corners.some((c) => !c)) continue;
        const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
        ctx2d.beginPath();
        for (const [a, b2] of EDGES) { ctx2d.moveTo(corners[a][0], corners[a][1]); ctx2d.lineTo(corners[b2][0], corners[b2][1]); }
        ctx2d.stroke();
      }
    }
  }

  /* ---------------- public ---------------- */
  view.sync = (bodies, selectedId) => { if (three) threeSync(bodies, selectedId); else wireSync(bodies, selectedId); };
  view.rayFromEvent = rayFromEvent;
  view.resize = () => {
    const w = canvas.clientWidth || 800, h = canvas.clientHeight || 600;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (view.mode === 'wire') { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    if (three) three.renderer.setSize(w, h, false);
  };
  view.resetCamera = () => { view.theta = 0.75; view.phi = 1.02; view.dist = 17; view.target = { x: 0, y: 1.2, z: 0 }; };
  return view;
}

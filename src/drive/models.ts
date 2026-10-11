// Low-poly vehicle models (merged geometries with vertex colours, one draw call per vehicle).
// Vehicle local frame: forward = -z, up = +y, right = +x. Origin at ground centre.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function part(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0) {
  if (rx) geo.rotateX(rx);
  geo.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) (arr[i * 3] = c.r), (arr[i * 3 + 1] = c.g), (arr[i * 3 + 2] = c.b);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}
const box = (w: number, h: number, l: number, x: number, y: number, z: number, color: number) => part(new THREE.BoxGeometry(w, h, l), color, x, y, z);

function wheels(w: number, base: number, color = 0x161718) {
  const out: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10);
      g.rotateZ(Math.PI / 2);
      out.push(part(g, color, (sx * w) / 2, 0.33, (sz * base) / 2));
    }
  return out;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Japanese patrol car: white upper body, black lower body, red light bar */
export function patrolCarGeometry(unmarked = false): THREE.BufferGeometry {
  const key = 'pc' + unmarked;
  if (cache.has(key)) return cache.get(key)!;
  const W = 1.8, L = 4.9;
  const black = 0x111214, white = unmarked ? 0x2b2f35 : 0xf2f2ef, glass = 0x26323d;
  const parts = [
    box(W, 0.5, L, 0, 0.55, 0, unmarked ? 0x2b2f35 : black),
    box(W, 0.22, L - 0.1, 0, 0.91, 0, white),
    box(W - 0.12, 0.42, 2.3, 0, 1.23, 0.25, glass),
    box(W - 0.2, 0.06, 2.0, 0, 1.47, 0.3, white),
    box(W - 0.02, 0.05, 1.3, 0, 1.03, -1.75, white), // hood top
    box(0.5, 0.12, 0.25, 0.65, 0.62, -2.46, 0xfff6d0), // headlights
    box(0.5, 0.12, 0.25, -0.65, 0.62, -2.46, 0xfff6d0),
    box(0.45, 0.12, 0.1, 0.65, 0.75, 2.46, 0xb01010), // tail lights
    box(0.45, 0.12, 0.1, -0.65, 0.75, 2.46, 0xb01010),
    ...wheels(W - 0.05, 2.85),
  ];
  if (!unmarked) {
    parts.push(box(1.35, 0.14, 0.32, 0, 1.57, 0.25, 0x2a2a2a));
    parts.push(box(0.6, 0.16, 0.3, -0.36, 1.66, 0.25, 0xff2020));
    parts.push(box(0.6, 0.16, 0.3, 0.36, 1.66, 0.25, 0xff2020));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  cache.set(key, g);
  return g;
}

export function motorcycleGeometry(): THREE.BufferGeometry {
  if (cache.has('moto')) return cache.get('moto')!;
  const tire = (z: number) => {
    const g = new THREE.CylinderGeometry(0.32, 0.32, 0.14, 10);
    g.rotateZ(Math.PI / 2);
    return part(g, 0x141414, 0, 0.32, z);
  };
  const parts = [
    tire(-0.75),
    tire(0.75),
    box(0.45, 0.45, 1.3, 0, 0.75, 0, 0xf4f4f2),
    box(0.6, 0.35, 0.45, 0, 1.05, -0.55, 0xf4f4f2),
    box(0.5, 0.55, 0.4, 0, 1.4, 0.1, 0x1d2a44), // rider torso
    box(0.3, 0.3, 0.3, 0, 1.85, 0.05, 0xf8f8f8), // helmet
    box(0.25, 0.1, 0.1, -0.22, 1.25, -0.75, 0xff2020),
  ];
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  cache.set('moto', g);
  return g;
}

const CIV_COLORS = [0xf5f5f5, 0xf5f5f5, 0x1c1c1e, 0xb8bcc2, 0x8a9096, 0x2c3e66, 0x7a1f1f, 0xe9e4d4, 0x3b4a3a, 0x5b6b7c, 0xd8c08a];

/** civilian vehicles: sedan / kei car / minivan / taxi / truck */
export function civilianGeometry(variant: number): { geo: THREE.BufferGeometry; length: number } {
  const key = 'civ' + variant;
  if (cache.has(key)) {
    const g = cache.get(key)!;
    return { geo: g, length: (g.userData.length as number) ?? 4.6 };
  }
  const type = variant % 5;
  const col = CIV_COLORS[Math.floor(variant / 5) % CIV_COLORS.length];
  const glass = 0x27313a;
  let parts: THREE.BufferGeometry[];
  let L = 4.6;
  if (type === 0) {
    // sedan
    parts = [box(1.75, 0.6, 4.6, 0, 0.6, 0, col), box(1.6, 0.45, 2.3, 0, 1.12, 0.2, glass), box(1.55, 0.06, 2.0, 0, 1.36, 0.2, col), ...wheels(1.7, 2.7)];
  } else if (type === 1) {
    // kei car (tall box)
    L = 3.4;
    parts = [box(1.47, 0.7, 3.4, 0, 0.65, 0, col), box(1.42, 0.65, 2.3, 0, 1.33, 0.25, glass), box(1.42, 0.07, 2.3, 0, 1.69, 0.25, col), ...wheels(1.42, 2.3)];
  } else if (type === 2) {
    // minivan
    L = 4.8;
    parts = [box(1.8, 0.8, 4.8, 0, 0.7, 0, col), box(1.75, 0.65, 3.4, 0, 1.43, 0.35, glass), box(1.75, 0.08, 3.4, 0, 1.8, 0.35, col), ...wheels(1.75, 2.9)];
  } else if (type === 3) {
    // taxi (black, roof sign)
    parts = [
      box(1.7, 0.6, 4.6, 0, 0.6, 0, 0x16181b),
      box(1.55, 0.45, 2.3, 0, 1.12, 0.2, glass),
      box(1.5, 0.06, 2.0, 0, 1.36, 0.2, 0x16181b),
      box(0.5, 0.22, 0.2, 0, 1.5, 0.2, 0xf3d26a),
      ...wheels(1.65, 2.7),
    ];
  } else {
    // light truck
    L = 4.7;
    parts = [box(1.7, 1.0, 1.5, 0, 0.95, -1.55, 0xeceae4), box(1.6, 0.4, 1.3, 0, 1.3, -1.6, glass), box(1.75, 0.3, 3.1, 0, 0.7, 0.75, 0x6f7377), box(1.75, 0.5, 3.1, 0, 1.1, 0.75, col), ...wheels(1.7, 2.9)];
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  g.userData.length = L;
  cache.set(key, g);
  return { geo: g, length: L };
}

/** cockpit interior for first-person view (right-hand drive). Returns group + steering wheel */
export function cockpit(): { group: THREE.Group; wheel: THREE.Object3D; beacon: THREE.Mesh } {
  const group = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1d20 });
  const dash = new THREE.MeshLambertMaterial({ color: 0x26292d });
  const hood = new THREE.MeshLambertMaterial({ color: 0xeeeeea });
  // hood (white upper body of the patrol car)
  const h = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.08, 1.7), hood);
  h.position.set(0, 0.86, -1.95);
  h.rotation.x = 0.06;
  group.add(h);
  // dashboard (top surface about 25 cm below eye level)
  const d = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.5), dash);
  d.position.set(0, 0.9, -0.95);
  group.add(d);
  // instrument hood in front of driver
  const ih = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.22), dark);
  ih.position.set(0.36, 1.0, -0.82);
  group.add(ih);
  // radio / equipment block in the centre console
  const rad = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.06), new THREE.MeshLambertMaterial({ color: 0x0f1012 }));
  rad.position.set(0, 0.86, -0.7);
  group.add(rad);
  // A-pillars (slim, at the windscreen edges)
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.05), dark);
    p.position.set(sx * 0.82, 1.27, -0.95);
    p.rotation.x = -0.62;
    group.add(p);
  }
  // roof edge
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.4), dark);
  roof.position.set(0, 1.56, -0.7);
  group.add(roof);
  // rear-view mirror
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.03), new THREE.MeshLambertMaterial({ color: 0x40464c }));
  mirror.position.set(0.02, 1.47, -0.85);
  group.add(mirror);
  // steering wheel (driver on the right)
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 6, 28), dark);
  wheel.add(rim);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.02), dark);
  wheel.add(spoke);
  const spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.02), dark);
  spoke2.position.y = -0.085;
  wheel.add(spoke2);
  wheel.position.set(0.36, 0.86, -0.62);
  wheel.rotation.x = -0.45;
  group.add(wheel);
  // beacon glow on the hood when the light bar is on
  const beacon = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.6), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, depthWrite: false }));
  beacon.rotation.x = -Math.PI / 2 + 0.06;
  beacon.position.set(0, 0.91, -1.95);
  group.add(beacon);
  return { group, wheel, beacon };
}

export const vehicleMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

// Streamed 3D street scene built from the OSM road graph and building footprints.
// three.js axes: x = east, y = up, z = -north.
import * as THREE from 'three';
import type { Sim } from '../sim/engine';
import type { RoadGraph } from '../sim/graph';
import { CLS_MOTORWAY, F_LINK, F_ONEWAY, F_TUNNEL } from '../sim/graph';
import { roadTexture, asphaltTexture, crosswalkTexture, sidewalkTexture, facadeTextures, houseTextures, type RoadKind } from './textures';

export const TILE = 500;
const ELEV = 9; // elevated expressway height (阪神高速)

export function roadWidth(g: RoadGraph, e: number): number {
  const c = g.ecls[e], lanes = g.elanes[e];
  if (c === CLS_MOTORWAY) return g.eflags[e] & F_LINK ? 6 : Math.max(2, lanes) * 3.5 + 1.5;
  if (g.eflags[e] & F_LINK) return 6.5;
  if (c === 7) return 4;
  if (c === 6) return lanes >= 2 ? lanes * 3 : 4.6;
  if (c === 5) return lanes >= 2 ? lanes * 3 + 0.5 : 5.5;
  return Math.max(2, lanes) * 3.25 + 1;
}

export function laneCount(g: RoadGraph, e: number): number {
  const c = g.ecls[e];
  if (c >= 6 && g.elanes[e] < 2) return 1;
  return Math.max(1, g.elanes[e]);
}

function roadKind(g: RoadGraph, e: number): RoadKind {
  const c = g.ecls[e], lanes = laneCount(g, e), one = g.eflags[e] & F_ONEWAY;
  if (c === CLS_MOTORWAY) return 'motor';
  if (one) return lanes >= 3 ? 'one3' : lanes === 2 ? 'one2' : 'one1';
  if (c >= 6 || lanes < 2) return 'narrow';
  if (lanes >= 6) return 'six';
  if (lanes >= 4) return 'four';
  return c <= 3 ? 'twoY' : 'two';
}

export type SignalColor = 'G' | 'Y' | 'R';

interface SignalHead {
  v: number;
  heading: number; // approach travel heading (rad, 0 = north)
  lamps: THREE.Mesh[]; // [green, yellow, red]
  state: SignalColor | '';
}

interface Tile {
  key: string;
  group: THREE.Group;
  signals: SignalHead[];
  buildings: { poly: [number, number][]; minX: number; minY: number; maxX: number; maxY: number }[];
  disposed: boolean;
}

function hash(n: number) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export class StreetWorld {
  scene: THREE.Scene;
  sim: Sim;
  g: RoadGraph;
  tiles = new Map<string, Tile>();
  private bldgIndex: Set<string> | null = null;
  private mats: Record<string, THREE.Material> = {};
  private roadMats = new Map<RoadKind, THREE.MeshLambertMaterial>();
  vElev: Float32Array;
  private axis = new Map<number, number>();
  private lampOn: Record<SignalColor, THREE.MeshBasicMaterial>;
  private lampOff: THREE.MeshLambertMaterial;
  facadeMat: THREE.MeshLambertMaterial;
  houseMat: THREE.MeshLambertMaterial;
  private waterGroup = new THREE.Group();
  private waterCenter: [number, number] | null = null;
  private baseData: GeoJSON.FeatureCollection | null = null;
  streetLightMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, sim: Sim) {
    this.scene = scene;
    this.sim = sim;
    this.g = sim.g;
    const g = this.g;
    // elevation of vertices: expressway level for motorway vertices, ramps in between
    this.vElev = new Float32Array(g.nv);
    for (let e = 0; e < g.ne; e++) {
      if (g.ecls[e] === CLS_MOTORWAY && !(g.eflags[e] & F_LINK) && !(g.eflags[e] & F_TUNNEL)) {
        this.vElev[g.ea[e]] = ELEV;
        this.vElev[g.eb[e]] = ELEV;
      }
    }
    for (let e = 0; e < g.ne; e++) {
      if (!(g.eflags[e] & F_LINK) || g.ecls[e] !== CLS_MOTORWAY) continue;
      for (const v of [g.ea[e], g.eb[e]]) {
        if (this.vElev[v] > 0) continue;
        let touchesSurface = false;
        for (let k = g.adjS[v]; k < g.adjS[v + 1]; k++) {
          const o = g.adjE[k];
          if (g.ecls[o] !== CLS_MOTORWAY) touchesSurface = true;
        }
        if (!touchesSurface) this.vElev[v] = ELEV / 2;
      }
    }
    const asphalt = asphaltTexture();
    this.mats.asphalt = new THREE.MeshLambertMaterial({ map: asphalt, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mats.cross = new THREE.MeshLambertMaterial({ map: crosswalkTexture(), transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mats.sidewalk = new THREE.MeshLambertMaterial({ map: sidewalkTexture() });
    this.mats.curb = new THREE.MeshLambertMaterial({ color: 0xb8b6b0 });
    this.mats.pillar = new THREE.MeshLambertMaterial({ color: 0x8e9092 });
    this.mats.barrier = new THREE.MeshLambertMaterial({ color: 0xa9abad, side: THREE.DoubleSide });
    this.mats.pole = new THREE.MeshLambertMaterial({ color: 0x6c7074 });
    this.mats.sigBox = new THREE.MeshLambertMaterial({ color: 0x3a3d40 });
    this.mats.roof = new THREE.MeshLambertMaterial({ color: 0x8a8a86 });
    this.mats.water = new THREE.MeshLambertMaterial({ color: 0x2c4a63, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.mats.white = new THREE.MeshLambertMaterial({ color: 0xe8e8e2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const fac = facadeTextures();
    this.facadeMat = new THREE.MeshLambertMaterial({ map: fac.map, vertexColors: true, emissiveMap: fac.emissive, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0 });
    const hs = houseTextures();
    this.houseMat = new THREE.MeshLambertMaterial({ map: hs.map, vertexColors: true, emissiveMap: hs.emissive, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0 });
    this.lampOn = {
      G: new THREE.MeshBasicMaterial({ color: 0x19e3c0 }),
      Y: new THREE.MeshBasicMaterial({ color: 0xffc21a }),
      R: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    };
    this.lampOff = new THREE.MeshLambertMaterial({ color: 0x1d2124 });
    this.streetLightMat = new THREE.MeshBasicMaterial({ color: 0xfff1cc });
    this.scene.add(this.waterGroup);
    fetch(import.meta.env.BASE_URL + 'data/bldg/index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        this.bldgIndex = j ? new Set(j.tiles) : new Set();
      })
      .catch(() => (this.bldgIndex = new Set()));
    fetch(import.meta.env.BASE_URL + 'data/base.json')
      .then((r) => r.json())
      .then((j) => (this.baseData = j))
      .catch(() => {});
  }

  roadMat(kind: RoadKind) {
    let m = this.roadMats.get(kind);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ map: roadTexture(kind), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      this.roadMats.set(kind, m);
    }
    return m;
  }

  setNight(k: number) {
    this.facadeMat.emissiveIntensity = k * 0.9;
    this.houseMat.emissiveIntensity = k * 0.8;
    this.streetLightMat.color.setRGB(0.55 + 0.45 * k, 0.5 + 0.44 * k, 0.4 + 0.4 * k);
  }

  /** elevation (m) at distance s along edge */
  elevAt(e: number, s: number) {
    const g = this.g;
    const a = this.vElev[g.ea[e]], b = this.vElev[g.eb[e]];
    if (!a && !b) return 0;
    const t = s / g.elen[e];
    return a + (b - a) * t;
  }

  // ---------------------------------------------------------------- signals
  private signalAxis(v: number) {
    let a = this.axis.get(v);
    if (a !== undefined) return a;
    const g = this.g;
    let best = 99;
    a = 0;
    for (let k = g.adjS[v]; k < g.adjS[v + 1]; k++) {
      const e = g.adjE[k];
      if (g.ecls[e] < best) {
        best = g.ecls[e];
        const p = g.pointAt(e, g.adjD[k] === 1 ? 0 : g.elen[e]);
        a = Math.atan2(p.hx, p.hy);
      }
    }
    this.axis.set(v, a);
    return a;
  }

  /** signal aspect for a vehicle approaching vertex v travelling with heading h */
  signalState(v: number, h: number, t: number): SignalColor {
    const cycle = 64;
    const tt = (t + hash(v) * cycle) % cycle;
    const axis = this.signalAxis(v);
    const groupA = Math.abs(Math.cos(h - axis)) > 0.7071;
    // A: green 0-28, yellow 28-31, all-red 31-32 / B: green 32-60, yellow 60-63, all-red 63-64
    if (groupA) return tt < 28 ? 'G' : tt < 31 ? 'Y' : 'R';
    return tt >= 32 && tt < 60 ? 'G' : tt >= 60 && tt < 63 ? 'Y' : 'R';
  }

  // ---------------------------------------------------------------- tiles
  update(x: number, y: number, radius = 1) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const want = new Set<string>();
    for (let i = -radius; i <= radius; i++) for (let j = -radius; j <= radius; j++) want.add(`${tx + i}_${ty + j}`);
    // build at most one tile per frame, nearest first
    const missing = [...want].filter((k) => !this.tiles.has(k));
    if (missing.length) {
      missing.sort((a, b) => {
        const [ax, ay] = a.split('_').map(Number), [bx, by] = b.split('_').map(Number);
        return Math.hypot(ax - tx, ay - ty) - Math.hypot(bx - tx, by - ty);
      });
      this.buildTile(missing[0]);
    }
    for (const [k, t] of this.tiles) {
      const [ax, ay] = k.split('_').map(Number);
      if (Math.abs(ax - tx) > radius + 1 || Math.abs(ay - ty) > radius + 1) {
        this.disposeTile(t);
        this.tiles.delete(k);
      }
    }
    if (!this.waterCenter || Math.hypot(this.waterCenter[0] - x, this.waterCenter[1] - y) > 1200) this.buildWater(x, y);
  }

  updateSignals(t: number) {
    for (const tile of this.tiles.values())
      for (const s of tile.signals) {
        const st = this.signalState(s.v, s.heading, t);
        if (st === s.state) continue;
        s.state = st;
        s.lamps[0].material = st === 'G' ? this.lampOn.G : this.lampOff;
        s.lamps[1].material = st === 'Y' ? this.lampOn.Y : this.lampOff;
        s.lamps[2].material = st === 'R' ? this.lampOn.R : this.lampOff;
      }
  }

  private disposeTile(t: Tile) {
    t.disposed = true;
    this.scene.remove(t.group);
    t.group.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }

  /** building footprints near a point (for collision) */
  buildingsNear(x: number, y: number) {
    const k = `${Math.floor(x / TILE)}_${Math.floor(y / TILE)}`;
    return this.tiles.get(k)?.buildings ?? [];
  }

  private buildTile(key: string) {
    const [tx, ty] = key.split('_').map(Number);
    const x0 = tx * TILE, y0 = ty * TILE;
    const tile: Tile = { key, group: new THREE.Group(), signals: [], buildings: [], disposed: false };
    this.tiles.set(key, tile);
    const g = this.g;
    const cx = x0 + TILE / 2, cy = y0 + TILE / 2;
    const edges = g.edgesNear(cx, cy, TILE * 0.75).filter((e) => {
      const p = g.pointAt(e, g.elen[e] / 2);
      return p.x >= x0 && p.x < x0 + TILE && p.y >= y0 && p.y < y0 + TILE && !(g.eflags[e] & F_TUNNEL);
    });
    const byKind = new Map<RoadKind, Builder>();
    const side = new Builder();
    const curb = new Builder();
    const disc = new Builder();
    const cross = new Builder();
    const white = new Builder();
    const barrier = new Builder();
    const pillars: [number, number, number][] = [];
    const lights: [number, number, number, number][] = [];
    const vertR = new Map<number, number>();
    for (const e of edges) {
      const w = roadWidth(g, e);
      for (const v of [g.ea[e], g.eb[e]]) if (g.degree(v) >= 3 && !this.vElev[v]) vertR.set(v, Math.max(vertR.get(v) ?? 0, w / 2 + 0.5));
    }
    // vertices in tile also need radius from edges outside the tile
    for (const v of [...vertR.keys()]) {
      let r = vertR.get(v)!;
      for (let k = g.adjS[v]; k < g.adjS[v + 1]; k++) if (!(g.ecls[g.adjE[k]] === CLS_MOTORWAY)) r = Math.max(r, roadWidth(g, g.adjE[k]) / 2 + 0.5);
      vertR.set(v, r);
    }
    for (const e of edges) {
      const kind = roadKind(g, e);
      let b = byKind.get(kind);
      if (!b) byKind.set(kind, (b = new Builder()));
      const w = roadWidth(g, e);
      const pts: [number, number, number][] = [];
      const g0 = g.gs[e], g1 = g.gs[e + 1];
      for (let k = g0; k < g1; k++) pts.push([g.gx[k], g.gy[k], this.elevAt(e, g.gd[k])]);
      const elevated = this.vElev[g.ea[e]] > 0 || this.vElev[g.eb[e]] > 0;
      const lift = elevated ? 0.05 : 0.02 + (8 - g.ecls[e]) * 0.003;
      b.strip(pts, w, lift, 12);
      if (elevated) {
        // side barriers and pillars
        barrier.wall(offsetLine(pts, w / 2), lift, 1.0);
        barrier.wall(offsetLine(pts, -w / 2), lift, 1.0);
        let acc = 20;
        for (let i = 1; i < pts.length; i++) {
          const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
          while (acc < L) {
            const t = acc / L;
            const z = pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * t;
            if (z > 3) pillars.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, z]);
            acc += 45;
          }
          acc -= L;
        }
        continue;
      }
      // sidewalks on major surface roads, trimmed at intersections
      const cls = g.ecls[e];
      const ra = vertR.get(g.ea[e]) ?? 0, rb = vertR.get(g.eb[e]) ?? 0;
      const trimmed = trimLine(pts, ra + (cls <= 4 ? 2.5 : 0), rb + (cls <= 4 ? 2.5 : 0));
      if (cls <= 4 && trimmed.length >= 2) {
        const sw = 2.6;
        side.strip(offsetLine(trimmed, w / 2 + sw / 2), sw, 0.15, 4);
        side.strip(offsetLine(trimmed, -(w / 2 + sw / 2)), sw, 0.15, 4);
        curb.wall(offsetLine(trimmed, w / 2), 0, 0.15);
        curb.wall(offsetLine(trimmed, -w / 2), 0, 0.15);
        // street lights along the left kerb, lamp arm over the carriageway
        let acc = 12;
        for (let i = 1; i < trimmed.length; i++) {
          const dx = trimmed[i][0] - trimmed[i - 1][0], dy = trimmed[i][1] - trimmed[i - 1][1];
          const L = Math.hypot(dx, dy);
          while (acc < L) {
            const t = acc / L;
            const nx = -dy / L, ny = dx / L;
            const off = w / 2 + 0.6;
            lights.push([trimmed[i - 1][0] + dx * t + nx * off, trimmed[i - 1][1] + dy * t + ny * off, Math.atan2(nx, -ny), 0]);
            acc += 34;
          }
          acc -= L;
        }
      }
    }
    // intersections: plain asphalt discs + crosswalks / stop lines at signals
    for (const [v, r] of vertR) {
      const vx = g.vx[v], vy = g.vy[v];
      if (vx < x0 || vx >= x0 + TILE || vy < y0 || vy >= y0 + TILE) continue;
      disc.disc(vx, vy, r, 0.055, 4);
      if (!g.signal[v]) continue;
      for (let k = g.adjS[v]; k < g.adjS[v + 1]; k++) {
        const e = g.adjE[k];
        if (g.ecls[e] === CLS_MOTORWAY) continue;
        const d = g.adjD[k];
        const p = g.pointAt(e, d === 1 ? Math.min(g.elen[e], r + 2) : Math.max(0, g.elen[e] - r - 2));
        const hx = d === 1 ? p.hx : -p.hx, hy = d === 1 ? p.hy : -p.hy; // pointing away from vertex
        const w = roadWidth(g, e);
        // crosswalk band (4 m) across the road
        cross.quad(p.x, p.y, hx, hy, w, 4, 0.06, w / 4);
        // no approaching traffic on a one-way road leaving this junction
        const oneway = g.eflags[e] & F_ONEWAY;
        if (oneway && d === 1) continue;
        // stop line on the approach side (the left half of a two-way road for the approaching driver)
        const sx = p.x + hx * 3.2, sy = p.y + hy * 3.2;
        const nx = -hy, ny = hx;
        if (oneway) white.quad(sx, sy, hx, hy, w, 0.45, 0.065, 1);
        else white.quad(sx - nx * (w / 4), sy - ny * (w / 4), hx, hy, w / 2, 0.45, 0.065, 1);
        // signal head on the far side of the junction, at the driver's left, arm over the road
        const fx = vx - hx * (r + 1), fy = vy - hy * (r + 1);
        const lx = hy, ly = -hx; // left of the approach direction (-hx, -hy)
        const head = this.signalHead(fx + lx * (w / 2 + 0.8), fy + ly * (w / 2 + 0.8), hx, hy, w);
        tile.group.add(head.obj);
        tile.signals.push({ v, heading: Math.atan2(-hx, -hy), lamps: head.lamps, state: '' });
      }
    }
    for (const [kind, b] of byKind) tile.group.add(b.mesh(this.roadMat(kind)));
    if (side.n) tile.group.add(side.mesh(this.mats.sidewalk));
    if (curb.n) tile.group.add(curb.mesh(this.mats.curb));
    if (disc.n) tile.group.add(disc.mesh(this.mats.asphalt));
    if (cross.n) tile.group.add(cross.mesh(this.mats.cross));
    if (white.n) tile.group.add(white.mesh(this.mats.white));
    if (barrier.n) tile.group.add(barrier.mesh(this.mats.barrier));
    if (pillars.length) {
      const geo = new THREE.BoxGeometry(1.6, 1, 1.6);
      geo.translate(0, 0.5, 0);
      const im = new THREE.InstancedMesh(geo, this.mats.pillar, pillars.length);
      const m = new THREE.Matrix4();
      pillars.forEach(([x, y, z], i) => {
        m.makeScale(1, z, 1);
        m.setPosition(x, 0, -y);
        im.setMatrixAt(i, m);
      });
      tile.group.add(im);
    }
    if (lights.length) {
      const pole = new THREE.CylinderGeometry(0.08, 0.1, 7, 6);
      pole.translate(0, 3.5, 0);
      const lamp = new THREE.BoxGeometry(0.5, 0.18, 1.4);
      lamp.translate(0, 7, -0.6);
      const ip = new THREE.InstancedMesh(pole, this.mats.pole, lights.length);
      const il = new THREE.InstancedMesh(lamp, this.streetLightMat, lights.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      lights.forEach(([x, y, rot], i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        m.compose(new THREE.Vector3(x, 0, -y), q, new THREE.Vector3(1, 1, 1));
        ip.setMatrixAt(i, m);
        il.setMatrixAt(i, m);
      });
      tile.group.add(ip, il);
    }
    this.scene.add(tile.group);
    this.loadBuildings(tile, tx, ty, edges);
  }

  /** (hx, hy): unit vector from the junction towards the approaching driver */
  private signalHead(x: number, y: number, hx: number, hy: number, roadW: number) {
    const obj = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5.6, 6), this.mats.pole);
    pole.position.set(0, 2.8, 0);
    obj.add(pole);
    const armLen = Math.min(roadW / 2, 6);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.12, 0.12), this.mats.pole);
    arm.position.set(armLen / 2, 5.4, 0);
    obj.add(arm);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.42, 0.25), this.mats.sigBox);
    box.position.set(armLen - 0.3, 5.4, 0);
    obj.add(box);
    const lamps: THREE.Mesh[] = [];
    // Japanese layout from left: 青 黄 赤 (as seen by the driver)
    const lampGeo = new THREE.CircleGeometry(0.15, 12);
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Mesh(lampGeo, this.lampOff);
      l.position.set(armLen - 0.3 - 0.4 + i * 0.4, 5.4, 0.13);
      obj.add(l);
      lamps.push(l);
    }
    // local +z faces the approaching driver, local +x points to the driver's right (road centre)
    obj.position.set(x, 0, -y);
    obj.rotation.y = Math.atan2(hx, -hy);
    return { obj, lamps };
  }

  private async loadBuildings(tile: Tile, tx: number, ty: number, edges: number[]) {
    // wait for index
    for (let i = 0; i < 50 && this.bldgIndex === null; i++) await new Promise((r) => setTimeout(r, 100));
    const key = `${tx}_${ty}`;
    let polys: { h: number; pts: [number, number][] }[] = [];
    if (this.bldgIndex?.has(key)) {
      try {
        const r = await fetch(import.meta.env.BASE_URL + `data/bldg/${key}.json`);
        const arr: number[] = await r.json();
        const ox = tx * TILE, oy = ty * TILE;
        for (let p = 0; p < arr.length; ) {
          const h = arr[p], n = arr[p + 1];
          const pts: [number, number][] = [];
          for (let k = 0; k < n; k++) pts.push([ox + arr[p + 2 + k * 2], oy + arr[p + 3 + k * 2]]);
          p += 2 + n * 2;
          polys.push({ h, pts });
        }
      } catch {
        polys = [];
      }
    }
    if (!polys.length) polys = this.proceduralBuildings(tx, ty, edges);
    if (tile.disposed) return;
    const wall = new Builder(true);
    const house = new Builder(true);
    const roof = new Builder();
    const central = this.isCentral(tx * TILE + TILE / 2, ty * TILE + TILE / 2);
    for (const b of polys) {
      let pts = b.pts;
      if (pts.length < 3) continue;
      // ensure counter-clockwise
      if (signedArea(pts) < 0) pts = pts.slice().reverse();
      const area = Math.abs(signedArea(pts));
      let h = b.h;
      const rnd = hash(Math.round(pts[0][0] * 7 + pts[0][1] * 13));
      if (!h) {
        // unknown height: Osaka is mostly low-rise, taller blocks in the centre
        const k = central ? 1.5 : 1;
        if (area > 2500) h = (16 + rnd * 30) * k;
        else if (area > 700) h = (11 + rnd * 18) * k;
        else if (area > 160) h = (7 + rnd * 9) * (central ? 1.3 : 1);
        else h = 5.5 + rnd * 3.5;
      }
      const tone = 0.62 + rnd * 0.36;
      const tint = rnd < 0.33 ? [tone, tone * 0.97, tone * 0.92] : rnd < 0.66 ? [tone * 0.95, tone * 0.97, tone] : [tone, tone, tone];
      if (h < 13) house.extrude(pts, h, tint as [number, number, number], 12, 11.6);
      else wall.extrude(pts, h, tint as [number, number, number]);
      roof.roof(pts, h);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of pts) (minX = Math.min(minX, x)), (minY = Math.min(minY, y)), (maxX = Math.max(maxX, x)), (maxY = Math.max(maxY, y));
      tile.buildings.push({ poly: pts, minX, minY, maxX, maxY });
    }
    if (wall.n) tile.group.add(wall.mesh(this.facadeMat));
    if (house.n) tile.group.add(house.mesh(this.houseMat));
    if (roof.n) tile.group.add(roof.mesh(this.mats.roof));
  }

  private isCentral(x: number, y: number) {
    const w = this.sim.world.wardAt(x, y)?.name ?? '';
    return ['北区', '中央区', '西区', '浪速区', '天王寺区', '福島区', '阿倍野区', '淀川区'].includes(w);
  }

  /** fallback city blocks along streets when no footprint data is available */
  private proceduralBuildings(tx: number, ty: number, edges: number[]) {
    const g = this.g;
    const out: { h: number; pts: [number, number][] }[] = [];
    const central = this.isCentral(tx * TILE + TILE / 2, ty * TILE + TILE / 2);
    for (const e of edges) {
      if (g.ecls[e] === CLS_MOTORWAY || g.eflags[e] & F_LINK) continue;
      const w = roadWidth(g, e);
      const L = g.elen[e];
      for (const sideSign of [1, -1]) {
        for (let s = 14; s < L - 14; s += 13 + hash(e * 31 + s) * 6) {
          const p = g.pointAt(e, s);
          const nx = -p.hy * sideSign, ny = p.hx * sideSign;
          const rnd = hash(e * 977 + Math.round(s) * 3 + (sideSign > 0 ? 1 : 0));
          const depth = 10 + rnd * 12, width = 9 + rnd * 4;
          const off = w / 2 + (g.ecls[e] <= 4 ? 3.5 : 1.2);
          const bx = p.x + nx * (off + depth / 2), by = p.y + ny * (off + depth / 2);
          const ax = p.hx, ay = p.hy;
          const corners: [number, number][] = [
            [bx - ax * width / 2 - nx * depth / 2, by - ay * width / 2 - ny * depth / 2],
            [bx + ax * width / 2 - nx * depth / 2, by + ay * width / 2 - ny * depth / 2],
            [bx + ax * width / 2 + nx * depth / 2, by + ay * width / 2 + ny * depth / 2],
            [bx - ax * width / 2 + nx * depth / 2, by - ay * width / 2 + ny * depth / 2],
          ];
          const h = g.ecls[e] <= 3 ? (central ? 25 + rnd * 45 : 12 + rnd * 18) : 6 + rnd * (central ? 20 : 8);
          out.push({ h, pts: corners });
        }
      }
    }
    return out;
  }

  private buildWater(x: number, y: number) {
    if (!this.baseData) return;
    this.waterCenter = [x, y];
    for (const c of [...this.waterGroup.children]) {
      this.waterGroup.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const R = 2600;
    for (const f of this.baseData.features) {
      const k = (f.properties as { k: string }).k;
      if (k !== 'water' && k !== 'sea') continue;
      const polys = f.geometry.type === 'MultiPolygon' ? (f.geometry as GeoJSON.MultiPolygon).coordinates : [(f.geometry as GeoJSON.Polygon).coordinates];
      for (const poly of polys) {
        const outer = poly[0].map(([lo, la]) => toLocal(lo, la));
        let near = false;
        for (const [px, py] of outer)
          if (Math.abs(px - x) < R && Math.abs(py - y) < R) {
            near = true;
            break;
          }
        if (!near || outer.length < 4) continue;
        const shape = new THREE.Shape(outer.map(([px, py]) => new THREE.Vector2(px, py)));
        for (const h of poly.slice(1)) shape.holes.push(new THREE.Path(h.map(([lo, la]) => new THREE.Vector2(...toLocal(lo, la)))));
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2); // (x, y) -> (x, 0, -y)
        const m = new THREE.Mesh(geo, this.mats.water);
        m.position.y = -0.3;
        this.waterGroup.add(m);
      }
    }
  }

  dispose() {
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear();
    this.scene.remove(this.waterGroup);
  }
}

import { proj } from '../shared/proj.js';
function toLocal(lon: number, lat: number): [number, number] {
  return proj(lon, lat);
}

function signedArea(p: [number, number][]) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]);
  return -a / 2;
}

/** offset a polyline to the left (positive d) */
function offsetLine(pts: [number, number, number][], d: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    out.push([pts[i][0] - (dy / L) * d, pts[i][1] + (dx / L) * d, pts[i][2]]);
  }
  return out;
}

/** cut ra metres from the start and rb from the end of a polyline */
function trimLine(pts: [number, number, number][], ra: number, rb: number): [number, number, number][] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  if (L - ra - rb < 2) return [];
  const at = (s: number): [number, number, number] => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * t];
  };
  const out: [number, number, number][] = [at(ra)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > ra && cum[i] < L - rb) out.push(pts[i]);
  out.push(at(L - rb));
  return out;
}

/** accumulates triangles into a single BufferGeometry */
class Builder {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  n = 0;
  private colors: boolean;
  constructor(colors = false) {
    this.colors = colors;
  }
  private v(x: number, y: number, z: number, u: number, w: number, c?: [number, number, number]) {
    this.pos.push(x, z, -y);
    this.uv.push(u, w);
    if (this.colors) this.col.push(...(c ?? [1, 1, 1]));
    return this.n++;
  }
  /** road-like strip along polyline pts (x,y,z) with width w; v texture coordinate per `rep` metres */
  strip(pts: [number, number, number][], w: number, lift: number, rep: number) {
    let acc = 0;
    let prevL = -1, prevR = -1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      let nx = -dy / L, ny = dx / L;
      // miter correction at interior vertices
      if (i > 0 && i < pts.length - 1) {
        const d1x = pts[i][0] - pts[i - 1][0], d1y = pts[i][1] - pts[i - 1][1];
        const l1 = Math.hypot(d1x, d1y) || 1;
        const n1x = -d1y / l1, n1y = d1x / l1;
        const dot = nx * n1x + ny * n1y;
        const k = 1 / Math.max(0.5, dot);
        nx *= k;
        ny *= k;
      }
      if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const [x, y, z] = pts[i];
      const l = this.v(x + (nx * w) / 2, y + (ny * w) / 2, z + lift, 0, acc / rep);
      const r = this.v(x - (nx * w) / 2, y - (ny * w) / 2, z + lift, 1, acc / rep);
      if (prevL >= 0) this.idx.push(prevL, prevR, l, prevR, r, l);
      prevL = l;
      prevR = r;
    }
  }
  /** vertical wall along a polyline from z0 to z0+h */
  wall(pts: [number, number, number][], z0: number, h: number) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const i0 = this.v(a[0], a[1], a[2] + z0, 0, 0), i1 = this.v(b[0], b[1], b[2] + z0, 1, 0);
      const i2 = this.v(b[0], b[1], b[2] + z0 + h, 1, 1), i3 = this.v(a[0], a[1], a[2] + z0 + h, 0, 1);
      this.idx.push(i0, i1, i2, i0, i2, i3);
    }
  }
  disc(x: number, y: number, r: number, z: number, rep: number) {
    const c = this.v(x, y, z, 0.5, 0.5);
    const N = 20;
    const first = this.n;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      this.v(x + Math.cos(a) * r, y + Math.sin(a) * r, z, 0.5 + (Math.cos(a) * r) / rep, 0.5 + (Math.sin(a) * r) / rep);
    }
    for (let i = 0; i < N; i++) this.idx.push(c, first + i, first + ((i + 1) % N));
  }
  /** rectangle centred at (x,y), `len` along (hx,hy) direction... width across */
  quad(x: number, y: number, hx: number, hy: number, across: number, along: number, z: number, urep: number) {
    const nx = -hy, ny = hx;
    const p = (s: number, t: number) => [x + nx * s + hx * t, y + ny * s + hy * t] as const;
    const a = p(-across / 2, -along / 2), b = p(across / 2, -along / 2), c = p(across / 2, along / 2), d = p(-across / 2, along / 2);
    const i0 = this.v(a[0], a[1], z, 0, 0), i1 = this.v(b[0], b[1], z, urep, 0), i2 = this.v(c[0], c[1], z, urep, 1), i3 = this.v(d[0], d[1], z, 0, 1);
    this.idx.push(i0, i2, i1, i0, i3, i2);
  }
  extrude(pts: [number, number][], h: number, c: [number, number, number], uDiv = 24, vDiv = 26.4) {
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // window grid: 3 m wide × 3.3 m tall cells, texture holds 8×8 cells
      const u0 = acc / uDiv, u1 = (acc + L) / uDiv;
      const vh = h / vDiv;
      const i0 = this.v(a[0], a[1], 0, u0, 0, c), i1 = this.v(b[0], b[1], 0, u1, 0, c);
      const i2 = this.v(b[0], b[1], h, u1, vh, c), i3 = this.v(a[0], a[1], h, u0, vh, c);
      this.idx.push(i0, i1, i2, i0, i2, i3);
      acc += L;
    }
  }
  roof(pts: [number, number][], h: number) {
    const tri = THREE.ShapeUtils.triangulateShape(
      pts.map(([x, y]) => new THREE.Vector2(x, y)),
      [],
    );
    const base = this.n;
    for (const [x, y] of pts) this.v(x, y, h, 0, 0);
    for (const t of tri) this.idx.push(base + t[0], base + t[1], base + t[2]);
  }
  mesh(mat: THREE.Material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.matrixAutoUpdate = false;
    return m;
  }
}

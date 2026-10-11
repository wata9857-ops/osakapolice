// Ambient road traffic around the player's vehicle: keeps left, obeys signals, yields to sirens.
import * as THREE from 'three';
import type { RoadGraph } from '../sim/graph';
import { CLS_MOTORWAY, F_LINK, F_ONEWAY, F_TUNNEL } from '../sim/graph';
import type { StreetWorld } from './world3d';
import { roadWidth, laneCount } from './world3d';
import { civilianGeometry, vehicleMaterial } from './models';

export interface PlayerState {
  x: number;
  y: number;
  heading: number;
  v: number;
  siren: boolean;
}

interface AICar {
  edge: number;
  dir: 1 | -1;
  s: number;
  v: number;
  lane: number;
  pull: number; // 0..1 pulled over to the kerb
  length: number;
  mesh: THREE.Mesh;
  x: number;
  y: number;
  h: number;
  vmax: number;
  stopped: number;
}

const MAX = 34;

export class Traffic {
  cars: AICar[] = [];
  private g: RoadGraph;
  private rnd = Math.random;
  private scene: THREE.Scene;
  private world: StreetWorld;
  constructor(scene: THREE.Scene, world: StreetWorld) {
    this.scene = scene;
    this.world = world;
    this.g = world.g;
  }

  private drivable(e: number) {
    const g = this.g;
    return g.ecls[e] !== CLS_MOTORWAY && !(g.eflags[e] & F_LINK) && !(g.eflags[e] & F_TUNNEL) && g.ecls[e] <= 6;
  }

  private spawn(p: PlayerState) {
    const g = this.g;
    const a = this.rnd() * Math.PI * 2, r = 120 + this.rnd() * 330;
    const x = p.x + Math.sin(a) * r, y = p.y + Math.cos(a) * r;
    const n = g.nearest(x, y, 120, (e) => this.drivable(e) && g.ecls[e] <= (this.rnd() < 0.8 ? 4 : 6));
    if (!n) return;
    const one = g.eflags[n.edge] & F_ONEWAY;
    const dir: 1 | -1 = one ? 1 : this.rnd() < 0.5 ? 1 : -1;
    // keep away from other cars
    for (const c of this.cars) if (c.edge === n.edge && Math.abs(c.s - n.s) < 15) return;
    if (Math.hypot(n.x - p.x, n.y - p.y) < 60) return;
    const variant = Math.floor(this.rnd() * 55);
    const { geo, length } = civilianGeometry(variant);
    const mesh = new THREE.Mesh(geo, vehicleMaterial);
    this.scene.add(mesh);
    const lanes = laneCount(g, n.edge);
    const perDir = one ? lanes : Math.max(1, Math.floor(lanes / 2));
    this.cars.push({
      edge: n.edge, dir, s: n.s, v: 6, lane: Math.floor(this.rnd() * perDir), pull: 0, length, mesh, x: n.x, y: n.y, h: 0,
      vmax: g.speed(n.edge) * (0.8 + this.rnd() * 0.3), stopped: 0,
    });
  }

  update(dt: number, p: PlayerState, t: number) {
    while (this.cars.length < MAX && this.rnd() < 0.5) this.spawn(p);
    const g = this.g;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (Math.hypot(c.x - p.x, c.y - p.y) > 560 || c.stopped > 90) {
        this.scene.remove(c.mesh);
        this.cars.splice(i, 1);
      }
    }
    for (const c of this.cars) {
      const L = g.elen[c.edge];
      const remain = c.dir === 1 ? L - c.s : c.s;
      let vt = Math.min(c.vmax, g.speed(c.edge));
      // signal ahead
      const vEnd = c.dir === 1 ? g.eb[c.edge] : g.ea[c.edge];
      if (g.signal[vEnd] && remain < 45) {
        const st = this.world.signalState(vEnd, c.h, t);
        const stopAt = roadWidth(g, c.edge) / 2 + 8;
        if (st === 'R' || (st === 'Y' && remain > 18)) vt = Math.min(vt, Math.max(0, (remain - stopAt) * 0.5));
      }
      // slow before corners on minor roads
      if (remain < 20 && g.ecls[c.edge] >= 5) vt = Math.min(vt, 6);
      // leader on the same edge & direction
      let gap = Infinity;
      for (const o of this.cars) {
        if (o === c || o.edge !== c.edge || o.dir !== c.dir || o.lane !== c.lane) continue;
        const d = (o.s - c.s) * c.dir;
        if (d > 0 && d < gap) gap = d - (o.length + c.length) / 2;
      }
      // player vehicle ahead in our path
      const hx = Math.sin(c.h), hy = Math.cos(c.h);
      const px = p.x - c.x, py = p.y - c.y;
      const ahead = px * hx + py * hy;
      const lateral = Math.abs(px * hy - py * hx);
      if (ahead > 0 && lateral < 2.4) gap = Math.min(gap, ahead - 4.5);
      if (gap < Infinity) vt = Math.min(vt, Math.max(0, (gap - 3) * 0.6));
      // yield to an approaching emergency vehicle (left-hand traffic: pull over to the left kerb)
      const behind = -ahead;
      const sameDir = Math.cos(p.heading - c.h) > 0.5;
      if (p.siren && ((behind > 0 && behind < 70 && lateral < 6 && sameDir) || (Math.hypot(px, py) < 35 && !sameDir))) {
        c.pull = Math.min(1, c.pull + dt * 0.8);
        vt = Math.min(vt, 2);
      } else c.pull = Math.max(0, c.pull - dt * 0.4);
      const acc = c.v < vt ? 2.2 : -6;
      c.v += Math.max(-6 * dt, Math.min(acc * dt, vt - c.v));
      if (c.v < 0) c.v = 0;
      c.stopped = c.v < 0.3 ? c.stopped + dt : 0;
      c.s += c.v * dt * c.dir;
      if (c.s > L || c.s < 0) this.nextEdge(c);
      // position: keep left of the centre line
      const pt = g.pointAt(c.edge, Math.max(0, Math.min(g.elen[c.edge], c.s)));
      const dx = pt.hx * c.dir, dy = pt.hy * c.dir;
      const w = roadWidth(g, c.edge);
      const lanes = laneCount(g, c.edge);
      const one = g.eflags[c.edge] & F_ONEWAY;
      let off: number;
      if (one) off = -w / 2 + (w / Math.max(1, lanes)) * (c.lane + 0.5);
      else if (lanes < 2) off = -w / 4;
      else off = -(w / lanes) * (c.lane + 0.5);
      off = off * (1 - c.pull) + (-w / 2 + 1.1) * c.pull;
      // left normal of travel direction is (-dy, dx); negative offset => left
      c.x = pt.x - dy * -off;
      c.y = pt.y + dx * -off;
      const targetH = Math.atan2(dx, dy);
      let dh = targetH - c.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      c.h += dh * Math.min(1, dt * 6);
      c.mesh.position.set(c.x, 0, -c.y);
      c.mesh.rotation.y = -c.h;
    }
  }

  private nextEdge(c: AICar) {
    const g = this.g;
    const v = c.dir === 1 ? g.eb[c.edge] : g.ea[c.edge];
    const opts: { e: number; d: 1 | -1; w: number }[] = [];
    for (let k = g.adjS[v]; k < g.adjS[v + 1]; k++) {
      const e = g.adjE[k], d = g.adjD[k] as 1 | -1;
      if (e === c.edge || !this.drivable(e) || !g.canTraverse(e, d)) continue;
      const w = (g.ecls[e] <= g.ecls[c.edge] ? 3 : 1) * (g.ecls[e] >= 6 ? 0.4 : 1);
      opts.push({ e, d, w });
    }
    if (!opts.length) {
      c.stopped = 999; // dead end: despawn
      c.s = Math.max(0, Math.min(g.elen[c.edge], c.s));
      return;
    }
    let r = this.rnd() * opts.reduce((a, o) => a + o.w, 0);
    let pick = opts[0];
    for (const o of opts) {
      r -= o.w;
      if (r <= 0) {
        pick = o;
        break;
      }
    }
    c.edge = pick.e;
    c.dir = pick.d;
    c.s = pick.d === 1 ? 0 : g.elen[pick.e];
    const lanes = laneCount(g, c.edge);
    const perDir = g.eflags[c.edge] & F_ONEWAY ? lanes : Math.max(1, Math.floor(lanes / 2));
    c.lane = Math.min(c.lane, perDir - 1);
    c.vmax = g.speed(c.edge) * (0.8 + this.rnd() * 0.3);
  }

  /** simple circle collision against the player; returns true if hit */
  collide(x: number, y: number): AICar | null {
    for (const c of this.cars) {
      const dx = c.x - x, dy = c.y - y;
      if (dx * dx + dy * dy < 2.3 * 2.3) return c;
    }
    return null;
  }

  dispose() {
    for (const c of this.cars) this.scene.remove(c.mesh);
    this.cars = [];
  }
}

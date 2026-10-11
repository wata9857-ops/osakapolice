// Road network graph built from OpenStreetMap data (see tools/build-data.mjs).
// Coordinates are local metres (x east, y north) from the shared projection.

export const ROAD_CLASS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street'] as const;
export const CLS_MOTORWAY = 0;
export const CLS_TERTIARY = 4;

/** Free-flow speeds (km/h) per road class, used when OSM has no maxspeed. */
const BASE_KMH = [60, 50, 50, 40, 40, 30, 20, 15];

export const F_ONEWAY = 1, F_BRIDGE = 2, F_TUNNEL = 4, F_LINK = 8, F_CITY = 16;

export interface RoadData {
  origin: [number, number];
  k: [number, number];
  v: number[];
  n: string[];
  e: number[];
}

/** A position on the network: edge index, travel direction (+1 a→b, -1 b→a), distance from vertex a. */
export interface NetPos {
  edge: number;
  dir: 1 | -1;
  s: number;
}

export interface RouteLeg {
  edge: number;
  dir: 1 | -1;
  s0: number; // start distance from vertex a
  s1: number; // end distance from vertex a
}

export interface Route {
  legs: RouteLeg[];
  length: number;
  time: number; // estimated seconds
}

export interface RouteOptions {
  emergency?: boolean;
  ignoreOneway?: boolean; // bicycles / officers on foot
  fixedKmh?: number; // speed ignoring road class (bicycle / foot)
  avoidMotorway?: boolean;
  preferMajor?: boolean;
  traffic?: (edge: number) => number; // speed multiplier 0..1
}

class MinHeap {
  ids: number[] = [];
  keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lid = ids.pop()!, lk = keys.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lk) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lid;
      keys[i] = lk;
    }
    return top;
  }
  topKey() {
    return this.keys[0];
  }
}

export class RoadGraph {
  nv: number;
  ne: number;
  vx: Float64Array;
  vy: Float64Array;
  ea: Int32Array;
  eb: Int32Array;
  ecls: Uint8Array;
  eflags: Uint8Array;
  elanes: Uint8Array;
  ename: Int32Array;
  emax: Uint8Array;
  elayer: Int8Array;
  elen: Float64Array;
  /** geometry: points of edge i are gx/gy[gs[i] .. gs[i+1]) including both endpoints */
  gs: Int32Array;
  gx: Float64Array;
  gy: Float64Array;
  /** cumulative distance along geometry */
  gd: Float64Array;
  names: string[];
  // adjacency (CSR): arcs leaving vertex v: adjE/adjD[adjS[v] .. adjS[v+1])
  adjS: Int32Array;
  adjE: Int32Array;
  adjD: Int8Array;
  /** vertex -> signalised */
  signal: Uint8Array;
  signalName = new Map<number, string>();
  // spatial grid of edges
  private cell = 120;
  private grid = new Map<number, number[]>();
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  constructor(d: RoadData) {
    this.names = d.n;
    this.nv = d.v.length / 2;
    this.vx = new Float64Array(this.nv);
    this.vy = new Float64Array(this.nv);
    for (let i = 0; i < this.nv; i++) {
      this.vx[i] = d.v[i * 2] / 10;
      this.vy[i] = d.v[i * 2 + 1] / 10;
    }
    // count edges
    const e = d.e;
    let ne = 0, np = 0;
    for (let p = 0; p < e.length; ) {
      const n = e[p + 8];
      ne++;
      np += n + 2;
      p += 9 + n * 2;
    }
    this.ne = ne;
    this.ea = new Int32Array(ne);
    this.eb = new Int32Array(ne);
    this.ecls = new Uint8Array(ne);
    this.eflags = new Uint8Array(ne);
    this.elanes = new Uint8Array(ne);
    this.ename = new Int32Array(ne);
    this.emax = new Uint8Array(ne);
    this.elayer = new Int8Array(ne);
    this.elen = new Float64Array(ne);
    this.gs = new Int32Array(ne + 1);
    this.gx = new Float64Array(np);
    this.gy = new Float64Array(np);
    this.gd = new Float64Array(np);
    let q = 0;
    for (let p = 0, i = 0; p < e.length; i++) {
      const a = e[p], b = e[p + 1], n = e[p + 8];
      this.ea[i] = a;
      this.eb[i] = b;
      this.ecls[i] = e[p + 2];
      this.eflags[i] = e[p + 3];
      this.elanes[i] = e[p + 4];
      this.ename[i] = e[p + 5];
      this.emax[i] = e[p + 6];
      this.elayer[i] = e[p + 7];
      this.gs[i] = q;
      let px = d.v[a * 2], py = d.v[a * 2 + 1];
      this.gx[q] = px / 10;
      this.gy[q] = py / 10;
      this.gd[q] = 0;
      q++;
      p += 9;
      for (let k = 0; k < n; k++, p += 2) {
        px += e[p];
        py += e[p + 1];
        this.gx[q] = px / 10;
        this.gy[q] = py / 10;
        this.gd[q] = this.gd[q - 1] + Math.hypot(this.gx[q] - this.gx[q - 1], this.gy[q] - this.gy[q - 1]);
        q++;
      }
      this.gx[q] = this.vx[b];
      this.gy[q] = this.vy[b];
      this.gd[q] = this.gd[q - 1] + Math.hypot(this.gx[q] - this.gx[q - 1], this.gy[q] - this.gy[q - 1]);
      this.elen[i] = Math.max(this.gd[q], 0.5);
      q++;
    }
    this.gs[ne] = q;
    // adjacency
    const deg = new Int32Array(this.nv + 1);
    for (let i = 0; i < ne; i++) {
      deg[this.ea[i]]++;
      deg[this.eb[i]]++; // reverse arc stored even for oneway (flag checked at search time)
    }
    this.adjS = new Int32Array(this.nv + 1);
    for (let v = 0; v < this.nv; v++) this.adjS[v + 1] = this.adjS[v] + deg[v];
    this.adjE = new Int32Array(this.adjS[this.nv]);
    this.adjD = new Int8Array(this.adjS[this.nv]);
    const fill = this.adjS.slice(0, this.nv);
    for (let i = 0; i < ne; i++) {
      let k = fill[this.ea[i]]++;
      this.adjE[k] = i;
      this.adjD[k] = 1;
      k = fill[this.eb[i]]++;
      this.adjE[k] = i;
      this.adjD[k] = -1;
    }
    this.signal = new Uint8Array(this.nv);
    // spatial grid
    for (let i = 0; i < ne; i++) {
      const cells = new Set<number>();
      for (let k = this.gs[i]; k < this.gs[i + 1]; k++) {
        const x = this.gx[k], y = this.gy[k];
        if (x < this.minX) this.minX = x;
        if (y < this.minY) this.minY = y;
        if (x > this.maxX) this.maxX = x;
        if (y > this.maxY) this.maxY = y;
        cells.add(this.cellKey(x, y));
        if (k + 1 < this.gs[i + 1]) {
          // sample long segments
          const L = this.gd[k + 1] - this.gd[k];
          const steps = Math.floor(L / (this.cell * 0.5));
          for (let s = 1; s <= steps; s++) {
            const t = s / (steps + 1);
            cells.add(this.cellKey(x + (this.gx[k + 1] - x) * t, y + (this.gy[k + 1] - y) * t));
          }
        }
      }
      for (const c of cells) {
        let arr = this.grid.get(c);
        if (!arr) this.grid.set(c, (arr = []));
        arr.push(i);
      }
    }
  }

  setSignals(list: (number | [number, string])[]) {
    for (const s of list) {
      if (Array.isArray(s)) {
        this.signal[s[0]] = 1;
        this.signalName.set(s[0], s[1]);
      } else this.signal[s] = 1;
    }
  }

  private cellKey(x: number, y: number) {
    return Math.floor(x / this.cell) * 100000 + Math.floor(y / this.cell);
  }

  name(edge: number) {
    return this.names[this.ename[edge]] || '';
  }
  oneway(edge: number) {
    return (this.eflags[edge] & F_ONEWAY) !== 0;
  }
  canTraverse(edge: number, dir: number, ignoreOneway = false) {
    return dir === 1 || ignoreOneway || !(this.eflags[edge] & F_ONEWAY);
  }
  /** free-flow speed in m/s */
  speed(edge: number) {
    const kmh = this.emax[edge] || BASE_KMH[this.ecls[edge]];
    return kmh / 3.6;
  }
  degree(v: number) {
    return this.adjS[v + 1] - this.adjS[v];
  }

  /** point and heading at distance s from vertex a along edge */
  pointAt(edge: number, s: number): { x: number; y: number; hx: number; hy: number } {
    const g0 = this.gs[edge], g1 = this.gs[edge + 1] - 1;
    if (s <= 0) s = 0;
    if (s >= this.gd[g1]) s = this.gd[g1];
    let lo = g0, hi = g1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.gd[m] <= s) lo = m;
      else hi = m;
    }
    const L = this.gd[hi] - this.gd[lo] || 1e-9;
    const t = (s - this.gd[lo]) / L;
    const dx = this.gx[hi] - this.gx[lo], dy = this.gy[hi] - this.gy[lo];
    return { x: this.gx[lo] + dx * t, y: this.gy[lo] + dy * t, hx: dx / L, hy: dy / L };
  }

  /** polyline of edge from s0 to s1 (s values from vertex a; s1 < s0 means reverse) */
  slice(edge: number, s0: number, s1: number, out: [number, number][] = []) {
    const g0 = this.gs[edge], g1 = this.gs[edge + 1];
    const p0 = this.pointAt(edge, s0);
    out.push([p0.x, p0.y]);
    if (s1 >= s0) {
      for (let k = g0; k < g1; k++) if (this.gd[k] > s0 && this.gd[k] < s1) out.push([this.gx[k], this.gy[k]]);
    } else {
      for (let k = g1 - 1; k >= g0; k--) if (this.gd[k] < s0 && this.gd[k] > s1) out.push([this.gx[k], this.gy[k]]);
    }
    const p1 = this.pointAt(edge, s1);
    out.push([p1.x, p1.y]);
    return out;
  }

  edgesNear(x: number, y: number, r: number): number[] {
    const c = this.cell;
    const res = new Set<number>();
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let i = x0; i <= x1; i++)
      for (let j = y0; j <= y1; j++) {
        const arr = this.grid.get(i * 100000 + j);
        if (arr) for (const e of arr) res.add(e);
      }
    return [...res];
  }

  /** nearest point on the network. filter can exclude edges (e.g. motorways for walkers). */
  nearest(x: number, y: number, maxR = 600, filter?: (e: number) => boolean): { edge: number; s: number; d: number; x: number; y: number } | null {
    let best: { edge: number; s: number; d: number; x: number; y: number } | null = null;
    for (let r = 80; r <= maxR * 2; r *= 2) {
      for (const e of this.edgesNear(x, y, Math.min(r, maxR))) {
        if (filter && !filter(e)) continue;
        for (let k = this.gs[e]; k < this.gs[e + 1] - 1; k++) {
          const ax = this.gx[k], ay = this.gy[k], bx = this.gx[k + 1], by = this.gy[k + 1];
          const dx = bx - ax, dy = by - ay;
          const L2 = dx * dx + dy * dy || 1e-9;
          let t = ((x - ax) * dx + (y - ay) * dy) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + dx * t, py = ay + dy * t;
          const d = Math.hypot(px - x, py - y);
          if (!best || d < best.d) best = { edge: e, s: this.gd[k] + t * (this.gd[k + 1] - this.gd[k]), d, x: px, y: py };
        }
      }
      if (best || r >= maxR) break;
    }
    return best;
  }

  nearestVertex(x: number, y: number, maxR = 500): number {
    let best = -1, bd = Infinity;
    for (const e of this.edgesNear(x, y, maxR)) {
      for (const v of [this.ea[e], this.eb[e]]) {
        const d = Math.hypot(this.vx[v] - x, this.vy[v] - y);
        if (d < bd) (bd = d), (best = v);
      }
    }
    return best;
  }

  /** travel cost (seconds) of traversing a full edge */
  edgeCost(e: number, o: RouteOptions): number {
    const cls = this.ecls[e];
    if (o.fixedKmh) {
      if (cls === CLS_MOTORWAY) return Infinity;
      return this.elen[e] / (o.fixedKmh / 3.6);
    }
    if (o.avoidMotorway && cls === CLS_MOTORWAY) return Infinity;
    let v = this.speed(e) * (o.traffic ? o.traffic(e) : 1);
    if (o.emergency) v = Math.min(v * 1.45 + 2, 30);
    let c = this.elen[e] / Math.max(v, 1.5);
    if (o.preferMajor && cls >= 5) c *= 1.8;
    return c;
  }
  /** expected delay passing through vertex v */
  nodeDelay(v: number, o: RouteOptions): number {
    if (!this.signal[v]) return o.fixedKmh ? 2 : 1;
    return o.emergency ? 4 : o.fixedKmh ? 15 : 18;
  }

  // reusable search buffers (reset lazily via list of touched vertices)
  private sg!: Float64Array;
  private sPrevE!: Int32Array;
  private sPrevD!: Int8Array;
  private sSettled!: Uint8Array;
  private sTouched: number[] = [];
  private scratch() {
    if (!this.sg) {
      this.sg = new Float64Array(this.nv).fill(Infinity);
      this.sPrevE = new Int32Array(this.nv).fill(-2);
      this.sPrevD = new Int8Array(this.nv);
      this.sSettled = new Uint8Array(this.nv);
    }
    for (const v of this.sTouched) {
      this.sg[v] = Infinity;
      this.sPrevE[v] = -2;
      this.sSettled[v] = 0;
    }
    this.sTouched.length = 0;
    return { sg: this.sg, sPrevE: this.sPrevE, sPrevD: this.sPrevD };
  }

  /** A* shortest-time route between two network positions. */
  route(from: NetPos, to: { edge: number; s: number }, o: RouteOptions = {}): Route | null {
    const { ea, eb, elen } = this;
    // direct along same edge
    if (from.edge === to.edge) {
      const d = to.s - from.s;
      const dir = d >= 0 ? 1 : -1;
      if (this.canTraverse(from.edge, dir, o.ignoreOneway) && (dir === from.dir || Math.abs(d) < 400)) {
        const t = (this.edgeCost(from.edge, o) * Math.abs(d)) / elen[from.edge];
        return { legs: [{ edge: from.edge, dir: dir as 1 | -1, s0: from.s, s1: to.s }], length: Math.abs(d), time: t };
      }
    }
    const { sg: g, sPrevE: prevE, sPrevD: prevD } = this.scratch();
    const heap = new MinHeap();
    const tx = this.pointAt(to.edge, to.s);
    const vmax = o.fixedKmh ? o.fixedKmh / 3.6 : o.emergency ? 30 : 22;
    const h = (v: number) => Math.hypot(this.vx[v] - tx.x, this.vy[v] - tx.y) / vmax;
    const fe = from.edge;
    const fc = this.edgeCost(fe, o) / elen[fe];
    // start: forward to b, or backward to a (U-turn penalty if facing the other way)
    if (this.canTraverse(fe, 1, o.ignoreOneway)) {
      const c = (elen[fe] - from.s) * fc + (from.dir === 1 ? 0 : 25);
      g[eb[fe]] = c;
      this.sTouched.push(eb[fe]);
      prevE[eb[fe]] = -1;
      prevD[eb[fe]] = 1;
      heap.push(eb[fe], c + h(eb[fe]));
    }
    if (this.canTraverse(fe, -1, o.ignoreOneway)) {
      const c = from.s * fc + (from.dir === -1 ? 0 : 25);
      if (c < g[ea[fe]]) {
        g[ea[fe]] = c;
        this.sTouched.push(ea[fe]);
        prevE[ea[fe]] = -1;
        prevD[ea[fe]] = -1;
        heap.push(ea[fe], c + h(ea[fe]));
      }
    }
    const te = to.edge;
    const tc = this.edgeCost(te, o) / elen[te];
    const ta = ea[te], tb = eb[te];
    let best = Infinity;
    let bestEnd = -1;
    const settled = this.sSettled;
    let iter = 0;
    while (heap.size) {
      if (heap.topKey() >= best) break;
      const v = heap.pop();
      if (settled[v]) continue;
      settled[v] = 1;
      if (++iter > 400000) break;
      // reaching target edge from this vertex
      if (v === ta && this.canTraverse(te, 1, o.ignoreOneway)) {
        const c = g[v] + to.s * tc;
        if (c < best) (best = c), (bestEnd = 1);
      }
      if (v === tb && this.canTraverse(te, -1, o.ignoreOneway)) {
        const c = g[v] + (elen[te] - to.s) * tc;
        if (c < best) (best = c), (bestEnd = -1);
      }
      const dl = this.nodeDelay(v, o);
      for (let k = this.adjS[v]; k < this.adjS[v + 1]; k++) {
        const e = this.adjE[k], d = this.adjD[k];
        if (!this.canTraverse(e, d, o.ignoreOneway)) continue;
        if (e === prevE[v] && prevE[v] >= 0) continue; // no immediate U-turn on same edge
        const w = d === 1 ? eb[e] : ea[e];
        const c = g[v] + this.edgeCost(e, o) + dl;
        if (c < g[w]) {
          if (g[w] === Infinity) this.sTouched.push(w);
          g[w] = c;
          prevE[w] = e;
          prevD[w] = d;
          heap.push(w, c + h(w));
        }
      }
    }
    if (best === Infinity) return null;
    // reconstruct
    const legs: RouteLeg[] = [];
    const endV = bestEnd === 1 ? ta : tb;
    legs.push({ edge: te, dir: bestEnd as 1 | -1, s0: bestEnd === 1 ? 0 : elen[te], s1: to.s });
    let v = endV;
    let guard = 0;
    while (prevE[v] !== -1 && guard++ < 100000) {
      const e = prevE[v], d = prevD[v];
      if (e < 0) return null;
      legs.push({ edge: e, dir: d as 1 | -1, s0: d === 1 ? 0 : elen[e], s1: d === 1 ? elen[e] : 0 });
      v = d === 1 ? ea[e] : eb[e];
    }
    const sd = prevD[v];
    legs.push({ edge: fe, dir: sd as 1 | -1, s0: from.s, s1: sd === 1 ? elen[fe] : 0 });
    legs.reverse();
    const clean = legs.filter((l) => Math.abs(l.s1 - l.s0) > 0.01);
    let length = 0;
    for (const l of clean) length += Math.abs(l.s1 - l.s0);
    return { legs: clean.length ? clean : legs.slice(0, 1), length, time: best };
  }

  /** route through intermediate waypoints */
  routeVia(from: NetPos, points: { edge: number; s: number }[], o: RouteOptions = {}): Route | null {
    let cur = from;
    const all: RouteLeg[] = [];
    let length = 0, time = 0;
    for (const p of points) {
      const r = this.route(cur, p, o);
      if (!r) return null;
      all.push(...r.legs);
      length += r.length;
      time += r.time;
      const last = r.legs[r.legs.length - 1];
      cur = { edge: last.edge, dir: last.dir, s: last.s1 };
    }
    return { legs: all, length, time };
  }

  /**
   * Reverse Dijkstra: time from every vertex to the target position (bounded).
   * Used to rank candidate units quickly.
   */
  timesTo(to: { edge: number; s: number }, o: RouteOptions, limit = 1800): Float64Array {
    const { ea, eb, elen } = this;
    const N = this.nv;
    const g = new Float64Array(N).fill(Infinity);
    const heap = new MinHeap();
    const te = to.edge;
    const tc = this.edgeCost(te, o) / elen[te];
    if (this.canTraverse(te, 1, o.ignoreOneway)) {
      g[ea[te]] = to.s * tc;
      heap.push(ea[te], g[ea[te]]);
    }
    if (this.canTraverse(te, -1, o.ignoreOneway)) {
      const c = (elen[te] - to.s) * tc;
      if (c < g[eb[te]]) {
        g[eb[te]] = c;
        heap.push(eb[te], c);
      }
    }
    const settled = new Uint8Array(N);
    while (heap.size) {
      const v = heap.pop();
      if (settled[v]) continue;
      settled[v] = 1;
      if (g[v] > limit) break;
      // incoming arcs: arcs at v reversed. Arc (e,d) leaving v goes v->w; incoming to v is from w via e with dir -d
      for (let k = this.adjS[v]; k < this.adjS[v + 1]; k++) {
        const e = this.adjE[k], d = this.adjD[k];
        // travelling from w to v along e means direction -d
        if (!this.canTraverse(e, -d, o.ignoreOneway)) continue;
        const w = d === 1 ? eb[e] : ea[e];
        const c = g[v] + this.edgeCost(e, o) + this.nodeDelay(v, o);
        if (c < g[w]) {
          g[w] = c;
          heap.push(w, c);
        }
      }
    }
    return g;
  }

  /** time from a network position to the target using precomputed timesTo table */
  timeFrom(pos: NetPos, table: Float64Array, o: RouteOptions, to?: { edge: number; s: number }): number {
    const e = pos.edge;
    const c = this.edgeCost(e, o) / this.elen[e];
    let best = Infinity;
    if (to && to.edge === e) best = Math.abs(to.s - pos.s) * c;
    if (this.canTraverse(e, 1, o.ignoreOneway)) best = Math.min(best, (this.elen[e] - pos.s) * c + (pos.dir === 1 ? 0 : 25) + table[this.eb[e]]);
    if (this.canTraverse(e, -1, o.ignoreOneway)) best = Math.min(best, pos.s * c + (pos.dir === -1 ? 0 : 25) + table[this.ea[e]]);
    return best;
  }

  /** human readable location string from the road network */
  describe(x: number, y: number): string {
    const n = this.nearest(x, y, 300, (e) => this.ecls[e] !== CLS_MOTORWAY);
    if (!n) return '';
    const nm = this.name(n.edge);
    // named signal nearby
    let sig = '';
    let sd = 260;
    for (const e of this.edgesNear(x, y, 260)) {
      for (const v of [this.ea[e], this.eb[e]]) {
        const s = this.signalName.get(v);
        if (!s) continue;
        const d = Math.hypot(this.vx[v] - x, this.vy[v] - y);
        if (d < sd) (sd = d), (sig = s);
      }
    }
    if (nm && sig) return `${nm} ${sig.endsWith('交差点') ? sig : sig + '交差点'}付近`;
    if (sig) return `${sig.endsWith('交差点') ? sig : sig + '交差点'}付近`;
    if (nm) return `${nm}付近`;
    // nearest named street within 150 m
    let bn = '', bd2 = 150;
    for (const e of this.edgesNear(x, y, 150)) {
      const s = this.name(e);
      if (!s || this.ecls[e] === CLS_MOTORWAY) continue;
      const p = this.pointAt(e, this.elen[e] / 2);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd2) (bd2 = d), (bn = s);
    }
    return bn ? `${bn}付近` : '';
  }
}

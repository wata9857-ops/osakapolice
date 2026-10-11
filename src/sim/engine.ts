// Core simulation: clock, unit movement, patrols, incidents, suspects, radio traffic.
import type { World } from './world';
import type { RoadGraph, Route, RouteOptions, NetPos } from './graph';
import { CLS_MOTORWAY, CLS_TERTIARY, F_LINK, F_CITY } from './graph';
import { INCIDENT_TYPES, TYPE_BY_KEY, type IncidentType, type Where } from './incidentTypes';
import type { Incident, Unit, RadioMsg, LogEntry, PatrolPlan, Suspect, UnitStatus } from './types';
import { AVAILABLE, STATUS_LABEL } from './types';
import { createUnits, areaPlan } from './units';
import * as R from './radio';
import { startEvent, tickEvent, endEvent, type ActiveEvent } from './events';
import { autoTick, selfInitiated, bulletin } from './autopilot';

/** 指令官 rank by score */
export const RANKS: [number, string][] = [
  [0, '巡査'], [800, '巡査長'], [2500, '巡査部長'], [6000, '警部補'], [12000, '警部'], [22000, '警視'], [38000, '警視正'], [60000, '警視長'], [90000, '警視監'],
];
export function rankOf(score: number) {
  let r = RANKS[0][1];
  for (const [s, n] of RANKS) if (score >= s) r = n;
  return r;
}
export function nextRank(score: number): [number, string] | null {
  for (const [s, n] of RANKS) if (score < s) return [s, n];
  return null;
}

export interface SimSettings {
  rate: number; // incident frequency multiplier
  autoReturn: boolean;
  /** automatic dispatcher: off / takes over after `autoDelay` real seconds of player inactivity / always */
  auto: 'off' | 'assist' | 'full';
  autoDelay: number;
  events: boolean;
}

export interface Candidate {
  unit: Unit;
  eta: number; // seconds
  dist: number; // metres straight line
  available: boolean;
}

type Listener = (type: string, payload?: unknown) => void;

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KOBAN_KMH = 14;
const FLEE_KMH: Record<string, number> = { foot: 6, bike: 15, moto: 45, car: 0 };

export class Sim {
  world: World;
  g: RoadGraph;
  rnd: () => number;
  t: number; // seconds since 00:00 of day 0 (JST)
  date0: Date; // calendar date of day 0
  speed = 1;
  paused = false;
  settings: SimSettings = { rate: 1, autoReturn: true, auto: 'assist', autoDelay: 45, events: true };
  events: ActiveEvent[] = [];
  weather: 'clear' | 'rain' = 'clear';
  /** real seconds since the player last touched the console */
  idleReal = 0;
  private nextEventT = 0;
  private nextBulletin = 0;
  private acc5 = 0;
  units: Unit[] = [];
  unitById = new Map<string, Unit>();
  incidents: Incident[] = [];
  incById = new Map<string, Incident>();
  radio: RadioMsg[] = [];
  log: LogEntry[] = [];
  stats = { received: 0, resolved: 0, failed: 0, arrests: 0, respTimes: [] as number[], score: 0, streak: 0, bestStreak: 0, tickets: 0, questioned: 0, auto: 0 };
  private radioQueue: { at: number; msg: Omit<RadioMsg, 'id' | 't'> }[] = [];
  private radioSeq = 0;
  private incSeq = 0;
  private listeners = new Set<Listener>();
  private acc1 = 0;
  private acc3 = 0;
  private nextSpawn = 0;
  tf: Float32Array; // traffic speed factor per edge
  trafficVersion = 0;
  private trafficT = -1e9;
  // precomputed location pools
  private poolSignal: number[] = [];
  private poolMajor: number[] = [];
  private poolMinor: number[] = [];
  private poolMotorway: number[] = [];
  private edgeMid: Float32Array;
  private candCache = new Map<string, { t: number; list: Candidate[] }>();

  constructor(world: World, opts: { startHour: number; seed?: number; date?: Date }) {
    this.world = world;
    this.g = world.graph;
    this.rnd = mulberry32(opts.seed ?? (Date.now() & 0xffffffff));
    R.setRadioRng(this.rnd);
    this.date0 = opts.date ?? new Date();
    this.t = opts.startHour * 3600;
    const g = this.g;
    this.tf = new Float32Array(g.ne).fill(1);
    this.edgeMid = new Float32Array(g.ne * 2);
    for (let e = 0; e < g.ne; e++) {
      const p = g.pointAt(e, g.elen[e] / 2);
      this.edgeMid[e * 2] = p.x;
      this.edgeMid[e * 2 + 1] = p.y;
      if (!(g.eflags[e] & F_CITY)) continue;
      const c = g.ecls[e];
      if (c === CLS_MOTORWAY) this.poolMotorway.push(e);
      else if (c <= 3 && !(g.eflags[e] & F_LINK)) this.poolMajor.push(e);
      else if (c >= 4) this.poolMinor.push(e);
    }
    for (let v = 0; v < g.nv; v++) {
      if (!g.signal[v]) continue;
      for (let k = g.adjS[v]; k < g.adjS[v + 1]; k++)
        if (g.eflags[g.adjE[k]] & F_CITY) {
          this.poolSignal.push(v);
          break;
        }
    }
    this.units = createUnits(world, this.rnd);
    for (const u of this.units) this.unitById.set(u.id, u);
    this.updateTraffic(true);
    // scatter patrolling units within their areas
    for (const u of this.units) {
      if (u.status === 'patrol' && u.patrol) {
        const p = this.randomPointInPlan(u, u.patrol);
        if (p) this.placeUnit(u, p.edge, p.s);
      }
    }
    this.nextSpawn = this.t + 15;
    this.nextEventT = this.t + 240;
    this.nextBulletin = this.t + 600;
    this.sys(`勤務開始。大阪府警察本部 通信指令本部、${this.units.length}隊を運用中。`);
  }

  // ---------------------------------------------------------------- events
  on(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  emit(type: string, payload?: unknown) {
    for (const l of this.listeners) l(type, payload);
  }

  // ---------------------------------------------------------------- clock
  get tod() {
    return ((this.t % 86400) + 86400) % 86400;
  }
  get hour() {
    return this.tod / 3600;
  }
  band(): 0 | 1 | 2 {
    const h = this.hour;
    return h >= 6 && h < 17 ? 0 : h >= 17 && h < 22 ? 1 : 2;
  }
  get isNight() {
    const h = this.hour;
    return h < 5.5 || h >= 18.5;
  }
  clockStr(t = this.t, sec = true) {
    const s = ((t % 86400) + 86400) % 86400;
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${sec ? ':' + String(ss).padStart(2, '0') : ''}`;
  }
  dateStr() {
    const d = new Date(this.date0.getTime() + Math.floor(this.t / 86400) * 86400000);
    const wd = '日月火水木金土'[d.getDay()];
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}（${wd}）`;
  }

  // ---------------------------------------------------------------- traffic
  private updateTraffic(force = false) {
    if (!force && this.t - this.trafficT < 60) return;
    this.trafficT = this.t;
    const g = this.g;
    const h = this.hour;
    const rush = Math.exp(-((h - 8) ** 2) / 1.2) + Math.exp(-((h - 18) ** 2) / 1.8);
    const day = h >= 7 && h < 21 ? 1 : h >= 5 && h < 7 ? 0.4 : h >= 21 && h < 24 ? 0.5 : 0.15;
    const majorBase = 1 - 0.3 * day - 0.32 * rush;
    const minorBase = 1 - 0.12 * day - 0.1 * rush;
    const ts = this.t / 60;
    const cores = [
      [0, 2500, 1600], [100, -1900, 1500], [1800, 600, 1300], [1250, -3800, 1200],
    ].map(([x, y, r]) => [x, y, r]);
    // incident / event slowdowns
    const blocks: [number, number, number, number][] = [];
    let globalMul = 1;
    for (const ev of this.events) {
      if (ev.x === undefined) globalMul *= ev.trafficMul;
      else if (ev.icon === '群') blocks.push([ev.x, ev.y!, ev.r ?? 500, 0.7]);
      else if (ev.trafficMul < 1) blocks.push([ev.x, ev.y!, ev.r ?? 1000, ev.trafficMul]);
      else if (ev.key === 'rain') globalMul *= ev.trafficMul;
    }
    for (const inc of this.incidents) {
      if (inc.status === 'resolved' || inc.status === 'failed') continue;
      if (inc.type.startsWith('acc') || inc.type === 'fire' || inc.type === 'signal' || inc.type === 'car_fire')
        blocks.push([inc.x, inc.y, inc.type === 'acc_major' ? 700 : 300, inc.type === 'acc_major' ? 0.25 : 0.55]);
    }
    for (let e = 0; e < g.ne; e++) {
      const x = this.edgeMid[e * 2], y = this.edgeMid[e * 2 + 1];
      const c = g.ecls[e];
      let f = (c <= CLS_TERTIARY ? majorBase : minorBase) * globalMul;
      if (c <= 3) {
        for (const [cx, cy, r] of cores) {
          const d = Math.hypot(x - cx, y - cy);
          if (d < r) f *= 0.85 + 0.15 * (d / r);
        }
        const n = Math.sin(x / 650 + ts / 37) * Math.cos(y / 820 - ts / 53) + 0.5 * Math.sin((x + y) / 400 + ts / 23);
        f *= 1 + 0.18 * n * day;
        if (c === CLS_MOTORWAY) f = Math.min(1, f + 0.12);
      }
      for (const [bx, by, br, bf] of blocks) {
        const dx = x - bx, dy = y - by;
        if (dx * dx + dy * dy < br * br) f *= c <= 4 ? bf : (bf + 1) / 2;
      }
      this.tf[e] = Math.max(0.12, Math.min(1, f));
    }
    this.trafficVersion++;
  }
  traffic = (e: number) => this.tf[e];

  routeOpts(u: Unit, emergency: boolean): RouteOptions {
    if (u.kind === 'koban') return { fixedKmh: KOBAN_KMH, ignoreOneway: true };
    const tr = u.kind === 'kotsu' ? (e: number) => Math.min(1, this.tf[e] * 1.5) : this.traffic;
    return {
      emergency,
      traffic: tr,
      preferMajor: u.routePref === 'major',
      avoidMotorway: u.routePref === 'nomotorway' || (!emergency && u.status === 'patrol'),
    };
  }

  // ---------------------------------------------------------------- radio
  say(from: string, to: string, text: string, meta: Partial<RadioMsg> = {}, delay = 0) {
    const msg = { from, to, text, level: meta.level ?? 'normal', channel: meta.channel ?? '指令', unitId: meta.unitId, incidentId: meta.incidentId };
    if (delay <= 0) this.pushRadio(msg as Omit<RadioMsg, 'id' | 't'>);
    else this.radioQueue.push({ at: this.t + delay, msg: msg as Omit<RadioMsg, 'id' | 't'> });
  }
  private pushRadio(m: Omit<RadioMsg, 'id' | 't'>) {
    const msg: RadioMsg = { ...m, id: ++this.radioSeq, t: this.t };
    this.radio.push(msg);
    if (this.radio.length > 800) this.radio.splice(0, this.radio.length - 800);
    this.emit('radio', msg);
  }
  sys(text: string, incidentId?: string, unitId?: string) {
    this.pushRadio({ from: 'システム', to: '', text, level: 'system', channel: 'システム', incidentId, unitId });
  }
  addLog(text: string, incidentId?: string, unitId?: string) {
    this.log.push({ t: this.t, text, incidentId, unitId });
    if (this.log.length > 3000) this.log.splice(0, 500);
  }

  // ---------------------------------------------------------------- main loop
  advance(realDt: number) {
    if (this.paused) return;
    this.idleReal += realDt;
    let dt = realDt * this.speed;
    while (dt > 0) {
      const step = Math.min(dt, 0.5);
      this.step(step);
      dt -= step;
    }
    this.emit('tick');
  }

  /** player touched the console: the assist dispatcher backs off */
  markActive() {
    this.idleReal = 0;
  }

  addScore(delta: number, reason: string, incidentId?: string) {
    this.stats.score = Math.max(0, this.stats.score + delta);
    this.emit('score', { delta, reason, incidentId });
  }

  private eventsTick() {
    // end expired events
    for (const ev of [...this.events]) {
      if (this.t >= ev.t1) {
        endEvent(this, ev);
        this.events = this.events.filter((e) => e !== ev);
        this.say(R.HQ, '各移動', `${R.HQ}から各移動。「${ev.name}」に伴う警戒態勢を解除する。`, { level: 'info' });
        this.emit('event', { ev, end: true });
      } else tickEvent(this, ev);
    }
    // new events
    if (this.settings.events && this.t >= this.nextEventT) {
      this.nextEventT = this.t + (25 + this.rnd() * 45) * 60;
      if (this.events.length < 3) {
        const ev = startEvent(this);
        if (ev) {
          this.say(R.HQ, '各移動', `${R.HQ}から各移動。${ev.name}。${ev.desc}。`, { level: 'urgent' });
          this.addLog(`情勢：${ev.name}`);
          this.emit('event', { ev, end: false });
          this.updateTraffic(true);
        }
      }
    }
    if (this.t >= this.nextBulletin) {
      this.nextBulletin = this.t + (12 + this.rnd() * 25) * 60;
      bulletin(this);
    }
  }

  private step(dt: number) {
    this.t += dt;
    this.updateTraffic();
    // radio queue
    if (this.radioQueue.length) {
      this.radioQueue.sort((a, b) => a.at - b.at);
      while (this.radioQueue.length && this.radioQueue[0].at <= this.t) this.pushRadio(this.radioQueue.shift()!.msg);
    }
    // spawn
    if (this.t >= this.nextSpawn) {
      this.spawnIncident();
      const h = this.hour;
      const diurnal = h >= 1 && h < 6 ? 0.55 : h >= 6 && h < 9 ? 0.9 : h >= 9 && h < 17 ? 1 : h >= 17 && h < 23 ? 1.25 : 0.9;
      const evMul = this.events.reduce((a, e) => a * e.rateMul, 1);
      const perHour = 19 * diurnal * this.settings.rate * evMul;
      this.nextSpawn = this.t + (-Math.log(1 - this.rnd()) * 3600) / perHour;
    }
    for (const u of this.units) this.moveUnit(u, dt);
    for (const inc of this.incidents) if (inc.suspect && inc.suspect.free) this.moveSuspect(inc, inc.suspect, dt);
    this.acc1 += dt;
    if (this.acc1 >= 1) {
      const d = this.acc1;
      this.acc1 = 0;
      for (const inc of this.incidents) if (inc.status !== 'resolved' && inc.status !== 'failed') this.updateIncident(inc, d);
      for (const u of this.units) this.updateUnitLogic(u, d);
    }
    this.acc3 += dt;
    if (this.acc3 >= 3) {
      this.acc3 = 0;
      this.detectSuspects();
    }
    this.acc5 += dt;
    if (this.acc5 >= 5) {
      this.acc5 = 0;
      this.eventsTick();
      autoTick(this);
    }
  }

  // ---------------------------------------------------------------- unit movement
  placeUnit(u: Unit, edge: number, s: number, dir: 1 | -1 = 1) {
    u.pos = { edge, dir, s };
    const p = this.g.pointAt(edge, s);
    u.x = p.x;
    u.y = p.y;
    u.heading = Math.atan2(p.hx * dir, p.hy * dir);
  }

  private moveUnit(u: Unit, dt: number) {
    if (u.manual) return;
    if (u.wait > 0) {
      u.wait -= dt;
      u.v = Math.max(0, u.v - 6 * dt);
      return;
    }
    const r = u.route;
    if (!r) {
      u.v = 0;
      return;
    }
    const g = this.g;
    let remaining = 0;
    let travel = 0;
    // target speed
    const leg = r.legs[u.leg];
    if (!leg) {
      this.routeDone(u);
      return;
    }
    const e = leg.edge;
    let vt: number;
    if (u.kind === 'koban') vt = KOBAN_KMH / 3.6;
    else {
      const tr = u.kind === 'kotsu' ? Math.min(1, this.tf[e] * 1.5) : this.tf[e];
      vt = g.speed(e) * tr;
      if (u.emergency) vt = Math.min(vt * 1.45 + 2, 30);
      if (u.status === 'patrol') vt *= 0.8;
    }
    remaining = Math.abs(leg.s1 - (u.pos.s ?? 0));
    for (let k = u.leg + 1; k < r.legs.length && remaining < 60; k++) remaining += Math.abs(r.legs[k].s1 - r.legs[k].s0);
    if (u.leg === r.legs.length - 1 || remaining < 60) vt = Math.min(vt, Math.max(3, remaining / 3));
    const acc = u.v < vt ? 2.6 : -5;
    u.v += Math.max(-Math.abs(acc) * dt, Math.min(acc * dt, vt - u.v));
    if (u.v < 0) u.v = 0;
    travel = u.v * dt;
    u.stats.km += travel / 1000;
    let cur = r.legs[u.leg];
    let s = u.pos.edge === cur.edge ? u.pos.s : cur.s0;
    while (travel > 0) {
      const dir = cur.s1 >= cur.s0 ? 1 : -1;
      const left = (cur.s1 - s) * dir;
      if (travel < left) {
        s += travel * dir;
        travel = 0;
      } else {
        travel -= left;
        s = cur.s1;
        u.visited.set(cur.edge, this.t);
        u.leg++;
        if (u.leg >= r.legs.length) break;
        const nxt = r.legs[u.leg];
        // crossing a vertex: traffic signal behaviour
        const vtx = dir === 1 ? g.eb[cur.edge] : g.ea[cur.edge];
        if (g.signal[vtx] && u.kind !== 'koban') {
          if (u.emergency) u.v = Math.min(u.v, 7);
          else if (this.rnd() < 0.42) {
            u.wait = 4 + this.rnd() * (g.ecls[nxt.edge] <= 3 ? 40 : 25);
            travel = 0;
          }
        }
        cur = nxt;
        s = cur.s0;
      }
    }
    if (u.leg >= r.legs.length) {
      const last = r.legs[r.legs.length - 1];
      this.placeUnit(u, last.edge, last.s1, last.s1 >= last.s0 ? 1 : -1);
      this.routeDone(u);
      return;
    }
    const dir = cur.s1 >= cur.s0 ? 1 : -1;
    this.placeUnit(u, cur.edge, s, dir as 1 | -1);
    if (u.visited.size > 4000) {
      const cutoff = this.t - 3 * 3600;
      for (const [k, v] of u.visited) if (v < cutoff) u.visited.delete(k);
    }
  }

  private setRoute(u: Unit, route: Route | null) {
    u.route = route;
    u.leg = 0;
    if (route && route.legs.length) {
      const l = route.legs[0];
      u.pos = { edge: l.edge, dir: l.s1 >= l.s0 ? 1 : -1, s: l.s0 };
    }
  }

  routeFor(u: Unit, to: { edge: number; s: number }, emergency: boolean, via: { x: number; y: number }[] = []): Route | null {
    const o = this.routeOpts(u, emergency);
    const pts = via.map((p) => this.snap(p.x, p.y, u.kind === 'koban')).filter(Boolean) as { edge: number; s: number }[];
    const r = pts.length ? this.g.routeVia(u.pos, [...pts, to], o) : this.g.route(u.pos, to, o);
    if (r) return r;
    // fallback: allow motorways / ignore preference
    return this.g.route(u.pos, to, { ...o, avoidMotorway: false, preferMajor: false });
  }

  snap(x: number, y: number, noMotorway = true): { edge: number; s: number; x: number; y: number } | null {
    const g = this.g;
    const n = g.nearest(x, y, 800, noMotorway ? (e) => g.ecls[e] !== CLS_MOTORWAY && !(g.eflags[e] & F_LINK) : undefined);
    if (!n) return null;
    return { edge: n.edge, s: n.s, x: n.x, y: n.y };
  }

  private routeDone(u: Unit) {
    u.route = null;
    u.leg = 0;
    const task = u.task;
    switch (u.status) {
      case 'enroute':
        if (task?.incidentId) this.arrive(u, this.incById.get(task.incidentId)!);
        break;
      case 'patrol': {
        const p = u.patrol;
        if (p && p.kind === 'route' && p.waypoints.length) {
          const wp = p.waypoints[p.wpIndex % p.waypoints.length];
          u.wait = wp.dwell;
          p.wpIndex = (p.wpIndex + 1) % p.waypoints.length;
        } else if (this.rnd() < 0.18) u.wait = 60 + this.rnd() * 240; // 立ち寄り警戒
        break;
      }
      case 'returning':
        u.status = 'standby';
        u.task = null;
        u.emergency = false;
        if (u.patrol && this.patrolActive(u.patrol) && this.settings.autoReturn) this.startPatrol(u, false);
        break;
      case 'transport':
        u.status = 'office';
        u.timer = (15 + this.rnd() * 25) * 60;
        u.emergency = false;
        this.addLog(`${u.callsign} 署着、署内処理`, undefined, u.id);
        break;
      case 'moving':
        u.status = 'hold';
        u.emergency = false;
        this.say(u.callsign, R.HQ, `${u.callsign}、${task?.label ?? '指定地点'}に到着、停留する。`, { unitId: u.id, channel: '現場' }, 1);
        break;
      case 'search':
      case 'pursuit':
        break; // logic loop picks next target
    }
  }

  // ---------------------------------------------------------------- unit logic (1 Hz)
  private updateUnitLogic(u: Unit, dt: number) {
    if (u.manual) {
      // arrival detection for player-driven unit
      if (u.status === 'enroute' && u.task?.incidentId) {
        const inc = this.incById.get(u.task.incidentId);
        if (inc && Math.hypot(inc.x - u.x, inc.y - u.y) < 40 && u.v < 4) this.arrive(u, inc);
      }
      return;
    }
    switch (u.status) {
      case 'patrol':
        if (u.patrol && !this.patrolActive(u.patrol)) {
          this.sendHome(u, false);
          break;
        }
        if (!u.route && u.wait <= 0) this.nextPatrolLeg(u);
        // own-initiative activity: questioning, enforcement, crimes spotted on patrol (≈ every 2.5 h per unit)
        if (u.kind !== 'koban' && this.rnd() < dt / 9000) selfInitiated(this, u);
        break;
      case 'standby':
        if (u.patrol && u.kind !== 'koban' && this.patrolActive(u.patrol) && u.patrol.schedule) this.startPatrol(u, true);
        break;
      case 'office':
        u.timer -= dt;
        if (u.timer <= 0) {
          this.say(u.callsign, R.HQ, R.officeDone(u), { unitId: u.id, channel: '署活' });
          this.resume(u);
        }
        break;
      case 'search': {
        const sc = u.searchCenter;
        if (!sc || this.t > sc.until) {
          this.say(u.callsign, R.HQ, `${u.callsign}、検索打ち切り。`, { unitId: u.id, channel: '現場' });
          u.searchCenter = undefined;
          this.finishAssignment(u);
          break;
        }
        if (!u.route && u.wait <= 0) {
          const p = this.randomPointInCircle(sc.x, sc.y, sc.r, u.kind === 'koban');
          if (p) this.setRoute(u, this.routeFor(u, p, false));
        }
        break;
      }
      case 'pursuit': {
        const inc = u.incidentId ? this.incById.get(u.incidentId) : null;
        const sus = inc?.suspect;
        if (!inc || !sus || !sus.free) {
          this.finishAssignment(u);
          break;
        }
        const d = Math.hypot(sus.x - u.x, sus.y - u.y);
        if (d < 18 + u.v * 0.5) {
          const p = sus.mode === 'car' || sus.mode === 'moto' ? 0.35 : 0.85;
          if (this.rnd() < p) this.catchSuspect(u, inc);
        } else if (d > (sus.mode === 'car' || sus.mode === 'moto' ? 700 : 350)) {
          this.say(u.callsign, R.HQ, R.lostSight(u), { unitId: u.id, incidentId: inc.id, channel: '現場' });
          u.status = 'search';
          u.emergency = false;
          u.searchCenter = { x: sus.x, y: sus.y, r: 600, until: this.t + 12 * 60 };
          this.setRoute(u, null);
        } else if (((this.t | 0) % 4 === 0 || !u.route) && sus.pos) {
          this.setRoute(u, this.routeFor(u, { edge: sus.pos.edge, s: sus.pos.s }, true));
        }
        break;
      }
    }
  }

  patrolActive(p: PatrolPlan) {
    if (!p.schedule) return true;
    const h = this.hour;
    const { start, end } = p.schedule;
    return start <= end ? h >= start && h < end : h >= start || h < end;
  }

  startPatrol(u: Unit, announce = true) {
    if (!u.patrol) return;
    u.status = 'patrol';
    u.task = { kind: 'patrol' };
    u.emergency = false;
    u.incidentId = null;
    u.wait = 0;
    this.setRoute(u, null);
    if (announce) this.say(u.callsign, R.HQ, R.patrolStart(u, u.patrol.areaName), { unitId: u.id, channel: '署活' }, 1);
    this.nextPatrolLeg(u);
  }

  private nextPatrolLeg(u: Unit) {
    const p = u.patrol;
    if (!p) {
      this.sendHome(u, false);
      return;
    }
    let target: { edge: number; s: number } | null = null;
    if (p.kind === 'route' && p.waypoints.length) {
      const wp = p.waypoints[p.wpIndex % p.waypoints.length];
      target = { edge: wp.edge, s: wp.s };
    } else target = this.randomPointInPlan(u, p);
    if (!target) return;
    const r = this.routeFor(u, target, false);
    if (!r) {
      u.wait = 5;
      if (p.kind === 'route') p.wpIndex = (p.wpIndex + 1) % Math.max(1, p.waypoints.length);
      return;
    }
    this.setRoute(u, r);
  }

  /** choose a patrol destination: stale roads matching the patrol focus, inside the area */
  randomPointInPlan(u: Unit, p: PatrolPlan): { edge: number; s: number } | null {
    const g = this.g;
    let best: { edge: number; s: number } | null = null;
    let bestScore = -1;
    const band = this.band();
    for (let i = 0; i < 14; i++) {
      const a = this.rnd() * Math.PI * 2, rr = Math.sqrt(this.rnd()) * p.r;
      const x = p.cx + Math.cos(a) * rr, y = p.cy + Math.sin(a) * rr;
      if (p.ward && this.world.wardAt(x, y)?.name !== p.ward) continue;
      const n = g.nearest(x, y, 250, (e) => g.ecls[e] !== CLS_MOTORWAY && !(g.eflags[e] & F_LINK));
      if (!n) continue;
      const e = n.edge, c = g.ecls[e];
      const last = u.visited.get(e);
      let score = last === undefined ? 1 : Math.min(1, (this.t - last) / 3600) * 0.8 + 0.05;
      if (p.focus === 'major') score *= c <= 3 ? 2.5 : 0.5;
      else if (p.focus === 'residential') score *= c >= 5 ? 2 : 0.6;
      else if (p.focus === 'hotspot') {
        let hs = 0.3;
        for (const h of this.world.hotspots) {
          const d = Math.hypot(h.x - n.x, h.y - n.y);
          if (d < h.r * 1.5) hs = Math.max(hs, h.w[band]);
        }
        score *= hs;
      } else score *= c <= 4 ? 1.3 : 1;
      const d = Math.hypot(n.x - u.x, n.y - u.y);
      if (d < 250) score *= 0.3;
      if (d > 2500) score *= 0.6;
      score *= 0.7 + this.rnd() * 0.6;
      if (score > bestScore) (bestScore = score), (best = { edge: e, s: n.s });
    }
    return best;
  }

  private randomPointInCircle(cx: number, cy: number, r: number, noMotorway = true) {
    for (let i = 0; i < 8; i++) {
      const a = this.rnd() * Math.PI * 2, rr = Math.sqrt(this.rnd()) * r;
      const s = this.snap(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, noMotorway);
      if (s) return s;
    }
    return null;
  }

  // ---------------------------------------------------------------- player commands
  /** ranked candidate units for an incident (ETA from network times) */
  candidates(incId: string): Candidate[] {
    const inc = this.incById.get(incId);
    if (!inc) return [];
    const c = this.candCache.get(incId);
    if (c && Math.abs(this.t - c.t) < 8) return c.list;
    const o: RouteOptions = { emergency: true, traffic: this.traffic };
    const table = this.g.timesTo(inc.loc, o, 2400);
    const list: Candidate[] = [];
    for (const u of this.units) {
      if (inc.assigned.includes(u.id)) continue;
      const dist = Math.hypot(u.x - inc.x, u.y - inc.y);
      let eta: number;
      if (u.kind === 'koban') {
        if (dist > 2500) continue;
        eta = (dist * 1.35) / (KOBAN_KMH / 3.6) + 30;
      } else {
        eta = this.g.timeFrom(u.pos, table, o, inc.loc);
        if (!isFinite(eta)) eta = (dist * 1.6) / 12;
        if (u.status === 'standby' || u.status === 'office') eta += 30; // 出発準備
      }
      const available = AVAILABLE.includes(u.status);
      list.push({ unit: u, eta, dist, available });
    }
    list.sort((a, b) => Number(b.available) - Number(a.available) || a.eta - b.eta);
    this.candCache.set(incId, { t: this.t, list });
    return list;
  }

  dispatch(unitIds: string[], incId: string, opts: { emergency: boolean; via?: { x: number; y: number }[] }) {
    const inc = this.incById.get(incId);
    if (!inc || inc.status === 'resolved' || inc.status === 'failed') return;
    const units = unitIds.map((id) => this.unitById.get(id)!).filter((u) => u && !inc.assigned.includes(u.id));
    if (!units.length) return;
    this.candCache.delete(incId);
    // order first, acknowledgements follow
    this.say(R.HQ, units.length > 1 ? '各移動' : units[0].callsign, R.dispatchOrder(inc, units, opts.emergency), {
      incidentId: inc.id,
      level: inc.priority <= 1 ? 'urgent' : 'normal',
    });
    let delay = 2.5;
    for (const u of units) {
      if (u.incidentId && u.incidentId !== inc.id) {
        const old = this.incById.get(u.incidentId);
        if (old) this.detach(u, old);
        this.say(R.HQ, u.callsign, R.redirectOrder(u, inc), { unitId: u.id, incidentId: inc.id }, delay);
        delay += 2;
      }
      const wasIdle = u.status === 'office' || u.status === 'standby';
      u.incidentId = inc.id;
      u.task = { kind: 'incident', incidentId: inc.id };
      u.status = 'enroute';
      u.emergency = opts.emergency;
      u.wait = wasIdle ? 20 : 0;
      u.via = opts.via ?? [];
      u.searchCenter = undefined;
      u.stats.dispatches++;
      const r = u.manual ? null : this.routeFor(u, inc.loc, opts.emergency, u.via);
      if (!u.manual) this.setRoute(u, r);
      inc.assigned.push(u.id);
      const eta = r ? r.time : (Math.hypot(u.x - inc.x, u.y - inc.y) * 1.5) / 10;
      const place = this.g.describe(u.x, u.y).replace(/上$|付近$/, '');
      this.say(u.callsign, R.HQ, R.ackDispatch(u, place, eta, opts.emergency), { unitId: u.id, incidentId: inc.id }, delay + this.rnd() * 3);
      delay += 3 + this.rnd() * 3;
    }
    if (inc.status === 'pending') {
      inc.status = 'dispatched';
      inc.tDispatch = this.t;
    }
    this.addLog(`指令 ${inc.id} ${inc.name} ← ${units.map((u) => u.callsign).join('・')}`, inc.id);
    inc.updates.push({ t: this.t, kind: 'system', text: `指令：${units.map((u) => u.callsign).join('、')}${opts.emergency ? '（緊急走行）' : ''}` });
    this.emit('change');
  }

  /** a unit that discovered an incident itself takes it on immediately */
  attachOnScene(u: Unit, inc: Incident) {
    const old = u.incidentId ? this.incById.get(u.incidentId) : null;
    if (old && old !== inc) this.detach(u, old);
    u.incidentId = inc.id;
    u.task = { kind: 'incident', incidentId: inc.id };
    u.status = 'enroute';
    u.emergency = false;
    u.stats.dispatches++;
    this.setRoute(u, null);
    inc.assigned.push(u.id);
    inc.status = 'dispatched';
    inc.tDispatch = this.t;
    inc.updates.push({ t: this.t, kind: 'field', text: `${u.callsign} が現認し対応開始` });
    this.arrive(u, inc);
  }

  /** remove unit from an incident without further orders */
  private detach(u: Unit, inc: Incident) {
    inc.assigned = inc.assigned.filter((id) => id !== u.id);
    inc.onScene = inc.onScene.filter((id) => id !== u.id);
    if (inc.status === 'dispatched' && !inc.assigned.length) inc.status = 'pending';
    if (inc.status === 'onscene' && !inc.onScene.length) inc.status = inc.assigned.length ? 'dispatched' : 'pending';
    this.candCache.delete(inc.id);
  }

  cancel(unitId: string) {
    const u = this.unitById.get(unitId);
    if (!u) return;
    const inc = u.incidentId ? this.incById.get(u.incidentId) : null;
    if (inc) {
      this.detach(u, inc);
      inc.updates.push({ t: this.t, kind: 'system', text: `${u.callsign} 指令解除` });
    }
    this.say(R.HQ, u.callsign, R.cancelOrder(u), { unitId: u.id, incidentId: inc?.id });
    this.say(u.callsign, R.HQ, R.cancelAck(u), { unitId: u.id }, 3);
    u.incidentId = null;
    this.resume(u);
    this.emit('change');
  }

  /** after-action: resume patrol, go home, or hold */
  resume(u: Unit) {
    u.task = null;
    u.incidentId = null;
    u.emergency = false;
    u.searchCenter = undefined;
    u.via = [];
    if (u.manual) {
      u.status = u.patrol ? 'patrol' : 'standby';
      return;
    }
    if (u.after === 'hold') {
      u.status = 'hold';
      this.setRoute(u, null);
    } else if (u.after === 'resume' && u.patrol && this.patrolActive(u.patrol) && u.kind !== 'koban') this.startPatrol(u, false);
    else this.sendHome(u, false);
  }

  sendHome(u: Unit, announce = true) {
    const inc = u.incidentId ? this.incById.get(u.incidentId) : null;
    if (inc) this.detach(u, inc);
    u.incidentId = null;
    u.task = { kind: 'home' };
    u.status = 'returning';
    u.emergency = false;
    const base = this.world.facilities.find((f) => f.id === u.baseId);
    const where = base ? (base.kind === 'station' ? base.short + '署' : base.name) : '本部';
    if (announce) {
      this.say(R.HQ, u.callsign, `${R.HQ}から${u.callsign}、${where}へ帰署せよ。`, { unitId: u.id });
      this.say(u.callsign, R.HQ, R.returning(u, where), { unitId: u.id }, 3);
    }
    const to = this.snap(u.baseX, u.baseY, u.kind !== 'koban');
    if (!to || u.manual) return;
    const r = this.routeFor(u, to, false);
    this.setRoute(u, r);
    if (!r || r.length < 15) this.routeDone(u);
    this.emit('change');
  }

  moveTo(unitId: string, x: number, y: number, label: string, emergency = false, via: { x: number; y: number }[] = []) {
    const u = this.unitById.get(unitId);
    if (!u) return;
    const inc = u.incidentId ? this.incById.get(u.incidentId) : null;
    if (inc) this.detach(u, inc);
    const to = this.snap(x, y, u.kind !== 'koban');
    if (!to) return;
    u.incidentId = null;
    u.status = 'moving';
    u.task = { kind: 'point', x: to.x, y: to.y, label };
    u.emergency = emergency;
    u.wait = 0;
    this.say(R.HQ, u.callsign, R.moveOrder(u, label, false), { unitId: u.id });
    this.say(u.callsign, R.HQ, `${u.callsign}了解。`, { unitId: u.id }, 3);
    if (!u.manual) this.setRoute(u, this.routeFor(u, to, emergency, via));
    this.emit('change');
  }

  /** reroute a moving unit through via points (player-defined route) */
  reroute(unitId: string, via: { x: number; y: number }[]) {
    const u = this.unitById.get(unitId);
    if (!u || u.manual) return;
    let to: { edge: number; s: number } | null = null;
    if (u.task?.kind === 'incident' && u.incidentId) to = this.incById.get(u.incidentId)!.loc;
    else if (u.task?.x !== undefined) to = this.snap(u.task.x, u.task.y!, u.kind !== 'koban');
    else if (u.route) {
      const l = u.route.legs[u.route.legs.length - 1];
      to = { edge: l.edge, s: l.s1 };
    }
    if (!to) return;
    u.via = via;
    this.setRoute(u, this.routeFor(u, to, u.emergency, via));
    this.emit('change');
  }

  setPatrol(unitId: string, plan: PatrolPlan | null, startNow = true) {
    const u = this.unitById.get(unitId);
    if (!u) return;
    u.patrol = plan;
    if (plan && startNow && (AVAILABLE.includes(u.status) || u.status === 'office')) {
      const inc = u.incidentId ? this.incById.get(u.incidentId) : null;
      if (inc) this.detach(u, inc);
      this.say(R.HQ, u.callsign, `${R.HQ}から${u.callsign}、${plan.areaName}の${plan.kind === 'route' ? '指定経路' : ''}警らにあたれ。`, { unitId: u.id, channel: '署活' });
      this.startPatrol(u, true);
    }
    this.emit('change');
  }

  setStandby(unitId: string) {
    const u = this.unitById.get(unitId);
    if (!u) return;
    const inc = u.incidentId ? this.incById.get(u.incidentId) : null;
    if (inc) this.detach(u, inc);
    u.incidentId = null;
    u.task = null;
    u.status = 'hold';
    u.emergency = false;
    this.setRoute(u, null);
    this.say(R.HQ, u.callsign, `${R.HQ}から${u.callsign}、現在地で待機せよ。`, { unitId: u.id });
    this.emit('change');
  }

  startSearch(unitId: string, x: number, y: number, r = 600, minutes = 15) {
    const u = this.unitById.get(unitId);
    if (!u) return;
    u.status = 'search';
    u.searchCenter = { x, y, r, until: this.t + minutes * 60 };
    u.emergency = false;
    this.setRoute(u, null);
    this.emit('change');
  }

  /** 緊急配備: send units to checkpoints around the suspect's probable position */
  cordon(incId: string, unitIds: string[]) {
    const inc = this.incById.get(incId);
    if (!inc || !inc.suspect || !inc.suspect.free) return;
    inc.cordoned = true;
    const sus = inc.suspect;
    const ls = sus.lastSeen ?? { x: inc.x, y: inc.y, t: inc.t0 };
    const sp = sus.mode === 'car' ? 9 : (FLEE_KMH[sus.mode] ?? 6) / 3.6;
    const R0 = Math.max(500, Math.min(3500, sp * (this.t - ls.t) * 0.8 + 400));
    const units = unitIds.map((id) => this.unitById.get(id)!).filter(Boolean);
    const g = this.g;
    // candidate checkpoints: signalised junctions on major roads near the ring
    const cps: { v: number; a: number }[] = [];
    for (const v of this.poolSignal) {
      const d = Math.hypot(g.vx[v] - ls.x, g.vy[v] - ls.y);
      if (Math.abs(d - R0) < R0 * 0.25) cps.push({ v, a: Math.atan2(g.vy[v] - ls.y, g.vx[v] - ls.x) });
    }
    this.say(R.HQ, '各移動', R.cordonOrder(inc, units), { incidentId: inc.id, level: 'urgent' });
    units.forEach((u, i) => {
      const ang = (i / units.length) * Math.PI * 2 + this.rnd() * 0.3;
      let best = cps[0], bd = Infinity;
      for (const c of cps) {
        const da = Math.abs(((c.a - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (da < bd) (bd = da), (best = c);
      }
      const x = best ? g.vx[best.v] : ls.x + Math.cos(ang) * R0;
      const y = best ? g.vy[best.v] : ls.y + Math.sin(ang) * R0;
      const label = best && g.signalName.get(best.v) ? `${g.signalName.get(best.v)}交差点` : this.world.describe(x, y);
      const old = u.incidentId ? this.incById.get(u.incidentId) : null;
      if (old && old.id !== inc.id) this.detach(u, old);
      const to = this.snap(x, y, u.kind !== 'koban');
      if (!to) return;
      u.incidentId = inc.id;
      if (!inc.assigned.includes(u.id)) inc.assigned.push(u.id);
      u.status = 'moving';
      u.task = { kind: 'point', x: to.x, y: to.y, label: label + '（検問）', incidentId: inc.id };
      u.emergency = true;
      if (!u.manual) this.setRoute(u, this.routeFor(u, to, true));
      this.say(u.callsign, R.HQ, `${u.callsign}了解、${label}で検問につく。`, { unitId: u.id, incidentId: inc.id }, 3 + i * 2.5);
    });
    if (inc.status === 'pending') {
      inc.status = 'dispatched';
      inc.tDispatch = this.t;
    }
    inc.updates.push({ t: this.t, kind: 'system', text: `緊急配備発令（半径約${(R0 / 1000).toFixed(1)}km、${units.length}隊）` });
    this.emit('change');
  }

  setPriority(incId: string, p: number) {
    const inc = this.incById.get(incId);
    if (!inc) return;
    inc.priority = p;
    inc.updates.push({ t: this.t, kind: 'system', text: `優先度を${p}に変更` });
    this.emit('change');
  }

  /** dispatcher closes an incident manually */
  closeIncident(incId: string, reason = '指令台判断により終結') {
    const inc = this.incById.get(incId);
    if (!inc || inc.status === 'resolved' || inc.status === 'failed') return;
    inc.outcome = reason;
    this.finishIncident(inc, inc.onScene.length > 0);
  }

  // ---------------------------------------------------------------- incidents
  private pickType(): IncidentType {
    const b = this.band();
    const w = (t: IncidentType) => {
      if (t.special) return 0;
      let x = t.rate[b];
      for (const ev of this.events) x *= ev.boost[t.key] ?? 1;
      return x;
    };
    const total = INCIDENT_TYPES.reduce((a, t) => a + w(t), 0);
    let r = this.rnd() * total;
    for (const t of INCIDENT_TYPES) {
      r -= w(t);
      if (r <= 0) return t;
    }
    return INCIDENT_TYPES[0];
  }

  private pickLocation(where: Where): { edge: number; s: number; x: number; y: number } | null {
    const g = this.g;
    const rnd = this.rnd;
    const pickEdge = (pool: number[]) => {
      const e = pool[Math.floor(rnd() * pool.length)];
      const s = g.elen[e] * (0.2 + rnd() * 0.6);
      const p = g.pointAt(e, s);
      return { edge: e, s, x: p.x, y: p.y };
    };
    const nearHotspot = (tags: string[]) => {
      const b = this.band();
      const hs = this.world.hotspots.filter((h) => h.tags.some((t) => tags.includes(t)));
      const list = hs.length ? hs : this.world.hotspots;
      const tot = list.reduce((a, h) => a + h.w[b], 0);
      let r = rnd() * tot;
      let h = list[0];
      for (const x of list) {
        r -= x.w[b];
        if (r <= 0) {
          h = x;
          break;
        }
      }
      const a = rnd() * Math.PI * 2, rr = Math.abs(gauss(rnd)) * h.r * 0.6;
      return this.snap(h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr);
    };
    const lm = (kinds: string[]) => {
      const l = this.world.landmarks.filter((l) => kinds.includes(l.kind) && this.world.inCity(l.x, l.y));
      if (!l.length) return null;
      const p = l[Math.floor(rnd() * l.length)];
      return this.snap(p.x + (rnd() - 0.5) * 60, p.y + (rnd() - 0.5) * 60);
    };
    switch (where) {
      case 'signal': {
        if (!this.poolSignal.length) return pickEdge(this.poolMajor);
        // weight towards busy areas: sample 3 take the one closest to a hotspot
        let best = -1, bd = Infinity;
        for (let i = 0; i < 3; i++) {
          const v = this.poolSignal[Math.floor(rnd() * this.poolSignal.length)];
          const d = Math.min(...this.world.hotspots.map((h) => Math.hypot(h.x - g.vx[v], h.y - g.vy[v])));
          if (d < bd) (bd = d), (best = v);
        }
        return this.snap(g.vx[best] + (rnd() - 0.5) * 30, g.vy[best] + (rnd() - 0.5) * 30);
      }
      case 'major':
        return pickEdge(this.poolMajor);
      case 'motorway':
        return this.poolMotorway.length ? pickEdge(this.poolMotorway) : pickEdge(this.poolMajor);
      case 'residential':
        return pickEdge(this.poolMinor);
      case 'hotspot':
        return nearHotspot(['shop', 'station', 'night', 'tourist']);
      case 'night':
        return nearHotspot(['night']);
      case 'tourist':
        return nearHotspot(['tourist']);
      case 'park':
        return nearHotspot(['park']) ?? pickEdge(this.poolMinor);
      case 'shop':
        return rnd() < 0.5 ? lm(['shop']) ?? nearHotspot(['shop']) : rnd() < 0.5 ? nearHotspot(['shop']) : pickEdge(this.poolMinor);
      case 'station':
        return lm(['station', 'subway']) ?? nearHotspot(['station']);
      default:
        return rnd() < 0.5 ? pickEdge(this.poolMinor) : nearHotspot(['shop', 'station', 'night']);
    }
  }

  spawnIncident(typeKey?: string, at?: { x: number; y: number }, eventName?: string, selfInit = false): Incident | null {
    const type = typeKey ? TYPE_BY_KEY.get(typeKey) : this.pickType();
    if (!type) return null;
    let loc: { edge: number; s: number; x: number; y: number } | null = null;
    // crowd events pull suitable random calls into their area
    if (!at && !typeKey && !type.where.includes('motorway')) {
      for (const ev of this.events) {
        if (ev.pull > 0 && ev.x !== undefined && this.rnd() < ev.pull && (ev.boost[type.key] ?? 1) > 1) {
          const a = this.rnd() * Math.PI * 2, rr = Math.sqrt(this.rnd()) * (ev.r ?? 500);
          at = { x: ev.x + Math.cos(a) * rr, y: ev.y! + Math.sin(a) * rr };
          eventName = ev.name;
          break;
        }
      }
    }
    if (!at && type.spots) {
      const hs = this.world.hotspots.filter((h) => type.spots!.includes(h.name));
      if (hs.length) {
        const h = hs[Math.floor(this.rnd() * hs.length)];
        at = { x: h.x + (this.rnd() - 0.5) * 120, y: h.y + (this.rnd() - 0.5) * 80 };
      }
    }
    if (at) loc = this.snap(at.x, at.y, type.where[0] !== 'motorway');
    for (let i = 0; i < 5 && !loc; i++) {
      const l = this.pickLocation(type.where[Math.floor(this.rnd() * type.where.length)]);
      if (l && this.world.inCity(l.x, l.y)) loc = l;
    }
    if (!loc) return null;
    const pick = <T,>(a: T[]) => a[Math.floor(this.rnd() * a.length)];
    const d = new Date(this.date0.getTime() + Math.floor(this.t / 86400) * 86400000);
    const id = `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(++this.incSeq).padStart(4, '0')}`;
    const st = this.world.jurisdiction(loc.x, loc.y);
    const inc: Incident = {
      id, type: type.key, name: type.name, code: type.code, priority: type.priority,
      x: loc.x, y: loc.y, loc: { edge: loc.edge, s: loc.s },
      address: this.world.describe(loc.x, loc.y), ward: this.world.wardAt(loc.x, loc.y)?.name ?? '',
      stationId: st?.id ?? 0, caller: pick(type.callers), detail: pick(type.details),
      status: 'pending', t0: this.t, tDispatch: null, tArrive: null, tEnd: null,
      assigned: [], onScene: [], minUnits: type.minUnits, idealUnits: type.idealUnits,
      work: type.work * 0.6 * (0.75 + this.rnd() * 0.5), workTotal: 0, updates: [], suspect: null,
      escalated: false, devAt: null, devDone: false, backupRequested: false, injury: false, outcome: '', transport: false,
      reported: new Set(),
    };
    inc.workTotal = inc.work;
    inc.transport = this.rnd() < (type.transport ?? 0);
    if (eventName) inc.eventName = eventName;
    if (selfInit) {
      inc.selfInit = true;
      inc.caller = '警ら中の部隊（現認）';
    }
    if (type.flee && this.rnd() < type.flee.p) {
      const p = this.g.pointAt(loc.edge, loc.s);
      inc.suspect = {
        desc: type.suspects ? pick(type.suspects) : '不明', mode: type.flee.mode,
        pos: { edge: loc.edge, dir: 1, s: loc.s }, x: p.x, y: p.y, route: null, leg: 0,
        free: type.flee.afterMin === 0, caught: false,
        lastSeen: { x: p.x, y: p.y, t: this.t }, seenBy: null,
        startT: this.t + type.flee.afterMin * 60, giveUpT: this.t + (type.flee.mode === 'car' || type.flee.mode === 'moto' ? 30 : 40) * 60,
      };
    }
    inc.updates.push({ t: this.t, kind: 'call', text: selfInit ? `警ら中の部隊が現認「${inc.detail}」` : `110番入電（通報者：${inc.caller}）「${inc.detail}」` });
    if (eventName) inc.updates.push({ t: this.t, kind: 'info', text: `関連情勢：${eventName}` });
    if (inc.suspect) inc.updates.push({ t: this.t, kind: 'info', text: `マル被：${inc.suspect.desc}${inc.suspect.free ? `、${R.modeWord(inc.suspect.mode)}で逃走` : ''}` });
    this.incidents.push(inc);
    this.incById.set(inc.id, inc);
    this.stats.received++;
    if (!selfInit) this.sys(`110番受理 ${inc.id}【${inc.name}】${inc.address}／通報者：${inc.caller}`, inc.id);
    this.addLog(`受理 ${inc.id} ${inc.name} ${inc.address}`, inc.id);
    if (!selfInit) this.emit('incident', inc);
    // keep the list bounded: drop old closed incidents
    if (this.incidents.length > 400) {
      const drop = this.incidents.filter((i) => i.status === 'resolved' || i.status === 'failed').slice(0, 50);
      for (const d2 of drop) this.incById.delete(d2.id);
      this.incidents = this.incidents.filter((i) => !drop.includes(i));
    }
    return inc;
  }

  private arrive(u: Unit, inc: Incident | undefined) {
    if (!inc || inc.status === 'resolved' || inc.status === 'failed') {
      this.resume(u);
      return;
    }
    const first = inc.onScene.length === 0;
    u.emergency = false;
    u.v = 0;
    if (!inc.onScene.includes(u.id)) inc.onScene.push(u.id);
    if (first) {
      inc.tArrive = this.t;
      inc.status = 'onscene';
      this.stats.respTimes.push(this.t - inc.t0);
      if (inc.devAt === null) {
        const type = TYPE_BY_KEY.get(inc.type)!;
        if (type.developments?.length) inc.devAt = this.t + (1 + this.rnd() * 6) * 60;
      }
    }
    // suspect gone: arriving units search
    const sus = inc.suspect;
    if (sus && sus.free && !sus.caught) {
      if (first) {
        u.status = 'onscene';
        this.say(u.callsign, R.HQ, R.arrival(u, inc, true), { unitId: u.id, incidentId: inc.id, channel: '現場' }, 1);
        if (!inc.reported.has('gone'))
          this.say(u.callsign, R.HQ, `マル被は既に現場を離脱、${R.dirName(sus.x - inc.x, sus.y - inc.y)}方向へ逃走との目撃情報。`, { unitId: u.id, incidentId: inc.id, channel: '現場' }, 6);
        inc.reported.add('gone');
      } else {
        u.status = 'search';
        u.searchCenter = { x: sus.lastSeen?.x ?? inc.x, y: sus.lastSeen?.y ?? inc.y, r: 700, until: this.t + 15 * 60 };
        this.say(u.callsign, R.HQ, R.searchStart(u), { unitId: u.id, incidentId: inc.id, channel: '現場' }, 1);
      }
    } else {
      u.status = 'onscene';
      this.say(u.callsign, R.HQ, R.arrival(u, inc, first), { unitId: u.id, incidentId: inc.id, channel: '現場' }, 1);
    }
    inc.updates.push({ t: this.t, kind: 'field', text: `${u.callsign} 現着${first ? `（覚知から${Math.round((this.t - inc.t0) / 60)}分）` : ''}` });
    this.addLog(`現着 ${inc.id} ${u.callsign}`, inc.id, u.id);
    this.emit('change');
  }

  private updateIncident(inc: Incident, dt: number) {
    const type = TYPE_BY_KEY.get(inc.type)!;
    const age = this.t - inc.t0;
    const sus = inc.suspect;
    // suspect begins to flee
    if (sus && !sus.free && !sus.caught && this.t >= sus.startT && inc.onScene.length === 0) {
      sus.free = true;
      sus.lastSeen = { x: sus.x, y: sus.y, t: this.t };
      inc.updates.push({ t: this.t, kind: 'warn', text: `続報：マル被が現場から立ち去った（${R.modeWord(sus.mode)}）` });
      this.say(R.HQ, '各移動', `${R.HQ}から各移動。${inc.address}の${inc.name.replace(/（.*?）/, '')}、マル被は現場を立ち去った模様。${sus.desc}。`, { incidentId: inc.id, level: 'urgent' });
    }
    if (sus && sus.free && !sus.caught) {
      // periodic sighting reports from the public
      if (!inc.reported.has('sight1') && this.t - (sus.lastSeen?.t ?? inc.t0) > 150) {
        inc.reported.add('sight1');
        sus.lastSeen = { x: sus.x + (this.rnd() - 0.5) * 120, y: sus.y + (this.rnd() - 0.5) * 120, t: this.t };
        inc.updates.push({ t: this.t, kind: 'info', text: `目撃情報：${this.world.describe(sus.x, sus.y)}付近で似た人物` });
        this.say(R.HQ, '各移動', R.fleeingUpdate(inc, sus.x - inc.x, sus.y - inc.y), { incidentId: inc.id, level: 'urgent' });
      }
      if (this.t > sus.giveUpT) {
        sus.free = false;
        inc.outcome = type.failOutcome ?? 'マル被逃走';
        this.finishIncident(inc, false);
        return;
      }
    }
    if (inc.status === 'pending' || inc.status === 'dispatched') {
      // escalation while waiting
      const esc = type.escalate;
      if (esc && !inc.escalated && inc.onScene.length === 0 && age > esc.afterMin * 60) {
        inc.escalated = true;
        if (this.rnd() < esc.p) {
          inc.updates.push({ t: this.t, kind: 'warn', text: esc.text });
          this.say(R.HQ, '各移動', R.escalationCall(inc, esc.text), { incidentId: inc.id, level: 'urgent' });
          if (esc.to) this.morph(inc, esc.to);
          else inc.priority = Math.max(1, inc.priority - 1);
        }
      }
      // reminders and abandonment if nobody is sent
      if (inc.status === 'pending') {
        const limit = [0, 6, 10, 18, 25][inc.priority] * 60;
        if (age > limit && !inc.reported.has('remind')) {
          inc.reported.add('remind');
          inc.updates.push({ t: this.t, kind: 'warn', text: '未指令のまま長時間経過' });
          this.sys(`【警告】${inc.id} ${inc.name} 未指令 ${Math.round(age / 60)}分経過`, inc.id);
          if (inc.priority > 1) inc.priority--;
        }
        if (age > limit * 3) {
          inc.outcome = '再三の架電に通報者応答なし、事案取消（未対応）';
          this.finishIncident(inc, false);
        }
      }
      return;
    }
    if (inc.status !== 'onscene') return;
    const units = inc.onScene.map((id) => this.unitById.get(id)!).filter((u) => u && u.status === 'onscene');
    const n = units.length;
    if (!n) return;
    let eff = 0;
    for (const u of units) eff += type.bonus?.includes(u.kind) ? 1.5 : u.kind === 'koban' ? 0.9 : 1;
    const enough = n >= inc.minUnits;
    const rate = Math.min(eff, inc.idealUnits * 1.3) * (enough ? 1 : 0.35);
    inc.work -= (rate * dt) / 60;
    // backup request
    if (!enough && !inc.backupRequested && this.t - (inc.tArrive ?? this.t) > 50) {
      inc.backupRequested = true;
      const lead = units[0];
      const need = inc.minUnits - n - (inc.assigned.length - inc.onScene.length);
      if (need > 0) {
        this.say(lead.callsign, R.HQ, R.backupRequest(lead, inc, need), { unitId: lead.id, incidentId: inc.id, level: 'urgent', channel: '現場' });
        inc.updates.push({ t: this.t, kind: 'warn', text: `応援要請：あと${need}台` });
      }
    }
    // development while on scene
    if (inc.devAt !== null && !inc.devDone && this.t >= inc.devAt) {
      inc.devDone = true;
      const devs = type.developments ?? [];
      const dv = devs.find((d) => this.rnd() < d.p);
      if (dv) {
        const lead = units[0];
        this.say(lead.callsign, R.HQ, `${lead.callsign}から${R.HQ}。${dv.text}。`, { unitId: lead.id, incidentId: inc.id, level: 'urgent', channel: '現場' });
        inc.updates.push({ t: this.t, kind: 'field', text: dv.text });
        if (dv.priority) inc.priority = Math.min(inc.priority, dv.priority);
        if (dv.work) {
          inc.work += dv.work;
          inc.workTotal += dv.work;
        }
        if (dv.injury) inc.injury = true;
        if (dv.minUnits && dv.minUnits > inc.minUnits) {
          inc.minUnits = dv.minUnits;
          inc.idealUnits = Math.max(inc.idealUnits, dv.minUnits);
          inc.backupRequested = false;
        }
        if (dv.escalateTo) this.morph(inc, dv.escalateTo);
      }
    }
    // a suspect at large blocks completion until caught or timed out
    if (sus && sus.free && !sus.caught) {
      inc.work = Math.max(inc.work, 2);
      return;
    }
    if (inc.work <= 0) {
      if (!inc.outcome) inc.outcome = (TYPE_BY_KEY.get(inc.type)!.outcomes ?? ['対応終了'])[Math.floor(this.rnd() * type.outcomes.length)];
      this.finishIncident(inc, true);
    }
  }

  /** change incident to a more serious type (e.g. 口論 → 暴行) */
  private morph(inc: Incident, key: string) {
    const nt = TYPE_BY_KEY.get(key);
    if (!nt) return;
    inc.type = nt.key;
    inc.name = nt.name;
    inc.code = nt.code;
    inc.priority = Math.min(inc.priority, nt.priority);
    inc.minUnits = Math.max(inc.minUnits, nt.minUnits);
    inc.idealUnits = Math.max(inc.idealUnits, nt.idealUnits);
    inc.work += nt.work * 0.5;
    inc.workTotal += nt.work * 0.5;
    inc.backupRequested = false;
    inc.transport = inc.transport || this.rnd() < (nt.transport ?? 0);
    inc.updates.push({ t: this.t, kind: 'warn', text: `事案種別変更：${nt.name}` });
    this.addLog(`種別変更 ${inc.id} → ${nt.name}`, inc.id);
  }

  private finishIncident(inc: Incident, success: boolean) {
    inc.status = success ? 'resolved' : 'failed';
    inc.tEnd = this.t;
    if (success) this.stats.resolved++;
    else this.stats.failed++;
    this.scoreIncident(inc, success);
    const units = inc.assigned.map((id) => this.unitById.get(id)!).filter(Boolean);
    const lead = units.find((u) => inc.onScene.includes(u.id)) ?? units[0];
    if (lead) this.say(lead.callsign, R.HQ, R.resolved(lead, inc), { unitId: lead.id, incidentId: inc.id, channel: '現場' }, 1);
    else this.sys(`${inc.id} ${inc.name}：${inc.outcome}`, inc.id);
    if (lead) this.say(R.HQ, lead.callsign, R.hqAck(lead.callsign), { unitId: lead.id, incidentId: inc.id }, 5);
    inc.updates.push({ t: this.t, kind: success ? 'system' : 'warn', text: `${success ? '終結' : '終了（未解決）'}：${inc.outcome}` });
    this.addLog(`${success ? '終結' : '未解決'} ${inc.id} ${inc.name}：${inc.outcome}`, inc.id);
    let transporter: Unit | null = null;
    if (inc.transport && success && lead && inc.onScene.includes(lead.id)) transporter = lead;
    if (inc.suspect?.caught && inc.suspect.seenBy) transporter = this.unitById.get(inc.suspect.seenBy) ?? transporter;
    for (const u of units) {
      if (u.incidentId !== inc.id) continue;
      if (u === transporter) {
        this.transport(u, inc);
        continue;
      }
      if (u.status === 'transport' || u.status === 'office') continue;
      u.incidentId = null;
      this.finishAssignment(u);
    }
    this.emit('resolved', inc);
    this.emit('change');
  }

  /** points: priority × response speed, arrest bonus; auto-handled calls earn half */
  private scoreIncident(inc: Incident, success: boolean) {
    const base = [0, 300, 180, 100, 50][inc.priority] ?? 50;
    let pts = 0;
    let reason = '';
    if (success) {
      const target = [0, 6, 9, 14, 20][inc.priority] * 60;
      const resp = inc.tArrive !== null ? inc.tArrive - inc.t0 : target * 2;
      const f = resp < target * 0.5 ? 1.6 : resp < target ? 1.2 : resp < target * 1.6 ? 0.8 : 0.4;
      pts = base * f;
      reason = f >= 1.6 ? '迅速対応' : f >= 1.2 ? '目標時間内' : f >= 0.8 ? '対応' : '遅延';
      if (inc.suspect?.caught) {
        pts += 150;
        reason += '・マル被確保';
      }
      if (inc.selfInit) pts *= 0.6;
      if (inc.auto) pts *= 0.25;
      this.stats.streak++;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
      if (this.stats.streak > 0 && this.stats.streak % 5 === 0) {
        pts += 50 * (this.stats.streak / 5);
        reason += `・連続解決${this.stats.streak}`;
      }
    } else {
      pts = -base * 0.8;
      reason = '未解決';
      this.stats.streak = 0;
    }
    pts = Math.round(pts);
    inc.score = pts;
    this.addScore(pts, `${inc.name}：${reason}${inc.auto ? '（自動指令）' : ''}`, inc.id);
  }

  private transport(u: Unit, inc: Incident) {
    const st = this.world.facilities.find((f) => f.id === u.stationId) ?? this.world.jurisdiction(u.x, u.y);
    const what = inc.suspect?.caught || /逮捕|確保|同行/.test(inc.outcome) ? 'マル被' : '保護対象者';
    u.status = 'transport';
    u.task = { kind: 'station', label: st?.short + '署' };
    u.incidentId = null;
    u.emergency = false;
    this.say(u.callsign, R.HQ, R.transportMsg(u, (st?.short ?? '') + '署', what), { unitId: u.id, incidentId: inc.id, channel: '現場' }, 8);
    if (!st) return this.resume(u);
    const to = this.snap(st.x, st.y);
    if (!to || u.manual) return;
    this.setRoute(u, this.routeFor(u, to, false));
    if (!u.route) this.routeDone(u);
  }

  private finishAssignment(u: Unit) {
    u.incidentId = null;
    if (!this.settings.autoReturn) {
      u.status = 'hold';
      u.task = null;
      this.setRoute(u, null);
      return;
    }
    this.resume(u);
  }

  // ---------------------------------------------------------------- suspects
  private moveSuspect(inc: Incident, s: Suspect, dt: number) {
    if (!s.route || s.leg >= s.route.legs.length) {
      // flee to a random point 1–3 km away, preferring the direction away from the scene
      const away = Math.atan2(s.y - inc.y, s.x - inc.x);
      const a = (Math.hypot(s.y - inc.y, s.x - inc.x) > 50 ? away : this.rnd() * Math.PI * 2) + (this.rnd() - 0.5) * 1.6;
      const dist = s.mode === 'car' || s.mode === 'moto' ? 2500 + this.rnd() * 3000 : 700 + this.rnd() * 1300;
      const to = this.snap(s.x + Math.cos(a) * dist, s.y + Math.sin(a) * dist);
      if (!to) return;
      const foot = s.mode === 'foot' || s.mode === 'bike';
      const r = this.g.route(s.pos, to, foot ? { fixedKmh: FLEE_KMH[s.mode], ignoreOneway: true } : { traffic: this.traffic, avoidMotorway: s.mode === 'moto' });
      s.route = r;
      s.leg = 0;
      if (!r) return;
    }
    const r = s.route!;
    let v = FLEE_KMH[s.mode] / 3.6;
    if (s.mode === 'car') v = this.g.speed(r.legs[s.leg].edge) * this.tf[r.legs[s.leg].edge] * 1.1;
    let travel = v * dt;
    let leg = r.legs[s.leg];
    let pos = s.pos.edge === leg.edge ? s.pos.s : leg.s0;
    while (travel > 0 && leg) {
      const dir = leg.s1 >= leg.s0 ? 1 : -1;
      const left = (leg.s1 - pos) * dir;
      if (travel < left) {
        pos += travel * dir;
        travel = 0;
      } else {
        travel -= left;
        s.leg++;
        leg = r.legs[s.leg];
        if (!leg) break;
        pos = leg.s0;
      }
    }
    if (!leg) {
      s.route = null;
      return;
    }
    s.pos = { edge: leg.edge, dir: leg.s1 >= leg.s0 ? 1 : -1, s: pos };
    const p = this.g.pointAt(leg.edge, pos);
    s.x = p.x;
    s.y = p.y;
  }

  private detectSuspects() {
    for (const inc of this.incidents) {
      const s = inc.suspect;
      if (!s || !s.free || s.caught) continue;
      if (this.units.some((u) => u.status === 'pursuit' && u.incidentId === inc.id)) continue;
      const vehicle = s.mode === 'car' || s.mode === 'moto';
      for (const u of this.units) {
        if (u.status === 'office' || u.status === 'transport') continue;
        if (u.status === 'standby' && u.kind !== 'koban') continue;
        const d = Math.hypot(u.x - s.x, u.y - s.y);
        const range = u.status === 'hold' ? (vehicle ? 120 : 80) : vehicle ? 160 : 110;
        if (d > range) continue;
        let p = u.status === 'hold' ? 0.4 : u.status === 'search' ? 0.22 : u.incidentId === inc.id ? 0.18 : 0.07;
        if (u.kind === 'kisou') p *= 1.5;
        if (this.isNight) p *= 0.75;
        if (this.rnd() > p) continue;
        // spotted
        const place = this.world.describe(s.x, s.y);
        const old = u.incidentId && u.incidentId !== inc.id ? this.incById.get(u.incidentId) : null;
        if (old) this.detach(u, old);
        u.incidentId = inc.id;
        if (!inc.assigned.includes(u.id)) inc.assigned.push(u.id);
        u.status = 'pursuit';
        u.emergency = true;
        u.wait = 0;
        u.task = { kind: 'pursue', incidentId: inc.id };
        s.lastSeen = { x: s.x, y: s.y, t: this.t };
        s.seenBy = u.id;
        if (!u.manual) this.setRoute(u, this.routeFor(u, { edge: s.pos.edge, s: s.pos.s }, true));
        this.say(u.callsign, R.HQ, R.spotted(u, place), { unitId: u.id, incidentId: inc.id, level: 'urgent', channel: '現場' });
        inc.updates.push({ t: this.t, kind: 'field', text: `${u.callsign} マル被らしき者を発見、追跡中（${place}）` });
        if (inc.status === 'pending') {
          inc.status = 'dispatched';
          inc.tDispatch = this.t;
        }
        this.emit('change');
        break;
      }
    }
  }

  private catchSuspect(u: Unit, inc: Incident) {
    const s = inc.suspect!;
    s.caught = true;
    s.free = false;
    s.seenBy = u.id;
    u.stats.arrests++;
    this.stats.arrests++;
    const place = this.world.describe(s.x, s.y);
    this.say(u.callsign, R.HQ, R.caught(u, place), { unitId: u.id, incidentId: inc.id, level: 'urgent', channel: '現場' });
    this.say(R.HQ, '各移動', `${R.HQ}から各移動。${inc.name.replace(/（.*?）/, '')}のマル被は${u.callsign}が確保。検索中の各移動は通常に戻れ。`, { incidentId: inc.id }, 6);
    inc.updates.push({ t: this.t, kind: 'field', text: `${u.callsign} マル被確保（${place}）` });
    const type = TYPE_BY_KEY.get(inc.type)!;
    inc.outcome = type.outcomes[0];
    inc.transport = true;
    // searching / checkpoint units stand down
    for (const id of [...inc.assigned]) {
      const o = this.unitById.get(id);
      if (!o || o === u) continue;
      if (o.status === 'search' || o.status === 'pursuit' || o.status === 'hold' || (o.status === 'moving' && o.task?.incidentId === inc.id)) {
        this.detach(o, inc);
        this.finishAssignment(o);
      }
    }
    inc.work = Math.min(inc.work, 3);
    if (inc.status !== 'onscene' || inc.onScene.length === 0) this.finishIncident(inc, true);
    this.emit('change');
  }

  // ---------------------------------------------------------------- queries
  activeIncidents() {
    return this.incidents.filter((i) => i.status !== 'resolved' && i.status !== 'failed');
  }
  unitStatusText(u: Unit) {
    return STATUS_LABEL[u.status as UnitStatus];
  }
  /** remaining route time estimate (seconds) */
  routeEta(u: Unit): number | null {
    if (!u.route) return null;
    let rem = 0;
    const r = u.route;
    for (let k = u.leg; k < r.legs.length; k++) {
      const l = r.legs[k];
      const len = k === u.leg ? Math.abs(l.s1 - u.pos.s) : Math.abs(l.s1 - l.s0);
      rem += (this.g.edgeCost(l.edge, this.routeOpts(u, u.emergency)) * len) / this.g.elen[l.edge];
    }
    return rem + u.wait;
  }
  routeRemaining(u: Unit): number {
    if (!u.route) return 0;
    let rem = 0;
    for (let k = u.leg; k < u.route.legs.length; k++) {
      const l = u.route.legs[k];
      rem += k === u.leg ? Math.abs(l.s1 - u.pos.s) : Math.abs(l.s1 - l.s0);
    }
    return rem;
  }
  /** polyline of the remaining route */
  routeLine(u: Unit): [number, number][] {
    const out: [number, number][] = [[u.x, u.y]];
    if (!u.route) return out;
    for (let k = u.leg; k < u.route.legs.length; k++) {
      const l = u.route.legs[k];
      this.g.slice(l.edge, k === u.leg ? u.pos.s : l.s0, l.s1, out);
    }
    return out;
  }
  previewRoute(u: Unit, to: { edge: number; s: number }, emergency: boolean, via: { x: number; y: number }[] = []): { line: [number, number][]; route: Route } | null {
    const r = this.routeFor(u, to, emergency, via);
    if (!r) return null;
    const line: [number, number][] = [];
    for (const l of r.legs) this.g.slice(l.edge, l.s0, l.s1, line);
    return { line, route: r };
  }

  /** manual control support (driving mode) */
  setManual(u: Unit, on: boolean) {
    u.manual = on;
    if (on) {
      u.route = null;
      u.wait = 0;
    } else {
      // resume automatic behaviour from current position
      const n = this.g.nearest(u.x, u.y, 400);
      if (n) {
        const p = this.g.pointAt(n.edge, n.s);
        const hx = Math.sin(u.heading), hy = Math.cos(u.heading);
        u.pos = { edge: n.edge, s: n.s, dir: p.hx * hx + p.hy * hy >= 0 ? 1 : -1 };
      }
      if (u.status === 'enroute' && u.incidentId) this.setRoute(u, this.routeFor(u, this.incById.get(u.incidentId)!.loc, u.emergency, []));
      else if (u.status === 'moving' && u.task?.x !== undefined) {
        const to = this.snap(u.task.x, u.task.y!);
        if (to) this.setRoute(u, this.routeFor(u, to, u.emergency));
      } else if (u.status === 'returning' || u.status === 'transport') {
        const st = u.status === 'transport' ? this.world.facilities.find((f) => f.id === u.stationId) : null;
        const to = this.snap(st?.x ?? u.baseX, st?.y ?? u.baseY);
        if (to) this.setRoute(u, this.routeFor(u, to, false));
      } else if (u.status === 'patrol') this.setRoute(u, null);
    }
  }
  /** called by driving mode each frame */
  manualUpdate(u: Unit, x: number, y: number, heading: number, v: number, dt: number) {
    u.x = x;
    u.y = y;
    u.heading = heading;
    u.v = v;
    u.stats.km += (v * dt) / 1000;
    // keep a network position for routing/ETA
    if (((this.t * 2) | 0) % 2 === 0) {
      const n = this.g.nearest(x, y, 120);
      if (n) {
        const p = this.g.pointAt(n.edge, n.s);
        u.pos = { edge: n.edge, s: n.s, dir: p.hx * Math.sin(heading) + p.hy * Math.cos(heading) >= 0 ? 1 : -1 };
      }
    }
  }
  /** arrival by player at destination of moving / returning task */
  manualArrive(u: Unit) {
    if (u.status === 'enroute' && u.incidentId) this.arrive(u, this.incById.get(u.incidentId));
    else if (u.status === 'moving' || u.status === 'returning' || u.status === 'transport') this.routeDone(u);
  }

  newPlanAround(u: Unit, x: number, y: number, r: number, name: string): PatrolPlan {
    return areaPlan(name, x, y, r, undefined, u.patrol?.focus ?? 'balanced');
  }

  // ---------------------------------------------------------------- persistence
  serialize() {
    return {
      v: 1,
      t: this.t,
      date0: this.date0.toISOString(),
      speed: this.speed,
      settings: this.settings,
      stats: this.stats,
      incSeq: this.incSeq,
      radioSeq: this.radioSeq,
      nextSpawn: this.nextSpawn,
      events: this.events,
      weather: this.weather,
      units: this.units.map((u) => ({ ...u, manual: false, visited: [...u.visited.entries()].slice(-500) })),
      incidents: this.incidents.map((i) => ({ ...i, reported: [...i.reported] })),
      radio: this.radio.slice(-300),
      log: this.log.slice(-1500),
    };
  }
  restore(d: ReturnType<Sim['serialize']>) {
    this.t = d.t;
    this.date0 = new Date(d.date0);
    this.speed = d.speed;
    this.incSeq = d.incSeq;
    this.radioSeq = d.radioSeq;
    this.nextSpawn = d.nextSpawn;
    this.events = d.events ?? [];
    this.weather = d.weather ?? 'clear';
    this.settings = { ...{ rate: 1, autoReturn: true, auto: 'assist', autoDelay: 45, events: true }, ...d.settings };
    this.stats = { ...{ score: 0, streak: 0, bestStreak: 0, tickets: 0, questioned: 0, auto: 0 }, ...d.stats };
    const byId = new Map(d.units.map((u) => [u.id, u]));
    for (const u of this.units) {
      const s = byId.get(u.id);
      if (!s) continue;
      Object.assign(u, s, { visited: new Map(s.visited), crew: s.crew });
      if (u.pos.edge >= this.g.ne) this.placeUnit(u, 0, 0);
    }
    this.incidents = d.incidents.map((i) => ({ ...i, reported: new Set(i.reported) })) as Incident[];
    this.incById = new Map(this.incidents.map((i) => [i.id, i]));
    this.radio = d.radio;
    this.log = d.log;
    this.updateTraffic(true);
    this.emit('change');
  }
}

function gauss(rnd: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
}

export type { NetPos };

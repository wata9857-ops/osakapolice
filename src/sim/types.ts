import type { NetPos, Route } from './graph';

export type UnitKind = 'pc' | 'jiraku' | 'kotsu' | 'kisou' | 'koban';

export type UnitStatus =
  | 'standby' // 待機（署・交番）
  | 'patrol' // 警ら中
  | 'enroute' // 出動中
  | 'onscene' // 現場活動
  | 'search' // 検索中
  | 'pursuit' // 追跡中
  | 'transport' // 連行・保護搬送
  | 'office' // 署内処理
  | 'returning' // 引揚げ
  | 'moving' // 指定地点へ移動
  | 'hold'; // 停留・検問

export const UNIT_KIND_LABEL: Record<UnitKind, string> = {
  pc: '所轄PC',
  jiraku: '自ら隊',
  kotsu: '交機白バイ',
  kisou: '機捜',
  koban: '交番',
};
export const UNIT_KIND_LONG: Record<UnitKind, string> = {
  pc: '所轄警察署 パトロールカー',
  jiraku: '地域部 自動車警ら隊',
  kotsu: '交通部 交通機動隊（白バイ）',
  kisou: '刑事部 機動捜査隊（覆面）',
  koban: '交番勤務員（自転車）',
};

export const STATUS_LABEL: Record<UnitStatus, string> = {
  standby: '待機',
  patrol: '警ら',
  enroute: '出動',
  onscene: '現場',
  search: '検索',
  pursuit: '追跡',
  transport: '連行',
  office: '署内',
  returning: '引揚',
  moving: '移動',
  hold: '停留',
};

/** statuses in which a unit can be assigned without pulling it off another incident */
export const AVAILABLE: UnitStatus[] = ['standby', 'patrol', 'returning', 'moving', 'hold'];

export interface Waypoint {
  x: number;
  y: number;
  edge: number;
  s: number;
  dwell: number; // seconds to stay
  label?: string;
}

export type PatrolFocus = 'balanced' | 'hotspot' | 'major' | 'residential';

export interface PatrolPlan {
  kind: 'area' | 'route';
  /** area patrol: circle in metres */
  cx: number;
  cy: number;
  r: number;
  areaName: string;
  ward?: string;
  focus: PatrolFocus;
  waypoints: Waypoint[];
  wpIndex: number;
  /** active hours (sim clock), inclusive start, exclusive end. null = always */
  schedule: { start: number; end: number } | null;
}

export interface UnitTask {
  kind: 'incident' | 'home' | 'patrol' | 'point' | 'station' | 'pursue';
  incidentId?: string;
  x?: number;
  y?: number;
  label?: string;
}

export interface Crew {
  rank: string;
  name: string;
}

export interface Unit {
  id: string;
  callsign: string;
  kind: UnitKind;
  stationId: number; // owning station facility id
  baseId: number; // facility where the unit is based (station or kōban)
  baseX: number;
  baseY: number;
  vehicle: string;
  crew: Crew[];
  status: UnitStatus;
  pos: NetPos;
  x: number;
  y: number;
  heading: number; // radians, 0 = north, clockwise
  v: number; // m/s
  route: Route | null;
  leg: number;
  task: UnitTask | null;
  emergency: boolean;
  incidentId: string | null;
  patrol: PatrolPlan | null;
  after: 'resume' | 'home' | 'hold';
  wait: number; // seconds remaining at a stop (signal / dwell / office)
  timer: number; // generic activity timer
  manual: boolean; // driven by the player in driving mode
  via: { x: number; y: number }[];
  routePref: 'fast' | 'major' | 'nomotorway';
  stats: { dispatches: number; arrests: number; km: number };
  lastRadio: number;
  visited: Map<number, number>; // edge -> sim time last patrolled
  searchCenter?: { x: number; y: number; r: number; until: number };
}

export type IncidentStatus = 'pending' | 'dispatched' | 'onscene' | 'resolved' | 'failed';

export interface IncidentUpdate {
  t: number;
  text: string;
  kind: 'call' | 'info' | 'field' | 'system' | 'warn';
}

export interface Suspect {
  desc: string;
  mode: 'foot' | 'bike' | 'car' | 'moto';
  pos: NetPos;
  x: number;
  y: number;
  route: Route | null;
  leg: number;
  free: boolean; // fleeing
  caught: boolean;
  lastSeen: { x: number; y: number; t: number } | null;
  seenBy: string | null;
  startT: number;
  giveUpT: number;
}

export interface Incident {
  id: string;
  type: string;
  name: string;
  code: string;
  priority: number;
  x: number;
  y: number;
  loc: { edge: number; s: number };
  address: string;
  ward: string;
  stationId: number;
  caller: string;
  detail: string;
  status: IncidentStatus;
  t0: number; // reported time
  tDispatch: number | null;
  tArrive: number | null;
  tEnd: number | null;
  assigned: string[];
  onScene: string[];
  minUnits: number;
  idealUnits: number;
  work: number; // remaining unit-minutes
  workTotal: number;
  updates: IncidentUpdate[];
  suspect: Suspect | null;
  escalated: boolean;
  devAt: number | null; // sim time at which a development occurs
  devDone: boolean;
  backupRequested: boolean;
  injury: boolean;
  outcome: string;
  transport: boolean;
  reported: Set<string>; // dedupe of radio messages
  auto?: boolean; // handled by the automatic dispatcher
  eventName?: string; // spawned by a city event
  cordoned?: boolean;
  selfInit?: boolean; // discovered by a patrol unit
  score?: number;
}

export interface RadioMsg {
  id: number;
  t: number;
  from: string;
  to: string;
  text: string;
  unitId?: string;
  incidentId?: string;
  level: 'normal' | 'urgent' | 'info' | 'system';
  channel: '指令' | '現場' | '署活' | 'システム';
}

export interface LogEntry {
  t: number;
  text: string;
  incidentId?: string;
  unitId?: string;
}

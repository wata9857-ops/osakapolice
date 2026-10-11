// Static world data: road graph, police facilities, landmarks, ward areas.
import { RoadGraph, type RoadData } from './graph';
import { proj } from '../shared/proj.js';

export type FacilityKind = 'hq' | 'station' | 'koban' | 'chuzaisho' | 'unitbase' | 'other';

export interface Facility {
  id: number;
  name: string;
  short: string; // e.g. 曽根崎 / 梅田
  kind: FacilityKind;
  x: number;
  y: number;
  ward: string | null;
  city: boolean;
  station?: number; // parent station id for kōban
}

export interface Landmark {
  name: string;
  kind: string;
  x: number;
  y: number;
  ward: string | null;
}

export interface Ward {
  name: string;
  rings: [number, number][][]; // outer rings in local metres
  cx: number;
  cy: number;
  area: number;
}

export interface Hotspot {
  name: string;
  x: number;
  y: number;
  r: number;
  /** relative activity by time band: [day, evening, night] */
  w: [number, number, number];
  tags: string[];
}

const HOTSPOTS_LL: [string, number, number, number, [number, number, number], string[]][] = [
  ['梅田', 135.4959, 34.7025, 600, [3, 3, 2], ['shop', 'station', 'night']],
  ['北新地', 135.4975, 34.6975, 300, [0.5, 2, 3], ['night']],
  ['茶屋町', 135.4995, 34.7065, 250, [1.5, 1.5, 1], ['shop']],
  ['道頓堀', 135.5013, 34.6687, 300, [2, 3, 3.5], ['night', 'tourist']],
  ['心斎橋', 135.5012, 34.6748, 350, [2.5, 2.5, 1.5], ['shop', 'tourist']],
  ['難波', 135.5016, 34.6627, 450, [2.5, 3, 2.5], ['shop', 'station', 'night']],
  ['アメリカ村', 135.4983, 34.6722, 220, [1.2, 2, 2], ['night']],
  ['日本橋でんでんタウン', 135.5063, 34.6592, 300, [1.5, 1, 0.3], ['shop']],
  ['京橋', 135.5338, 34.6967, 350, [1.2, 2, 2.5], ['station', 'night']],
  ['天王寺・あべの', 135.5133, 34.6466, 450, [2, 2, 1.5], ['shop', 'station']],
  ['新世界', 135.5063, 34.6523, 300, [1.5, 2, 2], ['tourist', 'night']],
  ['あいりん地区', 135.5017, 34.6447, 350, [1.5, 1.5, 2], ['night']],
  ['十三', 135.4823, 34.7208, 300, [1, 1.8, 2.2], ['night', 'station']],
  ['鶴橋', 135.5305, 34.6656, 300, [1.5, 1.5, 0.8], ['shop', 'station']],
  ['新大阪', 135.5002, 34.7334, 350, [1.5, 1, 0.5], ['station']],
  ['大阪城公園', 135.5262, 34.6873, 600, [1.2, 0.8, 0.4], ['tourist', 'park']],
  ['USJ・ユニバーサルシティ', 135.4323, 34.6654, 500, [1.5, 1.2, 0.3], ['tourist']],
  ['海遊館・天保山', 135.4289, 34.6545, 350, [1, 0.6, 0.2], ['tourist']],
  ['弁天町', 135.4614, 34.6697, 300, [0.8, 0.8, 0.5], ['station']],
  ['天神橋筋商店街', 135.5115, 34.7035, 500, [1.5, 1.2, 0.6], ['shop']],
  ['京セラドーム大阪', 135.4762, 34.6694, 300, [0.8, 1.2, 0.3], ['tourist']],
  ['西中島南方', 135.4999, 34.7275, 250, [0.8, 1.2, 1.5], ['night']],
  ['住之江公園', 135.4776, 34.6122, 400, [0.6, 0.6, 0.4], ['park']],
  ['平野', 135.5546, 34.6219, 500, [0.8, 0.6, 0.4], ['residential']],
  ['長居公園', 135.5180, 34.6131, 500, [0.8, 0.6, 0.3], ['park']],
];

export interface PoliceData {
  name: string;
  short: string;
  kind: FacilityKind;
  x: number;
  y: number;
  ward: string | null;
  city: boolean;
}

export interface AreasGeo {
  features: { properties: { kind: string; name: string }; geometry: { coordinates: [number, number][][][] } }[];
}

export class World {
  graph: RoadGraph;
  facilities: Facility[] = [];
  stations: Facility[] = [];
  kobans: Facility[] = [];
  landmarks: Landmark[];
  wards: Ward[] = [];
  city: [number, number][][] = [];
  hotspots: Hotspot[];
  places: [string, number, number][] = [];
  cityBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  constructor(roads: RoadData, signals: (number | [number, string])[], police: PoliceData[], landmarks: Landmark[], areas: AreasGeo) {
    this.graph = new RoadGraph(roads);
    this.graph.setSignals(signals);
    this.landmarks = landmarks;
    this.hotspots = HOTSPOTS_LL.map(([name, lon, lat, r, w, tags]) => {
      const [x, y] = proj(lon, lat);
      return { name, x, y, r, w, tags };
    });
    for (const f of areas.features) {
      const rings = f.geometry.coordinates.map((poly) => poly[0].map(([lo, la]) => proj(lo, la)));
      if (f.properties.kind === 'city') {
        this.city = rings;
        let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
        for (const r of rings) for (const [x, y] of r) (a = Math.min(a, x)), (b = Math.min(b, y)), (c = Math.max(c, x)), (d = Math.max(d, y));
        this.cityBounds = { minX: a, minY: b, maxX: c, maxY: d };
        continue;
      }
      let sx = 0, sy = 0, n = 0, area = 0;
      for (const r of rings) {
        for (const [x, y] of r) (sx += x), (sy += y), n++;
        area += Math.abs(ringArea(r));
      }
      this.wards.push({ name: f.properties.name, rings, cx: sx / n, cy: sy / n, area });
    }
    // facilities
    let id = 0;
    for (const p of police) {
      if (!p.city && p.kind !== 'station') continue;
      if (p.kind === 'other') continue;
      this.facilities.push({ id: id++, name: p.name, short: p.short || p.name, kind: p.kind, x: p.x, y: p.y, ward: p.ward, city: p.city });
    }
    this.stations = this.facilities.filter((f) => f.kind === 'station' && f.city);
    this.kobans = this.facilities.filter((f) => (f.kind === 'koban' || f.kind === 'chuzaisho') && f.city);
    for (const k of this.kobans) k.station = this.jurisdiction(k.x, k.y)?.id;
  }

  inCity(x: number, y: number) {
    return this.city.some((r) => pointInRing(x, y, r));
  }

  wardAt(x: number, y: number): Ward | null {
    for (const w of this.wards) if (w.rings.some((r) => pointInRing(x, y, r))) return w;
    return null;
  }

  /** police station responsible for a point: station of the same ward, nearest if several */
  jurisdiction(x: number, y: number): Facility | null {
    const w = this.wardAt(x, y);
    let cands = w ? this.stations.filter((s) => s.ward === w.name) : [];
    if (!cands.length) cands = this.stations;
    let best: Facility | null = null, bd = Infinity;
    for (const s of cands) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) (bd = d), (best = s);
    }
    return best;
  }

  nearestLandmark(x: number, y: number, maxD: number, kinds?: string[]): Landmark | null {
    let best: Landmark | null = null, bd = maxD;
    for (const l of this.landmarks) {
      if (kinds && !kinds.includes(l.kind)) continue;
      const d = Math.hypot(l.x - x, l.y - y);
      if (d < bd) (bd = d), (best = l);
    }
    return best;
  }

  placeAt(x: number, y: number, maxD = 450): string {
    let best = '', bd = maxD * maxD;
    for (const [n, px, py] of this.places) {
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) (bd = d), (best = n);
    }
    return best;
  }

  /** address-like description: 「北区梅田一丁目 御堂筋 梅田新道交差点付近」 */
  describe(x: number, y: number): string {
    const ward = this.wardAt(x, y)?.name ?? '';
    const area = ward + this.placeAt(x, y);
    const lm = this.nearestLandmark(x, y, 160);
    if (lm) {
      const nm = lm.kind === 'station' || lm.kind === 'subway' ? (lm.name.endsWith('駅') ? lm.name : lm.name + '駅') : lm.name;
      const road = this.graph.nearest(x, y, 60, (e) => this.graph.ecls[e] !== 0);
      const rn = road ? this.graph.name(road.edge) : '';
      return `${area} ${rn ? rn + ' ' : ''}${nm}付近`.trim();
    }
    const d = this.graph.describe(x, y);
    if (d) return `${area} ${d}`.trim();
    const hs = this.hotspots.find((h) => Math.hypot(h.x - x, h.y - y) < h.r);
    return `${area}${hs && !area.includes(hs.name) ? ' ' + hs.name : ''}付近`.trim();
  }
}

export function pointInRing(x: number, y: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringArea(r: [number, number][]) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

export interface LoadProgress {
  (stage: string, frac: number): void;
}

export async function loadWorld(onProgress?: LoadProgress): Promise<World> {
  const base = import.meta.env.BASE_URL + 'data/';
  const get = async <T,>(f: string): Promise<T> => {
    const r = await fetch(base + f);
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    return r.json();
  };
  onProgress?.('道路網データ読込中', 0.1);
  const [roads, signals, police, landmarks, areas, places] = await Promise.all([
    get<RoadData>('roads.json'),
    get<(number | [number, string])[]>('signals.json'),
    get<PoliceData[]>('police.json'),
    get<Landmark[]>('landmarks.json'),
    get<AreasGeo>('areas.json'),
    get<[string, number, number][]>('places.json').catch(() => []),
  ]);
  onProgress?.('道路グラフ構築中', 0.6);
  await new Promise((r) => setTimeout(r, 20));
  const w = new World(roads, signals, police, landmarks, areas);
  w.places = places;
  onProgress?.('完了', 1);
  return w;
}

// Creation of the police force: units per station, mobile patrol unit, traffic unit, investigators, kōban.
import type { World, Facility } from './world';
import type { Unit, UnitKind, Crew, PatrolPlan } from './types';
import { CLS_MOTORWAY, F_LINK } from './graph';
import { proj } from '../shared/proj.js';

const SURNAMES = '田中 山本 中村 松本 井上 木村 林 清水 山口 森 池田 橋本 山下 石川 中島 前田 藤田 小川 岡田 後藤 長谷川 村上 近藤 石井 坂本 遠藤 青木 藤井 西村 福田 太田 三浦 藤原 岡本 松田 中川 中野 原田 小野 竹内 金子 和田 中山 石田 上田 森田 原 柴田 酒井 工藤 横山 宮崎 宮本 内田 高木 安藤 谷口 大野 丸山 今井 河野 藤本 村田 武田 上野 杉山 増田 平野 大塚 千葉 久保 松井 小島 岩崎 桜井 野口 松尾 野村 木下 菊地 佐野 大西 杉本 新井 浜田 菅原 市川 水野 小松 島田 古川 小山 高野 西田 菊池 山内 西川 五十嵐 北村 安田 中田 川口 平田 川崎 飯田 吉川 本田 久保田 沢田 辻 関 吉村 渡部 岩田 中西 服部 樋口 福島 川上 永井 松岡 田口 山中 森本 土屋 矢野 広瀬 秋山 石原 松下 大橋 松浦 吉岡 小池 馬場 浅野 荒木 大久保 野田 小沢 田辺 川村 星野 黒田 堀 尾崎 望月 永田 熊谷 内藤 松村 西山 大谷 平井'.split(' ');

const PC_MODELS = ['トヨタ クラウン（220系）', 'トヨタ クラウン（210系）', 'トヨタ クラウン（220系）', 'スバル インプレッサG4'];

/** stations with heavier workload get three patrol cars */
const BUSY = ['曽根崎', '南', '天満', '東', '浪速', '西成', '天王寺', '阿倍野', '淀川', '東淀川', '平野', '生野', '城東'];

/** mobile patrol unit zones (自動車警ら隊 方面) */
const JIRAKU_ZONES: [string, number, number, number][] = [
  ['北部方面（淀川・東淀川）', 135.497, 34.733, 2600],
  ['中央方面（北・中央）', 135.505, 34.688, 2400],
  ['東部方面（城東・鶴見・旭）', 135.553, 34.705, 2800],
  ['西部方面（此花・港・西淀川）', 135.445, 34.680, 3200],
  ['南部方面（住吉・住之江・西成）', 135.490, 34.612, 3000],
  ['南東方面（平野・生野・東住吉）', 135.540, 34.632, 2800],
];

const HQ_LL: [number, number] = [135.5196, 34.6862]; // 大阪府警察本部（中央区大手前）

let rnd: () => number = Math.random;
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

function crew(kind: UnitKind): Crew[] {
  const n1 = pick(SURNAMES), n2 = pick(SURNAMES.filter((s) => s !== n1));
  if (kind === 'kotsu') return [{ rank: pick(['巡査部長', '巡査長']), name: n1 }];
  if (kind === 'kisou') return [{ rank: '警部補', name: n1 }, { rank: '巡査部長', name: n2 }];
  if (kind === 'koban') return [{ rank: pick(['巡査部長', '巡査長']), name: n1 }, { rank: '巡査', name: n2 }];
  return [{ rank: pick(['巡査部長', '警部補']), name: n1 }, { rank: pick(['巡査', '巡査長']), name: n2 }];
}

export function areaPlan(name: string, x: number, y: number, r: number, ward?: string, focus: PatrolPlan['focus'] = 'balanced'): PatrolPlan {
  return { kind: 'area', cx: x, cy: y, r, areaName: name, ward, focus, waypoints: [], wpIndex: 0, schedule: null };
}

export function wardPlan(world: World, wardName: string, focus: PatrolPlan['focus'] = 'balanced'): PatrolPlan {
  const w = world.wards.find((w) => w.name === wardName);
  if (!w) return areaPlan(wardName, 0, 0, 2000);
  return areaPlan(`${wardName}管内`, w.cx, w.cy, Math.sqrt(w.area / Math.PI) * 1.15, wardName, focus);
}

export function createUnits(world: World, random: () => number): Unit[] {
  rnd = random;
  const g = world.graph;
  const units: Unit[] = [];
  const carFilter = (e: number) => g.ecls[e] !== CLS_MOTORWAY && !(g.eflags[e] & F_LINK);
  const make = (id: string, callsign: string, kind: UnitKind, base: Facility | { id: number; x: number; y: number }, stationId: number, vehicle: string): Unit => {
    const n = g.nearest(base.x, base.y, 800, carFilter) ?? g.nearest(base.x, base.y, 5000)!;
    const p = g.pointAt(n.edge, n.s);
    return {
      id, callsign, kind, stationId, baseId: base.id, baseX: p.x, baseY: p.y, vehicle, crew: crew(kind),
      status: 'standby', pos: { edge: n.edge, dir: 1, s: n.s }, x: p.x, y: p.y, heading: Math.atan2(p.hx, p.hy), v: 0,
      route: null, leg: 0, task: null, emergency: false, incidentId: null, patrol: null, after: 'resume', wait: 0, timer: 0,
      manual: false, via: [], routePref: 'fast', stats: { dispatches: 0, arrests: 0, km: 0 }, lastRadio: -1e9, visited: new Map(),
    };
  };
  const stations = [...world.stations].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  for (const st of stations) {
    const n = BUSY.includes(st.short) ? 3 : 2;
    for (let i = 1; i <= n; i++) {
      const u = make(`pc-${st.id}-${i}`, `${st.short}${i}`, 'pc', st, st.id, pick(PC_MODELS) + ' パトロールカー');
      if (st.ward) u.patrol = wardPlan(world, st.ward);
      if (u.patrol && world.stations.filter((s) => s.ward === st.ward).length > 1) {
        // split ward: patrol around own station
        u.patrol = areaPlan(`${st.short}署管内`, st.x, st.y, 1500, st.ward ?? undefined);
      }
      units.push(u);
    }
  }
  const [hx, hy] = proj(...HQ_LL);
  const hq = world.facilities.find((f) => f.kind === 'hq') ?? { id: -1, x: hx, y: hy };
  const hqStation = world.jurisdiction(hq.x, hq.y)?.id ?? 0;
  // 自動車警ら隊: 方面機動警ら隊 / パトカー分駐所 when present in the data, otherwise HQ
  const bases = world.facilities.filter((f) => f.kind === 'unitbase');
  JIRAKU_ZONES.forEach(([name, lon, lat, r], zi) => {
    const [x, y] = proj(lon, lat);
    let base: Facility | { id: number; x: number; y: number } = hq;
    let bd = Infinity;
    for (const b of bases) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bd) (bd = d), (base = b);
    }
    for (let k = 0; k < 2; k++) {
      const num = 11 + zi * 2 + k;
      const u = make(`jr-${num}`, `警ら${num}`, 'jiraku', base, world.jurisdiction(base.x, base.y)?.id ?? hqStation, 'トヨタ クラウン（220系） 警ら用無線警ら車');
      u.patrol = areaPlan(name, x, y, r, undefined, k === 0 ? 'major' : 'hotspot');
      units.push(u);
    }
  });
  for (let i = 0; i < 6; i++) {
    const u = make(`kt-${31 + i}`, `交機${31 + i}`, 'kotsu', hq, hqStation, 'ホンダ CB1300P 白バイ');
    const z = JIRAKU_ZONES[i];
    const [x, y] = proj(z[1], z[2]);
    u.patrol = areaPlan(`${z[0].split('（')[0]}幹線`, x, y, z[3] + 800, undefined, 'major');
    units.push(u);
  }
  for (let i = 0; i < 4; i++) {
    const u = make(`ks-${21 + i}`, `機捜${21 + i}`, 'kisou', hq, hqStation, pick(['トヨタ クラウン（覆面）', 'スバル WRX S4（覆面）']));
    const z = JIRAKU_ZONES[[1, 0, 4, 5][i]];
    const [x, y] = proj(z[1], z[2]);
    u.patrol = areaPlan(`${z[0].split('（')[0]}`, x, y, z[3], undefined, 'hotspot');
    units.push(u);
  }
  const seen = new Map<string, number>();
  for (const k of world.kobans) {
    let cs = k.short + 'PB';
    const c = (seen.get(cs) ?? 0) + 1;
    seen.set(cs, c);
    if (c > 1) cs = k.short + c + 'PB';
    const u = make(`kb-${k.id}`, cs, 'koban', k, k.station ?? 0, '自転車（警ら用）');
    units.push(u);
  }
  // initial deployment: first car of each station and all mobile units patrol, the rest stand by
  for (const u of units) {
    if (u.kind === 'jiraku' || u.kind === 'kotsu' || u.kind === 'kisou') u.status = 'patrol';
    else if (u.kind === 'pc' && (u.id.endsWith('-1') || (u.id.endsWith('-3') && random() < 0.5))) u.status = 'patrol';
  }
  return units;
}

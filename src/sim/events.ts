// City-wide dynamic events: weather, crowds, crime sprees, fugitives, blackouts, pursuits.
// Events change incident rates/types, traffic and spawn their own incidents over time.
import type { Sim } from './engine';
import { proj } from '../shared/proj.js';

export interface ActiveEvent {
  id: number;
  key: string;
  name: string;
  desc: string;
  icon: string;
  t0: number;
  t1: number;
  x?: number;
  y?: number;
  r?: number;
  ward?: string;
  rateMul: number;
  trafficMul: number;
  /** incident type weight multipliers */
  boost: Record<string, number>;
  /** probability that a suitable random incident is placed inside the event area */
  pull: number;
  nextAction: number;
  count: number;
}

interface EventDef {
  key: string;
  weight: number;
  band: [number, number, number]; // day / evening / night
  create(sim: Sim, base: ActiveEvent): ActiveEvent | null;
  tick?(sim: Sim, ev: ActiveEvent): void;
}

const ll = (lon: number, lat: number) => proj(lon, lat);
const rand = (sim: Sim, a: number, b: number) => a + sim.rnd() * (b - a);

function inCircle(sim: Sim, ev: ActiveEvent) {
  const a = sim.rnd() * Math.PI * 2, r = Math.sqrt(sim.rnd()) * (ev.r ?? 500);
  return { x: (ev.x ?? 0) + Math.cos(a) * r, y: (ev.y ?? 0) + Math.sin(a) * r };
}

function crowd(key: string, name: string, desc: string, lon: number, lat: number, r: number, band: [number, number, number], boost: Record<string, number>, dur: [number, number]): EventDef {
  return {
    key,
    weight: 1,
    band,
    create(sim, base) {
      const [x, y] = ll(lon, lat);
      return { ...base, name, desc, icon: '群', x, y, r, t1: sim.t + rand(sim, dur[0], dur[1]) * 60, rateMul: 1.15, trafficMul: 1, boost, pull: 0.45, nextAction: sim.t + 120 };
    },
    tick(sim, ev) {
      // crowd control request once, then occasional crowd incidents
      if (ev.count === 0) {
        const p = inCircle(sim, { ...ev, r: (ev.r ?? 500) * 0.3 });
        sim.spawnIncident('crowd', p, `${ev.name}`);
      } else {
        const keys = Object.keys(ev.boost);
        sim.spawnIncident(keys[Math.floor(sim.rnd() * keys.length)], inCircle(sim, ev));
      }
      ev.count++;
      ev.nextAction = sim.t + rand(sim, 6, 16) * 60;
    },
  };
}

export const EVENT_DEFS: EventDef[] = [
  {
    key: 'rain',
    weight: 1.2,
    band: [1, 1, 1],
    create(sim, base) {
      if (sim.weather !== 'clear') return null;
      sim.weather = 'rain';
      return {
        ...base, name: '大雨・雷注意報', desc: '市内全域で強い雨。視界不良でスリップ事故が増加、幹線道路は渋滞', icon: '雨',
        t1: sim.t + rand(sim, 50, 140) * 60, rateMul: 1.1, trafficMul: 0.78, boost: { acc_prop: 2.6, acc_inj: 2, acc_major: 2, carbreak: 0.4, fight: 0.6, touting: 0.3 }, pull: 0,
      };
    },
  },
  crowd('baseball', '京セラドーム大阪 試合終了', 'プロ野球の試合終了で約3万人が駅へ移動。雑踏・スリ・酔客に注意', 135.4762, 34.6694, 900, [0.6, 1.6, 0.4], { fight: 2, drunk: 2.5, chikan: 2.5, okibiki: 2, acc_prop: 1.5, lost: 2 }, [60, 100]),
  crowd('fireworks', 'なにわ淀川花火大会', '淀川河川敷に約50万人。迷子・急病人・雑踏事故に厳重警戒', 135.4865, 34.7135, 1400, [0.2, 1.8, 0.2], { lost: 4, sick: 3, chikan: 2.5, fight: 2, drunk: 2, okibiki: 2.5 }, [90, 150]),
  crowd('tenjin', '天神祭 船渡御・奉納花火', '大川沿いに見物客が集中。天満・南森町周辺で交通規制', 135.5155, 34.6955, 1000, [0.4, 1.8, 0.3], { lost: 3, sick: 2, chikan: 2, fight: 2, drunk: 2 }, [90, 150]),
  crowd('dotonbori', '道頓堀に群衆（代表戦勝利）', 'サッカー日本代表の勝利で戎橋周辺に若者が殺到。川への飛び込み多発', 135.5013, 34.6687, 450, [0.1, 1, 1.6], { dive: 8, fight: 3, drunk: 3, vandal: 3, assault: 1.8, touting: 1.5 }, [60, 120]),
  crowd('usj', 'USJ 閉園・ハロウィンイベント', 'ユニバーサルシティ駅周辺が大混雑。外国人観光客のトラブル増加', 135.4323, 34.6654, 800, [0.6, 1.4, 0.4], { tourist: 4, lost: 3, okibiki: 2, sick: 2 }, [60, 120]),
  crowd('halloween', 'ハロウィンの仮装群衆（アメリカ村）', 'アメリカ村・心斎橋に仮装した若者が集まる。路上飲酒・喧嘩に警戒', 135.4983, 34.6722, 600, [0, 1.3, 1.8], { fight: 3, drunk: 3, vandal: 3, chikan: 2, touting: 2 }, [80, 140]),
  {
    key: 'series_snatch',
    weight: 1,
    band: [0.8, 1.2, 1],
    create(sim, base) {
      const wards = sim.world.wards;
      const w = wards[Math.floor(sim.rnd() * wards.length)];
      return {
        ...base, name: `${w.name}でひったくり続発`, desc: `${w.name}管内で同一犯とみられるひったくりが連続発生。原付・自転車の男に警戒`, icon: '続',
        x: w.cx, y: w.cy, r: Math.sqrt(w.area / Math.PI), ward: w.name,
        t1: sim.t + rand(sim, 60, 120) * 60, rateMul: 1, trafficMul: 1, boost: { snatch: 1.5 }, pull: 0, nextAction: sim.t + rand(sim, 2, 6) * 60,
      };
    },
    tick(sim, ev) {
      sim.spawnIncident('snatch', inCircle(sim, { ...ev, r: (ev.r ?? 1000) * 0.8 }));
      ev.count++;
      ev.nextAction = sim.t + rand(sim, 9, 22) * 60;
    },
  },
  {
    key: 'fugitive',
    weight: 0.7,
    band: [1, 1, 1],
    create(sim, base) {
      const hs = sim.world.hotspots[Math.floor(sim.rnd() * sim.world.hotspots.length)];
      return {
        ...base, name: '指名手配犯の市内潜伏情報', desc: `強盗致傷で指名手配中の男が${hs.name}周辺で目撃された。各移動は手配写真を確認せよ`, icon: '手',
        x: hs.x, y: hs.y, r: 1500, t1: sim.t + 100 * 60, rateMul: 1, trafficMul: 1, boost: {}, pull: 0, nextAction: sim.t + 30,
      };
    },
    tick(sim, ev) {
      if (ev.count === 0) {
        const p = inCircle(sim, { ...ev, r: 400 });
        const inc = sim.spawnIncident('wanted', p, ev.name);
        if (inc?.suspect) inc.suspect.giveUpT = sim.t + 90 * 60;
      }
      ev.count++;
      ev.nextAction = ev.t1 + 1;
    },
  },
  {
    key: 'blackout',
    weight: 0.6,
    band: [1, 1, 1],
    create(sim, base) {
      const wards = sim.world.wards;
      const w = wards[Math.floor(sim.rnd() * wards.length)];
      return {
        ...base, name: `${w.name}で大規模停電`, desc: `${w.name}の一部で停電。信号機が滅灯し交差点が混乱`, icon: '電',
        x: w.cx, y: w.cy, r: Math.sqrt(w.area / Math.PI) * 0.8, ward: w.name,
        t1: sim.t + rand(sim, 40, 80) * 60, rateMul: 1, trafficMul: 1, boost: { acc_prop: 1.5 }, pull: 0.2, nextAction: sim.t + 60,
      };
    },
    tick(sim, ev) {
      if (ev.count < 4) sim.spawnIncident('signal', inCircle(sim, ev));
      ev.count++;
      ev.nextAction = sim.t + rand(sim, 4, 12) * 60;
    },
  },
  {
    key: 'pursuit',
    weight: 0.7,
    band: [0.8, 1, 1.3],
    create(sim, base) {
      // stolen car entering from the Hyogo side (国道2号 / 43号) or from the north
      const entries: [number, number, string][] = [
        [135.41, 34.705, '兵庫県警'],
        [135.43, 34.685, '兵庫県警'],
        [135.5, 34.765, '吹田方面から'],
        [135.58, 34.66, '東大阪方面から'],
      ];
      const [lon, lat, from] = entries[Math.floor(sim.rnd() * entries.length)];
      const [x, y] = ll(lon, lat);
      return {
        ...base, name: '盗難車両 市内へ進入', desc: `${from}追跡中の盗難車両が大阪市内へ進入。緊急配備を検討せよ`, icon: '追',
        x, y, r: 800, t1: sim.t + 45 * 60, rateMul: 1, trafficMul: 1, boost: {}, pull: 0, nextAction: sim.t + 20,
      };
    },
    tick(sim, ev) {
      if (ev.count === 0) sim.spawnIncident('stolen_car', { x: ev.x!, y: ev.y! }, ev.name);
      ev.count++;
      ev.nextAction = ev.t1 + 1;
    },
  },
  {
    key: 'expressway',
    weight: 0.6,
    band: [1.2, 1, 0.6],
    create(sim, base) {
      const inc = sim.spawnIncident('acc_major');
      if (!inc) return null;
      return {
        ...base, name: '阪神高速 事故通行止め', desc: '阪神高速で多重事故、一部区間通行止め。一般道へ迂回車両が流入し渋滞', icon: '止',
        x: inc.x, y: inc.y, r: 2500, t1: sim.t + rand(sim, 50, 90) * 60, rateMul: 1, trafficMul: 0.7, boost: { acc_prop: 1.6, road_rage: 2 }, pull: 0.15, nextAction: Infinity,
      };
    },
  },
  {
    key: 'vip',
    weight: 0.5,
    band: [1.5, 0.6, 0],
    create(sim, base) {
      const [x, y] = ll(135.4959, 34.7025);
      return {
        ...base, name: '要人来阪（警衛警備）', desc: '海外要人の車列が大阪駅〜中之島を通過予定。沿道警戒と交通規制', icon: '警',
        x, y, r: 1200, t1: sim.t + 70 * 60, rateMul: 1, trafficMul: 0.85, boost: {}, pull: 0, nextAction: sim.t + 30,
      };
    },
    tick(sim, ev) {
      if (ev.count === 0) sim.spawnIncident('guard', inCircle(sim, { ...ev, r: 300 }), ev.name);
      ev.count++;
      ev.nextAction = ev.t1 + 1;
    },
  },
  {
    key: 'friday',
    weight: 0.9,
    band: [0, 0.8, 1.6],
    create(sim, base) {
      return {
        ...base, name: '週末の夜（繁華街多忙）', desc: 'キタ・ミナミの繁華街で人出が多い。酔客・喧嘩・客引きの通報が増加', icon: '夜',
        t1: sim.t + rand(sim, 120, 200) * 60, rateMul: 1.35, trafficMul: 0.95, boost: { drunk: 2, fight: 2, touting: 2.5, assault: 1.5, dine_dash: 1.5, chikan: 1.3 }, pull: 0,
      };
    },
  },
];

const DEF_BY_KEY = new Map(EVENT_DEFS.map((d) => [d.key, d]));

let seq = 0;
export function startEvent(sim: Sim, key?: string): ActiveEvent | null {
  const band = sim.band();
  const active = new Set(sim.events.map((e) => e.key));
  let def = key ? DEF_BY_KEY.get(key) : undefined;
  if (!def) {
    const cands = EVENT_DEFS.filter((d) => !active.has(d.key) && d.band[band] > 0);
    const tot = cands.reduce((a, d) => a + d.weight * d.band[band], 0);
    let r = sim.rnd() * tot;
    for (const d of cands) {
      r -= d.weight * d.band[band];
      if (r <= 0) {
        def = d;
        break;
      }
    }
  }
  if (!def) return null;
  const base: ActiveEvent = {
    id: ++seq, key: def.key, name: '', desc: '', icon: '', t0: sim.t, t1: sim.t + 3600, rateMul: 1, trafficMul: 1, boost: {}, pull: 0, nextAction: Infinity, count: 0,
  };
  const ev = def.create(sim, base);
  if (!ev) return null;
  sim.events.push(ev);
  return ev;
}

export function tickEvent(sim: Sim, ev: ActiveEvent) {
  const def = DEF_BY_KEY.get(ev.key);
  if (def?.tick && sim.t >= ev.nextAction && sim.t < ev.t1) def.tick(sim, ev);
}

export function endEvent(sim: Sim, ev: ActiveEvent) {
  if (ev.key === 'rain') sim.weather = 'clear';
}

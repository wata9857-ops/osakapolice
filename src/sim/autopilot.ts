// Automatic dispatcher (takes over when the player is idle) and self-initiated police activity
// that keeps the city alive: stop-and-question, traffic enforcement, crimes spotted on patrol,
// routine reports and HQ bulletins.
import type { Sim } from './engine';
import type { Incident, Unit } from './types';
import { TYPE_BY_KEY } from './incidentTypes';
import * as R from './radio';

const pick = <T,>(sim: Sim, a: T[]): T => a[Math.floor(sim.rnd() * a.length)];

/** is the automatic dispatcher currently in control? */
export function autoActive(sim: Sim) {
  const m = sim.settings.auto;
  return m === 'full' || (m === 'assist' && sim.idleReal >= sim.settings.autoDelay);
}

/** seconds (real time) until the assist dispatcher takes over, or 0 if active / -1 if off */
export function autoCountdown(sim: Sim) {
  if (sim.settings.auto === 'off') return -1;
  if (sim.settings.auto === 'full') return 0;
  return Math.max(0, sim.settings.autoDelay - sim.idleReal);
}

function chooseUnits(sim: Sim, inc: Incident, need: number) {
  const type = TYPE_BY_KEY.get(inc.type);
  const cands = sim.candidates(inc.id).filter((c) => c.available && !c.unit.manual && !c.unit.incidentId && c.eta < 1500);
  if (!cands.length) return [];
  const best = cands[0].eta;
  const out: Unit[] = [];
  // a specialist unit if it is not much further away
  const spec = cands.find((c) => type?.bonus?.includes(c.unit.kind) && c.eta < best + 240);
  if (spec) out.push(spec.unit);
  for (const c of cands) {
    if (out.length >= need) break;
    if (out.includes(c.unit)) continue;
    // kōban officers only for minor calls close by
    if (c.unit.kind === 'koban' && (inc.priority <= 2 || c.dist > 900)) continue;
    out.push(c.unit);
  }
  return out.slice(0, need);
}

/** called every few sim seconds */
export function autoTick(sim: Sim) {
  if (!autoActive(sim)) return;
  for (const inc of sim.activeIncidents()) {
    const age = sim.t - inc.t0;
    // initial dispatch
    if (inc.status === 'pending' && age > 15) {
      const need = inc.priority <= 1 ? inc.idealUnits : inc.minUnits;
      const units = chooseUnits(sim, inc, need);
      if (units.length) {
        inc.auto = true;
        sim.stats.auto++;
        sim.sys(`自動指令：${inc.id}【${inc.name}】→ ${units.map((u) => u.callsign).join('・')}`, inc.id);
        sim.dispatch(units.map((u) => u.id), inc.id, { emergency: inc.priority <= 2 });
      }
      continue;
    }
    // backup: fewer units than required on the way
    if ((inc.status === 'onscene' || inc.status === 'dispatched') && inc.assigned.length < inc.minUnits && age > 60) {
      const units = chooseUnits(sim, inc, inc.minUnits - inc.assigned.length);
      if (units.length) {
        inc.auto = true;
        sim.sys(`自動指令（応援）：${inc.id} → ${units.map((u) => u.callsign).join('・')}`, inc.id);
        sim.dispatch(units.map((u) => u.id), inc.id, { emergency: inc.priority <= 2 });
      }
    }
    // cordon for a fleeing suspect
    const s = inc.suspect;
    if (s && s.free && !s.caught && !inc.cordoned && age > 150 && inc.priority <= 2) {
      const units = sim
        .candidates(inc.id)
        .filter((c) => c.available && !c.unit.manual && c.unit.kind !== 'koban' && c.eta < 900)
        .slice(0, 3)
        .map((c) => c.unit.id);
      if (units.length >= 2) {
        inc.auto = true;
        sim.sys(`自動指令：${inc.id} 緊急配備（${units.length}隊）`, inc.id);
        sim.cordon(inc.id, units);
      }
    }
  }
  // keep the streets covered: idle cars at stations go out on patrol, held units resume
  for (const u of sim.units) {
    if (u.manual || u.kind === 'koban') continue;
    if (u.status === 'hold' && !u.incidentId && sim.rnd() < 0.02) sim.resume(u);
    if (u.status === 'standby' && u.patrol && sim.patrolActive(u.patrol) && sim.rnd() < 0.01) {
      const mates = sim.units.filter((o) => o.stationId === u.stationId && o.kind === u.kind && o.status === 'standby');
      if (mates.length >= 2 || u.kind !== 'pc') sim.startPatrol(u, true);
    }
  }
}

// ------------------------------------------------------------------ self-initiated activity

const SPOTTED: string[] = ['fight', 'drunk', 'suspicious', 'acc_prop', 'parking', 'vandal', 'touting', 'bike_theft', 'sick', 'wander'];

/** a patrolling unit does something on its own initiative */
export function selfInitiated(sim: Sim, u: Unit) {
  const r = sim.rnd();
  const place = sim.g.describe(u.x, u.y).replace(/付近$/, '') || sim.world.describe(u.x, u.y);
  if (r < 0.38) {
    // 職務質問
    u.wait = (3 + sim.rnd() * 4) * 60;
    u.v = 0;
    const who = pick(sim, ['自転車の男性', '挙動不審な男', '深夜徘徊の少年', '車内で寝ている男', '大きな荷物の男']);
    sim.say(u.callsign, R.HQ, `${u.callsign}から${R.HQ}。${place}で${who}に職務質問中、照会願う。`, { unitId: u.id, channel: '現場' });
    const hit = sim.rnd() < 0.18;
    if (hit) {
      sim.say(R.HQ, u.callsign, `${R.HQ}から${u.callsign}。照会の結果、該当あり。慎重に対応せよ。`, { unitId: u.id, level: 'urgent' }, 25);
      const inc = sim.spawnIncident('shokushitsu', { x: u.x, y: u.y }, undefined, true);
      if (inc) sim.attachOnScene(u, inc);
    } else {
      sim.say(R.HQ, u.callsign, `${R.HQ}から${u.callsign}。照会の結果、該当なし。`, { unitId: u.id }, 25);
      sim.stats.questioned++;
    }
  } else if (r < 0.6) {
    // 交通取締
    const viol = pick(sim, ['一時停止違反', '信号無視', '速度超過', '携帯電話使用', '通行禁止違反', 'シートベルト未着用']);
    u.wait = (4 + sim.rnd() * 6) * 60;
    sim.say(u.callsign, R.HQ, `${u.callsign}、${place}で${viol}の車両を停止させた、取締中。`, { unitId: u.id, channel: '現場' });
    sim.stats.tickets++;
    sim.addScore(20, `交通取締（${viol}）`);
  } else if (r < 0.82) {
    // 現認: an incident discovered by the patrol itself
    const type = pick(sim, SPOTTED);
    const inc = sim.spawnIncident(type, { x: u.x, y: u.y }, undefined, true);
    if (inc) {
      sim.say(u.callsign, R.HQ, `${u.callsign}から${R.HQ}。警ら中、${place}にて${inc.name.replace(/（.*?）/, '')}を現認、対応する。`, { unitId: u.id, incidentId: inc.id, channel: '現場' });
      sim.attachOnScene(u, inc);
    }
  } else {
    sim.say(u.callsign, R.HQ, pick(sim, [`${u.callsign}、${place}付近警ら中、異常なし。`, `${u.callsign}から${R.HQ}、${place}の立ち寄り警戒終了、異常なし。`, `${u.callsign}、管内巡回中、特異事案なし。`]), { unitId: u.id, channel: '署活' });
  }
}

/** occasional HQ bulletins so the radio is never silent */
export function bulletin(sim: Sim) {
  const ward = pick(sim, sim.world.wards).name;
  const h = Math.floor(sim.hour);
  const texts = [
    `${R.HQ}から各移動。${ward}管内で自転車盗が多発している。駐輪場の警戒を強化せよ。`,
    `${R.HQ}から各移動。手配車両、白色ワンボックス、ナンバー末尾「38」。発見時は速報せよ。`,
    `${R.HQ}から各移動。特殊詐欺の予兆電話が${ward}で相次いでいる。ATM周辺の警戒を実施せよ。`,
    `${R.HQ}から各移動。${h}時現在、受理中の事案${sim.activeIncidents().length}件。各移動は事故防止に留意せよ。`,
    `${R.HQ}から各移動。${ward}で不審者情報。下校時間帯の通学路の警戒を強化せよ。`,
    `${R.HQ}から各移動。交通事故多発につき、幹線道路での取締を強化せよ。`,
  ];
  if (sim.isNight) texts.push(`${R.HQ}から各移動。深夜帯、繁華街での酔客トラブルに留意せよ。`, `${R.HQ}から各移動。${ward}でオートバイの暴走行為の情報。発見時は無理な追跡を避け速報せよ。`);
  if (sim.weather === 'rain') texts.push(`${R.HQ}から各移動。降雨により路面が滑りやすい。緊急走行時は十分注意せよ。`);
  sim.say(R.HQ, '各移動', pick(sim, texts), { channel: '指令' });
}

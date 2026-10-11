// Headless simulation test: loads real data, runs the engine with an automatic dispatcher.
import fs from 'node:fs';
import { World } from '../src/sim/world';
import { Sim } from '../src/sim/engine';

const D = 'public/data/';
const j = (f: string) => JSON.parse(fs.readFileSync(D + f, 'utf8'));
let t0 = performance.now();
const world = new World(j('roads.json'), j('signals.json'), j('police.json'), j('landmarks.json'), j('areas.json'));
console.log(`world: ${world.graph.nv} vertices, ${world.graph.ne} edges, ${world.stations.length} stations, ${world.kobans.length} kobans (${(performance.now() - t0).toFixed(0)} ms)`);
t0 = performance.now();
const sim = new Sim(world, { startHour: 20, seed: 42 });
console.log(`sim: ${sim.units.length} units (${(performance.now() - t0).toFixed(0)} ms)`);
sim.settings.rate = 1.5;
let errors = 0;
const HOURS = Number(process.argv[2] ?? 3);
t0 = performance.now();
let routeMs = 0;
for (let step = 0; step < HOURS * 3600; step += 1) {
  try {
    sim.advance(1);
  } catch (e) {
    errors++;
    console.error('advance error', e);
    if (errors > 5) process.exit(1);
  }
  // auto dispatcher every 20 s
  if (step % 20 === 0) {
    for (const inc of sim.incidents.filter((i) => i.status === 'pending')) {
      const r0 = performance.now();
      const c = sim.candidates(inc.id).filter((c) => c.available && c.unit.kind !== 'koban').slice(0, inc.minUnits);
      routeMs += performance.now() - r0;
      if (c.length) sim.dispatch(c.map((x) => x.unit.id), inc.id, { emergency: inc.priority <= 2 });
      const sus = inc.suspect;
      if (sus && sus.free && Math.random() < 0.5) {
        const k = sim.candidates(inc.id).filter((c) => c.available && c.unit.kind !== 'koban').slice(0, 3);
        sim.cordon(inc.id, k.map((x) => x.unit.id));
      }
    }
  }
}
const el = performance.now() - t0;
const st = sim.stats;
const avg = st.respTimes.reduce((a, b) => a + b, 0) / Math.max(1, st.respTimes.length);
const byStatus: Record<string, number> = {};
for (const u of sim.units) byStatus[u.status] = (byStatus[u.status] ?? 0) + 1;
console.log(`ran ${HOURS}h sim in ${(el / 1000).toFixed(1)} s (candidates ${routeMs.toFixed(0)} ms)`);
console.log(`received ${st.received}, resolved ${st.resolved}, failed ${st.failed}, arrests ${st.arrests}, avg response ${(avg / 60).toFixed(1)} min`);
console.log('unit status:', byStatus);
console.log('open incidents:', sim.activeIncidents().map((i) => `${i.code}/${i.status}/${Math.round((sim.t - i.t0) / 60)}m`).join(' '));
console.log('--- radio sample ---');
for (const m of sim.radio.slice(-25)) console.log(sim.clockStr(m.t), m.from, '→', m.to, ':', m.text);
const stuck = sim.units.filter((u) => (u.status === 'enroute' || u.status === 'returning' || u.status === 'moving') && !u.route && !u.manual && u.wait <= 0);
console.log('stuck units (moving status without route):', stuck.map((u) => `${u.callsign}:${u.status}`).join(' ') || 'none');
console.log('errors', errors);

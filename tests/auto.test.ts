// Headless test of the living city: no player input, assist dispatcher takes over.
import fs from 'node:fs';
import { World } from '../src/sim/world';
import { Sim, rankOf } from '../src/sim/engine';

const D = 'public/data/';
const j = (f: string) => JSON.parse(fs.readFileSync(D + f, 'utf8'));
const world = new World(j('roads.json'), j('signals.json'), j('police.json'), j('landmarks.json'), j('areas.json'));
world.places = j('places.json');
const sim = new Sim(world, { startHour: 18, seed: 7 });
sim.settings.autoDelay = 30;
const HOURS = Number(process.argv[2] ?? 4);
const evNames: string[] = [];
const types = new Map<string, number>();
sim.on((t, p) => {
  if (t === 'event' && !(p as { end: boolean }).end) evNames.push((p as { ev: { name: string } }).ev.name);
});
let errors = 0;
const t0 = performance.now();
for (let s = 0; s < HOURS * 3600; s++) {
  try {
    sim.advance(1); // 1 real second per sim second, player idle the whole time
  } catch (e) {
    errors++;
    console.error(e);
    if (errors > 3) process.exit(1);
  }
}
for (const i of sim.incidents) types.set(i.name, (types.get(i.name) ?? 0) + 1);
const st = sim.stats;
const avg = st.respTimes.reduce((a, b) => a + b, 0) / Math.max(1, st.respTimes.length);
console.log(`${HOURS}h in ${((performance.now() - t0) / 1000).toFixed(1)}s, errors ${errors}`);
console.log(`received ${st.received} resolved ${st.resolved} failed ${st.failed} arrests ${st.arrests} auto ${st.auto} tickets ${st.tickets} questioned ${st.questioned}`);
console.log(`score ${st.score} (${rankOf(st.score)}), best streak ${st.bestStreak}, avg response ${(avg / 60).toFixed(1)} min`);
console.log('events:', evNames.join(' / '));
console.log('incident types:', [...types].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' '));
console.log('pending now:', sim.incidents.filter((i) => i.status === 'pending').length, 'open:', sim.activeIncidents().length);
const self = sim.incidents.filter((i) => i.selfInit).length;
console.log('self-initiated incidents:', self);
console.log('--- radio sample ---');
for (const m of sim.radio.slice(-20)) console.log(sim.clockStr(m.t), m.from, '→', m.to, ':', m.text.slice(0, 110));

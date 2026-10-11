import type { Sim } from '../sim/engine';
import type { Waypoint } from '../sim/types';

/** snap tapped map points to the (non-motorway) road network as patrol waypoints */
export function snapWaypoints(sim: Sim, pts: { x: number; y: number }[]): Waypoint[] {
  const out: Waypoint[] = [];
  for (const p of pts) {
    const s = sim.snap(p.x, p.y, true);
    if (!s) continue;
    out.push({ x: s.x, y: s.y, edge: s.edge, s: s.s, dwell: 180, label: sim.world.describe(s.x, s.y) });
  }
  return out;
}

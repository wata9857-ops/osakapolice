import { createContext, useContext, useEffect, useReducer } from 'react';
import type { Sim } from '../sim/engine';

export const SimContext = createContext<Sim | null>(null);
export function useSim(): Sim {
  return useContext(SimContext)!;
}

/** re-render the component at most `hz` times per second while the simulation changes */
export function useSimTick(hz = 4) {
  const sim = useSim();
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let last = 0;
    let pending = 0;
    const iv = 1000 / hz;
    const off = sim.on((type) => {
      const now = performance.now();
      if (type === 'change' || type === 'radio' || type === 'incident') {
        if (!pending)
          pending = window.setTimeout(() => {
            pending = 0;
            last = performance.now();
            force();
          }, 30);
        return;
      }
      if (now - last >= iv) {
        last = now;
        force();
      }
    });
    return () => {
      off();
      if (pending) clearTimeout(pending);
    };
  }, [sim, hz]);
}

export function fmtDur(sec: number) {
  if (!isFinite(sec)) return '—';
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtMinShort(sec: number) {
  if (!isFinite(sec)) return '—';
  return `${Math.max(1, Math.round(sec / 60))}分`;
}
export function fmtKm(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

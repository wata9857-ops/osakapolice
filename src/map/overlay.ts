// Transient map overlays set by UI panels (dispatch route previews etc.)
type Line = { coords: [number, number][]; kind: 'preview' | 'via' };

let lines: Line[] = [];
let points: { x: number; y: number; label?: string }[] = [];
const subs = new Set<() => void>();

export const overlay = {
  get lines() {
    return lines;
  },
  get points() {
    return points;
  },
  setLines(l: Line[]) {
    lines = l;
    subs.forEach((s) => s());
  },
  setPoints(p: { x: number; y: number; label?: string }[]) {
    points = p;
    subs.forEach((s) => s());
  },
  clear() {
    lines = [];
    points = [];
    subs.forEach((s) => s());
  },
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

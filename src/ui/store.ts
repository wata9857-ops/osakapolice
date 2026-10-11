// Minimal UI state store (useSyncExternalStore based).
import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
export type ToastLevel = 'info' | 'warn' | 'urgent' | 'score' | 'score minus' | 'rank';
export type Selection = { kind: 'unit' | 'incident' | 'facility'; id: string } | null;

export type MapMode =
  | null
  | { kind: 'via'; unitId: string; incidentId?: string; points: { x: number; y: number }[] }
  | { kind: 'move'; unitId: string; hold: boolean }
  | { kind: 'patrolArea'; unitId: string; center?: { x: number; y: number }; r: number }
  | { kind: 'patrolRoute'; unitId: string; points: { x: number; y: number }[] }
  | { kind: 'spawn'; type: string };

export interface Layers {
  koban: boolean;
  traffic: boolean;
  wards: boolean;
  routes: boolean;
  patrol: boolean;
  landmarks: boolean;
}

export interface UIState {
  theme: Theme;
  selected: Selection;
  leftOpen: boolean;
  leftTab: 'incidents' | 'units' | 'history';
  rightOpen: boolean;
  radio: 'min' | 'mid' | 'max';
  sheet: 'peek' | 'half' | 'full';
  sheetTab: 'incidents' | 'units' | 'radio' | 'detail';
  mapMode: MapMode;
  dispatchPick: string[];
  dispatchFor: string | null; // incident id whose dispatch panel is open
  emergency: boolean;
  follow: string | null;
  driving: string | null;
  layers: Layers;
  menu: null | 'layers' | 'main' | 'stats';
  toasts: { id: number; text: string; level: ToastLevel; incidentId?: string; unitId?: string }[];
  flyTo: { x: number; y: number; zoom?: number; seq: number } | null;
  speech: boolean;
  sfx: boolean;
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('opd-ui') || '{}');
  } catch {
    return {};
  }
})();

let state: UIState = {
  theme: saved.theme ?? (matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  selected: null,
  leftOpen: saved.leftOpen ?? true,
  leftTab: 'incidents',
  rightOpen: true,
  radio: saved.radio ?? 'mid',
  sheet: 'peek',
  sheetTab: 'incidents',
  mapMode: null,
  dispatchPick: [],
  dispatchFor: null,
  emergency: true,
  follow: null,
  driving: null,
  layers: { koban: true, traffic: false, wards: true, routes: true, patrol: true, landmarks: true, ...(saved.layers ?? {}) },
  menu: null,
  toasts: [],
  flyTo: null,
  speech: saved.speech ?? false,
  sfx: saved.sfx ?? true,
};

const subs = new Set<() => void>();
export function getUI() {
  return state;
}
export function setUI(patch: Partial<UIState> | ((s: UIState) => Partial<UIState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  if ('theme' in p || 'leftOpen' in p || 'radio' in p || 'layers' in p || 'speech' in p || 'sfx' in p)
    localStorage.setItem('opd-ui', JSON.stringify({ theme: state.theme, leftOpen: state.leftOpen, radio: state.radio, layers: state.layers, speech: state.speech, sfx: state.sfx }));
  for (const s of subs) s();
}
export function useUI<T>(sel: (s: UIState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => sel(state),
  );
}

let toastSeq = 0;
export function toast(text: string, level: ToastLevel = 'info', extra: { incidentId?: string; unitId?: string } = {}) {
  const id = ++toastSeq;
  setUI((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, level, ...extra }] }));
  setTimeout(() => setUI((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), level === 'urgent' || level === 'rank' ? 9000 : level.startsWith('score') ? 3500 : 5000);
}

let flySeq = 0;
export function flyTo(x: number, y: number, zoom?: number) {
  setUI({ flyTo: { x, y, zoom, seq: ++flySeq } });
}

export function select(sel: Selection, fly = false) {
  const narrow = window.innerWidth < 700;
  setUI((s) => ({
    selected: sel,
    rightOpen: sel ? true : s.rightOpen,
    dispatchFor: sel?.kind === 'incident' && s.dispatchFor === sel.id ? s.dispatchFor : null,
    dispatchPick: sel?.kind === 'incident' && s.dispatchFor === sel.id ? s.dispatchPick : [],
    ...(narrow && sel ? { sheetTab: 'detail' as const, sheet: s.sheet === 'peek' ? ('half' as const) : s.sheet } : {}),
  }));
  void fly;
}

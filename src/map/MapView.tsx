// The dispatch map: MapLibre GL rendering of OSM-derived Osaka data plus live simulation layers.
import { useEffect, useRef, useState } from 'react';
import { Map as MLMap, AttributionControl, setWorkerUrl, type GeoJSONSource, type LayerSpecification, type StyleSpecification, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(workerUrl);
import type { Sim } from '../sim/engine';
import { unproj, proj } from '../shared/proj.js';
import { PALETTES, type MapPalette } from './palette';
import { registerIcons } from './icons';
import { getUI, setUI, useUI, select, type UIState } from '../ui/store';
import { overlay } from './overlay';

type FC = GeoJSON.FeatureCollection;
const FONT = ['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic UI', 'Meiryo'];
const FONT_B = ['Hiragino Sans Bold', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic UI', 'Meiryo'];
const ll = (x: number, y: number) => unproj(x, y) as [number, number];
/** extent of the pre-rendered road tiles (tools/build-tiles.mjs) */
const TILE_BOUNDS: [number, number, number, number] = [135.3832, 34.5697, 135.6201, 34.789];
const empty = (): FC => ({ type: 'FeatureCollection', features: [] });

function circlePoly(x: number, y: number, r: number, n = 64): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(ll(x + Math.cos(a) * r, y + Math.sin(a) * r));
  }
  return out;
}

/** major roads as GeoJSON for the (optional) live traffic overlay */
function trafficGeoJSON(sim: Sim): FC {
  const g = sim.g;
  const major: GeoJSON.Feature[] = [];
  for (let e = 0; e < g.ne; e++) {
    if (g.ecls[e] > 3) continue;
    const coords: [number, number][] = [];
    for (let k = g.gs[e]; k < g.gs[e + 1]; k++) coords.push(ll(g.gx[k], g.gy[k]));
    major.push({ type: 'Feature', properties: { e, f: 1 }, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features: major };
}

const W = (stops: [number, number][]) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.flat()] as unknown as number;

function layers(p: MapPalette, dark: boolean): LayerSpecification[] {
  const road = (id: string, filter: unknown[], color: string, width: [number, number][], minzoom = 0, extra: Record<string, unknown> = {}): LayerSpecification =>
    ({
      id, type: 'line', source: 'roads', 'source-layer': id.startsWith('road-minor') ? 'minor' : 'roads', minzoom, filter,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': color, 'line-width': W(width), ...extra },
    }) as LayerSpecification;
  const notTunnel = ['==', ['get', 't'], 0];
  const casing = !dark;
  const L: LayerSpecification[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': p.bg } },
    { id: 'city-fill', type: 'fill', source: 'areas', filter: ['==', ['get', 'kind'], 'city'], paint: { 'fill-color': p.cityFill } },
    { id: 'city-line', type: 'line', source: 'areas', filter: ['==', ['get', 'kind'], 'city'], paint: { 'line-color': p.cityLine, 'line-width': W([[10, 1.4], [15, 3]]) } },
    { id: 'sea', type: 'fill', source: 'base', filter: ['==', ['get', 'k'], 'sea'], paint: { 'fill-color': p.sea } },
    { id: 'island', type: 'fill', source: 'base', filter: ['==', ['get', 'k'], 'island'], paint: { 'fill-color': p.cityFill } },
    { id: 'green', type: 'fill', source: 'base', filter: ['==', ['get', 'k'], 'green'], paint: { 'fill-color': p.green } },
    { id: 'water', type: 'fill', source: 'base', filter: ['==', ['get', 'k'], 'water'], paint: { 'fill-color': p.water, 'fill-outline-color': p.waterLine } },
    { id: 'waterway', type: 'line', source: 'base', filter: ['==', ['get', 'k'], 'waterway'], paint: { 'line-color': p.water, 'line-width': W([[11, 1], [16, 5]]) } },
    { id: 'rail', type: 'line', source: 'base', minzoom: 11, filter: ['==', ['get', 'k'], 'rail'], paint: { 'line-color': p.rail, 'line-width': W([[11, 0.8], [16, 2]]), 'line-dasharray': [3, 2] } },
  ];
  if (casing) {
    L.push(road('road-minor-case', ['all', ['>=', ['get', 'c'], 5], notTunnel], p.casing, [[13, 1.6], [17, 10]], 13));
    L.push(road('road-major-case', ['all', ['>=', ['get', 'c'], 1], ['<=', ['get', 'c'], 4], notTunnel], p.casing, [[10, 1.2], [13, 3.4], [17, 18]], 0));
  }
  L.push(
    road('road-minor', ['all', ['>=', ['get', 'c'], 5], notTunnel], p.roads.minor, [[13, 0.6], [17, 8]], 12.5),
    road('road-tertiary', ['all', ['==', ['get', 'c'], 4], notTunnel], p.roads.tertiary, [[11, 0.5], [13, 1.6], [17, 12]], 10.5),
    road('road-secondary', ['all', ['==', ['get', 'c'], 3], notTunnel], p.roads.secondary, [[10, 0.6], [13, 2], [17, 14]]),
    road('road-primary', ['all', ['<=', ['get', 'c'], 2], ['>=', ['get', 'c'], 1], notTunnel], p.roads.primary, [[10, 0.9], [13, 2.6], [17, 16]]),
    road('road-tunnel', ['==', ['get', 't'], 1], p.roads.secondary, [[10, 0.6], [13, 1.6], [17, 9]], 0, { 'line-opacity': 0.5, 'line-dasharray': [2, 1.5] }),
  );
  if (casing) L.push(road('road-motorway-case', ['all', ['==', ['get', 'c'], 0], notTunnel], p.motorwayCasing, [[10, 1.8], [13, 4], [17, 16]]));
  L.push(road('road-motorway', ['all', ['==', ['get', 'c'], 0], notTunnel], p.roads.motorway, [[10, 1], [13, 2.4], [17, 12]]));
  L.push(
    { id: 'ward-fill', type: 'fill', source: 'areas', filter: ['==', ['get', 'kind'], 'ward'], paint: { 'fill-color': p.wardLine, 'fill-opacity': 0 } },
    { id: 'ward-line', type: 'line', source: 'areas', filter: ['==', ['get', 'kind'], 'ward'], paint: { 'line-color': p.wardLine, 'line-width': W([[10, 0.8], [15, 1.6]]), 'line-dasharray': [4, 2] } },
    {
      id: 'traffic', type: 'line', source: 'traffic', layout: { 'line-cap': 'round', visibility: 'none' },
      filter: ['<', ['get', 'f'], 0.78],
      paint: {
        'line-color': ['interpolate', ['linear'], ['get', 'f'], 0.3, p.traffic[2], 0.55, p.traffic[1], 0.77, p.traffic[0]],
        'line-width': W([[10, 1.4], [13, 3], [17, 9]]),
        'line-opacity': 0.85,
      },
    },
    { id: 'patrol-fill', type: 'fill', source: 'patrol', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': p.patrol, 'fill-opacity': 0.07 } },
    { id: 'patrol-line', type: 'line', source: 'patrol', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': p.patrol, 'line-width': 2, 'line-dasharray': [3, 2] } },
    { id: 'patrol-wp', type: 'symbol', source: 'patrol', filter: ['==', ['geometry-type'], 'Point'], layout: { 'icon-image': 'wp', 'icon-allow-overlap': true, 'text-field': ['get', 'n'], 'text-font': FONT_B, 'text-size': 11, 'text-offset': [0, 1.2], 'text-allow-overlap': true }, paint: { 'text-color': p.patrol, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.5 } },
    { id: 'suspect-fill', type: 'fill', source: 'suspect', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': p.suspect, 'fill-opacity': 0.06 } },
    { id: 'suspect-line', type: 'line', source: 'suspect', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': p.suspect, 'line-width': 1.5, 'line-dasharray': [1, 2] } },
    {
      id: 'route-all', type: 'line', source: 'routes', filter: ['==', ['get', 'k'], 'a'], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'col'], 'line-width': W([[10, 1.2], [14, 2.5], [17, 4]]), 'line-opacity': 0.55 },
    },
    {
      id: 'route-preview', type: 'line', source: 'routes', filter: ['==', ['get', 'k'], 'p'], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.routeAlt, 'line-width': W([[10, 2], [14, 4], [17, 6]]), 'line-dasharray': [1.2, 1] },
    },
    { id: 'route-sel-case', type: 'line', source: 'routes', filter: ['==', ['get', 'k'], 's'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': p.labelHalo, 'line-width': W([[10, 4.5], [14, 7], [17, 10]]) } },
    { id: 'route-sel', type: 'line', source: 'routes', filter: ['==', ['get', 'k'], 's'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'col'], 'line-width': W([[10, 2.5], [14, 4], [17, 6]]) } },
    {
      id: 'road-minor-label', type: 'symbol', source: 'roads', 'source-layer': 'minor', minzoom: 15.5,
      filter: ['!=', ['get', 'n'], ''],
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'n'], 'text-font': FONT, 'text-size': 11, 'symbol-spacing': 300, 'text-max-angle': 30, 'text-padding': 8 },
      paint: { 'text-color': p.roadLabel, 'text-halo-color': p.roadHalo, 'text-halo-width': 1.6 },
    },
    {
      id: 'road-label', type: 'symbol', source: 'roads', 'source-layer': 'roads', minzoom: 12.5,
      filter: ['all', ['!=', ['get', 'n'], ''], ['any', ['<=', ['get', 'c'], 3], ['>=', ['zoom'], 14.5]]],
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'n'], 'text-font': FONT, 'text-size': W([[12.5, 10], [17, 13]]), 'symbol-spacing': 320, 'text-max-angle': 30, 'text-padding': 8 },
      paint: { 'text-color': p.roadLabel, 'text-halo-color': p.roadHalo, 'text-halo-width': 1.6 },
    },
    {
      id: 'ward-label', type: 'symbol', source: 'wardpts', maxzoom: 14.5,
      layout: { 'text-field': ['get', 'n'], 'text-font': FONT_B, 'text-size': W([[10, 12], [14, 17]]), 'text-letter-spacing': 0.3, 'text-allow-overlap': false },
      paint: { 'text-color': p.wardLabel, 'text-halo-color': p.bg, 'text-halo-width': 1.5 },
    },
    {
      id: 'landmark', type: 'symbol', source: 'landmarks', minzoom: 13.5,
      layout: { 'icon-image': 'lm-dot', 'text-field': ['get', 'n'], 'text-font': FONT, 'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true, 'symbol-sort-key': ['get', 'r'] },
      paint: { 'text-color': p.roadLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 },
    },
    {
      id: 'fac-koban', type: 'symbol', source: 'facilities', minzoom: 13, filter: ['in', ['get', 'k'], ['literal', ['koban', 'chuzaisho']]],
      layout: { 'icon-image': ['concat', 'f-', ['get', 'k']], 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 14.5, ['get', 'n']], 'text-font': FONT, 'text-size': 10.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': p.koban, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 },
    },
    {
      id: 'fac-station', type: 'symbol', source: 'facilities', filter: ['in', ['get', 'k'], ['literal', ['station', 'hq', 'unitbase']]],
      layout: { 'icon-image': ['concat', 'f-', ['get', 'k']], 'icon-allow-overlap': true, 'icon-size': W([[10, 0.75], [13, 1]]), 'text-field': ['step', ['zoom'], '', 11.5, ['get', 'n']], 'text-font': FONT_B, 'text-size': 11.5, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': p.facility, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.6 },
    },
    { id: 'inc-closed', type: 'symbol', source: 'incidents', minzoom: 12, filter: ['==', ['get', 'open'], 0], layout: { 'icon-image': 'i-closed', 'icon-allow-overlap': true } },
    { id: 'inc-pulse', type: 'circle', source: 'incidents', filter: ['==', ['get', 'st'], 'pending'], paint: { 'circle-radius': 14, 'circle-color': ['get', 'col'], 'circle-opacity': 0.4, 'circle-pitch-alignment': 'map' } },
    { id: 'sel-ring', type: 'circle', source: 'sel', paint: { 'circle-radius': 19, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': dark ? '#ffffff' : '#0f151a', 'circle-stroke-width': 2.5 } },
    {
      id: 'inc', type: 'symbol', source: 'incidents', filter: ['==', ['get', 'open'], 1],
      layout: {
        'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'pr'],
        'text-field': ['get', 'lbl'], 'text-font': FONT_B, 'text-size': 12, 'text-offset': [1.4, 0], 'text-anchor': 'left', 'text-optional': true,
      },
      paint: { 'text-color': ['get', 'col'], 'text-halo-color': p.labelHalo, 'text-halo-width': 1.8 },
    },
    { id: 'unit-emerg', type: 'circle', source: 'units', filter: ['==', ['get', 'em'], 1], paint: { 'circle-radius': 13, 'circle-color': '#ff2020', 'circle-opacity': 0.35, 'circle-blur': 0.4 } },
    {
      id: 'unit-koban', type: 'symbol', source: 'units', minzoom: 11, filter: ['==', ['get', 'kind'], 'koban'],
      layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 14, ['get', 'lbl']], 'text-font': FONT_B, 'text-size': 10.5, 'text-offset': [0.9, 0], 'text-anchor': 'left', 'text-optional': true },
      paint: { 'text-color': ['get', 'col'], 'text-halo-color': p.labelHalo, 'text-halo-width': 1.6 },
    },
    {
      id: 'unit', type: 'symbol', source: 'units', filter: ['all', ['!=', ['get', 'kind'], 'koban'], ['any', ['==', ['get', 'idle'], 0], ['>=', ['zoom'], 14]]],
      layout: {
        'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'hdg'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': W([[10, 0.7], [13, 0.9], [16, 1.1]]),
        'text-field': ['step', ['zoom'], ['case', ['==', ['get', 'act'], 1], ['get', 'lbl'], ''], 12.5, ['get', 'lbl']],
        'text-font': FONT_B, 'text-size': 11.5, 'text-offset': [1.1, 0], 'text-anchor': 'left', 'text-optional': true, 'symbol-sort-key': ['get', 'sk'],
      },
      paint: { 'text-color': ['get', 'col'], 'text-halo-color': p.labelHalo, 'text-halo-width': 1.8 },
    },
    { id: 'pick-line', type: 'line', source: 'pick', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': p.route, 'line-width': 2, 'line-dasharray': [2, 1.5] } },
    { id: 'pick-fill', type: 'fill', source: 'pick', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': p.patrol, 'fill-opacity': 0.12 } },
    { id: 'pick-pt', type: 'symbol', source: 'pick', filter: ['==', ['geometry-type'], 'Point'], layout: { 'icon-image': 'pick', 'icon-allow-overlap': true, 'text-field': ['get', 'n'], 'text-font': FONT_B, 'text-size': 11, 'text-offset': [0, 1.3], 'text-allow-overlap': true }, paint: { 'text-color': p.route, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.6 } },
  );
  return L;
}

export function MapView({ sim }: { sim: Sim }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const readyRef = useRef(false);
  const [tilesReady, setTilesReady] = useState(false);
  const theme = useUI((s) => s.theme);
  const layersUI = useUI((s) => s.layers);
  const fly = useUI((s) => s.flyTo);
  const padKey = useUI((s) => `${s.leftOpen}|${s.rightOpen && !!s.selected}|${s.radio}|${s.sheet}`);

  // create map once
  useEffect(() => {
    const p = PALETTES[getUI().theme];
    const dark = getUI().theme === 'dark';
    let traffic: FC | null = null;
    const w = sim.world;
    const facilities: FC = {
      type: 'FeatureCollection',
      features: w.facilities.map((f) => ({ type: 'Feature', properties: { id: String(f.id), k: f.kind, n: f.kind === 'station' ? f.short + '署' : f.kind === 'hq' ? '府警本部' : f.kind === 'unitbase' ? f.name.replace(/^大阪府警察/, '') : f.short }, geometry: { type: 'Point', coordinates: ll(f.x, f.y) } })),
    };
    const lmRank: Record<string, number> = { sight: 1, station: 2, shop: 3, stadium: 3, townhall: 3, hospital: 4, university: 4, subway: 5, poi: 6 };
    const landmarks: FC = {
      type: 'FeatureCollection',
      features: w.landmarks.filter((l) => l.kind !== 'subway').map((l) => ({ type: 'Feature', properties: { n: l.name, r: lmRank[l.kind] ?? 6 }, geometry: { type: 'Point', coordinates: ll(l.x, l.y) } })),
    };
    const wardpts: FC = { type: 'FeatureCollection', features: w.wards.map((wd) => ({ type: 'Feature', properties: { n: wd.name }, geometry: { type: 'Point', coordinates: ll(wd.cx, wd.cy) } })) };
    const base = new URL(import.meta.env.BASE_URL + 'data/', window.location.href).href;
    const style: StyleSpecification = {
      version: 8,
      sources: {
        base: { type: 'geojson', data: base + 'base.json' },
        areas: { type: 'geojson', data: base + 'areas.json' },
        roads: { type: 'vector', tiles: [base + 'tiles/{z}/{x}/{y}.pbf'], minzoom: 9, maxzoom: 15, bounds: TILE_BOUNDS },
        traffic: { type: 'geojson', data: empty(), maxzoom: 14 },
        facilities: { type: 'geojson', data: facilities },
        landmarks: { type: 'geojson', data: landmarks },
        wardpts: { type: 'geojson', data: wardpts },
        patrol: { type: 'geojson', data: empty() },
        suspect: { type: 'geojson', data: empty() },
        routes: { type: 'geojson', data: empty() },
        incidents: { type: 'geojson', data: empty() },
        units: { type: 'geojson', data: empty() },
        sel: { type: 'geojson', data: empty() },
        pick: { type: 'geojson', data: empty() },
      },
      layers: layers(p, dark),
    };
    const b = w.cityBounds;
    const map = new MLMap({
      container: el.current!,
      style,
      bounds: [ll(b.minX, b.minY), ll(b.maxX, b.maxY)],
      fitBoundsOptions: { padding: 20 },
      maxBounds: [[135.36, 34.55], [135.63, 34.8]],
      minZoom: 9.5,
      maxZoom: 18.5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      localIdeographFontFamily: "'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic UI', 'Meiryo', sans-serif",
      fadeDuration: 0,
    });
    map.on('error', (e) => console.error('map error', e.error?.message ?? e));
    map.touchZoomRotate.disableRotation();
    map.keyboard.disable();
    map.addControl(new AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors' }), 'bottom-right');
    mapRef.current = map;
    (window as unknown as { __map: MLMap }).__map = map;
    let trafficCache = { v: -1, at: 0 };
    let blink = false;
    const timers: number[] = [];

    let iconsReady = false;
    const ensureIcons = () => {
      if (iconsReady) return;
      iconsReady = true;
      const th = getUI().theme;
      registerIcons(map, PALETTES[th], th === 'dark');
    };
    map.on('styleimagemissing', ensureIcons);
    try {
      ensureIcons();
    } catch {
      iconsReady = false;
    }
    const onStyle = () => {
      if (readyRef.current) return;
      ensureIcons();
      readyRef.current = true;
      applyVisibility(map, getUI().layers);
      updateUnits();
      updateSlow();
    };
    map.once('style.load', onStyle);
    map.once('load', onStyle);
    const onData = () => {
      if (map.getSource('roads') && map.isSourceLoaded('roads')) {
        setTilesReady(true);
        map.off('sourcedata', onData);
      }
    };
    map.on('sourcedata', onData);

    const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;

    // ---------- live data
    function updateUnits() {
      if (!readyRef.current) return;
      const pal = PALETTES[getUI().theme];
      const sel = getUI().selected;
      const feats: GeoJSON.Feature[] = [];
      const atBase = new Map<number, number>();
      for (const u of sim.units) {
        if (u.kind === 'koban' && u.status === 'standby' && !(sel?.kind === 'unit' && sel.id === u.id)) continue;
        const idle = u.status === 'standby' && Math.hypot(u.x - u.baseX, u.y - u.baseY) < 30 ? 1 : 0;
        let ux = u.x, uy = u.y;
        if (idle) {
          // park side by side in front of the station
          const k = atBase.get(u.baseId) ?? 0;
          atBase.set(u.baseId, k + 1);
          ux += (k - 1) * 9;
          uy -= 14;
        }
        const act = u.status !== 'patrol' && u.status !== 'standby' && u.status !== 'office' ? 1 : 0;
        let lbl = u.callsign;
        if ((u.status === 'enroute' || u.status === 'moving' || u.status === 'transport') && u.route) {
          const eta = sim.routeEta(u);
          if (eta !== null) lbl += ` ${Math.max(1, Math.round(eta / 60))}′`;
        }
        if (u.manual) lbl += ' ◉';
        feats.push({
          type: 'Feature',
          properties: {
            id: u.id, kind: u.kind, icon: `u-${u.kind}-${u.status}`, hdg: (u.heading * 180) / Math.PI, lbl, col: pal.status[u.status],
            act, em: u.emergency && (u.status === 'enroute' || u.status === 'pursuit' || u.status === 'moving') && u.kind !== 'kisou' ? 1 : 0,
            sk: act ? 0 : 1,
            idle,
          },
          geometry: { type: 'Point', coordinates: ll(ux, uy) },
        });
      }
      src('units')?.setData({ type: 'FeatureCollection', features: feats });
      // selection ring + follow
      let sx: number | null = null, sy = 0;
      if (sel?.kind === 'unit') {
        const u = sim.unitById.get(sel.id);
        if (u) (sx = u.x), (sy = u.y);
      } else if (sel?.kind === 'incident') {
        const i = sim.incById.get(sel.id);
        if (i) (sx = i.x), (sy = i.y);
      } else if (sel?.kind === 'facility') {
        const f = sim.world.facilities.find((f) => String(f.id) === sel.id);
        if (f) (sx = f.x), (sy = f.y);
      }
      src('sel')?.setData(sx === null ? empty() : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ll(sx, sy) } }] });
      const fol = getUI().follow;
      if (fol) {
        const u = sim.unitById.get(fol);
        if (u && !map.isMoving()) map.easeTo({ center: ll(u.x, u.y), duration: 300 });
      }
    }

    function updateSlow() {
      if (!readyRef.current) return;
      const ui = getUI();
      const pal = PALETTES[ui.theme];
      const sel = ui.selected;
      // incidents
      const inc: GeoJSON.Feature[] = [];
      for (const i of sim.incidents) {
        const open = i.status !== 'resolved' && i.status !== 'failed';
        if (!open && sim.t - (i.tEnd ?? 0) > 1800) continue;
        const age = Math.floor((sim.t - i.t0) / 60);
        inc.push({
          type: 'Feature',
          properties: {
            id: i.id, open: open ? 1 : 0, st: i.status, pr: i.priority, col: pal.pri[i.priority],
            icon: `i-${i.priority}${i.status === 'pending' ? '' : i.status === 'onscene' ? '' : 'h'}`,
            lbl: `${i.code} ${age}分${i.status === 'pending' ? ' 未指令' : ''}`,
          },
          geometry: { type: 'Point', coordinates: ll(i.x, i.y) },
        });
      }
      src('incidents')?.setData({ type: 'FeatureCollection', features: inc });
      // routes
      const routes: GeoJSON.Feature[] = [];
      if (ui.layers.routes) {
        for (const u of sim.units) {
          if (!u.route || u.manual) continue;
          if (!['enroute', 'pursuit', 'transport', 'moving', 'returning'].includes(u.status)) continue;
          if (sel?.kind === 'unit' && sel.id === u.id) continue;
          routes.push({ type: 'Feature', properties: { k: 'a', col: pal.status[u.status] }, geometry: { type: 'LineString', coordinates: sim.routeLine(u).map(([x, y]) => ll(x, y)) } });
        }
      }
      if (sel?.kind === 'unit') {
        const u = sim.unitById.get(sel.id);
        if (u && u.route) routes.push({ type: 'Feature', properties: { k: 's', col: pal.status[u.status] }, geometry: { type: 'LineString', coordinates: sim.routeLine(u).map(([x, y]) => ll(x, y)) } });
      }
      if (sel?.kind === 'incident') {
        const i = sim.incById.get(sel.id);
        for (const id of i?.assigned ?? []) {
          const u = sim.unitById.get(id);
          if (u && u.route) routes.push({ type: 'Feature', properties: { k: 's', col: pal.status[u.status] }, geometry: { type: 'LineString', coordinates: sim.routeLine(u).map(([x, y]) => ll(x, y)) } });
        }
      }
      for (const l of overlay.lines) routes.push({ type: 'Feature', properties: { k: 'p' }, geometry: { type: 'LineString', coordinates: l.coords.map(([x, y]) => ll(x, y)) } });
      src('routes')?.setData({ type: 'FeatureCollection', features: routes });
      // patrol plan of selected unit
      const pf: GeoJSON.Feature[] = [];
      if (sel?.kind === 'unit' && ui.layers.patrol) {
        const u = sim.unitById.get(sel.id);
        const pl = u?.patrol;
        if (pl) {
          if (pl.kind === 'area') pf.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePoly(pl.cx, pl.cy, pl.r)] } });
          else if (pl.waypoints.length) {
            const pts = pl.waypoints.map((w) => ll(w.x, w.y));
            pf.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...pts, pts[0]] } });
            pl.waypoints.forEach((w, i) => pf.push({ type: 'Feature', properties: { n: `${i + 1}` }, geometry: { type: 'Point', coordinates: ll(w.x, w.y) } }));
          }
        }
      }
      src('patrol')?.setData({ type: 'FeatureCollection', features: pf });
      // suspects: probable area
      const sf: GeoJSON.Feature[] = [];
      for (const i of sim.incidents) {
        const s = i.suspect;
        if (!s || !s.free || s.caught || !s.lastSeen) continue;
        const sp = s.mode === 'car' ? 8 : s.mode === 'moto' ? 10 : s.mode === 'bike' ? 4 : 1.6;
        const r = Math.min(3500, 80 + sp * (sim.t - s.lastSeen.t) * 0.7);
        sf.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePoly(s.lastSeen.x, s.lastSeen.y, r, 48)] } });
      }
      src('suspect')?.setData({ type: 'FeatureCollection', features: sf });
      // traffic (throttled)
      if (ui.layers.traffic && sim.trafficVersion !== trafficCache.v && performance.now() - trafficCache.at > 8000) {
        trafficCache = { v: sim.trafficVersion, at: performance.now() };
        traffic ??= trafficGeoJSON(sim);
        for (const f of traffic.features) (f.properties as { e: number; f: number }).f = Math.round(sim.tf[(f.properties as { e: number }).e] * 100) / 100;
        src('traffic')?.setData(traffic);
      }
      updatePick();
    }

    function updatePick() {
      const mode = getUI().mapMode;
      const f: GeoJSON.Feature[] = [];
      if (mode?.kind === 'via' || mode?.kind === 'patrolRoute') {
        const pts = mode.points;
        pts.forEach((p, i) => f.push({ type: 'Feature', properties: { n: mode.kind === 'via' ? `経由${i + 1}` : `${i + 1}` }, geometry: { type: 'Point', coordinates: ll(p.x, p.y) } }));
        if (pts.length > 1) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: (mode.kind === 'patrolRoute' ? [...pts, pts[0]] : pts).map((p) => ll(p.x, p.y)) } });
      } else if (mode?.kind === 'patrolArea' && mode.center) {
        f.push({ type: 'Feature', properties: { n: `半径${(mode.r / 1000).toFixed(1)}km` }, geometry: { type: 'Point', coordinates: ll(mode.center.x, mode.center.y) } });
        f.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePoly(mode.center.x, mode.center.y, mode.r)] } });
      }
      for (const p of overlay.points) f.push({ type: 'Feature', properties: { n: p.label ?? '' }, geometry: { type: 'Point', coordinates: ll(p.x, p.y) } });
      src('pick')?.setData({ type: 'FeatureCollection', features: f });
    }

    timers.push(window.setInterval(updateUnits, 110));
    timers.push(window.setInterval(updateSlow, 900));
    // animations: pending incident pulse & emergency light flash
    let pulse = 0;
    timers.push(
      window.setInterval(() => {
        if (!readyRef.current) return;
        pulse = (pulse + 0.06) % 1;
        map.setPaintProperty('inc-pulse', 'circle-radius', 12 + pulse * 20);
        map.setPaintProperty('inc-pulse', 'circle-opacity', 0.55 * (1 - pulse));
      }, 60),
    );
    timers.push(
      window.setInterval(() => {
        if (!readyRef.current) return;
        blink = !blink;
        map.setPaintProperty('unit-emerg', 'circle-color', blink ? '#ff1e1e' : '#2a6bff');
      }, 380),
    );
    const unsubOverlay = overlay.subscribe(() => updateSlow());
    const unsubSim = sim.on((t) => {
      if (t === 'change') updateSlow();
    });

    // ---------- interaction
    map.on('click', (e) => {
      const ui = getUI();
      const [x, y] = proj(e.lngLat.lng, e.lngLat.lat);
      if (ui.mapMode) {
        handleModeTap(ui, x, y);
        updatePick();
        return;
      }
      const pad = 18;
      const feats = map.queryRenderedFeatures(
        [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ],
        { layers: ['unit', 'unit-koban', 'inc', 'fac-station', 'fac-koban'] },
      );
      if (!feats.length) {
        if (ui.selected) select(null);
        return;
      }
      const prio = (l: string) => (l === 'inc' ? 0 : l === 'unit' ? 1 : l === 'unit-koban' ? 2 : 3);
      const dist = (f: MapGeoJSONFeature) => {
        const c = (f.geometry as GeoJSON.Point).coordinates;
        const pt = map.project(c as [number, number]);
        return Math.hypot(pt.x - e.point.x, pt.y - e.point.y);
      };
      feats.sort((a, b) => {
        const da = dist(a), db = dist(b);
        if (Math.abs(da - db) > 10) return da - db;
        return prio(a.layer.id) - prio(b.layer.id);
      });
      const f = feats[0];
      const id = String(f.properties!.id);
      if (f.layer.id === 'inc') select({ kind: 'incident', id });
      else if (f.layer.id === 'unit' || f.layer.id === 'unit-koban') select({ kind: 'unit', id });
      else select({ kind: 'facility', id });
      setTimeout(updateUnits, 0);
      setTimeout(updateSlow, 0);
    });
    map.on('dragstart', () => {
      if (getUI().follow) setUI({ follow: null });
    });

    function handleModeTap(ui: UIState, x: number, y: number) {
      const m = ui.mapMode!;
      if (m.kind === 'via') setUI({ mapMode: { ...m, points: [...m.points, { x, y }] } });
      else if (m.kind === 'patrolRoute') setUI({ mapMode: { ...m, points: [...m.points, { x, y }] } });
      else if (m.kind === 'patrolArea') setUI({ mapMode: { ...m, center: { x, y } } });
      else if (m.kind === 'move') {
        sim.moveTo(m.unitId, x, y, sim.world.describe(x, y));
        setUI({ mapMode: null });
      } else if (m.kind === 'spawn') {
        const inc = sim.spawnIncident(m.type, { x, y });
        setUI({ mapMode: null });
        if (inc) select({ kind: 'incident', id: inc.id });
      }
    }

    return () => {
      timers.forEach(clearInterval);
      unsubOverlay();
      unsubSim();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, [sim]);

  // theme switching: recolour layers in place
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const p = PALETTES[theme];
    const dark = theme === 'dark';
    registerIcons(map, p, dark);
    const defs = layers(p, dark);
    for (const d of defs) {
      if (!map.getLayer(d.id)) {
        // casing layers differ between themes: add/remove as needed
        const idx = defs.indexOf(d);
        const before = defs.slice(idx + 1).find((n) => map.getLayer(n.id));
        map.addLayer(d, before?.id);
        continue;
      }
      const paint = (d as { paint?: Record<string, unknown> }).paint ?? {};
      for (const [k, v] of Object.entries(paint)) {
        if (d.id === 'inc-pulse' && (k === 'circle-radius' || k === 'circle-opacity')) continue;
        if (d.id === 'unit-emerg' && k === 'circle-color') continue;
        map.setPaintProperty(d.id, k as never, v as never);
      }
    }
    for (const id of ['road-minor-case', 'road-major-case', 'road-motorway-case']) if (dark && map.getLayer(id)) map.removeLayer(id);
    applyVisibility(map, getUI().layers);
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) applyVisibility(map, layersUI);
  }, [layersUI]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fly) return;
    map.flyTo({ center: ll(fly.x, fly.y), zoom: fly.zoom ?? Math.max(map.getZoom(), 14.5), duration: 700, essential: true });
  }, [fly]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ui = getUI();
    const phone = window.innerWidth < 700;
    const css = getComputedStyle(document.documentElement);
    const lw = parseInt(css.getPropertyValue('--left-w')) || 340;
    const rw = parseInt(css.getPropertyValue('--right-w')) || 380;
    const rh = ui.radio === 'min' ? 34 : ui.radio === 'mid' ? 150 : 320;
    map.setPadding(
      phone
        ? { left: 0, right: 0, top: 0, bottom: ui.sheet === 'peek' ? 90 : ui.sheet === 'half' ? window.innerHeight * 0.45 : window.innerHeight * 0.8 }
        : { left: ui.leftOpen ? lw : 0, right: ui.rightOpen && ui.selected ? rw : 0, top: 0, bottom: rh },
    );
  }, [padKey]);

  return (
    <div className="map-wrap">
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {!tilesReady && <div className="map-loading">地図データ展開中…</div>}
    </div>
  );
}

function applyVisibility(map: MLMap, l: UIState['layers']) {
  const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('traffic', l.traffic);
  vis('ward-line', l.wards);
  vis('ward-label', l.wards);
  vis('fac-koban', l.koban);
  vis('unit-koban', l.koban);
  vis('route-all', l.routes);
  vis('patrol-fill', l.patrol);
  vis('patrol-line', l.patrol);
  vis('landmark', l.landmarks);
}


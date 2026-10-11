// Pre-renders the road network into Mapbox Vector Tiles (public/data/tiles/{z}/{x}/{y}.pbf)
// so the dispatch map only loads the roads that are on screen.
// Usage: node tools/build-tiles.mjs   (after build-data.mjs)
import fs from 'node:fs';
import path from 'node:path';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { unproj } from '../src/shared/proj.js';

const DATA = path.join(import.meta.dirname, '..', 'public', 'data');
const OUT = path.join(DATA, 'tiles');
const MINZ = 9, MAXZ = 15;

const d = JSON.parse(fs.readFileSync(path.join(DATA, 'roads.json'), 'utf8'));
const features = [];
const e = d.e;
for (let p = 0, id = 0; p < e.length; id++) {
  const a = e[p], b = e[p + 1], cls = e[p + 2], flags = e[p + 3], name = d.n[e[p + 5]], n = e[p + 8];
  let px = d.v[a * 2], py = d.v[a * 2 + 1];
  const coords = [unproj(px / 10, py / 10)];
  p += 9;
  for (let k = 0; k < n; k++, p += 2) {
    px += e[p];
    py += e[p + 1];
    coords.push(unproj(px / 10, py / 10));
  }
  coords.push(unproj(d.v[b * 2] / 10, d.v[b * 2 + 1] / 10));
  // drop minor streets from low zoom tiles via the layer's minzoom; keep properties compact
  features.push({
    type: 'Feature',
    id,
    properties: { c: cls, n: name || '', t: flags & 4 ? 1 : 0, l: flags & 8 ? 1 : 0 },
    geometry: { type: 'LineString', coordinates: coords },
  });
}
console.log(`roads: ${features.length} features`);

// separate indexes so low zooms do not carry residential streets
const major = new geojsonvt({ type: 'FeatureCollection', features: features.filter((f) => f.properties.c <= 4) }, { maxZoom: MAXZ, indexMaxZoom: 6, tolerance: 2.5, extent: 4096, buffer: 48 });
const minor = new geojsonvt({ type: 'FeatureCollection', features: features.filter((f) => f.properties.c >= 5) }, { maxZoom: MAXZ, indexMaxZoom: 6, tolerance: 2.5, extent: 4096, buffer: 48 });

let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
for (let i = 0; i < d.v.length; i += 2) {
  const [lo, la] = unproj(d.v[i] / 10, d.v[i + 1] / 10);
  lonMin = Math.min(lonMin, lo);
  lonMax = Math.max(lonMax, lo);
  latMin = Math.min(latMin, la);
  latMax = Math.max(latMax, la);
}
const tx = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const ty = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
fs.rmSync(OUT, { recursive: true, force: true });
let count = 0, bytes = 0;
for (let z = MINZ; z <= MAXZ; z++) {
  for (let x = tx(lonMin, z); x <= tx(lonMax, z); x++)
    for (let y = ty(latMax, z); y <= ty(latMin, z); y++) {
      const layers = {};
      const tm = major.getTile(z, x, y);
      if (tm && tm.features.length) layers.roads = tm;
      if (z >= 12) {
        const tn = minor.getTile(z, x, y);
        if (tn && tn.features.length) layers.minor = tn;
      }
      // empty tiles are written too so static hosts never fall back to HTML
      const buf = Object.keys(layers).length ? vtpbf.fromGeojsonVt(layers, { version: 2 }) : new Uint8Array(0);
      const dir = path.join(OUT, String(z), String(x));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${y}.pbf`), buf);
      count++;
      bytes += buf.length;
    }
}
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ bounds: [lonMin, latMin, lonMax, latMax], minzoom: MINZ, maxzoom: MAXZ }));
console.log(`tiles: ${count} files, ${(bytes / 1e6).toFixed(1)} MB`);

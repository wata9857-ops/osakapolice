// Fetches raw OpenStreetMap data for Osaka City via Overpass API mirrors.
// Results are cached in tools/raw/*.json; delete a file to refetch it.
// Usage: node tools/fetch-osm.mjs [queryName ...]
import fs from 'node:fs';
import path from 'node:path';

const RAW = path.join(import.meta.dirname, 'raw');
fs.mkdirSync(RAW, { recursive: true });

const MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Osaka City bounding box (south, west, north, east)
export const BBOX = [34.575, 135.395, 34.775, 135.595];

function tiles(n, m = n) {
  const [s, w, no, e] = BBOX;
  const out = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      const a = s + ((no - s) * i) / n, b = s + ((no - s) * (i + 1)) / n;
      const c = w + ((e - w) * j) / m, d = w + ((e - w) * (j + 1)) / m;
      out.push([a, c, b, d].map((v) => v.toFixed(5)).join(','));
    }
  return out;
}

const bb = BBOX.join(',');
const Q = {
  boundary: `[out:json][timeout:170];
    rel["boundary"="administrative"]["admin_level"~"^(7|8)$"](${bb});
    out geom;`,
  police: `[out:json][timeout:170][bbox:${bb}];
    nwr["amenity"="police"]; out tags center;`,
  signals: `[out:json][timeout:170][bbox:${bb}];
    node["highway"="traffic_signals"]; out qt;`,
  water: `[out:json][timeout:170][bbox:${bb}];
    (way["natural"="water"]; rel["natural"="water"]; way["waterway"="riverbank"];
     way["natural"="coastline"]; way["waterway"~"^(river|canal)$"];);
    out geom;`,
  rail: `[out:json][timeout:170][bbox:${bb}];
    way["railway"~"^(rail|subway|light_rail)$"]["service"!~"."]; out tags geom;`,
  green: `[out:json][timeout:170][bbox:${bb}];
    (way["leisure"="park"]; rel["leisure"="park"]; way["landuse"~"^(grass|cemetery|recreation_ground)$"];);
    out geom;`,
  landmarks: `[out:json][timeout:170][bbox:${bb}];
    (nwr["tourism"~"^(attraction|museum|zoo|aquarium|theme_park)$"]["name"];
     nwr["railway"="station"]["name"]["station"!="subway"];
     nwr["railway"="station"]["name"]["station"="subway"];
     nwr["shop"~"^(department_store|mall)$"]["name"];
     nwr["amenity"~"^(hospital|townhall|university)$"]["name"];
     nwr["building"="stadium"]["name"]; nwr["leisure"="stadium"]["name"];);
    out tags center;`,
};
for (const [i, t] of tiles(2).entries())
  Q[`roads_major_${i}`] = `[out:json][timeout:170][bbox:${t}];
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"]; out body; >; out skel qt;`;
for (const [i, t] of tiles(5).entries())
  Q[`roads_minor_${i}`] = `[out:json][timeout:170][bbox:${t}];
    way["highway"~"^(unclassified|residential|living_street)$"]; out body; >; out skel qt;`;
for (const [i, t] of tiles(10).entries())
  Q[`bldg_${i}`] = `[out:json][timeout:170][bbox:${t}];
    way["building"]; out tags geom;`;

async function run(name, q) {
  const file = path.join(RAW, name + '.json');
  if (fs.existsSync(file)) return;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'osakapolice-sim/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(200000),
      });
      const txt = await res.text();
      if (!res.ok || !txt.startsWith('{')) throw new Error(`HTTP ${res.status} ${txt.slice(0, 80)}`);
      const j = JSON.parse(txt);
      if (j.remark && /error/i.test(j.remark)) throw new Error(j.remark);
      fs.writeFileSync(file, txt);
      console.log(`${name}: ${j.elements.length} elements (${(txt.length / 1e6).toFixed(1)} MB)`);
      return;
    } catch (e) {
      console.warn(`${name} attempt ${attempt + 1} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
  console.error(`${name}: GAVE UP`);
}

const want = process.argv.slice(2);
const names = Object.keys(Q).filter((n) => !want.length || want.some((w) => n.startsWith(w)));
const queue = [...names];
await Promise.all(
  [0, 1].map(async () => {
    while (queue.length) {
      const n = queue.shift();
      await run(n, Q[n]);
    }
  }),
);

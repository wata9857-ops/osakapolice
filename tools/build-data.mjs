// Compiles raw Overpass responses (tools/raw) into compact game data (public/data).
// Usage: node tools/build-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { LAT0, LON0, KX, KY, proj, unproj } from '../src/shared/proj.js';

const RAW = path.join(import.meta.dirname, 'raw');
const OUT = path.join(import.meta.dirname, '..', 'public', 'data');
fs.mkdirSync(OUT, { recursive: true });

const readRaw = (n) => {
  const f = path.join(RAW, n + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).elements : null;
};
const rawFiles = (prefix) =>
  fs.readdirSync(RAW).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).map((f) => f.slice(0, -5));
const write = (name, obj) => {
  const s = JSON.stringify(obj);
  fs.writeFileSync(path.join(OUT, name), s);
  console.log(`  wrote ${name} ${(s.length / 1024).toFixed(0)} KB`);
};
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// ---------- geometry helpers ----------
function dpSimplify(pts, tol) {
  // pts: [[x,y],...] in metres
  if (pts.length < 3) return pts;
  const n = pts.length;
  if (n > 4 && pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1]) {
    // closed ring: simplify both halves separately
    const m = n >> 1;
    return dpSimplify(pts.slice(0, m + 1), tol).concat(dpSimplify(pts.slice(m), tol).slice(1));
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > md) (md = d), (mi = i);
    }
    if (md > tol) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
const simplifyLL = (ll, tol) => dpSimplify(ll.map(([lo, la]) => proj(lo, la)), tol).map(([x, y]) => unproj(x, y).map(r5));

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2; // >0 => clockwise in x-right/y-up
};

// join open line strings (arrays of [lon,lat]) into rings / maximal chains
function joinLines(lines) {
  const key = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  const pool = lines.map((l) => l.slice());
  const out = [];
  while (pool.length) {
    let cur = pool.pop();
    let changed = true;
    while (changed && key(cur[0]) !== key(cur[cur.length - 1])) {
      changed = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        const cs = key(cur[0]), ce = key(cur[cur.length - 1]);
        const ls = key(l[0]), le = key(l[l.length - 1]);
        if (ce === ls) cur = cur.concat(l.slice(1));
        else if (ce === le) cur = cur.concat(l.slice().reverse().slice(1));
        else if (cs === le) cur = l.concat(cur.slice(1));
        else if (cs === ls) cur = l.slice().reverse().concat(cur.slice(1));
        else continue;
        pool.splice(i, 1);
        changed = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}
const isClosed = (l) => l.length > 3 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1];

// multipolygon relation (with member geometry) -> list of polygons [[outer, ...holes]]
function relationPolygons(rel) {
  const outers = [], inners = [];
  for (const m of rel.members || []) {
    if (m.type !== 'way' || !m.geometry) continue;
    const g = m.geometry.map((p) => [p.lon, p.lat]);
    (m.role === 'inner' ? inners : outers).push(g);
  }
  const oR = joinLines(outers).filter(isClosed);
  const iR = joinLines(inners).filter(isClosed);
  const polys = oR.map((o) => [o]);
  for (const h of iR) {
    const p = polys.find((pp) => pointInRing(h[0][0], h[0][1], pp[0]));
    if (p) p.push(h);
  }
  return polys;
}

// ---------- boundaries ----------
console.log('boundaries');
const bRaw = readRaw('boundary');
const cityRel = bRaw.find((e) => e.tags.admin_level === '7' && e.tags.name === '大阪市');
const cityPolys = relationPolygons(cityRel);
const inCity = (lon, lat) => cityPolys.some((p) => pointInRing(lon, lat, p[0]) && !p.slice(1).some((h) => pointInRing(lon, lat, h)));
const wards = [];
for (const e of bRaw) {
  if (e.tags.admin_level !== '8') continue;
  const polys = relationPolygons(e);
  if (!polys.length) continue;
  // ward belongs to Osaka City if a vertex well inside is in the city polygon
  const big = polys.reduce((a, b) => (Math.abs(ringArea(b[0])) > Math.abs(ringArea(a[0])) ? b : a));
  let sx = 0, sy = 0;
  for (const p of big[0]) (sx += p[0]), (sy += p[1]);
  const cx = sx / big[0].length, cy = sy / big[0].length;
  if (!inCity(cx, cy)) continue;
  wards.push({ name: e.tags.name, polys });
}
console.log(`  city polys ${cityPolys.length}, wards ${wards.length}: ${wards.map((w) => w.name).join(' ')}`);
const simplePoly = (polys, tol) => polys.map((p) => p.map((r) => simplifyLL(r, tol))).filter((p) => p[0].length >= 4);
write('areas.json', {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { kind: 'city', name: '大阪市' }, geometry: { type: 'MultiPolygon', coordinates: simplePoly(cityPolys, 8) } },
    ...wards.map((w) => ({
      type: 'Feature',
      properties: { kind: 'ward', name: w.name },
      geometry: { type: 'MultiPolygon', coordinates: simplePoly(w.polys, 6) },
    })),
  ],
});
const wardOf = (lon, lat) => {
  for (const w of wards) for (const p of w.polys) if (pointInRing(lon, lat, p[0])) return w.name;
  return null;
};

// ---------- roads / graph ----------
console.log('roads');
const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street'];
const nodeLL = new Map();
const ways = new Map();
for (const f of rawFiles('roads_')) {
  for (const e of readRaw(f)) {
    if (e.type === 'node') nodeLL.set(e.id, [e.lon, e.lat]);
    else if (e.type === 'way') ways.set(e.id, e);
  }
}
const roadWays = [];
for (const w of ways.values()) {
  const t = w.tags || {};
  let hw = t.highway || '';
  const link = hw.endsWith('_link');
  if (link) hw = hw.slice(0, -5);
  const cls = ROAD_CLASSES.indexOf(hw);
  if (cls < 0 || t.area === 'yes' || t.access === 'no' || t.access === 'private') continue;
  if (!w.nodes.every((n) => nodeLL.has(n))) continue;
  let oneway = 0;
  if (['yes', '1', 'true'].includes(t.oneway)) oneway = 1;
  else if (t.oneway === '-1') oneway = -1;
  else if (t.oneway !== 'no' && (t.junction === 'roundabout' || hw === 'motorway')) oneway = 1;
  let name = t.name || '';
  if (!name && t.ref) name = cls <= 1 ? `国道${t.ref}号` : cls <= 3 ? `府道${t.ref}号` : '';
  let lanes = parseInt(t.lanes, 10);
  if (!(lanes > 0)) lanes = [4, 4, 4, 2, 2, 2, 1, 1][cls];
  if (oneway && !t.lanes) lanes = Math.max(1, Math.ceil(lanes / 2));
  const ms = parseInt(t.maxspeed, 10);
  roadWays.push({
    nodes: oneway === -1 ? w.nodes.slice().reverse() : w.nodes,
    cls, link, oneway: oneway !== 0, name, lanes: Math.min(lanes, 8),
    bridge: t.bridge && t.bridge !== 'no', tunnel: t.tunnel && t.tunnel !== 'no',
    maxspeed: ms > 0 ? ms : 0,
    layer: parseInt(t.layer, 10) || 0,
  });
}
const uses = new Map();
for (const w of roadWays)
  w.nodes.forEach((n, i) => uses.set(n, (uses.get(n) || 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
const vIndex = new Map();
const vList = [];
const vid = (n) => {
  let i = vIndex.get(n);
  if (i === undefined) {
    i = vList.length;
    vIndex.set(n, i);
    vList.push(n);
  }
  return i;
};
let edges = [];
for (const w of roadWays) {
  let start = 0;
  for (let i = 1; i < w.nodes.length; i++) {
    if (uses.get(w.nodes[i]) >= 2 || i === w.nodes.length - 1) {
      const seg = w.nodes.slice(start, i + 1);
      if (seg[0] !== seg[seg.length - 1] || seg.length > 2)
        edges.push({ a: vid(seg[0]), b: vid(seg[seg.length - 1]), pts: seg.map((n) => proj(...nodeLL.get(n))), w });
      start = i;
    }
  }
}
edges = edges.filter((e) => e.a !== e.b);
console.log(`  ways ${roadWays.length}, vertices ${vList.length}, edges ${edges.length}`);

// strongly connected components (iterative Tarjan) to keep a fully routable network
{
  const N = vList.length;
  const adj = Array.from({ length: N }, () => []);
  for (const e of edges) {
    adj[e.a].push(e.b);
    if (!e.w.oneway) adj[e.b].push(e.a);
  }
  const index = new Int32Array(N).fill(-1), low = new Int32Array(N), onStack = new Uint8Array(N), comp = new Int32Array(N).fill(-1);
  const st = [];
  let idx = 0, nc = 0;
  for (let s = 0; s < N; s++) {
    if (index[s] >= 0) continue;
    const call = [[s, 0]];
    index[s] = low[s] = idx++;
    st.push(s);
    onStack[s] = 1;
    while (call.length) {
      const fr = call[call.length - 1];
      const v = fr[0];
      if (fr[1] < adj[v].length) {
        const w2 = adj[v][fr[1]++];
        if (index[w2] < 0) {
          index[w2] = low[w2] = idx++;
          st.push(w2);
          onStack[w2] = 1;
          call.push([w2, 0]);
        } else if (onStack[w2]) low[v] = Math.min(low[v], index[w2]);
      } else {
        call.pop();
        if (call.length) {
          const p = call[call.length - 1][0];
          low[p] = Math.min(low[p], low[v]);
        }
        if (low[v] === index[v]) {
          let x;
          do {
            x = st.pop();
            onStack[x] = 0;
            comp[x] = nc;
          } while (x !== v);
          nc++;
        }
      }
    }
  }
  const sizes = new Int32Array(nc);
  for (let i = 0; i < N; i++) sizes[comp[i]]++;
  let best = 0;
  for (let c = 1; c < nc; c++) if (sizes[c] > sizes[best]) best = c;
  const before = edges.length;
  edges = edges.filter((e) => comp[e.a] === best && comp[e.b] === best);
  console.log(`  SCC: ${nc} comps, largest ${sizes[best]} vertices; edges ${before} -> ${edges.length}`);
}
// compact vertex numbering
const remap = new Map();
const vOut = [];
for (const e of edges)
  for (const k of ['a', 'b']) {
    if (!remap.has(e[k])) {
      remap.set(e[k], vOut.length / 2);
      const [x, y] = proj(...nodeLL.get(vList[e[k]]));
      vOut.push(Math.round(x * 10), Math.round(y * 10));
    }
    e[k + 'v'] = remap.get(e[k]);
  }
const names = [''];
const nameIdx = new Map([['', 0]]);
const eOut = [];
for (const e of edges) {
  const w = e.w;
  let ni = nameIdx.get(w.name);
  if (ni === undefined) (ni = names.length), names.push(w.name), nameIdx.set(w.name, ni);
  const pts = dpSimplify(e.pts, 0.8);
  const inner = pts.slice(1, -1);
  const mid = e.pts[Math.floor(e.pts.length / 2)];
  const [mlon, mlat] = unproj(mid[0], mid[1]);
  const flags = (w.oneway ? 1 : 0) | (w.bridge ? 2 : 0) | (w.tunnel ? 4 : 0) | (w.link ? 8 : 0) | (inCity(mlon, mlat) ? 16 : 0);
  eOut.push(e.av, e.bv, w.cls, flags, w.lanes, ni, w.maxspeed, w.layer, inner.length);
  let px = vOut[e.av * 2], py = vOut[e.av * 2 + 1];
  for (const [x, y] of inner) {
    const qx = Math.round(x * 10), qy = Math.round(y * 10);
    eOut.push(qx - px, qy - py);
    (px = qx), (py = qy);
  }
}
write('roads.json', { origin: [LON0, LAT0], k: [KX, KY], v: vOut, n: names, e: eOut });

// spatial grid of output vertices for snapping
const NV = vOut.length / 2;
const GRID = 100;
const grid = new Map();
for (let i = 0; i < NV; i++) {
  const k = Math.floor(vOut[i * 2] / 10 / GRID) + ',' + Math.floor(vOut[i * 2 + 1] / 10 / GRID);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
}
function nearestVertex(x, y, maxD) {
  const gx = Math.floor(x / GRID), gy = Math.floor(y / GRID);
  let best = -1, bd = maxD;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (const i of grid.get(gx + dx + ',' + (gy + dy)) || []) {
        const d = Math.hypot(vOut[i * 2] / 10 - x, vOut[i * 2 + 1] / 10 - y);
        if (d < bd) (bd = d), (best = i);
      }
  return best;
}

// ---------- traffic signals ----------
console.log('signals');
const sig = readRaw('signals') || [];
const sigSet = new Map();
for (const s of sig) {
  const [x, y] = proj(s.lon, s.lat);
  const v = nearestVertex(x, y, 22);
  if (v < 0) continue;
  const nm = s.tags && (s.tags.name || s.tags['name:ja']);
  if (!sigSet.has(v) || nm) sigSet.set(v, nm || sigSet.get(v) || '');
}
const sigOut = [];
for (const [v, nm] of sigSet) sigOut.push(nm ? [v, nm] : v);
write('signals.json', sigOut);
console.log(`  ${sigSet.size} signalised vertices, ${sigOut.filter((s) => Array.isArray(s)).length} named`);

// ---------- police facilities ----------
console.log('police');
const pol = readRaw('police') || [];
const facilities = [];
const seen = new Set();
for (const e of pol) {
  const t = e.tags || {};
  const name = t.name || t['name:ja'];
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  if (!name || lat == null) continue;
  let kind = 'other';
  if (/警察本部$/.test(name)) kind = 'hq';
  else if (/交番$/.test(name)) kind = 'koban';
  else if (/駐在所$/.test(name)) kind = 'chuzaisho';
  else if (/機動警ら隊|分駐所/.test(name)) kind = 'unitbase';
  else if (/連絡所|詰所|立寄|巡回所|警ら所|別館|警察官室/.test(name)) kind = 'other';
  else if (/警察署$/.test(name)) kind = 'station';
  let short = name;
  if (kind === 'station') short = name.replace(/^(大阪府警察|大阪府|兵庫県警)/, '').replace(/警察署$/, '');
  else if (kind === 'koban' || kind === 'chuzaisho') short = name.replace(/^.*警察署\s*/, '').replace(/(警察官)?(交番|駐在所)$/, '').trim();
  const key = kind === 'station' ? 'st:' + short : name + kind;
  if (seen.has(key)) continue;
  seen.add(key);
  const [x, y] = proj(lon, lat);
  facilities.push({ name, short, kind, x: Math.round(x), y: Math.round(y), ward: wardOf(lon, lat), city: inCity(lon, lat) });
}
write('police.json', facilities);
const byKind = {};
for (const f of facilities) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
console.log('  ', byKind);

// ---------- landmarks ----------
console.log('landmarks');
const lm = readRaw('landmarks') || [];
const lmOut = [];
const lmSeen = new Set();
for (const e of lm) {
  const t = e.tags || {};
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  if (!t.name || lat == null) continue;
  let kind = 'poi';
  if (t.railway === 'station') kind = t.station === 'subway' ? 'subway' : 'station';
  else if (t.shop) kind = 'shop';
  else if (t.amenity === 'hospital') kind = 'hospital';
  else if (t.amenity === 'university') kind = 'university';
  else if (t.amenity === 'townhall') kind = 'townhall';
  else if (t.leisure === 'stadium' || t.building === 'stadium') kind = 'stadium';
  else if (t.tourism) kind = 'sight';
  const k = t.name + kind;
  if (lmSeen.has(k)) continue;
  lmSeen.add(k);
  const [x, y] = proj(lon, lat);
  lmOut.push({ name: t.name, kind, x: Math.round(x), y: Math.round(y), ward: wardOf(lon, lat) });
}
write('landmarks.json', lmOut);

// ---------- neighbourhood names (町丁目) ----------
{
  const pl = readRaw('places') || [];
  const out = [];
  for (const e of pl) {
    let n = e.tags?.name;
    if (!n) continue;
    if (/[一二三四五六七八九十]丁$/.test(n)) n += '目';
    const [x, y] = proj(e.lon, e.lat);
    out.push([n, Math.round(x), Math.round(y)]);
  }
  write('places.json', out);
}

// ---------- base map layers (water, green, rail) ----------
console.log('base layers');
const feats = [];
const water = readRaw('water') || [];
const coast = [];
for (const e of water) {
  const t = e.tags || {};
  if (e.type === 'way' && t.natural === 'coastline') {
    coast.push(e.geometry.map((p) => [p.lon, p.lat]));
    continue;
  }
  if (e.type === 'way' && (t.waterway === 'river' || t.waterway === 'canal')) {
    feats.push({ type: 'Feature', properties: { k: 'waterway', n: t.name || '' }, geometry: { type: 'LineString', coordinates: simplifyLL(e.geometry.map((p) => [p.lon, p.lat]), 3) } });
    continue;
  }
  let polys = [];
  if (e.type === 'way') {
    const g = e.geometry.map((p) => [p.lon, p.lat]);
    if (isClosed(g)) polys = [[g]];
  } else if (e.type === 'relation') polys = relationPolygons(e);
  const sp = simplePoly(polys, 2.5);
  if (sp.length) feats.push({ type: 'Feature', properties: { k: 'water', n: t.name || '' }, geometry: { type: 'MultiPolygon', coordinates: sp } });
}

// Sea polygon from coastline (land on the left, water on the right of way direction)
{
  const [W, S] = proj(135.3962, 34.5762), [E, N] = proj(135.5938, 34.7738);
  const chains = joinLines(coast).map((c) => c.map(([lo, la]) => proj(lo, la)));
  const islands = chains.filter((c) => c.length > 3 && Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) < 0.01);
  const open = chains.filter((c) => !islands.includes(c));
  const inside = (p) => p[0] >= W && p[0] <= E && p[1] >= S && p[1] <= N;
  // clip polyline to rect -> pieces that start/end on the border
  const pieces = [];
  const clipSeg = (p, q) => {
    let t0 = 0, t1 = 1;
    const dx = q[0] - p[0], dy = q[1] - p[1];
    for (const [pp, qq] of [[-dx, p[0] - W], [dx, E - p[0]], [-dy, p[1] - S], [dy, N - p[1]]]) {
      if (pp === 0) { if (qq < 0) return null; continue; }
      const r = qq / pp;
      if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy], t0 > 0, t1 < 1];
  };
  for (const c of open) {
    let cur = null;
    for (let i = 0; i < c.length - 1; i++) {
      const r = clipSeg(c[i], c[i + 1]);
      if (!r) { if (cur) { pieces.push(cur); cur = null; } continue; }
      if (!cur || r[2]) { if (cur) pieces.push(cur); cur = [r[0]]; }
      cur.push(r[1]);
      if (r[3]) { pieces.push(cur); cur = null; }
    }
    if (cur) pieces.push(cur);
  }
  const onBorder = (p) => Math.min(Math.abs(p[0] - W), Math.abs(p[0] - E), Math.abs(p[1] - S), Math.abs(p[1] - N)) < 0.5;
  const valid = pieces.filter((pc) => pc.length >= 2 && onBorder(pc[0]) && onBorder(pc[pc.length - 1]));
  // clockwise perimeter parameter starting at top-left corner (y-up coords): top edge W->E, right N->S, bottom E->W, left S->N
  const PW = E - W, PH = N - S;
  const perim = (p) => {
    const [x, y] = p;
    if (Math.abs(y - N) < 0.5) return x - W;
    if (Math.abs(x - E) < 0.5) return PW + (N - y);
    if (Math.abs(y - S) < 0.5) return PW + PH + (E - x);
    return 2 * PW + PH + (y - S);
  };
  const corners = [[PW, [E, N]], [PW + PH, [E, S]], [2 * PW + PH, [W, S]], [2 * PW + 2 * PH, [W, N]]];
  const total = 2 * PW + 2 * PH;
  const used = new Set();
  const seaPolys = [];
  for (let s = 0; s < valid.length; s++) {
    if (used.has(s)) continue;
    const ring = [];
    let cur = s, guard = 0;
    while (guard++ < 500) {
      used.add(cur);
      ring.push(...valid[cur]);
      const endP = perim(valid[cur][valid[cur].length - 1]);
      // walk clockwise along border to next piece start
      let best = -1, bestD = Infinity;
      for (let j = 0; j < valid.length; j++) {
        const d = (perim(valid[j][0]) - endP + total) % total;
        if (d < bestD && (!used.has(j) || j === s)) (bestD = d), (best = j);
      }
      for (const [cp, pt] of corners.map(([c, p]) => [c % total, p]).sort((a, b) => ((a[0] - endP + total) % total) - ((b[0] - endP + total) % total)))
        if ((cp - endP + total) % total < bestD && (cp - endP + total) % total > 0) ring.push(pt);
      if (best === s || best < 0) break;
      cur = best;
    }
    ring.push(ring[0]);
    seaPolys.push([dpSimplify(ring, 3).map(([x, y]) => unproj(x, y).map(r5))]);
  }
  console.log(`  coastline chains ${chains.length}, islands ${islands.length}, border pieces ${valid.length}, sea polys ${seaPolys.length}`);
  if (seaPolys.length) feats.unshift({ type: 'Feature', properties: { k: 'sea' }, geometry: { type: 'MultiPolygon', coordinates: seaPolys } });
  for (const isl of islands)
    feats.push({ type: 'Feature', properties: { k: 'island' }, geometry: { type: 'Polygon', coordinates: [dpSimplify(isl, 3).map(([x, y]) => unproj(x, y).map(r5))] } });
}

const green = readRaw('green') || [];
for (const e of green) {
  const t = e.tags || {};
  let polys = [];
  if (e.type === 'way') {
    const g = e.geometry.map((p) => [p.lon, p.lat]);
    if (isClosed(g)) polys = [[g]];
  } else polys = relationPolygons(e);
  const sp = simplePoly(polys, 3);
  const area = sp.reduce((a, p) => a + Math.abs(ringArea(p[0].map(([lo, la]) => proj(lo, la)))), 0);
  if (area < 1500) continue;
  feats.push({ type: 'Feature', properties: { k: 'green', n: area > 40000 ? t.name || '' : '' }, geometry: { type: 'MultiPolygon', coordinates: sp } });
}
const rail = readRaw('rail') || [];
for (const e of rail) {
  const t = e.tags || {};
  if (t.railway === 'subway' || t.tunnel === 'yes') continue;
  feats.push({ type: 'Feature', properties: { k: 'rail', n: t.name || '' }, geometry: { type: 'LineString', coordinates: simplifyLL(e.geometry.map((p) => [p.lon, p.lat]), 4) } });
}
write('base.json', { type: 'FeatureCollection', features: feats });

// ---------- buildings (tiled for driving mode) ----------
const bfiles = rawFiles('bldg_');
if (bfiles.length) {
  console.log(`buildings from ${bfiles.length} raw tiles`);
  const T = 500;
  const tilesB = new Map();
  const seenB = new Set();
  let count = 0;
  for (const f of bfiles) {
    for (const e of readRaw(f)) {
      if (e.type !== 'way' || !e.geometry || seenB.has(e.id)) continue;
      seenB.add(e.id);
      const t = e.tags || {};
      if (t.building === 'roof' || t.location === 'underground' || t.layer?.startsWith('-')) continue;
      const pts = dpSimplify(e.geometry.map((p) => proj(p.lon, p.lat)), 0.5);
      if (pts.length < 4) continue;
      let h = parseFloat(t.height);
      const lv = parseFloat(t['building:levels']);
      if (!(h > 0)) h = lv > 0 ? lv * 3.3 + 1 : 0; // 0 = unknown -> client heuristic
      let cx = 0, cy = 0;
      for (const p of pts) (cx += p[0]), (cy += p[1]);
      cx /= pts.length;
      cy /= pts.length;
      const tx = Math.floor(cx / T), ty = Math.floor(cy / T);
      const k = tx + '_' + ty;
      if (!tilesB.has(k)) tilesB.set(k, []);
      const ox = tx * T, oy = ty * T;
      const rec = [Math.round(h), pts.length - 1];
      for (let i = 0; i < pts.length - 1; i++) rec.push(Math.round(pts[i][0] - ox), Math.round(pts[i][1] - oy));
      tilesB.get(k).push(rec);
      count++;
    }
  }
  const BD = path.join(OUT, 'bldg');
  fs.mkdirSync(BD, { recursive: true });
  let bytes = 0;
  for (const [k, list] of tilesB) {
    const s = JSON.stringify(list.flat());
    bytes += s.length;
    fs.writeFileSync(path.join(BD, k + '.json'), s);
  }
  fs.writeFileSync(path.join(BD, 'index.json'), JSON.stringify({ size: T, tiles: [...tilesB.keys()] }));
  console.log(`  ${count} buildings in ${tilesB.size} tiles, ${(bytes / 1e6).toFixed(1)} MB`);
}
console.log('done');

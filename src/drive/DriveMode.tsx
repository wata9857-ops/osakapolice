// First-person police car driving mode on the real Osaka street network.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useSim } from '../ui/hooks';
import { setUI, flyTo, select } from '../ui/store';
import type { Unit, RadioMsg } from '../sim/types';
import { STATUS_LABEL } from '../sim/types';
import { CLS_MOTORWAY, F_LINK, F_TUNNEL, type Route } from '../sim/graph';
import { StreetWorld, roadWidth } from './world3d';
import { Traffic, type PlayerState } from './traffic';
import { patrolCarGeometry, motorcycleGeometry, cockpit, vehicleMaterial } from './models';
import { DriveAudio } from './audio';
import type { Sim } from '../sim/engine';

interface Controls {
  throttle: number;
  brake: number;
  steer: number; // -1 left .. 1 right
  keys: Set<string>;
}

interface Hud {
  speed: number;
  limit: number;
  road: string;
  task: string;
  taskSub: string;
  navTurn: number | null; // degrees, + = right
  navDist: number;
  navRoad: string;
  destDist: number;
  status: string;
  siren: boolean;
  view: 'cockpit' | 'chase';
  flash: string;
  reverse: boolean;
  canArrive: boolean;
}

type Dest = { edge: number; s: number; x: number; y: number; label: string; kind: 'incident' | 'point' | 'home' | 'station' | 'suspect' | 'wp' } | null;

function destination(sim: Sim, u: Unit): Dest {
  const g = sim.g;
  if ((u.status === 'enroute' || u.status === 'onscene') && u.incidentId) {
    const i = sim.incById.get(u.incidentId);
    if (i) return { ...i.loc, x: i.x, y: i.y, label: `${i.name} ${i.address}`, kind: 'incident' };
  }
  if (u.status === 'pursuit' && u.incidentId) {
    const s = sim.incById.get(u.incidentId)?.suspect;
    if (s) return { edge: s.pos.edge, s: s.pos.s, x: s.x, y: s.y, label: 'マル被追跡', kind: 'suspect' };
  }
  if ((u.status === 'moving' || u.status === 'hold') && u.task?.x !== undefined) {
    const sn = sim.snap(u.task.x, u.task.y!);
    if (sn) return { ...sn, label: u.task.label ?? '指定地点', kind: 'point' };
  }
  if (u.status === 'transport') {
    const st = sim.world.facilities.find((f) => f.id === u.stationId);
    const sn = st && sim.snap(st.x, st.y);
    if (sn) return { ...sn, label: `${st!.short}署`, kind: 'station' };
  }
  if (u.status === 'returning') {
    const sn = sim.snap(u.baseX, u.baseY);
    const b = sim.world.facilities.find((f) => f.id === u.baseId);
    if (sn) return { ...sn, label: b ? b.name : '所属', kind: 'home' };
  }
  if (u.status === 'patrol' && u.patrol?.kind === 'route' && u.patrol.waypoints.length) {
    const wp = u.patrol.waypoints[u.patrol.wpIndex % u.patrol.waypoints.length];
    return { edge: wp.edge, s: wp.s, x: wp.x, y: wp.y, label: `巡回地点 ${wp.label ?? ''}`, kind: 'wp' };
  }
  void g;
  return null;
}

export default function DriveMode({ unitId }: { unitId: string }) {
  const sim = useSim();
  const u = sim.unitById.get(unitId)!;
  const host = useRef<HTMLDivElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const ctl = useRef<Controls>({ throttle: 0, brake: 0, steer: 0, keys: new Set() });
  const sirenRef = useRef(u.emergency);
  const viewRef = useRef<'cockpit' | 'chase'>('cockpit');
  const arriveReq = useRef(false);
  const audio = useRef(new DriveAudio());
  const [hud, setHud] = useState<Hud>({
    speed: 0, limit: 40, road: '', task: '', taskSub: '', navTurn: null, navDist: 0, navRoad: '', destDist: 0, status: '', siren: u.emergency,
    view: 'cockpit', flash: '', reverse: false, canArrive: false,
  });
  const [msgs, setMsgs] = useState<(RadioMsg & { at: number })[]>([]);
  const [knob, setKnob] = useState(0);
  const [pedal, setPedal] = useState({ acc: false, brk: false });

  // radio feed
  useEffect(() => {
    const off = sim.on((type, p) => {
      if (type !== 'radio') return;
      const m = p as RadioMsg;
      if (m.level === 'system' && m.unitId !== u.id) return;
      setMsgs((l) => [...l.slice(-3), { ...m, at: performance.now() }]);
    });
    const iv = setInterval(() => setMsgs((l) => l.filter((m) => performance.now() - m.at < 14000)), 1000);
    return () => {
      off();
      clearInterval(iv);
    };
  }, [sim, u.id]);

  useEffect(() => {
    const g = sim.g;
    const prevSpeed = sim.speed;
    const prevPaused = sim.paused;
    sim.speed = 1;
    sim.paused = false;
    sim.setManual(u, true);
    select({ kind: 'unit', id: u.id });

    // ---------- renderer & scene
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setSize(host.current!.clientWidth, host.current!.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.current!.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(68, host.current!.clientWidth / host.current!.clientHeight, 0.1, 1600);
    const hemi = new THREE.HemisphereLight(0xdfe8f0, 0x50504a, 1.1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    scene.add(sun);
    scene.add(sun.target);
    scene.fog = new THREE.Fog(0xb8c6d2, 120, 900);
    // ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: 0x77786f }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);
    const world = new StreetWorld(scene, sim);
    const traffic = new Traffic(scene, world);

    // ---------- player vehicle rig
    const rig = new THREE.Group();
    scene.add(rig);
    const body = new THREE.Mesh(patrolCarGeometry(u.kind === 'kisou'), vehicleMaterial);
    rig.add(body);
    const cp = cockpit();
    rig.add(cp.group);
    rig.add(camera);
    const headlight = new THREE.SpotLight(0xfff4dd, 0, 90, 0.5, 0.5, 1.2);
    headlight.position.set(0, 1, -2.4);
    headlight.target.position.set(0, 0, -30);
    rig.add(headlight, headlight.target);
    const beaconLight = new THREE.PointLight(0xff2020, 0, 30, 1.5);
    beaconLight.position.set(0, 2.2, 0);
    rig.add(beaconLight);
    if (u.kind === 'kotsu') {
      body.geometry = motorcycleGeometry();
    }

    // other police units
    const others = new Map<string, THREE.Mesh>();
    // incident beacons
    const beacons = new Map<string, THREE.Group>();
    const pillarGeo = new THREE.CylinderGeometry(3, 3, 120, 16, 1, true);
    pillarGeo.translate(0, 60, 0);
    // route ribbon
    let ribbon: THREE.Mesh | null = null;
    const ribbonMat = new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

    // ---------- player state
    const P = { x: u.x, y: u.y, h: u.heading, v: 0, steerA: 0, rev: false, offroad: false, look: 0 };
    // start on the left lane of the current road
    {
      const n = g.nearest(P.x, P.y, 60);
      if (n) {
        const pt = g.pointAt(n.edge, n.s);
        const dir = Math.sin(P.h) * pt.hx + Math.cos(P.h) * pt.hy >= 0 ? 1 : -1;
        const dx = pt.hx * dir, dy = pt.hy * dir;
        const w = roadWidth(g, n.edge);
        P.h = Math.atan2(dx, dy);
        const off = g.eflags[n.edge] & 1 ? 0 : w / 4;
        P.x = pt.x - dy * off;
        P.y = pt.y + dx * off;
      }
    }
    let route: Route | null = null;
    let routeLine: [number, number][] = [];
    let dest: Dest = null;
    let lastRoute = -1e9;
    let navT = 0;
    let lastHud = 0;
    let lastNear = 0;
    let curEdge = -1;
    let flash = '';
    let flashUntil = 0;
    let lookTarget = 0;

    const drivable = (e: number) => g.ecls[e] !== CLS_MOTORWAY && !(g.eflags[e] & F_LINK) && !(g.eflags[e] & F_TUNNEL);

    function rebuildRibbon() {
      if (ribbon) {
        scene.remove(ribbon);
        ribbon.geometry.dispose();
        ribbon = null;
      }
      if (routeLine.length < 2) return;
      const pos: number[] = [];
      const idx: number[] = [];
      let n = 0;
      for (let i = 0; i < routeLine.length; i++) {
        const a = routeLine[Math.max(0, i - 1)], b = routeLine[Math.min(routeLine.length - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L = Math.hypot(dx, dy) || 1;
        const nx = (-dy / L) * 0.9, ny = (dx / L) * 0.9;
        const [x, y] = routeLine[i];
        pos.push(x + nx, 0.12, -(y + ny), x - nx, 0.12, -(y - ny));
        if (i > 0) idx.push(n - 2, n - 1, n, n - 1, n + 1, n);
        n += 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      ribbon = new THREE.Mesh(geo, ribbonMat);
      scene.add(ribbon);
    }

    function computeRoute(now: number) {
      dest = destination(sim, u);
      lastRoute = now;
      if (!dest) {
        route = null;
        routeLine = [];
        rebuildRibbon();
        return;
      }
      const n = g.nearest(P.x, P.y, 80, drivable);
      if (!n) return;
      const pt = g.pointAt(n.edge, n.s);
      const dir = Math.sin(P.h) * pt.hx + Math.cos(P.h) * pt.hy >= 0 ? 1 : -1;
      route = g.route({ edge: n.edge, dir, s: n.s }, dest, { emergency: sirenRef.current, traffic: sim.traffic, avoidMotorway: true });
      routeLine = [];
      if (route) for (const l of route.legs) g.slice(l.edge, l.s0, l.s1, routeLine);
      rebuildRibbon();
    }

    function nav() {
      // next manoeuvre along the route polyline
      if (!route || routeLine.length < 2) return { turn: null as number | null, dist: 0, road: '' };
      // find closest point index
      let bi = 0, bd = Infinity;
      for (let i = 0; i < routeLine.length; i++) {
        const d = Math.hypot(routeLine[i][0] - P.x, routeLine[i][1] - P.y);
        if (d < bd) (bd = d), (bi = i);
      }
      if (bd > 45) lastRoute = -1e9; // off route → recompute
      let dist = 0;
      for (let i = bi + 1; i < routeLine.length - 1; i++) {
        const a = routeLine[i - 1], b = routeLine[i], c = routeLine[i + 1];
        dist += Math.hypot(b[0] - a[0], b[1] - a[1]);
        const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]);
        const h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
        let dh = h2 - h1;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        if (Math.abs(dh) > 0.6 && Math.hypot(c[0] - b[0], c[1] - b[1]) > 4) {
          const ne = g.nearest(c[0], c[1], 20);
          return { turn: (dh * 180) / Math.PI, dist, road: ne ? g.name(ne.edge) : '' };
        }
        if (dist > 1500) break;
      }
      const tail = Math.hypot(routeLine[routeLine.length - 1][0] - P.x, routeLine[routeLine.length - 1][1] - P.y);
      return { turn: 0, dist: Math.max(dist, tail), road: '' };
    }

    function insideBuilding(x: number, y: number) {
      for (const b of world.buildingsNear(x, y)) {
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
        let inside = false;
        const r = b.poly;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++)
          if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
        if (inside) return true;
      }
      return false;
    }

    function setFlash(text: string, ms = 1600) {
      flash = text;
      flashUntil = performance.now() + ms;
    }

    // ---------- day / night
    function lighting() {
      const h = sim.hour;
      const elev = Math.sin(((h - 6) / 12) * Math.PI); // >0 daytime
      const day = Math.max(0, Math.min(1, elev * 2.2 + 0.25));
      const night = 1 - day;
      const skyDay = new THREE.Color(0xa9c3dc), skyNight = new THREE.Color(0x0a1220), dusk = new THREE.Color(0xd99a6c);
      const sky = skyNight.clone().lerp(skyDay, day);
      if (day > 0.05 && day < 0.6) sky.lerp(dusk, 0.35 * (1 - Math.abs(day - 0.3) / 0.3));
      const rain = sim.weather === 'rain';
      if (rain) sky.lerp(new THREE.Color(0x5d656c).multiplyScalar(0.3 + day * 0.7), 0.75);
      scene.background = sky;
      (scene.fog as THREE.Fog).color.copy(sky);
      (scene.fog as THREE.Fog).near = rain ? 40 : 120;
      (scene.fog as THREE.Fog).far = rain ? 320 : 700 + day * 300;
      hemi.intensity = (0.25 + day * 0.95) * (rain ? 0.7 : 1);
      sun.intensity = day * (rain ? 0.3 : 1.5);
      sun.position.set(P.x + 300, 400 * Math.max(0.2, elev), -(P.y - 200));
      sun.target.position.set(P.x, 0, -P.y);
      (ground.material as THREE.MeshLambertMaterial).color.setRGB(0.47 * (0.35 + day * 0.65), 0.47 * (0.35 + day * 0.65), 0.44 * (0.35 + day * 0.65));
      world.setNight(night);
      headlight.intensity = night > 0.3 ? 60 : 0;
    }
    lighting();

    // ---------- input
    const keyDown = (e: KeyboardEvent) => {
      ctl.current.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') exit();
      if (e.key.toLowerCase() === 'h') toggleSiren();
      if (e.key.toLowerCase() === 'v') toggleView();
    };
    const keyUp = (e: KeyboardEvent) => ctl.current.keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    const onResize = () => {
      const w = host.current!.clientWidth, h = host.current!.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    // drag on the scene to look around
    let lookPtr: { id: number; x: number } | null = null;
    const pd = (e: PointerEvent) => {
      if (e.target !== renderer.domElement) return;
      lookPtr = { id: e.pointerId, x: e.clientX };
    };
    const pm = (e: PointerEvent) => {
      if (!lookPtr || e.pointerId !== lookPtr.id) return;
      lookTarget = Math.max(-1.3, Math.min(1.3, ((e.clientX - lookPtr.x) / window.innerWidth) * -2.6));
    };
    const pu = (e: PointerEvent) => {
      if (lookPtr && e.pointerId === lookPtr.id) {
        lookPtr = null;
        lookTarget = 0;
      }
    };
    renderer.domElement.addEventListener('pointerdown', pd);
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointercancel', pu);

    // ---------- main loop
    let raf = 0;
    let last = performance.now();
    let t0 = performance.now();
    let signalT = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const c = ctl.current;
      const k = c.keys;
      let throttle = c.throttle, brake = c.brake, steer = c.steer;
      if (k.has('arrowup') || k.has('w')) throttle = 1;
      if (k.has('arrowdown') || k.has('s') || k.has(' ')) brake = 1;
      if (k.has('arrowleft') || k.has('a')) steer = -1;
      if (k.has('arrowright') || k.has('d')) steer = 1;
      // reverse gear: hold brake while stopped
      if (brake > 0.5 && P.v <= 0.05 && !P.rev) {
        if (now - t0 > 700) P.rev = true;
      } else if (brake < 0.5 && P.v > -0.05) t0 = now;
      if (throttle > 0.1 && P.rev && P.v > -0.2) P.rev = false;
      // longitudinal dynamics
      const vmax = u.kind === 'kotsu' ? 50 : 46;
      let a = 0;
      if (P.rev) {
        if (brake > 0.1) a = -2.2 * brake;
        if (throttle > 0.1) a += 6 * throttle;
        if (P.v < -5) a = Math.max(a, 0);
      } else {
        a = throttle * (u.kind === 'kotsu' ? 4.2 : 3.4) * (1 - Math.max(0, P.v) / vmax);
        if (brake > 0) a -= brake * 8.5 * Math.sign(P.v || 1);
      }
      a -= 0.25 * Math.sign(P.v) + 0.0012 * P.v * Math.abs(P.v);
      if (P.offroad) a -= 2.5 * Math.sign(P.v);
      const nv = P.v + a * dt;
      P.v = !P.rev && P.v > 0 && nv < 0 ? 0 : P.rev && P.v < 0 && nv > 0 && throttle < 0.1 ? 0 : nv;
      if (!P.rev && P.v < 0) P.v = 0;
      // steering
      const maxSteer = 0.62 / (1 + Math.abs(P.v) / 9);
      P.steerA += (steer * maxSteer - P.steerA) * Math.min(1, dt * 6);
      const L = u.kind === 'kotsu' ? 1.5 : 2.8;
      P.h += (P.v / L) * Math.tan(P.steerA) * dt;
      const ox = P.x, oy = P.y;
      P.x += Math.sin(P.h) * P.v * dt;
      P.y += Math.cos(P.h) * P.v * dt;
      // collisions: buildings & traffic
      const fx = P.x + Math.sin(P.h) * 2.2 * Math.sign(P.v || 1), fy = P.y + Math.cos(P.h) * 2.2 * Math.sign(P.v || 1);
      if (insideBuilding(fx, fy) || insideBuilding(P.x, P.y)) {
        P.x = ox;
        P.y = oy;
        if (Math.abs(P.v) > 3) setFlash('衝突！', 1200);
        P.v = -P.v * 0.15;
      }
      const hit = traffic.collide(fx, fy);
      if (hit) {
        P.x = ox;
        P.y = oy;
        if (Math.abs(P.v) > 3) setFlash('接触事故に注意', 1200);
        P.v = 0;
        hit.v = 0;
      }
      // road surface
      if (now - lastNear > 150) {
        lastNear = now;
        const n = g.nearest(P.x, P.y, 40, drivable);
        if (n) {
          curEdge = n.edge;
          P.offroad = n.d > roadWidth(g, n.edge) / 2 + 3;
        } else P.offroad = true;
      }
      // sync with simulation
      sim.manualUpdate(u, P.x, P.y, P.h, Math.abs(P.v), dt);
      // world streaming / traffic
      world.update(P.x, P.y, 1);
      signalT += dt;
      if (signalT > 0.3) {
        signalT = 0;
        world.updateSignals(sim.t);
      }
      traffic.update(dt, { x: P.x, y: P.y, heading: P.h, v: P.v, siren: sirenRef.current } as PlayerState, sim.t);
      // rig & camera
      rig.position.set(P.x, 0, -P.y);
      ground.position.set(P.x, -0.02, -P.y);
      rig.rotation.y = -P.h;
      P.look += (lookTarget - P.look) * Math.min(1, dt * 5);
      const vw = viewRef.current;
      cp.group.visible = vw === 'cockpit';
      body.visible = vw === 'chase';
      if (vw === 'cockpit') {
        camera.position.set(u.kind === 'kotsu' ? 0 : 0.36, u.kind === 'kotsu' ? 1.6 : 1.2, u.kind === 'kotsu' ? 0.1 : -0.05);
        camera.rotation.set(-0.06, P.look, 0, 'YXZ');
        cp.wheel.rotation.z = -P.steerA * 4;
      } else {
        camera.position.set(0, 3.4, 8.5);
        camera.rotation.set(-0.2, P.look, 0, 'YXZ');
      }
      // beacon flashing
      const on = sirenRef.current;
      const ph = Math.floor(now / 200) % 2;
      beaconLight.intensity = on ? (ph ? 40 : 25) : 0;
      beaconLight.color.setHex(ph ? 0xff1a1a : 0xff3030);
      (cp.beacon.material as THREE.MeshBasicMaterial).opacity = on ? (ph ? 0.1 : 0.04) : 0;
      // other units
      for (const o of sim.units) {
        if (o.id === u.id || o.kind === 'koban') continue;
        const d = Math.hypot(o.x - P.x, o.y - P.y);
        let m = others.get(o.id);
        if (d > 600) {
          if (m) {
            scene.remove(m);
            others.delete(o.id);
          }
          continue;
        }
        if (!m) {
          m = new THREE.Mesh(o.kind === 'kotsu' ? motorcycleGeometry() : patrolCarGeometry(o.kind === 'kisou'), vehicleMaterial);
          scene.add(m);
          others.set(o.id, m);
        }
        // keep left of the centre line when on a two-way road
        const off = 1.6;
        m.position.set(o.x + Math.cos(o.heading) * -off, 0, -(o.y - Math.sin(o.heading) * -off));
        m.rotation.y = -o.heading;
      }
      // incident beacons
      for (const inc of sim.activeIncidents()) {
        const d = Math.hypot(inc.x - P.x, inc.y - P.y);
        let b = beacons.get(inc.id);
        if (d > 2500) {
          if (b) {
            scene.remove(b);
            beacons.delete(inc.id);
          }
          continue;
        }
        if (!b) {
          b = new THREE.Group();
          const col = inc.priority === 1 ? 0xff3030 : inc.priority === 2 ? 0xff8a1f : 0xe9c34a;
          const pil = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, fog: false }));
          b.add(pil);
          const ring = new THREE.Mesh(new THREE.RingGeometry(5, 6.5, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.2;
          b.add(ring);
          b.position.set(inc.x, 0, -inc.y);
          scene.add(b);
          beacons.set(inc.id, b);
        }
        const pil = b.children[0] as THREE.Mesh;
        (pil.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.08 * Math.sin(now / 300);
      }
      for (const [id, b] of beacons) {
        const inc = sim.incById.get(id);
        if (!inc || inc.status === 'resolved' || inc.status === 'failed') {
          scene.remove(b);
          beacons.delete(id);
        }
      }
      // navigation
      if (now - lastRoute > 2500) computeRoute(now);
      navT += dt;
      // arrival
      if (dest && !arriveReq.current) {
        const dd = Math.hypot(dest.x - P.x, dest.y - P.y);
        const near = dd < (dest.kind === 'incident' ? 40 : 30);
        if (near && Math.abs(P.v) < 3 && dest.kind !== 'wp' && dest.kind !== 'suspect' && u.status !== 'onscene' && u.status !== 'hold') {
          arriveReq.current = true;
          sim.manualArrive(u);
          setFlash(dest.kind === 'incident' ? '現着' : '到着', 1800);
          setTimeout(() => (arriveReq.current = false), 3000);
          lastRoute = -1e9;
        }
        if (dest.kind === 'wp' && dd < 25 && u.patrol) {
          u.patrol.wpIndex = (u.patrol.wpIndex + 1) % u.patrol.waypoints.length;
          setFlash('巡回地点 通過', 1200);
          lastRoute = -1e9;
        }
      }
      if (now > flashUntil) flash = '';
      // audio
      audio.current.setEngine(Math.abs(P.v), throttle);
      lighting();
      renderer.render(scene, camera);
      // HUD (≈8 Hz)
      if (now - lastHud > 125) {
        lastHud = now;
        const nv2 = nav();
        const inc = u.incidentId ? sim.incById.get(u.incidentId) : null;
        const limit = curEdge >= 0 ? Math.round(g.speed(curEdge) * 3.6) : 40;
        const dd = dest ? Math.hypot(dest.x - P.x, dest.y - P.y) : 0;
        setHud({
          speed: Math.abs(P.v) * 3.6,
          limit,
          road: curEdge >= 0 ? g.name(curEdge) : '',
          task: dest ? dest.label : u.status === 'patrol' ? `${u.patrol?.areaName ?? ''} 警ら中` : STATUS_LABEL[u.status],
          taskSub: inc ? `${inc.id} · P${inc.priority} · ${inc.status === 'onscene' ? '現場活動中' : inc.status === 'dispatched' ? '臨場中' : ''}` : '',
          navTurn: nv2.turn,
          navDist: nv2.dist,
          navRoad: nv2.road,
          destDist: dd,
          status: STATUS_LABEL[u.status],
          siren: sirenRef.current,
          view: viewRef.current,
          flash,
          reverse: P.rev,
          canArrive: !!dest && dd < 120 && dest.kind !== 'wp' && dest.kind !== 'suspect' && u.status !== 'onscene',
        });
        drawMinimap(mini.current, sim, P, routeLine, dest);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    function toggleSiren() {
      sirenRef.current = !sirenRef.current;
      u.emergency = sirenRef.current;
      audio.current.setSiren(sirenRef.current);
      lastRoute = -1e9;
      sim.emit('change');
    }
    function toggleView() {
      viewRef.current = viewRef.current === 'cockpit' ? 'chase' : 'cockpit';
    }
    function exit() {
      setUI({ driving: null });
    }
    handlers.current = { toggleSiren, toggleView, exit, arrive: () => (sim.manualArrive(u), setFlash('現着報告', 1500)) };
    if (u.emergency) audio.current.setSiren(true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointercancel', pu);
      audio.current.dispose();
      traffic.dispose();
      world.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sim.setManual(u, false);
      sim.speed = prevSpeed;
      sim.paused = prevPaused;
      flyTo(u.x, u.y, 15.5);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  const handlers = useRef<{ toggleSiren: () => void; toggleView: () => void; exit: () => void; arrive: () => void }>({
    toggleSiren: () => {},
    toggleView: () => {},
    exit: () => {},
    arrive: () => {},
  });

  // ---------- touch controls
  const padRef = useRef<HTMLDivElement>(null);
  const steerPtr = useRef<number | null>(null);
  const onPad = (e: React.PointerEvent) => {
    if (steerPtr.current !== null && steerPtr.current !== e.pointerId) return;
    const r = padRef.current!.getBoundingClientRect();
    const v = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    ctl.current.steer = Math.sign(v) * Math.pow(Math.abs(v), 1.3);
    setKnob(v);
  };
  const pedalProps = (which: 'throttle' | 'brake') => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      ctl.current[which] = 1;
      setPedal((p) => ({ ...p, [which === 'throttle' ? 'acc' : 'brk']: true }));
      audio.current.startEngine();
    },
    onPointerUp: () => {
      ctl.current[which] = 0;
      setPedal((p) => ({ ...p, [which === 'throttle' ? 'acc' : 'brk']: false }));
    },
    onPointerCancel: () => {
      ctl.current[which] = 0;
      setPedal((p) => ({ ...p, [which === 'throttle' ? 'acc' : 'brk']: false }));
    },
  });

  const arrowRot = hud.navTurn === null ? 0 : Math.max(-150, Math.min(150, hud.navTurn));
  const turnText = hud.navTurn === null ? '' : Math.abs(hud.navTurn) < 30 ? '直進' : hud.navTurn > 0 ? (hud.navTurn > 120 ? 'Uターン' : '右折') : hud.navTurn < -120 ? 'Uターン' : '左折';

  return (
    <div className="drive">
      <div ref={host} className="drive-view" style={{ position: 'absolute', inset: 0 }} />
      <div className="drive-hud">
        <div className="hud-top">
          <button className="hud-btn" onClick={() => handlers.current.exit()}>
            ◀ 指令台
          </button>
          <div className="hud-box hud-task">
            <div className="k">
              {u.callsign} · {hud.status} {hud.taskSub && `· ${hud.taskSub}`}
            </div>
            <div className="v">{hud.task || '任務なし — 自由走行'}</div>
          </div>
          {hud.navTurn !== null && (
            <div className="hud-box hud-nav">
              <svg width="34" height="34" viewBox="-17 -17 34 34" style={{ transform: `rotate(${arrowRot}deg)` }}>
                <path d="M0 -14 L9 -3 L3 -3 L3 13 L-3 13 L-3 -3 L-9 -3 Z" fill="#ffb000" />
              </svg>
              <div>
                <div className="dist">{hud.navDist >= 1000 ? `${(hud.navDist / 1000).toFixed(1)}km` : `${Math.round(hud.navDist / 10) * 10}m`}</div>
                <div className="road">
                  {turnText}
                  {hud.navRoad ? ` · ${hud.navRoad}` : ''}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="hud-radio">
          {msgs.map((m) => (
            <div key={m.id} className={m.from === '本部' ? 'hq' : ''}>
              <b>{m.from}</b> {m.text}
            </div>
          ))}
        </div>
        <canvas ref={mini} className="minimap" width={380} height={380} />
        <div className="drive-side">
          <button className={`hud-btn ${hud.siren ? 'on' : ''}`} onClick={() => handlers.current.toggleSiren()}>
            {hud.siren ? '赤色灯 ON' : '赤色灯'}
          </button>
          <button className="hud-btn" onClick={() => handlers.current.toggleView()}>
            {hud.view === 'cockpit' ? '車外視点' : '運転席'}
          </button>
          {hud.canArrive && (
            <button className="hud-btn amber on" onClick={() => handlers.current.arrive()}>
              現着報告
            </button>
          )}
        </div>
        {hud.flash && <div className="hud-box drive-msg">{hud.flash}</div>}
        <div className="hud-box speedo">
          <div className="sv">{Math.round(hud.speed)}</div>
          <div className="su">km/h{hud.reverse ? ' · R' : ''}</div>
          <div className="lim">
            {hud.road || '—'} · 制限{hud.limit}
          </div>
        </div>
        <div
          className="wheel-pad"
          ref={padRef}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            steerPtr.current = e.pointerId;
            onPad(e);
          }}
          onPointerMove={(e) => steerPtr.current === e.pointerId && onPad(e)}
          onPointerUp={() => {
            steerPtr.current = null;
            ctl.current.steer = 0;
            setKnob(0);
          }}
          onPointerCancel={() => {
            steerPtr.current = null;
            ctl.current.steer = 0;
            setKnob(0);
          }}
        >
          <div className="lbl">ハンドル ◀ ▶</div>
          <div className="track" />
          <div className="knob" style={{ left: `${50 + knob * 44}%` }} />
        </div>
        <div className="pedals">
          <div className={`pedal brake ${pedal.brk ? 'down' : ''}`} {...pedalProps('brake')}>
            ブレーキ
          </div>
          <div className={`pedal ${pedal.acc ? 'down' : ''}`} {...pedalProps('throttle')}>
            アクセル
          </div>
        </div>
      </div>
    </div>
  );
}

function drawMinimap(c: HTMLCanvasElement | null, sim: Sim, P: { x: number; y: number; h: number }, route: [number, number][], dest: Dest) {
  if (!c) return;
  const g = sim.g;
  const ctx = c.getContext('2d')!;
  const W = c.width, R = W / 2;
  const scale = R / 320; // px per metre (≈320 m radius)
  ctx.save();
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = 'rgba(10,16,22,0.9)';
  ctx.fillRect(0, 0, W, W);
  ctx.translate(R, R);
  ctx.rotate(-P.h);
  const tx = (x: number) => (x - P.x) * scale, ty = (y: number) => -(y - P.y) * scale;
  ctx.lineCap = 'round';
  const edges = g.edgesNear(P.x, P.y, 460);
  for (const pass of [1, 0]) {
    for (const e of edges) {
      const cls = g.ecls[e];
      if (pass === 1 && cls <= 3) continue;
      if (pass === 0 && cls > 3) continue;
      ctx.strokeStyle = cls === 0 ? '#8a6a25' : cls <= 3 ? '#7d8a96' : '#46525d';
      ctx.lineWidth = cls === 0 ? 5 : cls <= 3 ? 6 : cls <= 5 ? 3.5 : 2.5;
      ctx.beginPath();
      for (let k = g.gs[e]; k < g.gs[e + 1]; k++) {
        const x = tx(g.gx[k]), y = ty(g.gy[k]);
        if (k === g.gs[e]) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  if (route.length > 1) {
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 5;
    ctx.beginPath();
    route.forEach(([x, y], i) => (i ? ctx.lineTo(tx(x), ty(y)) : ctx.moveTo(tx(x), ty(y))));
    ctx.stroke();
  }
  // other units
  for (const o of sim.units) {
    const d = Math.hypot(o.x - P.x, o.y - P.y);
    if (d > 420 || o.manual) continue;
    ctx.fillStyle = o.kind === 'koban' ? '#6aa9d8' : '#4ea8ff';
    ctx.fillRect(tx(o.x) - 4, ty(o.y) - 4, 8, 8);
  }
  for (const i of sim.activeIncidents()) {
    const d = Math.hypot(i.x - P.x, i.y - P.y);
    if (d > 600) continue;
    ctx.save();
    ctx.translate(tx(Math.max(Math.min(i.x, P.x + 400), P.x - 400)), ty(Math.max(Math.min(i.y, P.y + 400), P.y - 400)));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = i.priority === 1 ? '#ff3d3d' : i.priority === 2 ? '#ff8a1f' : '#e9c34a';
    ctx.fillRect(-7, -7, 14, 14);
    ctx.restore();
  }
  if (dest) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(tx(dest.x), ty(dest.y), 10, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  // player arrow (heading up)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(R, R - 14);
  ctx.lineTo(R + 9, R + 10);
  ctx.lineTo(R, R + 5);
  ctx.lineTo(R - 9, R + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '600 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', R + Math.sin(-P.h) * (R - 18), R - Math.cos(-P.h) * (R - 18) + 7);
}

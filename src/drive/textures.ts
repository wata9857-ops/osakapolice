// Procedural canvas textures for the 3D street scene.
import * as THREE from 'three';

function cv(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, n = 2400) {
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - 0.5) * amp;
    g.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v) / 255})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

function tex(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export type RoadKind = 'narrow' | 'two' | 'twoY' | 'four' | 'six' | 'one1' | 'one2' | 'one3' | 'motor';

/**
 * Road surface texture. u spans the road width (0 = left edge in travel direction a→b),
 * v runs along the road with one repeat per 12 m (dash period).
 * Japan drives on the left: two-way roads carry a→b traffic on the left half.
 */
export function roadTexture(kind: RoadKind): THREE.CanvasTexture {
  const W = 256, H = 256;
  const { c, g } = cv(W, H);
  noise(g, W, H, kind === 'motor' ? [70, 72, 76] : [58, 60, 63], 40);
  const white = 'rgba(236,236,230,0.92)';
  const yellow = 'rgba(232,180,40,0.95)';
  const line = (u: number, col: string, wpx: number, dashed: boolean) => {
    g.fillStyle = col;
    if (dashed) {
      g.fillRect(u * W - wpx / 2, 0, wpx, H * 0.45);
    } else g.fillRect(u * W - wpx / 2, 0, wpx, H);
  };
  const edge = 0.035;
  switch (kind) {
    case 'narrow':
      line(edge, white, 3, false);
      line(1 - edge, white, 3, false);
      break;
    case 'two':
      line(edge, white, 4, false);
      line(1 - edge, white, 4, false);
      line(0.5, white, 5, true);
      break;
    case 'twoY':
      line(edge, white, 4, false);
      line(1 - edge, white, 4, false);
      line(0.5, yellow, 6, false);
      break;
    case 'four':
      line(edge, white, 4, false);
      line(1 - edge, white, 4, false);
      line(0.25, white, 4, true);
      line(0.75, white, 4, true);
      line(0.49, yellow, 4, false);
      line(0.51, yellow, 4, false);
      break;
    case 'six':
      line(edge, white, 3, false);
      line(1 - edge, white, 3, false);
      for (const u of [1 / 6, 2 / 6, 4 / 6, 5 / 6]) line(u, white, 3, true);
      line(0.49, yellow, 3, false);
      line(0.51, yellow, 3, false);
      break;
    case 'one1':
      line(edge, white, 4, false);
      line(1 - edge, white, 4, false);
      break;
    case 'one2':
      line(edge, white, 4, false);
      line(1 - edge, white, 4, false);
      line(0.5, white, 4, true);
      break;
    case 'one3':
    case 'motor':
      line(edge, white, 4, false);
      line(1 - edge, white, 4, false);
      line(1 / 3, white, 4, true);
      line(2 / 3, white, 4, true);
      break;
  }
  return tex(c);
}

export function asphaltTexture() {
  const { c, g } = cv(128, 128);
  noise(g, 128, 128, [58, 60, 63], 40, 800);
  return tex(c);
}

export function crosswalkTexture() {
  const { c, g } = cv(128, 64);
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, 128, 64);
  g.fillStyle = 'rgba(236,236,230,0.9)';
  for (let i = 0; i < 4; i++) g.fillRect(i * 32 + 6, 0, 18, 64);
  return tex(c);
}

export function sidewalkTexture() {
  const { c, g } = cv(128, 128);
  noise(g, 128, 128, [150, 148, 142], 30, 600);
  g.strokeStyle = 'rgba(80,80,80,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i <= 128; i += 32) {
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(128, i);
    g.stroke();
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.stroke();
  }
  return tex(c);
}

/** facade: 8×8 window cells (3 m wide × 3.3 m tall each) */
export function facadeTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const N = 8, S = 48;
  const { c, g } = cv(N * S, N * S);
  const e = cv(N * S, N * S);
  g.fillStyle = '#d8d6d0';
  g.fillRect(0, 0, N * S, N * S);
  e.g.fillStyle = '#000';
  e.g.fillRect(0, 0, N * S, N * S);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = i * S, y = j * S;
      // slab band
      g.fillStyle = 'rgba(0,0,0,0.08)';
      g.fillRect(x, y + S - 6, S, 6);
      // window
      const glass = 40 + Math.random() * 30;
      g.fillStyle = `rgb(${glass},${glass + 8},${glass + 18})`;
      g.fillRect(x + 6, y + 8, S - 12, S - 20);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x + 6, y + 8, (S - 12) / 2, S - 20);
      if (Math.random() < 0.38) {
        const warm = Math.random() < 0.7;
        e.g.fillStyle = warm ? `rgb(255,${200 + Math.random() * 40},${120 + Math.random() * 60})` : `rgb(${190 + Math.random() * 40},220,255)`;
        e.g.fillRect(x + 6, y + 8, S - 12, S - 20);
      }
    }
  return { map: tex(c), emissive: tex(e.c) };
}

/** low-rise facade: 4x4 cells (3 m x 2.9 m) - houses, shops, small apartments */
export function houseTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const N = 4, S = 64;
  const { c, g } = cv(N * S, N * S);
  const e = cv(N * S, N * S);
  g.fillStyle = '#e4ddd0';
  g.fillRect(0, 0, N * S, N * S);
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * N * S, Math.random() * N * S, 2, 2);
  }
  e.g.fillStyle = '#000';
  e.g.fillRect(0, 0, N * S, N * S);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const x = i * S, y = j * S;
      const ground = j === N - 1;
      if (ground && i % 2 === 0) {
        // shutter / shop front on the ground floor
        g.fillStyle = '#8f9396';
        g.fillRect(x + 6, y + 18, S - 12, S - 18);
        g.fillStyle = 'rgba(0,0,0,0.15)';
        for (let k = y + 20; k < y + S; k += 4) g.fillRect(x + 6, k, S - 12, 1);
        continue;
      }
      if (Math.random() < 0.25) continue;
      const w = 22 + Math.random() * 14, h = 18 + Math.random() * 10;
      const wx = x + (S - w) / 2, wy = y + 14;
      g.fillStyle = '#6d6a64';
      g.fillRect(wx - 2, wy - 2, w + 4, h + 4);
      g.fillStyle = '#2d3640';
      g.fillRect(wx, wy, w, h);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(wx, wy, w / 2, h);
      if (Math.random() < 0.45) {
        e.g.fillStyle = `rgb(255,${190 + Math.random() * 50},${110 + Math.random() * 60})`;
        e.g.fillRect(wx, wy, w, h);
      }
    }
  return { map: tex(c), emissive: tex(e.c) };
}

export function groundTexture() {
  const { c, g } = cv(256, 256);
  noise(g, 256, 256, [92, 94, 92], 30, 3000);
  return tex(c);
}

// Canvas-drawn map symbols, regenerated per theme.
import type { Map as MLMap } from 'maplibre-gl';
import type { MapPalette } from './palette';
import { STATUS_LABEL, type UnitStatus } from '../sim/types';

const PR = 2; // pixel ratio of generated images

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w * PR;
  c.height = h * PR;
  const ctx = c.getContext('2d')!;
  ctx.scale(PR, PR);
  return { c, ctx };
}

function put(map: MLMap, name: string, c: HTMLCanvasElement) {
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  if (map.hasImage(name)) map.updateImage(name, data);
  else map.addImage(name, data, { pixelRatio: PR });
}

export function registerIcons(map: MLMap, p: MapPalette, dark: boolean) {
  const outline = dark ? '#05080b' : '#ffffff';
  const statuses = Object.keys(STATUS_LABEL) as UnitStatus[];
  for (const st of statuses) {
    const col = p.status[st];
    // patrol car: chevron
    {
      const { c, ctx } = canvas(30, 30);
      ctx.translate(15, 15);
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(9.5, 10);
      ctx.lineTo(0, 5);
      ctx.lineTo(-9.5, 10);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fill();
      put(map, `u-pc-${st}`, c);
    }
    // mobile patrol (自ら隊): chevron with centre bar
    {
      const { c, ctx } = canvas(30, 30);
      ctx.translate(15, 15);
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(10.5, 11);
      ctx.lineTo(0, 5.5);
      ctx.lineTo(-10.5, 11);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.fillStyle = outline;
      ctx.fillRect(-1.2, -6, 2.4, 9);
      put(map, `u-jiraku-${st}`, c);
    }
    // investigators (unmarked): hollow chevron
    {
      const { c, ctx } = canvas(30, 30);
      ctx.translate(15, 15);
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(9.5, 10);
      ctx.lineTo(0, 5);
      ctx.lineTo(-9.5, 10);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5.5;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = col;
      ctx.stroke();
      put(map, `u-kisou-${st}`, c);
    }
    // motorcycle: slim arrow
    {
      const { c, ctx } = canvas(24, 30);
      ctx.translate(12, 15);
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(6, 6);
      ctx.lineTo(2, 11);
      ctx.lineTo(-2, 11);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fill();
      put(map, `u-kotsu-${st}`, c);
    }
    // kōban officers: small square dot
    {
      const { c, ctx } = canvas(14, 14);
      ctx.fillStyle = outline;
      ctx.fillRect(1, 1, 12, 12);
      ctx.fillStyle = col;
      ctx.fillRect(3, 3, 8, 8);
      put(map, `u-koban-${st}`, c);
    }
  }
  // facilities
  const fac = (name: string, size: number, ch: string, bg: string, fg: string) => {
    const { c, ctx } = canvas(size, size);
    ctx.fillStyle = outline;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = bg;
    ctx.fillRect(1.5, 1.5, size - 3, size - 3);
    ctx.fillStyle = fg;
    ctx.font = `700 ${Math.round(size * 0.62)}px "Hiragino Sans", "Noto Sans JP", "Meiryo", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, size / 2, size / 2 + 0.5);
    put(map, name, c);
  };
  fac('f-station', 22, '署', p.facility, p.facilityTx);
  fac('f-hq', 26, '本', dark ? '#ffb000' : '#b86e00', dark ? '#1a1200' : '#fff');
  fac('f-unitbase', 20, '隊', p.facility, p.facilityTx);
  fac('f-koban', 15, '交', dark ? '#1b2833' : '#ffffff', p.koban);
  fac('f-chuzaisho', 15, '駐', dark ? '#1b2833' : '#ffffff', p.koban);
  // incidents: diamond by priority
  for (const pr of [1, 2, 3, 4]) {
    for (const hollow of [false, true]) {
      const { c, ctx } = canvas(30, 30);
      ctx.translate(15, 15);
      ctx.beginPath();
      ctx.moveTo(0, -12.5);
      ctx.lineTo(12.5, 0);
      ctx.lineTo(0, 12.5);
      ctx.lineTo(-12.5, 0);
      ctx.closePath();
      ctx.lineWidth = 4;
      ctx.strokeStyle = outline;
      ctx.stroke();
      if (hollow) {
        ctx.fillStyle = dark ? '#111820' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = p.pri[pr];
        ctx.stroke();
      } else {
        ctx.fillStyle = p.pri[pr];
        ctx.fill();
      }
      ctx.fillStyle = hollow ? p.pri[pr] : pr >= 3 ? '#151a1e' : '#ffffff';
      ctx.font = `800 12px "SF Mono", Menlo, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(pr), 0, 1);
      put(map, `i-${pr}${hollow ? 'h' : ''}`, c);
    }
  }
  // closed incident marker
  {
    const { c, ctx } = canvas(16, 16);
    ctx.translate(8, 8);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(6, 0);
    ctx.lineTo(0, 6);
    ctx.lineTo(-6, 0);
    ctx.closePath();
    ctx.fillStyle = dark ? '#3a4652' : '#a3adb5';
    ctx.fill();
    put(map, 'i-closed', c);
  }
  // waypoint / pick marker
  {
    const { c, ctx } = canvas(22, 22);
    ctx.translate(11, 11);
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = outline;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fillStyle = p.route;
    ctx.fill();
    put(map, 'pick', c);
  }
  {
    const { c, ctx } = canvas(18, 18);
    ctx.translate(9, 9);
    ctx.fillStyle = outline;
    ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = p.patrol;
    ctx.fillRect(-5, -5, 10, 10);
    put(map, 'wp', c);
  }
  {
    const { c, ctx } = canvas(10, 10);
    ctx.beginPath();
    ctx.arc(5, 5, 3, 0, Math.PI * 2);
    ctx.fillStyle = dark ? '#7f8d99' : '#5f6c76';
    ctx.fill();
    put(map, 'lm-dot', c);
  }
}

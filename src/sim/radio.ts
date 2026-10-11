// Phrase generation for police radio traffic (大阪府警 通信指令本部 ⇔ 各移動).
// Phrases are composed from context so that messages reflect the simulation state.
import type { Incident, Unit } from './types';

export const HQ = '本部';

let rng: () => number = Math.random;
export function setRadioRng(r: () => number) {
  rng = r;
}
const pick = <T,>(a: T[]): T => a[Math.floor(rng() * a.length)];

export function fmtMin(sec: number) {
  if (!isFinite(sec)) return '不明';
  const m = Math.max(1, Math.round(sec / 60));
  return `${m}分`;
}

const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
export function dirName(dx: number, dy: number) {
  const a = Math.atan2(dx, dy); // 0 = north
  const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return DIRS[i];
}

export function dispatchOrder(inc: Incident, units: Unit[], emergency: boolean): string {
  const cs = units.map((u) => u.callsign).join('、');
  const head = inc.priority <= 1 ? pick(['至急、至急。', '至急報。', '']) : '';
  const lead = units.length > 1 ? pick(['本部から各移動。', '本部から関係各移動。']) : `本部から${units[0].callsign}。`;
  const what = `${inc.address}にて${inc.name.replace(/（.*?）/, '')}${pick(['の110番', '事案', 'の通報'])}。`;
  const det = inc.detail ? `${inc.detail}。` : '';
  const sus = inc.suspect && inc.suspect.free ? `マル被は${inc.suspect.desc}、${inc.suspect.lastSeen ? dirName(inc.suspect.lastSeen.x - inc.x, inc.suspect.lastSeen.y - inc.y) + '方向へ逃走中' : '逃走方向不明'}。` : '';
  const order =
    units.length > 1
      ? `${cs}は${emergency ? '緊急走行で' : ''}現場へ${pick(['向かえ', '急行せよ', '臨場せよ'])}。`
      : `${emergency ? '緊急走行で' : ''}現場${pick(['へ向かえ', '臨場願いたい', '急行願う'])}。`;
  return `${head}${lead}${what}${det}${sus}${order}${pick(['どうぞ。', 'どうぞ。', '以上。'])}`;
}

export function ackDispatch(u: Unit, place: string, eta: number, emergency: boolean): string {
  const loc = place ? `現在${place}、` : '';
  return pick([
    `${u.callsign}了解。${loc}${emergency ? '緊急走行で' : ''}向かう、到着まで約${fmtMin(eta)}。`,
    `${u.callsign}、了解。${loc}現場まで約${fmtMin(eta)}。`,
    `${u.callsign}了解、${emergency ? '赤色灯にて' : ''}転進する。所要約${fmtMin(eta)}。`,
  ]);
}

export function arrival(u: Unit, inc: Incident, first: boolean): string {
  if (!first)
    return pick([`${u.callsign}現着。先着隊と合流する。`, `${u.callsign}、現着。応援に入る。`, `${u.callsign}現着、${inc.onScene.length + 1}台目。`]);
  const tail: Record<string, string[]> = {
    acc_prop: ['当事者と接触する。', '車両2台を確認、けが人なしの模様。'],
    acc_inj: ['負傷者1名を確認、救急隊未着。', '交通整理を開始する。'],
    acc_major: ['現場は大規模な事故、通行止め措置を開始する。'],
    snatch: ['マル害と接触、事情聴取する。'],
    robbery: ['店員と接触、店内にマル被なし。', '現場保存にかかる。'],
    assault: ['マル害は意識あり、頭部から出血。', '当事者を分離する。'],
    fight: ['当事者らを確認、引き離す。'],
    drunk: ['該当の男性を確認、呼びかけに反応あり。'],
    suspicious: ['付近を検索する。'],
    shoplift: ['保安員と接触する。'],
    burglary: ['現場保存にかかる。'],
    dv: ['室内に入り当事者を確認する。'],
    knife: ['マル被を視認、距離をとって説得にかかる。'],
    noise: ['騒音を確認、関係者と接触する。'],
    lost: ['保護者と接触、特徴を確認する。'],
    fire: ['交通規制を開始する。'],
    signal: ['信号滅灯を確認、手信号にて整理する。'],
    bosozoku: ['集団は既に移動した模様。'],
  };
  const t = tail[inc.type] ?? ['これより対応する。'];
  return `${u.callsign}から${HQ}。${pick(['現着。', '現着、現着。', '只今現着。'])}${pick(t)}`;
}

export function backupRequest(u: Unit, inc: Incident, need: number): string {
  return pick([
    `${u.callsign}から${HQ}。現場は${inc.onScene.length}名では対応困難、応援${need}台求む。`,
    `${u.callsign}から${HQ}、至急応援願いたい。あと${need}台。`,
    `${u.callsign}、応援要請。${inc.name.replace(/（.*?）/, '')}、当事者多数につき応援求む。`,
  ]);
}

export function resolved(u: Unit, inc: Incident): string {
  return `${u.callsign}から${HQ}。${inc.outcome}。${pick(['以上、事案終了。', '本件終了、引き揚げる。', '終了する。'])}`;
}

export function hqAck(cs: string): string {
  return pick([`${HQ}了解。`, `${HQ}、${cs}了解。`, `了解。`]);
}

export function fleeingUpdate(inc: Incident, dx: number, dy: number): string {
  const d = dirName(dx, dy);
  return pick([
    `${HQ}から各移動。${inc.address}の${inc.name.replace(/（.*?）/, '')}、続報。マル被は${inc.suspect!.desc}、${d}方向へ逃走した模様。付近移動は留意せよ。`,
    `続報。マル被は${modeWord(inc.suspect!.mode)}で${d}方向へ逃走、${inc.suspect!.desc}。`,
  ]);
}

export function modeWord(m: string) {
  return m === 'foot' ? '徒歩' : m === 'bike' ? '自転車' : m === 'moto' ? 'バイク' : '車両';
}

export function spotted(u: Unit, place: string): string {
  return pick([
    `${u.callsign}から${HQ}！マル被らしき者を発見、${place}、追跡する！`,
    `${u.callsign}、該当者発見！${place}、これより追尾する。`,
  ]);
}

export function caught(u: Unit, place: string): string {
  return pick([
    `${u.callsign}から${HQ}。${place}でマル被確保！確保！`,
    `${u.callsign}、マル被確保。${place}、けが人なし。`,
    `${u.callsign}から${HQ}、マル被を確保した。これより署へ連行する。`,
  ]);
}

export function lostSight(u: Unit): string {
  return pick([`${u.callsign}、マル被を見失った。付近を検索する。`, `${u.callsign}、失尾した。周辺を検索継続。`]);
}

export function searchStart(u: Unit): string {
  return pick([
    `${u.callsign}現着、マル被は既に逃走。付近を検索する。`,
    `${u.callsign}、マル被の姿なし。周辺検索にかかる。`,
    `${u.callsign}から${HQ}、現着時マル被なし、検索開始。`,
  ]);
}

export function patrolStart(u: Unit, area: string): string {
  return pick([`${u.callsign}、${area}の警らに入る。`, `${u.callsign}から${HQ}、これより${area}方面警ら。`, `${u.callsign}、${area}警ら開始。`]);
}

export function returning(u: Unit, where: string): string {
  return pick([`${u.callsign}、${where}へ引き揚げる。`, `${u.callsign}、${where}へ帰る。`, `${u.callsign}から${HQ}、${where}へ戻る。`]);
}

export function transportMsg(u: Unit, station: string, what: string): string {
  return pick([`${u.callsign}、${what}を${station}へ${what === 'マル被' ? '連行' : '同行'}する。`, `${u.callsign}から${HQ}、${station}へ${what}を搬送する。`]);
}

export function cancelOrder(u: Unit): string {
  return pick([`${HQ}から${u.callsign}。先の指令は解除、通常勤務に戻れ。`, `${HQ}から${u.callsign}、指令解除。`]);
}

export function cancelAck(u: Unit): string {
  return pick([`${u.callsign}了解。`, `${u.callsign}、了解、解除。`]);
}

export function redirectOrder(u: Unit, inc: Incident): string {
  return `${HQ}から${u.callsign}。現在の任務を中断し、${inc.address}の${inc.name.replace(/（.*?）/, '')}へ転進せよ。`;
}

export function moveOrder(u: Unit, place: string, hold: boolean): string {
  return hold ? `${HQ}から${u.callsign}。${place}にて停留警戒、検問にあたれ。` : `${HQ}から${u.callsign}。${place}へ移動せよ。`;
}

export function cordonOrder(inc: Incident, units: Unit[]): string {
  return `${HQ}から各移動。${inc.name.replace(/（.*?）/, '')}に伴い緊急配備を発令する。${units.map((u) => u.callsign).join('、')}は所定の配備位置につけ。マル被は${inc.suspect?.desc ?? '不明'}。`;
}

export function escalationCall(inc: Incident, text: string): string {
  return `${HQ}から各移動。${inc.address}の事案、${text}。`;
}

export function officeDone(u: Unit): string {
  return pick([`${u.callsign}、書類処理終了、警らに出る。`, `${u.callsign}、署内処理完了、再出向する。`]);
}

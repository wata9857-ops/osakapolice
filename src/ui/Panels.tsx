import { useEffect, useRef, useState } from 'react';
import { useSim, useSimTick } from './hooks';
import { getUI, setUI, useUI, select, flyTo, toast } from './store';
import { IncidentDetail } from './IncidentDetail';
import { UnitDetail, pendingPatrol } from './UnitDetail';
import { UnitRow } from './Lists';
import type { RadioMsg } from '../sim/types';
import { areaPlan } from '../sim/units';
import { INCIDENT_TYPES } from '../sim/incidentTypes';
import { EVENT_DEFS, startEvent } from '../sim/events';
import { snapWaypoints } from './util';

export function DetailPanel() {
  const sim = useSim();
  const sel = useUI((s) => s.selected);
  useSimTick(1);
  if (!sel)
    return (
      <div className="detail">
        <div className="empty" style={{ marginTop: 40 }}>
          地図上の事案（◆）・部隊（▲）・警察署をタップ、
          <br />
          または一覧から選択すると詳細と操作が表示されます。
        </div>
      </div>
    );
  if (sel.kind === 'incident') {
    const inc = sim.incById.get(sel.id);
    return inc ? <IncidentDetail inc={inc} /> : null;
  }
  if (sel.kind === 'unit') {
    const u = sim.unitById.get(sel.id);
    return u ? <UnitDetail u={u} /> : null;
  }
  const f = sim.world.facilities.find((x) => String(x.id) === sel.id);
  if (!f) return null;
  const units = sim.units.filter((u) => u.baseId === f.id || (f.kind === 'station' && u.stationId === f.id && u.kind !== 'koban'));
  const kobans = f.kind === 'station' ? sim.world.kobans.filter((k) => k.station === f.id) : [];
  const kindL = { hq: '警察本部', station: '警察署', koban: '交番', chuzaisho: '駐在所', unitbase: '部隊拠点', other: '施設' }[f.kind];
  return (
    <div className="detail">
      <div className="detail-head">
        <div className="dh-kicker">{kindL}</div>
        <div className="dh-title">{f.name}</div>
        <div className="dh-sub">{sim.world.describe(f.x, f.y)}</div>
        <button className="btn ghost icon-btn close" onClick={() => select(null)}>
          ✕
        </button>
      </div>
      <div className="scroll">
        <div className="section-h">
          <span>配置部隊</span>
          <span className="mono">{units.length}</span>
        </div>
        {units.map((u) => (
          <UnitRow key={u.id} u={u} sel={false} />
        ))}
        {kobans.length > 0 && (
          <>
            <div className="section-h">
              <span>管内の交番・駐在所</span>
              <span className="mono">{kobans.length}</span>
            </div>
            {kobans.map((k) => (
              <div key={k.id} className="row" style={{ minHeight: 44 }} onClick={() => (select({ kind: 'facility', id: String(k.id) }), flyTo(k.x, k.y, 16))}>
                <div className="stripe" style={{ background: 'var(--blue)' }} />
                <div className="row-body">
                  <div className="row-title">{k.name.replace(/^.*警察署\s*/, '')}</div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="action-bar">
        <button className="btn wide" onClick={() => flyTo(f.x, f.y, 16)}>
          地図で表示
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ radio
type RF = 'all' | 'order' | 'field' | 'urgent' | 'sel';

export function RadioPanel({ phone = false }: { phone?: boolean }) {
  const sim = useSim();
  useSimTick(3);
  const size = useUI((s) => s.radio);
  const sel = useUI((s) => s.selected);
  const speech = useUI((s) => s.speech);
  const [f, setF] = useState<RF>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [hl, setHl] = useState<number | null>(null);
  const last = sim.radio[sim.radio.length - 1];
  const [rx, setRx] = useState(false);
  useEffect(() => {
    setRx(true);
    const t = setTimeout(() => setRx(false), 600);
    return () => clearTimeout(t);
  }, [last?.id]);
  let msgs = sim.radio;
  if (f === 'order') msgs = msgs.filter((m) => m.from === '本部');
  else if (f === 'field') msgs = msgs.filter((m) => m.from !== '本部' && m.level !== 'system');
  else if (f === 'urgent') msgs = msgs.filter((m) => m.level === 'urgent');
  else if (f === 'sel' && sel) msgs = msgs.filter((m) => (sel.kind === 'unit' ? m.unitId === sel.id : m.incidentId === sel.id));
  msgs = msgs.slice(-250);
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  const open = (m: RadioMsg) => {
    setHl(m.id);
    if (m.incidentId && sim.incById.has(m.incidentId) && !m.unitId) {
      const i = sim.incById.get(m.incidentId)!;
      select({ kind: 'incident', id: i.id });
      flyTo(i.x, i.y);
    } else if (m.unitId && sim.unitById.has(m.unitId)) {
      const u = sim.unitById.get(m.unitId)!;
      select({ kind: 'unit', id: u.id });
      flyTo(u.x, u.y);
    } else if (m.incidentId && sim.incById.has(m.incidentId)) {
      const i = sim.incById.get(m.incidentId)!;
      select({ kind: 'incident', id: i.id });
      flyTo(i.x, i.y);
    }
  };
  const chips: [RF, string][] = [
    ['all', '全て'],
    ['order', '指令'],
    ['field', '現場'],
    ['urgent', '至急'],
    ['sel', '選択中'],
  ];
  const showList = phone || size !== 'min';
  return (
    <>
      <div className="radio-head">
        <span className="ttl">
          <i className={`rx ${rx ? 'on' : ''}`} />
          無線
        </span>
        {!showList && last ? (
          <div className="radio-ticker" onClick={() => setUI({ radio: 'mid' })}>
            <span className="mono muted">{sim.clockStr(last.t)} </span>
            <b style={{ color: last.from === '本部' ? 'var(--acc)' : undefined }}>{last.from}</b> {last.text}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 4, flex: 1, overflowX: 'auto', minWidth: 0 }}>
            {chips.map(([k, l]) => (
              <button key={k} className={`chip ${f === k ? 'on' : ''}`} style={{ minHeight: 26, padding: '0 8px', fontSize: 12 }} onClick={() => setF(k)}>
                {l}
              </button>
            ))}
          </div>
        )}
        <button className={`btn ghost xs ${speech ? 'on' : ''}`} title="音声読み上げ" onClick={() => setUI({ speech: !speech })}>
          {speech ? '🔊' : '🔈'}
        </button>
        {!phone && (
          <>
            <button className="btn ghost xs icon-btn" disabled={size === 'max'} onClick={() => setUI({ radio: size === 'min' ? 'mid' : 'max' })} aria-label="無線欄を拡大">
              ▲
            </button>
            <button className="btn ghost xs icon-btn" disabled={size === 'min'} onClick={() => setUI({ radio: size === 'max' ? 'mid' : 'min' })} aria-label="無線欄を縮小">
              ▼
            </button>
          </>
        )}
      </div>
      {showList && (
        <div
          className="radio-list"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {msgs.map((m) => (
            <div key={m.id} className={`rmsg ${m.from === '本部' ? 'hq' : ''} ${m.level} ${hl === m.id ? 'hl' : ''}`} onClick={() => open(m)}>
              <span className="rt">{sim.clockStr(m.t)}</span>
              <span className="rf">
                {m.from}
                {m.to && (
                  <>
                    <span className="arrow"> → </span>
                    {m.to}
                  </>
                )}
              </span>
              <span className="rtx">{m.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ speech
export function useRadioSpeech() {
  const sim = useSim();
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const off = sim.on((type, payload) => {
      if (type !== 'radio' || !getUI().speech) return;
      const m = payload as RadioMsg;
      if (m.level === 'system') return;
      const synth = window.speechSynthesis;
      if (synth.pending) synth.cancel();
      const u = new SpeechSynthesisUtterance(m.text.replace(/マル被/g, 'まるひ').replace(/マル害/g, 'まるがい').replace(/PB/g, 'ピービー'));
      u.lang = 'ja-JP';
      u.rate = 1.25;
      u.pitch = m.from === '本部' ? 0.9 : 1.1;
      u.volume = 0.9;
      synth.speak(u);
    });
    return () => {
      off();
    };
  }, [sim]);
}

// ------------------------------------------------------------------ map mode banner
export function ModeBanner() {
  const sim = useSim();
  const mode = useUI((s) => s.mapMode);
  const emergency = useUI((s) => s.emergency);
  if (!mode) return null;
  const u = 'unitId' in mode ? sim.unitById.get(mode.unitId) : null;
  const cancel = () => setUI({ mapMode: null });
  let title = '', subtitle = '';
  let actions: React.ReactNode = null;
  switch (mode.kind) {
    case 'via':
      title = `${u?.callsign} 経由地を地図上でタップ（${mode.points.length}点）`;
      subtitle = mode.incidentId ? '決定で経由地を通る経路で出動指令' : '決定で経由地を通る経路に変更';
      actions = (
        <>
          <button className="btn sm" disabled={!mode.points.length} onClick={() => setUI({ mapMode: { ...mode, points: mode.points.slice(0, -1) } })}>
            戻す
          </button>
          <button
            className="btn sm primary"
            onClick={() => {
              if (mode.incidentId) {
                sim.dispatch([mode.unitId], mode.incidentId, { emergency, via: mode.points });
                setUI({ dispatchFor: null, dispatchPick: [] });
              } else sim.reroute(mode.unitId, mode.points);
              setUI({ mapMode: null });
            }}
          >
            決定
          </button>
        </>
      );
      break;
    case 'move':
      title = `${u?.callsign} 移動先を地図上でタップ`;
      subtitle = '到着後はその地点で停留警戒';
      break;
    case 'patrolArea':
      title = mode.center ? `${u?.callsign} 警ら範囲 半径${(mode.r / 1000).toFixed(1)}km` : `${u?.callsign} 警ら範囲の中心をタップ`;
      subtitle = '中心は再タップで変更できます';
      actions = (
        <>
          <button className="btn sm icon-btn" onClick={() => setUI({ mapMode: { ...mode, r: Math.max(300, mode.r - 300) } })}>
            −
          </button>
          <button className="btn sm icon-btn" onClick={() => setUI({ mapMode: { ...mode, r: Math.min(6000, mode.r + 300) } })}>
            ＋
          </button>
          <button
            className="btn sm primary"
            disabled={!mode.center}
            onClick={() => {
              const c = mode.center!;
              const ward = sim.world.wardAt(c.x, c.y)?.name ?? '';
              const plan = areaPlan(`${ward}${sim.world.describe(c.x, c.y).replace(ward, '').trim().slice(0, 14)}周辺`, c.x, c.y, mode.r);
              plan.focus = pendingPatrol.focus;
              plan.schedule = pendingPatrol.schedule;
              sim.setPatrol(mode.unitId, plan, true);
              setUI({ mapMode: null });
              toast(`${u?.callsign} 範囲警ら設定`);
            }}
          >
            決定
          </button>
        </>
      );
      break;
    case 'patrolRoute':
      title = `${u?.callsign} 巡回地点を順にタップ（${mode.points.length}点）`;
      subtitle = '2点以上で決定。経路を周回します';
      actions = (
        <>
          <button className="btn sm" disabled={!mode.points.length} onClick={() => setUI({ mapMode: { ...mode, points: mode.points.slice(0, -1) } })}>
            戻す
          </button>
          <button
            className="btn sm primary"
            disabled={mode.points.length < 2}
            onClick={() => {
              const wps = snapWaypoints(sim, mode.points);
              const first = mode.points[0];
              const plan = areaPlan(`巡回経路（${sim.world.wardAt(first.x, first.y)?.name ?? ''}）`, first.x, first.y, 800);
              plan.kind = 'route';
              plan.waypoints = wps;
              plan.focus = pendingPatrol.focus;
              plan.schedule = pendingPatrol.schedule;
              sim.setPatrol(mode.unitId, plan, true);
              setUI({ mapMode: null });
              toast(`${u?.callsign} 巡回経路 ${wps.length}点を設定`);
            }}
          >
            決定
          </button>
        </>
      );
      break;
    case 'spawn':
      title = `訓練事案：${INCIDENT_TYPES.find((t) => t.key === mode.type)?.name} の発生地点をタップ`;
      break;
  }
  return (
    <div className="mode-banner">
      <div style={{ minWidth: 0 }}>
        <div className="mt">{title}</div>
        {subtitle && <div className="ms">{subtitle}</div>}
      </div>
      {actions}
      <button className="btn sm" onClick={cancel}>
        取消
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ toasts
export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const sim = useSim();
  return (
    <div className="toasts" style={{ left: '50%', transform: 'translateX(-50%)', top: 64 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.level}`}
          onClick={() => {
            if (t.incidentId && sim.incById.has(t.incidentId)) {
              const i = sim.incById.get(t.incidentId)!;
              select({ kind: 'incident', id: i.id });
              flyTo(i.x, i.y);
            }
            setUI((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }));
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ menus
const EVENT_LABEL: Record<string, string> = {
  rain: '大雨', baseball: '京セラドーム試合終了', fireworks: 'なにわ淀川花火大会', tenjin: '天神祭', dotonbori: '道頓堀に群衆',
  usj: 'USJ閉園混雑', halloween: 'ハロウィン（アメ村）', series_snatch: 'ひったくり続発', fugitive: '指名手配犯の目撃',
  blackout: '大規模停電', pursuit: '盗難車両の進入', expressway: '阪神高速通行止め', vip: '要人来阪', friday: '週末の夜',
};
function Sw({ on, label, sub, onClick }: { on: boolean; label: string; sub?: string; onClick: () => void }) {
  return (
    <div className="switch-row" onClick={onClick}>
      <div>
        <div>{label}</div>
        {sub && <div className="small muted">{sub}</div>}
      </div>
      <div className={`switch ${on ? 'on' : ''}`} />
    </div>
  );
}

export function Menus({ onNewGame, onSave }: { onNewGame: () => void; onSave: () => void }) {
  const sim = useSim();
  useSimTick(2);
  const menu = useUI((s) => s.menu);
  const layers = useUI((s) => s.layers);
  const theme = useUI((s) => s.theme);
  const speech = useUI((s) => s.speech);
  const sfxOn = useUI((s) => s.sfx);
  const [spawnType, setSpawnType] = useState(INCIDENT_TYPES[0].key);
  const [evKey, setEvKey] = useState(EVENT_DEFS[0].key);
  if (!menu) return null;
  const close = () => setUI({ menu: null });
  const L = (k: keyof typeof layers) => () => setUI({ layers: { ...layers, [k]: !layers[k] } });
  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="menu">
        <div className="menu-h">
          <span>{menu === 'layers' ? '表示レイヤー' : 'メニュー'}</span>
          <button className="btn ghost icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        {menu === 'layers' && (
          <>
            <Sw on={layers.traffic} label="交通状況" sub="幹線道路の渋滞（時間帯・事故で変化）" onClick={L('traffic')} />
            <Sw on={layers.routes} label="走行経路" sub="出動・移動中車両のルート" onClick={L('routes')} />
            <Sw on={layers.patrol} label="警ら区域" sub="選択車両の警ら範囲・経路" onClick={L('patrol')} />
            <Sw on={layers.koban} label="交番・交番勤務員" onClick={L('koban')} />
            <Sw on={layers.wards} label="区境界・区名" onClick={L('wards')} />
            <Sw on={layers.landmarks} label="ランドマーク・駅" onClick={L('landmarks')} />
            <div className="block small muted">
              ▲所轄PC ▲(線入)自ら隊 △機捜 ↑交機 ■交番 ◆事案（数字=優先度） 署=警察署
            </div>
          </>
        )}
        {menu === 'main' && (
          <>
            <div className="block">
              <div className="block-h">時間倍率</div>
              <div className="seg">
                {[1, 2, 4, 8, 16].map((s) => (
                  <button
                    key={s}
                    className={!sim.paused && sim.speed === s ? 'on' : ''}
                    onClick={() => {
                      sim.paused = false;
                      sim.speed = s;
                      sim.emit('change');
                    }}
                  >
                    ×{s}
                  </button>
                ))}
                <button
                  className={sim.paused ? 'on' : ''}
                  onClick={() => {
                    sim.paused = !sim.paused;
                    sim.emit('change');
                  }}
                >
                  停止
                </button>
              </div>
            </div>
            <div className="block">
              <div className="block-h">110番入電頻度</div>
              <div className="seg">
                {(
                  [
                    [0.5, '少'],
                    [1, '標準'],
                    [1.6, '多'],
                    [2.5, '繁忙'],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    className={sim.settings.rate === v ? 'on' : ''}
                    onClick={() => {
                      sim.settings.rate = v;
                      sim.emit('change');
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="block">
              <div className="block-h">自動指令（AUTO）</div>
              <div className="seg">
                {(
                  [
                    ['off', '切'],
                    ['assist', '無操作時'],
                    ['full', '全自動'],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    className={sim.settings.auto === k ? 'on' : ''}
                    onClick={() => {
                      sim.settings.auto = k;
                      sim.markActive();
                      sim.emit('change');
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {sim.settings.auto === 'assist' && (
                <>
                  <div className="small muted" style={{ margin: '8px 0 4px' }}>
                    操作がない状態が続くと自動で指令・応援・緊急配備・警らを実施（自動指令の事案は評価点が1/4）
                  </div>
                  <div className="seg">
                    {[20, 45, 90, 180].map((d) => (
                      <button
                        key={d}
                        className={sim.settings.autoDelay === d ? 'on' : ''}
                        onClick={() => {
                          sim.settings.autoDelay = d;
                          sim.emit('change');
                        }}
                      >
                        {d < 60 ? `${d}秒` : `${d / 60}分`}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <Sw
              on={sim.settings.events}
              label="情勢イベント"
              sub="大雨・花火大会・試合終了・連続ひったくり・手配犯・停電・追跡など"
              onClick={() => {
                sim.settings.events = !sim.settings.events;
                sim.emit('change');
              }}
            />
            <Sw on={sfxOn} label="効果音" sub="入電チャイム・至急アラート・解決音" onClick={() => setUI({ sfx: !sfxOn })} />
            <Sw on={theme === 'dark'} label="ダークモード" sub="夜間の指令室向け" onClick={() => setUI({ theme: theme === 'dark' ? 'light' : 'dark' })} />
            <Sw on={speech} label="無線の音声読み上げ" sub="端末の日本語音声を使用" onClick={() => setUI({ speech: !speech })} />
            <Sw
              on={sim.settings.autoReturn}
              label="任務終了後の自動復帰"
              sub="オフ：終了した部隊はその場で指示待ち"
              onClick={() => {
                sim.settings.autoReturn = !sim.settings.autoReturn;
                sim.emit('change');
              }}
            />
            <div className="block">
              <div className="block-h">訓練：事案を手動発生</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={spawnType}
                  onChange={(e) => setSpawnType(e.target.value)}
                  style={{ flex: 1, minHeight: 40, background: 'var(--bg2)', color: 'var(--tx0)', border: '1px solid var(--line2)', fontSize: 14 }}
                >
                  {INCIDENT_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn sm"
                  onClick={() => {
                    setUI({ menu: null, mapMode: { kind: 'spawn', type: spawnType } });
                  }}
                >
                  地点指定
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    const inc = sim.spawnIncident(spawnType);
                    if (inc) {
                      select({ kind: 'incident', id: inc.id });
                      flyTo(inc.x, inc.y);
                    }
                    close();
                  }}
                >
                  ランダム
                </button>
              </div>
            </div>
            <div className="block">
              <div className="block-h">訓練：情勢イベントを発生</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={evKey}
                  onChange={(e) => setEvKey(e.target.value)}
                  style={{ flex: 1, minHeight: 40, background: 'var(--bg2)', color: 'var(--tx0)', border: '1px solid var(--line2)', fontSize: 14 }}
                >
                  {EVENT_DEFS.map((d) => (
                    <option key={d.key} value={d.key}>
                      {EVENT_LABEL[d.key] ?? d.key}
                    </option>
                  ))}
                </select>
                <button
                  className="btn sm"
                  onClick={() => {
                    const ev = startEvent(sim, evKey);
                    if (ev) {
                      sim.say('本部', '各移動', `本部から各移動。${ev.name}。${ev.desc}。`, { level: 'urgent' });
                      sim.emit('event', { ev, end: false });
                      if (ev.x !== undefined) setUI({ flyTo: { x: ev.x, y: ev.y!, zoom: 13, seq: Date.now() } });
                    } else toast('このイベントは現在発生できません');
                    close();
                  }}
                >
                  発生
                </button>
              </div>
            </div>
            <div className="block btn-grid">
              <button
                className="btn"
                onClick={() => {
                  onSave();
                  toast('勤務状況を保存しました');
                }}
              >
                保存
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (confirm('現在の勤務を終了し、新しい勤務を開始しますか？')) onNewGame();
                }}
              >
                新規勤務
              </button>
            </div>
            <div className="block small muted">
              地図データ © OpenStreetMap contributors（ODbL）。道路網・警察署・交番の位置はOSMに基づく。部隊編成・呼出符号・事案は架空のシミュレーションです。
            </div>
          </>
        )}
      </div>
    </>
  );
}

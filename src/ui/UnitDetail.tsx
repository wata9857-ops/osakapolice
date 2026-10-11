import { useState } from 'react';
import { useSim, useSimTick, fmtMinShort, fmtKm } from './hooks';
import { setUI, useUI, select, flyTo, toast } from './store';
import { STATUS_LABEL, UNIT_KIND_LONG, AVAILABLE, type Unit, type PatrolFocus } from '../sim/types';
import { unitTaskText } from './Lists';
import { wardPlan, areaPlan } from '../sim/units';

const FOCUS: [PatrolFocus, string][] = [
  ['balanced', '均等'],
  ['hotspot', '繁華街重点'],
  ['major', '幹線道路'],
  ['residential', '住宅街'],
];
const SCHED: [string, { start: number; end: number } | null][] = [
  ['常時', null],
  ['日勤 8-17', { start: 8, end: 17 }],
  ['夜間 18-6', { start: 18, end: 6 }],
  ['深夜 22-5', { start: 22, end: 5 }],
];

export function UnitDetail({ u }: { u: Unit }) {
  const sim = useSim();
  useSimTick(3);
  const follow = useUI((s) => s.follow);
  const [sub, setSub] = useState<null | 'incident' | 'patrol'>(null);
  const station = sim.world.facilities.find((f) => f.id === u.stationId);
  const base = sim.world.facilities.find((f) => f.id === u.baseId);
  const eta = u.route ? sim.routeEta(u) : null;
  const rem = u.route ? sim.routeRemaining(u) : 0;
  const inc = u.incidentId ? sim.incById.get(u.incidentId) : null;
  const where = sim.world.describe(u.x, u.y);
  const canDrive = u.kind !== 'koban';

  if (sub === 'incident') return <PickIncident u={u} onDone={() => setSub(null)} />;
  if (sub === 'patrol') return <PatrolEditor u={u} onDone={() => setSub(null)} />;

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="dh-kicker">
          <span>{UNIT_KIND_LONG[u.kind]}</span>
        </div>
        <div className="dh-title">
          {u.callsign}{' '}
          <span className={`st st-${u.status}`} style={{ fontSize: 14, verticalAlign: 3 }}>
            {STATUS_LABEL[u.status]}
          </span>
        </div>
        <div className="dh-sub">{u.vehicle}</div>
        <button className="btn ghost icon-btn close" onClick={() => select(null)} aria-label="閉じる">
          ✕
        </button>
      </div>
      <div className="scroll">
        <div className="kv">
          <div className="k">任務</div>
          <div className="v">
            {unitTaskText(sim, u)}
            {inc && (
              <button className="btn xs" style={{ marginLeft: 6 }} onClick={() => select({ kind: 'incident', id: inc.id })}>
                事案 {inc.id}
              </button>
            )}
          </div>
          <div className="k">現在地</div>
          <div className="v">{where || '—'}</div>
          <div className="k">速度</div>
          <div className="v mono">
            {Math.round(u.v * 3.6)} km/h{u.emergency ? <span style={{ color: 'var(--red)', fontFamily: 'var(--font)' }}> 赤色灯・サイレン</span> : ''}
          </div>
          {eta !== null && (
            <>
              <div className="k">目的地まで</div>
              <div className="v mono">
                {fmtKm(rem)} · 約{fmtMinShort(eta)}
              </div>
            </>
          )}
          <div className="k">所属</div>
          <div className="v">
            {station ? `${station.short}警察署` : '—'}
            {base && base.id !== station?.id ? ` / ${base.name}` : ''}
          </div>
          <div className="k">乗務員</div>
          <div className="v">{u.crew.map((c) => `${c.rank} ${c.name}`).join('、')}</div>
          <div className="k">警ら計画</div>
          <div className="v">
            {u.patrol ? `${u.patrol.areaName}（${u.patrol.kind === 'route' ? `経路${u.patrol.waypoints.length}点` : FOCUS.find((f) => f[0] === u.patrol!.focus)?.[1]}${u.patrol.schedule ? ` ${u.patrol.schedule.start}-${u.patrol.schedule.end}時` : ''}）` : '未設定'}
          </div>
          <div className="k">本日実績</div>
          <div className="v mono">
            出動{u.stats.dispatches} · 検挙{u.stats.arrests} · {u.stats.km.toFixed(1)}km
          </div>
        </div>
        <div className="block">
          <div className="block-h">完了後の行動</div>
          <div className="seg">
            {(
              [
                ['resume', '警ら再開'],
                ['home', '帰署'],
                ['hold', 'その場待機'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                className={u.after === k ? 'on' : ''}
                onClick={() => {
                  u.after = k;
                  sim.emit('change');
                }}
              >
                {l}
              </button>
            ))}
          </div>
          {u.kind !== 'koban' && (
            <>
              <div className="block-h" style={{ marginTop: 10 }}>
                経路選択
              </div>
              <div className="seg">
                {(
                  [
                    ['fast', '最短時間'],
                    ['major', '幹線優先'],
                    ['nomotorway', '高速不使用'],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    className={u.routePref === k ? 'on' : ''}
                    onClick={() => {
                      u.routePref = k;
                      if (u.route && !u.manual) sim.reroute(u.id, u.via);
                      sim.emit('change');
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="block">
          <div className="block-h">直近の無線</div>
          <ul className="timeline">
            {sim.radio
              .filter((m) => m.unitId === u.id)
              .slice(-5)
              .reverse()
              .map((m) => (
                <li key={m.id}>
                  <span className="tt">{sim.clockStr(m.t)}</span>
                  <span>{m.text}</span>
                </li>
              ))}
          </ul>
        </div>
      </div>
      <div className="action-bar">
        <div className="btn-grid">
          <button className="btn primary" onClick={() => setSub('incident')}>
            事案へ出動
          </button>
          <button className="btn" onClick={() => setUI({ mapMode: { kind: 'move', unitId: u.id, hold: true } })}>
            地点へ移動
          </button>
          <button className="btn" onClick={() => setSub('patrol')}>
            警ら設定
          </button>
          {u.route && !u.manual && (u.status === 'enroute' || u.status === 'moving' || u.status === 'returning') ? (
            <button className="btn" onClick={() => setUI({ mapMode: { kind: 'via', unitId: u.id, points: [] } })}>
              経路変更
            </button>
          ) : (
            <button className="btn" onClick={() => sim.startSearch(u.id, u.x, u.y, 500, 15)}>
              周辺検索
            </button>
          )}
          <button className="btn" onClick={() => sim.sendHome(u)}>
            帰署
          </button>
          <button className="btn" onClick={() => sim.setStandby(u.id)}>
            現在地待機
          </button>
          {inc ? (
            <button className="btn danger" onClick={() => sim.cancel(u.id)}>
              指令解除
            </button>
          ) : (
            <button
              className="btn"
              disabled={!u.patrol}
              onClick={() => {
                sim.setPatrol(u.id, u.patrol, true);
              }}
            >
              警ら開始
            </button>
          )}
          <button
            className={`btn ${follow === u.id ? 'on' : ''}`}
            onClick={() => {
              setUI({ follow: follow === u.id ? null : u.id });
              flyTo(u.x, u.y, 15.5);
            }}
          >
            {follow === u.id ? '追従中' : '追従表示'}
          </button>
        </div>
        {canDrive && (
          <button className="btn wide" style={{ borderColor: 'var(--acc)', color: 'var(--acc)' }} onClick={() => setUI({ driving: u.id })}>
            ▶ この車両を運転する（運転席視点）
          </button>
        )}
      </div>
    </div>
  );
}

function PickIncident({ u, onDone }: { u: Unit; onDone: () => void }) {
  const sim = useSim();
  useSimTick(1);
  const emergency = useUI((s) => s.emergency);
  const list = sim
    .activeIncidents()
    .map((i) => ({ i, d: Math.hypot(i.x - u.x, i.y - u.y) }))
    .sort((a, b) => a.i.priority - b.i.priority || a.d - b.d);
  return (
    <div className="detail">
      <div className="detail-head">
        <div className="dh-kicker">{u.callsign} · 出動先選択</div>
        <div className="dh-title" style={{ fontSize: 17 }}>
          事案を選択
        </div>
        <button className="btn ghost icon-btn close" onClick={onDone}>
          ✕
        </button>
      </div>
      <div className="filterbar">
        <button className={`chip ${emergency ? 'on' : ''}`} onClick={() => setUI({ emergency: !emergency })}>
          {emergency ? '● 緊急走行' : '○ 通常走行'}
        </button>
      </div>
      <div className="scroll">
        {list.length === 0 && <div className="empty">対応中の事案はありません</div>}
        {list.map(({ i, d }) => (
          <div
            key={i.id}
            className="row"
            onClick={() => {
              if (u.incidentId === i.id) return onDone();
              sim.dispatch([u.id], i.id, { emergency });
              toast(`${u.callsign} → ${i.name}`, 'info', { incidentId: i.id });
              onDone();
            }}
          >
            <div className="stripe" style={{ background: `var(--p${i.priority})` }} />
            <div className="row-body">
              <div className="row-l1">
                <span className={`pri pri-${i.priority}`}>P{i.priority}</span>
                <span className="row-title">{i.name}</span>
              </div>
              <div className="row-l2">{i.address}</div>
            </div>
            <div className="row-side">
              <span className="mono">{fmtKm(d)}</span>
              <span className="small muted">{i.assigned.length}隊</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PatrolEditor({ u, onDone }: { u: Unit; onDone: () => void }) {
  const sim = useSim();
  const [focus, setFocus] = useState<PatrolFocus>(u.patrol?.focus ?? 'balanced');
  const [sched, setSched] = useState<number>(() => {
    const s = u.patrol?.schedule;
    return s ? Math.max(0, SCHED.findIndex((x) => x[1]?.start === s.start)) : 0;
  });
  const station = sim.world.facilities.find((f) => f.id === u.stationId);
  const wards = sim.world.wards.map((w) => w.name);
  const [ward, setWard] = useState(station?.ward ?? wards[0]);
  const apply = (plan: ReturnType<typeof areaPlan>) => {
    plan.focus = focus;
    plan.schedule = SCHED[sched][1];
    sim.setPatrol(u.id, plan, AVAILABLE.includes(u.status) || u.status === 'office');
    toast(`${u.callsign} 警ら計画を設定：${plan.areaName}`);
    onDone();
  };
  return (
    <div className="detail">
      <div className="detail-head">
        <div className="dh-kicker">{u.callsign} · 警ら計画</div>
        <div className="dh-title" style={{ fontSize: 17 }}>
          警ら設定
        </div>
        <button className="btn ghost icon-btn close" onClick={onDone}>
          ✕
        </button>
      </div>
      <div className="scroll">
        <div className="block">
          <div className="block-h">重点</div>
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {FOCUS.map(([k, l]) => (
              <button key={k} className={focus === k ? 'on' : ''} onClick={() => setFocus(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="block-h" style={{ marginTop: 12 }}>
            実施時間帯
          </div>
          <div className="seg" style={{ flexWrap: 'wrap' }}>
            {SCHED.map(([l], i) => (
              <button key={l} className={sched === i ? 'on' : ''} onClick={() => setSched(i)}>
                {l}
              </button>
            ))}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            時間帯外は所属へ戻り待機し、開始時刻に自動で警らを開始します。
          </div>
        </div>
        <div className="block">
          <div className="block-h">区域警ら（区単位）</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={ward}
              onChange={(e) => setWard(e.target.value)}
              style={{ flex: 1, minHeight: 44, background: 'var(--bg2)', color: 'var(--tx0)', border: '1px solid var(--line2)', fontSize: 15, padding: '0 8px' }}
            >
              {wards.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
            <button className="btn primary" onClick={() => apply(wardPlan(sim.world, ward))}>
              設定
            </button>
          </div>
          {station?.ward && (
            <button className="btn wide sm" style={{ marginTop: 6 }} onClick={() => apply(areaPlan(`${station.short}署周辺`, station.x, station.y, 1500, station.ward ?? undefined))}>
              所属署周辺（半径1.5km）
            </button>
          )}
        </div>
        <div className="block">
          <div className="block-h">地図で指定</div>
          <div className="btn-grid">
            <button
              className="btn"
              onClick={() => {
                setUI({ mapMode: { kind: 'patrolArea', unitId: u.id, r: 1200 } });
                pendingPatrol = { focus, schedule: SCHED[sched][1] };
                onDone();
              }}
            >
              範囲（円）
            </button>
            <button
              className="btn"
              onClick={() => {
                setUI({ mapMode: { kind: 'patrolRoute', unitId: u.id, points: [] } });
                pendingPatrol = { focus, schedule: SCHED[sched][1] };
                onDone();
              }}
            >
              巡回経路
            </button>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            巡回経路：地図上で立ち寄り地点を順にタップ。各地点で約3分間の立ち寄り警戒を行い、経路を周回します。
          </div>
        </div>
        <div className="block">
          <button
            className="btn wide danger"
            onClick={() => {
              sim.setPatrol(u.id, null, false);
              onDone();
            }}
          >
            警ら計画を解除
          </button>
        </div>
      </div>
    </div>
  );
}

/** focus/schedule chosen in the editor, applied when a map-drawn plan is completed */
export let pendingPatrol: { focus: PatrolFocus; schedule: { start: number; end: number } | null } = { focus: 'balanced', schedule: null };

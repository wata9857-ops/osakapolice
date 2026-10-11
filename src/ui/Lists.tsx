import { useState } from 'react';
import { useSim, useSimTick, fmtDur, fmtMinShort } from './hooks';
import { useUI, select, flyTo } from './store';
import { STATUS_LABEL, UNIT_KIND_LABEL, AVAILABLE, type Unit, type Incident } from '../sim/types';
import { PRIORITY_LABEL } from '../sim/incidentTypes';
import { rankOf } from '../sim/engine';

const INC_ST: Record<string, string> = { pending: '未指令', dispatched: '指令済', onscene: '現場', resolved: '終結', failed: '未解決' };

export function IncidentRow({ inc, sel }: { inc: Incident; sel: boolean }) {
  const sim = useSim();
  const open = inc.status !== 'resolved' && inc.status !== 'failed';
  const age = (inc.tEnd ?? sim.t) - inc.t0;
  const stCls = inc.status === 'pending' ? 'st-onscene blink' : inc.status === 'dispatched' ? 'st-enroute' : inc.status === 'onscene' ? 'st-patrol' : 'st-office';
  return (
    <div
      className={`row ${sel ? 'sel' : ''}`}
      onClick={() => {
        select({ kind: 'incident', id: inc.id });
        flyTo(inc.x, inc.y);
      }}
    >
      <div className="stripe" style={{ background: open ? `var(--p${inc.priority})` : 'var(--line2)' }} />
      <div className="row-body">
        <div className="row-l1">
          <span className={`pri pri-${inc.priority}`}>P{inc.priority}</span>
          <span className="row-title" style={{ opacity: open ? 1 : 0.6 }}>
            {inc.name}
          </span>
        </div>
        <div className="row-l2">{inc.address}</div>
        <div className="row-l2 muted mono" style={{ fontSize: 11 }}>
          {inc.id} · {inc.assigned.length ? `${inc.onScene.length}/${inc.assigned.length}隊` : '部隊なし'}
          {inc.suspect && !inc.suspect.caught && inc.suspect.free ? ' · マル被逃走中' : ''}
          {inc.suspect?.caught ? ' · 確保' : ''}
        </div>
        {(inc.auto || inc.selfInit || inc.eventName || inc.score !== undefined) && (
          <div className="row-tags">
            {inc.selfInit && <span className="tag t-self">現認</span>}
            {inc.auto && <span className="tag t-auto">自動指令</span>}
            {inc.eventName && <span className="tag t-ev">{inc.eventName}</span>}
            {inc.score !== undefined && <span className={`tag ${inc.score >= 0 ? 't-plus' : 't-minus'}`}>{inc.score >= 0 ? '+' : ''}{inc.score}</span>}
          </div>
        )}
      </div>
      <div className="row-side">
        <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>
          {fmtDur(age)}
        </span>
        <span className={`st ${stCls}`}>{INC_ST[inc.status]}</span>
      </div>
    </div>
  );
}

export function EventStrip() {
  const sim = useSim();
  if (!sim.events.length) return null;
  return (
    <div className="ev-strip">
      {sim.events.map((e) => (
        <div
          key={e.id}
          className={`ev-card ev-${e.key}`}
          onClick={() => {
            if (e.x !== undefined) flyTo(e.x, e.y!, e.r && e.r > 1500 ? 12.5 : 14);
          }}
        >
          <span className="ev-ic">{e.icon}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ev-name">{e.name}</div>
            <div className="ev-desc">{e.desc}</div>
          </div>
          <span className="mono muted small">残{Math.max(1, Math.round((e.t1 - sim.t) / 60))}分</span>
        </div>
      ))}
    </div>
  );
}

export function IncidentList() {
  const sim = useSim();
  useSimTick(2);
  const [f, setF] = useState<'open' | 'pending' | 'all'>('open');
  const sel = useUI((s) => s.selected);
  let list = sim.incidents.filter((i) =>
    f === 'all' ? true : f === 'pending' ? i.status === 'pending' : i.status !== 'resolved' && i.status !== 'failed',
  );
  list = [...list].sort((a, b) => {
    const ao = a.status === 'resolved' || a.status === 'failed' ? 1 : 0;
    const bo = b.status === 'resolved' || b.status === 'failed' ? 1 : 0;
    if (ao !== bo) return ao - bo;
    if (ao) return b.t0 - a.t0;
    const ap = a.status === 'pending' ? 0 : 1, bp = b.status === 'pending' ? 0 : 1;
    return a.priority - b.priority || ap - bp || a.t0 - b.t0;
  });
  const pend = sim.incidents.filter((i) => i.status === 'pending').length;
  return (
    <>
      <div className="filterbar">
        <button className={`chip ${f === 'open' ? 'on' : ''}`} onClick={() => setF('open')}>
          対応中
        </button>
        <button className={`chip ${f === 'pending' ? 'on' : ''}`} onClick={() => setF('pending')}>
          未指令 {pend ? `(${pend})` : ''}
        </button>
        <button className={`chip ${f === 'all' ? 'on' : ''}`} onClick={() => setF('all')}>
          全件
        </button>
      </div>
      <div className="scroll">
        <EventStrip />
        {list.length === 0 && <div className="empty">{f === 'pending' ? '未指令の事案はありません' : '受理中の事案はありません。110番入電を待機中…'}</div>}
        {list.map((i) => (
          <IncidentRow key={i.id} inc={i} sel={sel?.kind === 'incident' && sel.id === i.id} />
        ))}
      </div>
    </>
  );
}

export function unitTaskText(sim: ReturnType<typeof useSim>, u: Unit): string {
  const inc = u.incidentId ? sim.incById.get(u.incidentId) : null;
  switch (u.status) {
    case 'enroute':
      return `→ ${inc ? inc.name.replace(/（.*?）/, '') + ' ' + inc.address : '現場'}`;
    case 'onscene':
      return `${inc ? inc.name.replace(/（.*?）/, '') : ''} 現場活動中`;
    case 'search':
      return `${inc ? inc.name.replace(/（.*?）/, '') + ' ' : ''}周辺検索中`;
    case 'pursuit':
      return 'マル被追跡中';
    case 'transport':
      return `${u.task?.label ?? '署'}へ連行・搬送中`;
    case 'office':
      return `署内処理（残り${fmtMinShort(u.timer)}）`;
    case 'returning':
      return '帰署中';
    case 'moving':
      return `→ ${u.task?.label ?? '指定地点'}`;
    case 'hold':
      return `${u.task?.label ? u.task.label.replace(/（検問）/, '') + ' ' : ''}停留警戒`;
    case 'patrol':
      return `${u.patrol?.areaName ?? ''} 警ら中`;
    default: {
      const b = sim.world.facilities.find((f) => f.id === u.baseId);
      return `${b ? (b.kind === 'station' ? b.short + '署' : b.name) : '本部'} 待機`;
    }
  }
}

export function UnitRow({ u, sel }: { u: Unit; sel: boolean }) {
  const sim = useSim();
  const eta = (u.status === 'enroute' || u.status === 'moving' || u.status === 'transport' || u.status === 'returning') && u.route ? sim.routeEta(u) : null;
  return (
    <div
      className={`row ${sel ? 'sel' : ''}`}
      onClick={() => {
        select({ kind: 'unit', id: u.id });
        flyTo(u.x, u.y);
      }}
    >
      <div className="stripe" style={{ background: `var(--st-${u.status})` }} />
      <div className="row-body">
        <div className="row-l1">
          <span className="row-title" style={{ flex: 'none' }}>
            {u.callsign}
          </span>
          <span className="tag">{UNIT_KIND_LABEL[u.kind]}</span>
          {u.manual && <span className="tag" style={{ color: 'var(--acc)', borderColor: 'var(--acc)' }}>運転中</span>}
          {u.emergency && (u.status === 'enroute' || u.status === 'pursuit') && <span className="tag" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>緊急</span>}
        </div>
        <div className="row-l2">{unitTaskText(sim, u)}</div>
      </div>
      <div className="row-side">
        <span className={`st st-${u.status} ${u.status === 'enroute' || u.status === 'pursuit' ? 'blink' : ''}`}>{STATUS_LABEL[u.status]}</span>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {eta !== null ? `ETA ${fmtMinShort(eta)}` : u.v > 0.5 ? `${Math.round(u.v * 3.6)}km/h` : ''}
        </span>
      </div>
    </div>
  );
}

type UF = 'all' | 'avail' | 'busy' | 'pc' | 'mobile' | 'koban';

export function UnitList() {
  const sim = useSim();
  useSimTick(2);
  const [f, setF] = useState<UF>('all');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const sel = useUI((s) => s.selected);
  const match = (u: Unit) => {
    if (f === 'koban') return u.kind === 'koban';
    if (u.kind === 'koban' && f !== 'avail' && f !== 'busy') return false;
    if (u.kind === 'koban' && f === 'avail') return false;
    if (f === 'avail') return AVAILABLE.includes(u.status);
    if (f === 'busy') return !AVAILABLE.includes(u.status);
    if (f === 'pc') return u.kind === 'pc';
    if (f === 'mobile') return u.kind === 'jiraku' || u.kind === 'kotsu' || u.kind === 'kisou';
    return true;
  };
  const units = sim.units.filter(match);
  const groups = new Map<string, Unit[]>();
  const order: string[] = [];
  const gname = (u: Unit) => {
    if (u.kind === 'jiraku') return '自動車警ら隊';
    if (u.kind === 'kotsu') return '交通機動隊';
    if (u.kind === 'kisou') return '機動捜査隊';
    const st = sim.world.facilities.find((x) => x.id === u.stationId);
    return st ? `${st.short}警察署` : 'その他';
  };
  for (const u of units) {
    const g = gname(u);
    if (!groups.has(g)) {
      groups.set(g, []);
      order.push(g);
    }
    groups.get(g)!.push(u);
  }
  const chips: [UF, string][] = [
    ['all', '全車両'],
    ['avail', '可動'],
    ['busy', '活動中'],
    ['pc', '所轄PC'],
    ['mobile', '自ら隊・交機・機捜'],
    ['koban', '交番'],
  ];
  return (
    <>
      <div className="filterbar">
        {chips.map(([k, l]) => (
          <button key={k} className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="scroll">
        {order.length === 0 && <div className="empty">該当する部隊はありません</div>}
        {order.map((g) => {
          const list = groups.get(g)!;
          const busy = list.filter((u) => !AVAILABLE.includes(u.status)).length;
          return (
            <div key={g}>
              <div className="section-h" style={{ cursor: 'pointer' }} onClick={() => setClosed((c) => ({ ...c, [g]: !c[g] }))}>
                <span>
                  {closed[g] ? '▸' : '▾'} {g}
                </span>
                <span className="mono">
                  {busy}/{list.length}
                </span>
              </div>
              {!closed[g] && list.map((u) => <UnitRow key={u.id} u={u} sel={sel?.kind === 'unit' && sel.id === u.id} />)}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function HistoryList() {
  const sim = useSim();
  useSimTick(1);
  const [tab, setTab] = useState<'cases' | 'log'>('cases');
  const closed = sim.incidents.filter((i) => i.status === 'resolved' || i.status === 'failed').sort((a, b) => (b.tEnd ?? 0) - (a.tEnd ?? 0));
  const s = sim.stats;
  const rt = s.respTimes;
  const avg = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : NaN;
  const p1 = sim.incidents.filter((i) => i.priority === 1 && i.tArrive !== null).map((i) => i.tArrive! - i.t0);
  const p1avg = p1.length ? p1.reduce((a, b) => a + b, 0) / p1.length : NaN;
  return (
    <>
      <div className="kv" style={{ flex: 'none' }}>
        <div className="k">受理件数</div>
        <div className="v mono">{s.received}</div>
        <div className="k">解決／未解決</div>
        <div className="v mono">
          {s.resolved} / <span style={{ color: s.failed ? 'var(--p1)' : undefined }}>{s.failed}</span>
        </div>
        <div className="k">検挙・確保</div>
        <div className="v mono">{s.arrests}</div>
        <div className="k">平均現着</div>
        <div className="v mono">
          {fmtDur(avg)}（P1 {fmtDur(p1avg)}）
        </div>
        <div className="k">評価点</div>
        <div className="v mono">
          {s.score.toLocaleString()}（{rankOf(s.score)}）最高連続{s.bestStreak}
        </div>
        <div className="k">自主活動</div>
        <div className="v mono">
          職質{s.questioned} · 取締{s.tickets} · 自動指令{s.auto}
        </div>
      </div>
      <div className="filterbar">
        <button className={`chip ${tab === 'cases' ? 'on' : ''}`} onClick={() => setTab('cases')}>
          事案履歴
        </button>
        <button className={`chip ${tab === 'log' ? 'on' : ''}`} onClick={() => setTab('log')}>
          運用記録
        </button>
      </div>
      <div className="scroll">
        {tab === 'cases' &&
          (closed.length ? (
            closed.map((i) => (
              <div key={i.id} className="row" onClick={() => select({ kind: 'incident', id: i.id })}>
                <div className="stripe" style={{ background: i.status === 'failed' ? 'var(--p1)' : 'var(--ok)' }} />
                <div className="row-body">
                  <div className="row-l1">
                    <span className="mono muted small">{sim.clockStr(i.t0, false)}</span>
                    <span className="row-title">{i.name}</span>
                  </div>
                  <div className="row-l2">{i.outcome}</div>
                  <div className="row-l2 muted small">
                    {i.address} · 現着 {i.tArrive !== null ? fmtDur(i.tArrive - i.t0) : '—'} · {PRIORITY_LABEL[i.priority]}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">終結した事案はまだありません</div>
          ))}
        {tab === 'log' && (
          <ul className="timeline" style={{ padding: '6px 12px' }}>
            {[...sim.log].reverse().slice(0, 400).map((l, k) => (
              <li
                key={k}
                onClick={() => {
                  if (l.incidentId && sim.incById.has(l.incidentId)) select({ kind: 'incident', id: l.incidentId });
                  else if (l.unitId) select({ kind: 'unit', id: l.unitId });
                }}
              >
                <span className="tt">{sim.clockStr(l.t)}</span>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

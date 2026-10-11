import { useEffect, useMemo, useState } from 'react';
import { useSim, useSimTick, fmtDur, fmtMinShort, fmtKm } from './hooks';
import { getUI, setUI, useUI, select, flyTo, toast } from './store';
import { STATUS_LABEL, UNIT_KIND_LABEL, AVAILABLE, type Incident } from '../sim/types';
import { PRIORITY_LABEL, TYPE_BY_KEY } from '../sim/incidentTypes';
import { overlay } from '../map/overlay';
import { modeWord } from '../sim/radio';

export function IncidentDetail({ inc }: { inc: Incident }) {
  const sim = useSim();
  useSimTick(2);
  const dispatchOpen = useUI((s) => s.dispatchFor === inc.id);
  const open = inc.status !== 'resolved' && inc.status !== 'failed';
  const station = sim.world.facilities.find((f) => f.id === inc.stationId);
  const age = (inc.tEnd ?? sim.t) - inc.t0;
  const type = TYPE_BY_KEY.get(inc.type);
  const progress = inc.workTotal ? Math.max(0, Math.min(1, 1 - inc.work / inc.workTotal)) : 0;
  const sus = inc.suspect;
  if (dispatchOpen && open) return <DispatchPanel inc={inc} />;
  return (
    <div className="detail">
      <div className="detail-head">
        <div className="dh-kicker">
          <span>事案 {inc.id}</span>
          <span>受理 {sim.clockStr(inc.t0)}</span>
        </div>
        <div className="dh-title">
          <span className={`pri pri-${inc.priority}`} style={{ verticalAlign: 3, marginRight: 8 }}>
            P{inc.priority}
          </span>
          {inc.name}
        </div>
        <div className="dh-sub">{inc.address}</div>
        <button className="btn ghost icon-btn close" onClick={() => select(null)} aria-label="閉じる">
          ✕
        </button>
      </div>
      <div className="scroll">
        <div className="kv">
          <div className="k">状態</div>
          <div className="v">
            <b>{{ pending: '未指令', dispatched: '指令済・臨場中', onscene: '現場対応中', resolved: '終結', failed: '未解決で終了' }[inc.status]}</b>
            <span className="mono muted"> 経過 {fmtDur(age)}</span>
          </div>
          <div className="k">優先度</div>
          <div className="v" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>
              {inc.priority}（{PRIORITY_LABEL[inc.priority]}）
            </span>
            {open && (
              <span className="btn-row">
                <button className="btn xs" disabled={inc.priority <= 1} onClick={() => sim.setPriority(inc.id, inc.priority - 1)}>
                  ▲上げる
                </button>
                <button className="btn xs" disabled={inc.priority >= 4} onClick={() => sim.setPriority(inc.id, inc.priority + 1)}>
                  ▼下げる
                </button>
              </span>
            )}
          </div>
          <div className="k">管轄</div>
          <div className="v">{station ? `${station.short}警察署` : '—'}{inc.ward ? `（${inc.ward}）` : ''}</div>
          <div className="k">通報者</div>
          <div className="v">{inc.caller}</div>
          <div className="k">通報内容</div>
          <div className="v">{inc.detail}</div>
          <div className="k">所要部隊</div>
          <div className="v">
            最低{inc.minUnits}隊／適正{inc.idealUnits}隊{type?.bonus?.length ? `（${type.bonus.map((b) => UNIT_KIND_LABEL[b]).join('・')}が有効）` : ''}
          </div>
          {inc.tArrive !== null && (
            <>
              <div className="k">現着</div>
              <div className="v mono">
                {sim.clockStr(inc.tArrive)}（{fmtDur(inc.tArrive - inc.t0)}）
              </div>
            </>
          )}
          {inc.status === 'onscene' && (
            <>
              <div className="k">処理進捗</div>
              <div className="v">
                <div className="meter" style={{ marginTop: 6 }}>
                  <i style={{ width: `${progress * 100}%`, background: inc.onScene.length < inc.minUnits ? 'var(--p2)' : 'var(--ok)' }} />
                </div>
                {inc.onScene.length < inc.minUnits && <div className="small" style={{ color: 'var(--p2)' }}>人員不足のため処理が遅延</div>}
              </div>
            </>
          )}
          {inc.outcome && (
            <>
              <div className="k">結果</div>
              <div className="v">{inc.outcome}</div>
            </>
          )}
        </div>
        {sus && (
          <div className="block">
            <div className="block-h">
              <span>被疑者（マル被）</span>
              <span className="st" style={{ color: sus.caught ? 'var(--ok)' : sus.free ? 'var(--st-pursuit)' : 'var(--tx2)' }}>
                {sus.caught ? '確保' : sus.free ? '逃走中' : '現場付近'}
              </span>
            </div>
            <div className="small">{sus.desc}</div>
            <div className="small muted">
              逃走手段：{modeWord(sus.mode)}
              {sus.lastSeen && sus.free ? ` · 最終目撃 ${sim.clockStr(sus.lastSeen.t, false)}（${fmtDur(sim.t - sus.lastSeen.t)}前）` : ''}
            </div>
          </div>
        )}
        <div className="block">
          <div className="block-h">
            <span>出動部隊</span>
            <span className="mono">{inc.assigned.length}</span>
          </div>
          {inc.assigned.length === 0 && <div className="small muted">指令された部隊はありません</div>}
          {inc.assigned.map((id) => {
            const u = sim.unitById.get(id);
            if (!u) return null;
            const eta = u.status === 'enroute' && u.incidentId === inc.id ? sim.routeEta(u) : null;
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px dashed var(--line)' }}>
                <button className="btn ghost sm" style={{ padding: '0 4px', justifyContent: 'flex-start', flex: 1 }} onClick={() => select({ kind: 'unit', id })}>
                  <b>{u.callsign}</b>
                  <span className="tag">{UNIT_KIND_LABEL[u.kind]}</span>
                  <span className={`st st-${u.status}`}>{STATUS_LABEL[u.status]}</span>
                  {eta !== null && <span className="mono muted">ETA {fmtMinShort(eta)}</span>}
                </button>
                {open && u.incidentId === inc.id && (
                  <button className="btn xs" onClick={() => sim.cancel(u.id)}>
                    解除
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="block">
          <div className="block-h">経過記録</div>
          <ul className="timeline">
            {[...inc.updates].reverse().map((u, k) => (
              <li key={k}>
                <span className="tt">{sim.clockStr(u.t)}</span>
                <span className={`tl-${u.kind}`}>{u.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {open && (
        <div className="action-bar">
          <button className="btn primary wide" onClick={() => setUI({ dispatchFor: inc.id, dispatchPick: [] })}>
            部隊選定・出動指令
          </button>
          <div className="btn-grid">
            {sus && sus.free && !sus.caught ? (
              <button className="btn" onClick={() => setUI({ dispatchFor: inc.id, dispatchPick: [] })}>
                緊急配備…
              </button>
            ) : (
              <button className="btn" onClick={() => flyTo(inc.x, inc.y, 16)}>
                現場を表示
              </button>
            )}
            <button
              className="btn danger"
              onClick={() => {
                if (confirm(`${inc.id} ${inc.name} を終結させますか？`)) sim.closeIncident(inc.id);
              }}
            >
              事案終結
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DispatchPanel({ inc }: { inc: Incident }) {
  const sim = useSim();
  useSimTick(1);
  const pick = useUI((s) => s.dispatchPick);
  const emergency = useUI((s) => s.emergency);
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<'dispatch' | 'cordon'>('dispatch');
  const cands = sim.candidates(inc.id);
  const sus = inc.suspect && inc.suspect.free && !inc.suspect.caught ? inc.suspect : null;
  // recommended: nearest available units up to the minimum requirement
  const need = Math.max(0, inc.minUnits - inc.assigned.length);
  const recommended = useMemo(() => {
    const avail = cands.filter((c) => c.available && c.eta < 1500);
    const type = TYPE_BY_KEY.get(inc.type);
    const rec: string[] = [];
    const bonus = avail.find((c) => type?.bonus?.includes(c.unit.kind) && c.eta < (avail[0]?.eta ?? 0) + 240);
    if (bonus && need > 0) rec.push(bonus.unit.id);
    for (const c of avail) if (rec.length < Math.max(need, 1) && !rec.includes(c.unit.id)) rec.push(c.unit.id);
    return rec;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inc.id, cands.length]);
  useEffect(() => {
    if (!getUI().dispatchPick.length && recommended.length && mode === 'dispatch') setUI({ dispatchPick: recommended });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inc.id]);
  // route previews for picked units
  const pickKey = pick.join(',') + emergency;
  useEffect(() => {
    if (mode !== 'dispatch') {
      overlay.setLines([]);
      return;
    }
    const lines = pick
      .slice(0, 6)
      .map((id) => sim.unitById.get(id))
      .filter((u) => u && !u.manual)
      .map((u) => sim.previewRoute(u!, inc.loc, emergency))
      .filter(Boolean)
      .map((r) => ({ coords: r!.line, kind: 'preview' as const }));
    overlay.setLines(lines);
    return () => overlay.setLines([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey, inc.id, mode]);
  const list = showAll ? cands : cands.filter((c, i) => c.available || i < 12).slice(0, 40);
  const toggle = (id: string) => setUI((s) => ({ dispatchPick: s.dispatchPick.includes(id) ? s.dispatchPick.filter((x) => x !== id) : [...s.dispatchPick, id] }));
  const go = () => {
    if (!pick.length) return;
    if (mode === 'cordon') {
      sim.cordon(inc.id, pick);
      toast(`緊急配備発令：${pick.length}隊`, 'info', { incidentId: inc.id });
    } else {
      sim.dispatch(pick, inc.id, { emergency });
      toast(`出動指令：${pick.map((id) => sim.unitById.get(id)?.callsign).join('・')}`, 'info', { incidentId: inc.id });
    }
    setUI({ dispatchFor: null, dispatchPick: [] });
  };
  return (
    <div className="detail">
      <div className="detail-head">
        <div className="dh-kicker">
          <span>{mode === 'cordon' ? '緊急配備' : '部隊選定'}</span>
          <span>
            {inc.id} · P{inc.priority}
          </span>
        </div>
        <div className="dh-title" style={{ fontSize: 17 }}>
          {inc.name}
        </div>
        <div className="dh-sub">{inc.address}</div>
        <button className="btn ghost icon-btn close" onClick={() => setUI({ dispatchFor: null, dispatchPick: [] })} aria-label="戻る">
          ✕
        </button>
      </div>
      <div className="filterbar" style={{ alignItems: 'center' }}>
        {sus && (
          <div className="seg">
            <button className={mode === 'dispatch' ? 'on' : ''} onClick={() => setMode('dispatch')}>
              現場臨場
            </button>
            <button
              className={mode === 'cordon' ? 'on' : ''}
              onClick={() => {
                setMode('cordon');
                setUI({ dispatchPick: cands.filter((c) => c.available && c.unit.kind !== 'koban').slice(0, 4).map((c) => c.unit.id) });
              }}
            >
              緊急配備
            </button>
          </div>
        )}
        {mode === 'dispatch' && (
          <button className={`chip ${emergency ? 'on' : ''}`} onClick={() => setUI({ emergency: !emergency })}>
            {emergency ? '● 緊急走行' : '○ 通常走行'}
          </button>
        )}
        <button className={`chip ${showAll ? 'on' : ''}`} onClick={() => setShowAll(!showAll)}>
          全部隊表示
        </button>
      </div>
      <div className="small muted" style={{ padding: '6px 12px', borderBottom: '1px solid var(--line)' }}>
        {mode === 'cordon'
          ? '選択した部隊を推定逃走範囲の外周の主要交差点へ配置し検問にあたらせます。'
          : `最低${inc.minUnits}隊（指令済${inc.assigned.length}隊）。ETAは現在の交通状況と道路網から算出。`}
      </div>
      <div className="scroll">
        {list.map((c) => {
          const u = c.unit;
          const on = pick.includes(u.id);
          const busyInc = u.incidentId ? sim.incById.get(u.incidentId) : null;
          return (
            <div key={u.id} className={`cand ${on ? 'on' : ''}`} onClick={() => toggle(u.id)}>
              <div className="chk">{on ? '✓' : ''}</div>
              <div style={{ minWidth: 0, padding: '5px 0' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <b>{u.callsign}</b>
                  <span className="tag">{UNIT_KIND_LABEL[u.kind]}</span>
                  {recommended.includes(u.id) && <span className="tag" style={{ color: 'var(--acc)', borderColor: 'var(--acc)' }}>推奨</span>}
                </div>
                <div className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span className={`st st-${u.status}`}>{STATUS_LABEL[u.status]}</span>{' '}
                  <span className="muted">
                    {busyInc ? `${busyInc.name.replace(/（.*?）/, '')}対応中` : ''} {fmtKm(c.dist)}
                  </span>
                </div>
              </div>
              <div className="eta">
                {fmtMinShort(c.eta)}
                <small>{c.available ? '到着予想' : '転進時'}</small>
              </div>
            </div>
          );
        })}
      </div>
      <div className="action-bar">
        {mode === 'dispatch' && pick.length === 1 && (
          <button
            className="btn sm"
            onClick={() => {
              setUI({ mapMode: { kind: 'via', unitId: pick[0], incidentId: inc.id, points: [] } });
            }}
          >
            経由地を指定して指令（{sim.unitById.get(pick[0])?.callsign}）
          </button>
        )}
        <button className="btn primary wide" disabled={!pick.length} onClick={go}>
          {mode === 'cordon' ? `緊急配備 発令（${pick.length}隊）` : `出動指令（${pick.length}隊）`}
        </button>
      </div>
    </div>
  );
}

export function unitAvailable(status: string) {
  return AVAILABLE.includes(status as never);
}

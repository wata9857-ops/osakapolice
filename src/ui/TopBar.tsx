import { useSim, useSimTick, fmtDur } from './hooks';
import { setUI, useUI } from './store';
import { AVAILABLE } from '../sim/types';
import { rankOf, nextRank } from '../sim/engine';
import { autoCountdown } from '../sim/autopilot';

export function AutoChip() {
  const sim = useSim();
  useSimTick(2);
  const cd = autoCountdown(sim);
  const mode = sim.settings.auto;
  const cls = mode === 'off' ? '' : cd === 0 ? 'auto-on' : 'auto-wait';
  const label = mode === 'off' ? 'AUTO 切' : mode === 'full' ? '全自動' : cd === 0 ? '自動指令中' : `AUTO ${Math.ceil(cd)}s`;
  return (
    <button
      className={`btn sm auto-chip ${cls}`}
      title="自動指令：操作がない間、未指令事案を自動で指令・警らを実施（タップで切替）"
      onClick={() => {
        sim.settings.auto = mode === 'off' ? 'assist' : mode === 'assist' ? 'full' : 'off';
        sim.markActive();
        sim.emit('change');
      }}
    >
      {label}
    </button>
  );
}

export function Emblem({ size = 30 }: { size?: number }) {
  // abstract command-centre mark (not an official emblem)
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" fill="none" stroke="var(--acc)" strokeWidth="2" />
      <path d="M16 5 L26 10 V17 C26 22 21.5 25.5 16 27 C10.5 25.5 6 22 6 17 V10 Z" fill="var(--acc)" opacity="0.18" stroke="var(--acc)" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="3.2" fill="var(--acc)" />
      <path d="M16 9 V12 M16 20 V23 M9 16 H12 M20 16 H23" stroke="var(--acc)" strokeWidth="1.6" />
    </svg>
  );
}

export function TopBar({ phone }: { phone: boolean }) {
  const sim = useSim();
  useSimTick(4);
  const theme = useUI((s) => s.theme);
  const open = sim.activeIncidents();
  const pending = open.filter((i) => i.status === 'pending').length;
  const onscene = sim.units.filter((u) => u.status === 'onscene' || u.status === 'search' || u.status === 'pursuit').length;
  const cars = sim.units.filter((u) => u.kind !== 'koban');
  const avail = cars.filter((u) => AVAILABLE.includes(u.status)).length;
  const rt = sim.stats.respTimes.slice(-30);
  const avg = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : NaN;
  const speeds = [0, 1, 2, 4, 8];
  const nr = nextRank(sim.stats.score);
  return (
    <header className="topbar">
      <div className="brand">
        <Emblem />
        {!phone && (
          <div>
            <div className="brand-t1">大阪府警察 通信指令本部</div>
            <div className="brand-t2">OSAKA PPH · COMMAND &amp; CONTROL</div>
          </div>
        )}
      </div>
      <div className="clock">
        <div className="clock-t">{sim.clockStr()}</div>
        <div className="clock-d">{sim.dateStr()}</div>
      </div>
      <div className="kpis">
        <div className="kpi">
          <span className="kpi-l">受理中</span>
          <span className="kpi-v">{open.length}</span>
        </div>
        <div className={`kpi ${pending ? 'alert' : ''}`}>
          <span className="kpi-l">未指令</span>
          <span className="kpi-v">{pending}</span>
        </div>
        <div className="kpi opt">
          <span className="kpi-l">現場活動</span>
          <span className="kpi-v">{onscene}</span>
        </div>
        <div className="kpi">
          <span className="kpi-l">可動車両</span>
          <span className="kpi-v">
            {avail}
            <small style={{ fontSize: 11, color: 'var(--tx2)' }}>/{cars.length}</small>
          </span>
        </div>
        <div className="kpi opt">
          <span className="kpi-l">平均現着</span>
          <span className="kpi-v">{fmtDur(avg)}</span>
        </div>
        <div className="kpi score" title={nr ? `次の階級「${nr[1]}」まで ${nr[0] - sim.stats.score}点` : '最高階級'}>
          <span className="kpi-l">
            評価 · {rankOf(sim.stats.score)}
            {sim.stats.streak >= 3 ? ` · ${sim.stats.streak}連続` : ''}
          </span>
          <span className="kpi-v">{sim.stats.score.toLocaleString()}</span>
          {nr && (
            <span className="rank-bar">
              <i style={{ width: `${Math.min(100, (sim.stats.score / nr[0]) * 100)}%` }} />
            </span>
          )}
        </div>
        {sim.events.length > 0 && (
          <div className="kpi opt events-kpi" title={sim.events.map((e) => e.name).join('\n')}>
            <span className="kpi-l">情勢</span>
            <span className="kpi-v ev-icons">
              {sim.events.map((e) => (
                <i key={e.id}>{e.icon}</i>
              ))}
            </span>
          </div>
        )}
      </div>
      <div className="top-spacer" />
      <div className="top-tools">
        <AutoChip />
        {!phone && (
          <div className="seg" role="group" aria-label="時間倍率">
            {speeds.map((s) => (
              <button
                key={s}
                className={(s === 0 ? sim.paused : !sim.paused && sim.speed === s) ? 'on' : ''}
                onClick={() => {
                  if (s === 0) sim.paused = !sim.paused;
                  else {
                    sim.paused = false;
                    sim.speed = s;
                  }
                  sim.emit('change');
                }}
              >
                {s === 0 ? (sim.paused ? '▶' : 'Ⅱ') : `×${s}`}
              </button>
            ))}
          </div>
        )}
        <button className="btn icon-btn sm" title="表示レイヤー" onClick={() => setUI((s) => ({ menu: s.menu === 'layers' ? null : 'layers' }))}>
          ▤
        </button>
        <button className="btn icon-btn sm" title="ライト／ダーク切替" onClick={() => setUI({ theme: theme === 'dark' ? 'light' : 'dark' })}>
          {theme === 'dark' ? '☾' : '☀'}
        </button>
        <button className="btn icon-btn sm" title="メニュー" onClick={() => setUI((s) => ({ menu: s.menu === 'main' ? null : 'main' }))}>
          ≡
        </button>
      </div>
    </header>
  );
}

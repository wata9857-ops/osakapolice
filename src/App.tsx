import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { loadWorld, type World } from './sim/world';
import { Sim } from './sim/engine';
import { SimContext, useSim as useContextSim } from './ui/hooks';
import { MapView } from './map/MapView';
import { TopBar, Emblem } from './ui/TopBar';
import { IncidentList, UnitList, HistoryList } from './ui/Lists';
import { DetailPanel, RadioPanel, ModeBanner, Toasts, Menus, useRadioSpeech } from './ui/Panels';
import { setUI, useUI, toast, select } from './ui/store';
import type { Incident } from './sim/types';

const DriveMode = lazy(() => import('./drive/DriveMode'));
const SAVE_KEY = 'opd-save-v1';

function usePhone() {
  const q = () => window.innerWidth < 700 || (window.innerHeight < 500 && window.innerWidth < 950);
  const [phone, setPhone] = useState(q);
  useEffect(() => {
    const on = () => setPhone(q());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return phone;
}

export default function App() {
  const theme = useUI((s) => s.theme);
  const [world, setWorld] = useState<World | null>(null);
  const [progress, setProgress] = useState<[string, number]>(['データ読込中', 0]);
  const [error, setError] = useState<string | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0e1419' : '#f6f7f8');
  }, [theme]);

  useEffect(() => {
    loadWorld((s, f) => setProgress([s, f]))
      .then(setWorld)
      .catch((e) => setError(String(e)));
  }, []);

  if (error)
    return (
      <div className="splash">
        <div className="splash-card">
          <div className="splash-body">データの読み込みに失敗しました：{error}</div>
        </div>
      </div>
    );
  if (!sim) return <StartScreen world={world} progress={progress} onStart={setSim} />;
  return (
    <SimContext.Provider value={sim}>
      <Console
        onNewGame={() => {
          localStorage.removeItem(SAVE_KEY);
          setSim(null);
        }}
      />
    </SimContext.Provider>
  );
}

function StartScreen({ world, progress, onStart }: { world: World | null; progress: [string, number]; onStart: (s: Sim) => void }) {
  const [start, setStart] = useState<number>(-1);
  const [rate, setRate] = useState(1);
  const hasSave = !!localStorage.getItem(SAVE_KEY);
  const now = new Date();
  const jstHour = (now.getUTCHours() + 9 + now.getUTCMinutes() / 60) % 24;
  const begin = (resume: boolean) => {
    if (!world) return;
    const sim = new Sim(world, { startHour: start < 0 ? jstHour : start });
    sim.settings.rate = rate;
    if (resume) {
      try {
        sim.restore(JSON.parse(localStorage.getItem(SAVE_KEY)!));
      } catch (e) {
        console.warn('restore failed', e);
      }
    }
    onStart(sim);
  };
  const starts: [number, string][] = [
    [-1, '現在時刻'],
    [8, '08:00 朝'],
    [13, '13:00 昼'],
    [19, '19:00 夜'],
    [23, '23:00 深夜'],
    [3, '03:00 未明'],
  ];
  return (
    <div className="splash">
      <div className="splash-card">
        <div className="splash-top">
          <Emblem size={44} />
          <div>
            <h1>大阪府警察 通信指令本部</h1>
            <div className="en">OSAKA CITY POLICE DISPATCH SIMULATOR</div>
          </div>
        </div>
        {!world ? (
          <div className="splash-body">
            <div className="small muted">{progress[0]}…</div>
            <div className="progress">
              <i style={{ width: `${Math.max(5, progress[1] * 100)}%` }} />
            </div>
            <div className="splash-note">大阪市24区の道路網（OpenStreetMap）・警察署28署・交番を読み込んでいます。</div>
          </div>
        ) : (
          <div className="splash-body">
            <div className="small muted">
              道路 {world.graph.ne.toLocaleString()} 区間 · 交差点 {world.graph.nv.toLocaleString()} · 警察署 {world.stations.length} · 交番・駐在所 {world.kobans.length}
            </div>
            <div>
              <div className="field-l">勤務開始時刻</div>
              <div className="seg" style={{ flexWrap: 'wrap' }}>
                {starts.map(([h, l]) => (
                  <button key={h} className={start === h ? 'on' : ''} onClick={() => setStart(h)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="field-l">110番入電頻度</div>
              <div className="seg">
                {(
                  [
                    [0.5, '少'],
                    [1, '標準'],
                    [1.6, '多'],
                    [2.5, '繁忙'],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} className={rate === v ? 'on' : ''} onClick={() => setRate(v)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="btn-row">
              <button className="btn primary" style={{ flex: 1, minHeight: 52, fontSize: 16 }} onClick={() => begin(false)}>
                勤務開始
              </button>
              {hasSave && (
                <button className="btn" style={{ minHeight: 52 }} onClick={() => begin(true)}>
                  続きから
                </button>
              )}
            </div>
            <div className="splash-note">
              あなたは通信指令官です。110番通報を受理し、所轄警察署のパトカー・自動車警ら隊・交通機動隊・機動捜査隊・交番勤務員を選んで出動を指令してください。
              部隊を選択すると警ら区域・巡回経路の設定や、運転席視点での車両操縦ができます。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Console({ onNewGame }: { onNewGame: () => void }) {
  const sim = useContextSim();
  const phone = usePhone();
  const leftOpen = useUI((s) => s.leftOpen);
  const leftTab = useUI((s) => s.leftTab);
  const rightOpen = useUI((s) => s.rightOpen);
  const selected = useUI((s) => s.selected);
  const radio = useUI((s) => s.radio);
  const driving = useUI((s) => s.driving);
  const [, setTick] = useState(0);
  useRadioSpeech();

  // simulation loop
  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      const dt = Math.min(0.25, (t - last) / 1000);
      last = t;
      sim.advance(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  const save = useCallback(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(sim.serialize()));
    } catch (e) {
      console.warn('save failed', e);
    }
  }, [sim]);
  useEffect(() => {
    const iv = setInterval(save, 30000);
    const onHide = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [save]);

  // incoming call notifications
  useEffect(() => {
    return sim.on((type, p) => {
      if (type === 'incident') {
        const i = p as Incident;
        toast(`110番入電【${i.name}】${i.address}`, i.priority <= 1 ? 'urgent' : i.priority === 2 ? 'warn' : 'info', { incidentId: i.id });
        setTick((x) => x + 1);
      }
    });
  }, [sim]);

  const pending = sim.incidents.filter((i) => i.status === 'pending').length;
  const radioH = radio === 'min' ? 'var(--radio-min)' : radio === 'mid' ? '170px' : '46%';

  if (phone) return <PhoneConsole onNewGame={onNewGame} save={save} driving={driving} />;

  return (
    <div className="app">
      <TopBar phone={false} />
      <div className="main">
        <MapView sim={sim} />
        <aside className={`dock dock-left ${leftOpen ? '' : 'closed'}`}>
          <button className="dock-handle" onClick={() => setUI({ leftOpen: !leftOpen })} aria-label={leftOpen ? '一覧を隠す' : '一覧を表示'}>
            <span>{leftOpen ? '◀' : '▶'}</span>
            {!leftOpen && <span className="hl">一覧</span>}
            {!leftOpen && pending > 0 && <span className="pri pri-1 badge-dot">{pending}</span>}
          </button>
          <div className="tabs">
            <button className={`tab ${leftTab === 'incidents' ? 'on' : ''}`} onClick={() => setUI({ leftTab: 'incidents' })}>
              事案 <span className={`cnt ${pending ? 'hot' : ''}`}>{sim.activeIncidents().length}</span>
            </button>
            <button className={`tab ${leftTab === 'units' ? 'on' : ''}`} onClick={() => setUI({ leftTab: 'units' })}>
              部隊
            </button>
            <button className={`tab ${leftTab === 'history' ? 'on' : ''}`} onClick={() => setUI({ leftTab: 'history' })}>
              記録
            </button>
          </div>
          {leftTab === 'incidents' && <IncidentList />}
          {leftTab === 'units' && <UnitList />}
          {leftTab === 'history' && <HistoryList />}
        </aside>
        <aside className={`dock dock-right ${rightOpen && selected ? '' : 'closed'}`}>
          {selected && (
            <button className="dock-handle" onClick={() => setUI({ rightOpen: !rightOpen })} aria-label={rightOpen ? '詳細を隠す' : '詳細を表示'}>
              <span>{rightOpen ? '▶' : '◀'}</span>
              {!rightOpen && <span className="hl">詳細</span>}
            </button>
          )}
          <DetailPanel />
        </aside>
        <section
          className="radio"
          style={{
            left: leftOpen ? 'var(--left-w)' : 0,
            right: rightOpen && selected ? 'var(--right-w)' : 0,
            height: radioH,
          }}
        >
          <RadioPanel />
        </section>
        <MapControls bottom={radioH} right={rightOpen && selected ? 'var(--right-w)' : '0px'} />
        <ModeBanner />
        <Toasts />
        <Menus onNewGame={onNewGame} onSave={save} />
      </div>
      {driving && (
        <Suspense fallback={<div className="drive" />}>
          <DriveMode unitId={driving} />
        </Suspense>
      )}
    </div>
  );
}

function MapControls({ bottom, right }: { bottom: string; right: string }) {
  const sim = useContextSim();
  return (
    <div className="map-ctrls" style={{ right: `calc(${right} + 10px)`, bottom: `calc(${bottom} + 26px)` }}>
      <button
        className="btn"
        title="未指令事案へ"
        onClick={() => {
          const p = sim.incidents.filter((i) => i.status === 'pending').sort((a, b) => a.priority - b.priority || a.t0 - b.t0)[0];
          if (p) {
            select({ kind: 'incident', id: p.id });
            setUI({ flyTo: { x: p.x, y: p.y, zoom: 15, seq: Date.now() } });
          } else toast('未指令の事案はありません');
        }}
      >
        ◆
      </button>
      <button
        className="btn"
        title="大阪市全域"
        onClick={() => {
          const b = sim.world.cityBounds;
          setUI({ flyTo: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, zoom: 11.3, seq: Date.now() } });
        }}
      >
        ⌂
      </button>
    </div>
  );
}

function PhoneConsole({ onNewGame, save, driving }: { onNewGame: () => void; save: () => void; driving: string | null }) {
  const sim = useContextSim();
  const sheet = useUI((s) => s.sheet);
  const tab = useUI((s) => s.sheetTab);
  const [, force] = useState(0);
  useEffect(() => sim.on((t) => t === 'incident' && force((x) => x + 1)), [sim]);
  const pending = sim.incidents.filter((i) => i.status === 'pending').length;
  const h = sheet === 'peek' ? 'calc(112px + var(--safe-b))' : sheet === 'half' ? '48%' : '88%';
  const drag = useRef<{ y: number; s: typeof sheet } | null>(null);
  const cycle = () => setUI({ sheet: sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek' });
  const setTab = (t: typeof tab) => setUI({ sheetTab: t, sheet: sheet === 'peek' ? 'half' : sheet });
  return (
    <div className="app phone">
      <TopBar phone />
      <div className="main">
        <MapView sim={sim} />
        <ModeBanner />
        <Toasts />
        <Menus onNewGame={onNewGame} onSave={save} />
        <PhoneSpeed />
        <div className="sheet" style={{ height: h }}>
          <div
            className="sheet-grip"
            onClick={cycle}
            onPointerDown={(e) => (drag.current = { y: e.clientY, s: sheet })}
            onPointerUp={(e) => {
              const d = drag.current;
              drag.current = null;
              if (!d) return;
              const dy = e.clientY - d.y;
              if (Math.abs(dy) < 20) return;
              const order = ['peek', 'half', 'full'] as const;
              const i = order.indexOf(d.s) + (dy < 0 ? 1 : -1);
              setUI({ sheet: order[Math.max(0, Math.min(2, i))] });
            }}
          >
            <i />
          </div>
          <div className="tabs">
            <button className={`tab ${tab === 'incidents' ? 'on' : ''}`} onClick={() => setTab('incidents')}>
              事案 <span className={`cnt ${pending ? 'hot' : ''}`}>{sim.activeIncidents().length}</span>
            </button>
            <button className={`tab ${tab === 'units' ? 'on' : ''}`} onClick={() => setTab('units')}>
              部隊
            </button>
            <button className={`tab ${tab === 'radio' ? 'on' : ''}`} onClick={() => setTab('radio')}>
              無線
            </button>
            <button className={`tab ${tab === 'detail' ? 'on' : ''}`} onClick={() => setTab('detail')}>
              詳細
            </button>
            <button className="tab" style={{ flex: 'none', width: 48 }} onClick={cycle} aria-label="パネル展開">
              {sheet === 'full' ? '▼' : '▲'}
            </button>
          </div>
          {sheet === 'peek' ? (
            <PhoneTicker />
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {tab === 'incidents' && <IncidentList />}
              {tab === 'units' && <UnitList />}
              {tab === 'radio' && <RadioPanel phone />}
              {tab === 'detail' && <DetailPanel />}
            </div>
          )}
        </div>
      </div>
      {driving && (
        <Suspense fallback={<div className="drive" />}>
          <DriveMode unitId={driving} />
        </Suspense>
      )}
    </div>
  );
}

function PhoneTicker() {
  const sim = useContextSim();
  const [, f] = useState(0);
  useEffect(() => sim.on((t) => t === 'radio' && f((x) => x + 1)), [sim]);
  const last = sim.radio[sim.radio.length - 1];
  if (!last) return null;
  return (
    <div className="radio-ticker" style={{ padding: '8px 12px', whiteSpace: 'normal', fontSize: 12.5, lineHeight: 1.4, maxHeight: 44 }} onClick={() => setUI({ sheetTab: 'radio', sheet: 'half' })}>
      <span className="mono muted">{sim.clockStr(last.t)} </span>
      <b style={{ color: last.from === '本部' ? 'var(--acc)' : undefined }}>{last.from}</b> {last.text}
    </div>
  );
}

function PhoneSpeed() {
  const sim = useContextSim();
  const [, f] = useState(0);
  return (
    <div className="map-ctrls" style={{ left: 8, top: 8 }}>
      <button
        className="btn"
        onClick={() => {
          const seq = [1, 2, 4, 8];
          if (sim.paused) sim.paused = false;
          else sim.speed = seq[(seq.indexOf(sim.speed) + 1) % seq.length];
          sim.emit('change');
          f((x) => x + 1);
        }}
        style={{ fontSize: 13, fontFamily: 'var(--mono)' }}
      >
        ×{sim.speed}
      </button>
      <button
        className="btn"
        onClick={() => {
          sim.paused = !sim.paused;
          sim.emit('change');
          f((x) => x + 1);
        }}
      >
        {sim.paused ? '▶' : 'Ⅱ'}
      </button>
    </div>
  );
}

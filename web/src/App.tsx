import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError, checkHealth, createScenario, decodeCells, deleteScenario, encodeCells,
  getScenario, listScenarios, postRun, type ScenarioSummary,
} from './api/client';
import { ControlPanel, SPEED_RANGE, type Brush } from './components/ControlPanel';
import { stepValue } from './components/controls/dialMath';
import { DroneCanvas } from './components/DroneCanvas';
import { TelemetryHud } from './components/TelemetryHud';
import { createPlanner, type PlanMode } from './engine/plannerBridge';
import { useShortcuts } from './input/useShortcuts';
import type { ShortcutAction } from './input/keymap';
import { Simulation, type SimStats } from './engine/simulation';
import { log } from './logger';
import { isDemoMode } from './demoMode';
import { IntroCard } from './components/intro/IntroCard';
import { IntroPill, IntroShield } from './components/intro/IntroOverlay';
import { useIntro } from './components/intro/useIntro';
import { decideIntro, defaultStorage, hasSeenIntro } from './intro/introStorage';
import { prefersReducedMotion } from './motion/spring';
import { buildPreset, type PresetName } from './scenarios/presets';

const GRID_W = 48;
const GRID_H = 30;

/** Root component: owns the simulation instance and wires UI state to it. */
export function App() {
  const [sim, setSim] = useState<Simulation | null>(null);
  const [stats, setStats] = useState<SimStats | null>(null);
  const [brush, setBrush] = useState<Brush>('wall');
  const [mode, setMode] = useState<PlanMode>('astar');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [radius, setRadius] = useState(6);
  const [showHeat, setShowHeat] = useState(true);
  const [showLidar, setShowLidar] = useState(true);
  const [apiOnline, setApiOnline] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const scenarioId = useRef<string | null>(null);
  // Decided once, at load: a first visit (or ?intro=1) plays the intro; ?intro=0 never does.
  const [introDecision] = useState(() => decideIntro({
    search: typeof location === 'undefined' ? '' : location.search,
    seen: hasSeenIntro(defaultStorage()),
    reducedMotion: prefersReducedMotion(),
  }));
  const animatedIntro = introDecision.show && introDecision.mode === 'animated';
  /** True while the intro paints the city: the renderer plays no search events. Starts true so the first frame is not the old map. */
  const quietRef = useRef(animatedIntro);
  const speedRef = useRef(1);

  useEffect(() => {
    let cancelled = false;
    createPlanner(GRID_W, GRID_H).then((planner) => {
      if (cancelled) return;
      const s = new Simulation(planner, (summary) => {
        if (isDemoMode()) return; // nothing to record to on the static demo
        postRun({ ...summary, scenarioId: scenarioId.current, engineMode: planner.mode })
          .catch((e) => log.warn('run not recorded', e instanceof ApiError ? e.message : e));
      });
      s.importState(buildPreset(animatedIntro ? 'Empty Arena' : introDecision.show ? 'Urban Canyon' : 'Dynamic Patrols', GRID_W, GRID_H));
      setStats({ ...s.stats });
      setSim(s);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { sim?.setMode(mode); }, [sim, mode]);
  useEffect(() => { if (sim) sim.speed = speed; }, [sim, speed]);
  useEffect(() => { if (sim) sim.lidarRadius = radius; }, [sim, radius]);

  // Telemetry snapshot a few times per second keeps React out of the 60 FPS loop.
  useEffect(() => {
    if (!sim) return;
    const id = setInterval(() => {
      setStats({ ...sim.stats });
      if (sim.over) setPlaying(false);
    }, 200);
    return () => clearInterval(id);
  }, [sim]);

  useEffect(() => {
    if (isDemoMode()) return; // no backend on the static demo; HUD shows the demo label
    let alive = true;
    const probe = () => checkHealth().then((ok) => alive && setApiOnline(ok));
    probe();
    const id = setInterval(probe, 8000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  /** Marks the console as scrollable so CSS only fades its bottom edge when content is actually clipped. */
  const consoleRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = consoleRef.current;
    if (!el) return;
    // Measure the panel itself, not scrollHeight: scroll mode adds 44px of bottom padding, which would otherwise flip the flag back and forth.
    const update = () => {
      const inner = el.firstElementChild as HTMLElement | null;
      if (!inner) return;
      const pad = el.hasAttribute('data-scroll') ? 44 : 0;
      el.toggleAttribute('data-scroll', inner.offsetHeight > el.clientHeight - pad + 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [sim]);

  // Keyboard shortcuts read the latest handlers through a ref, so the window listener is installed once.
  const onShortcut = useRef<(a: ShortcutAction) => void>(() => {});
  useShortcuts((a) => onShortcut.current(a));

  speedRef.current = speed;
  const intro = useIntro({
    sim, gridW: GRID_W, gridH: GRID_H, auto: introDecision.show ? introDecision.mode : null,
    setMode, setPlaying, quietRef,
    restoreSpeed: () => { if (sim) sim.speed = speedRef.current; },
  });
  const replayIntro = () => intro.replay(prefersReducedMotion() ? 'card' : 'animated');

  const refreshScenarios = useCallback(() => {
    listScenarios().then(setScenarios).catch(() => setApiOnline(false));
  }, []);

  if (!sim || !stats) {
    return <div className="loading">Loading planner engine...</div>;
  }

  const stop = () => { setPlaying(false); sim.setPlaying(false); };
  const togglePlay = () => {
    if (!playing && sim.over) sim.reset();
    sim.setPlaying(!playing);
    setPlaying(!playing);
  };

  onShortcut.current = (a) => {
    if (intro.ui.status === 'running' || intro.ui.status === 'card') return; // the intro owns the keyboard (Esc skips)
    switch (a.type) {
      case 'togglePlay': togglePlay(); break;
      case 'reset': stop(); sim.reset(); break;
      case 'toggleMode': setMode((m) => (m === 'astar' ? 'dstar' : 'astar')); break;
      case 'toggleHeat': setShowHeat((v) => !v); break;
      case 'toggleLidar': setShowLidar((v) => !v); break;
      case 'brush': setBrush(a.brush); break;
      case 'replayIntro': replayIntro(); break;
      case 'speed': setSpeed((v) => stepValue(v, SPEED_RANGE, a.dir)); break;
    }
  };

  const onSave = async (name: string): Promise<string> => {
    try {
      const st = sim.exportState();
      const saved = await createScenario({
        name, width: sim.width, height: sim.height, cells: encodeCells(st.cells),
        start: st.start, goal: st.goal, patrols: st.patrols,
      });
      scenarioId.current = saved.id;
      refreshScenarios();
      return `Saved "${saved.name}"`;
    } catch (e) {
      if (e instanceof ApiError && e.offline) setApiOnline(false);
      return e instanceof ApiError && e.offline ? 'API offline, nothing saved' : `Save failed: ${(e as Error).message}`;
    }
  };

  const onLoad = async (id: string) => {
    try {
      const s = await getScenario(id);
      stop();
      const ok = sim.importState({ cells: decodeCells(s.cells), start: s.start, goal: s.goal, patrols: s.patrols });
      if (ok) scenarioId.current = id;
      else log.warn(`scenario ${id} has size ${s.width}x${s.height}, expected ${sim.width}x${sim.height}`);
    } catch (e) {
      if (e instanceof ApiError && e.offline) setApiOnline(false);
    }
  };

  const onDelete = async (id: string) => {
    try { await deleteScenario(id); refreshScenarios(); } catch { setApiOnline(false); }
  };

  return (
    <div className="app" data-intro={intro.ui.status === 'idle' ? undefined : intro.ui.status}>
      <header>
        <h1>Drone Obstacle Sandbox</h1>
        <span>Real-time A* and D* Lite replanning with LiDAR</span>
      </header>
      <main>
        <div className="left">
          <div className="deck">
            <section className="stage"><DroneCanvas sim={sim} brush={brush} showHeat={showHeat} showLidar={showLidar} quietRef={quietRef} />
              <IntroPill ui={intro.ui} />
            </section>
            <TelemetryHud engine={sim.planner.mode} stats={stats} apiOnline={apiOnline} demo={isDemoMode()} />
          </div>
        </div>
        <aside className="console" ref={consoleRef}>
          <ControlPanel
            brush={brush} onBrush={setBrush}
            mode={mode} onMode={setMode}
            playing={playing} onTogglePlay={togglePlay}
            onReset={() => { stop(); sim.reset(); }}
            onClear={() => { stop(); scenarioId.current = null; sim.clearMap(); }}
            onPreset={(n: PresetName) => { stop(); scenarioId.current = null; sim.importState(buildPreset(n, GRID_W, GRID_H)); }}
            speed={speed} onSpeed={setSpeed}
            radius={radius} onRadius={setRadius}
            showHeat={showHeat} onShowHeat={setShowHeat}
            showLidar={showLidar} onShowLidar={setShowLidar}
            apiOnline={apiOnline} demo={isDemoMode()} scenarios={scenarios}
            onRefreshScenarios={refreshScenarios}
            onSave={onSave} onLoad={onLoad} onDelete={onDelete}
            onReplayIntro={replayIntro}
          />
        </aside>
      </main>
      <IntroShield active={intro.ui.status === 'running'} onSkip={intro.skip} />
      {intro.ui.status === 'card' && <IntroCard onDismiss={intro.skip} />}
    </div>
  );
}

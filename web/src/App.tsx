import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError, checkHealth, createScenario, decodeCells, deleteScenario, encodeCells,
  getScenario, listScenarios, postRun, type ScenarioSummary,
} from './api/client';
import { ControlPanel, type Brush } from './components/ControlPanel';
import { DroneCanvas } from './components/DroneCanvas';
import { TelemetryHud } from './components/TelemetryHud';
import { createPlanner, type PlanMode } from './engine/plannerBridge';
import { Simulation, type SimStats } from './engine/simulation';
import { log } from './logger';
import { isDemoMode } from './demoMode';
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

  useEffect(() => {
    let cancelled = false;
    createPlanner(GRID_W, GRID_H).then((planner) => {
      if (cancelled) return;
      const s = new Simulation(planner, (summary) => {
        if (isDemoMode()) return; // nothing to record to on the static demo
        postRun({ ...summary, scenarioId: scenarioId.current, engineMode: planner.mode })
          .catch((e) => log.warn('run not recorded', e instanceof ApiError ? e.message : e));
      });
      s.importState(buildPreset('Dynamic Patrols', GRID_W, GRID_H));
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
    <div className="app">
      <header>
        <h1>Drone Obstacle Sandbox</h1>
        <span>Real-time A* and D* Lite replanning with LiDAR</span>
      </header>
      <main>
        <section className="stage"><DroneCanvas sim={sim} brush={brush} showHeat={showHeat} showLidar={showLidar} /></section>
        <aside>
          <TelemetryHud engine={sim.planner.mode} stats={stats} apiOnline={apiOnline} demo={isDemoMode()} />
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
          />
        </aside>
      </main>
    </div>
  );
}

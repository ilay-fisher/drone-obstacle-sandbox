import { useState } from 'react';
import type { ScenarioSummary } from '../api/client';
import { REPO_URL } from '../demoMode';
import type { PlanMode } from '../engine/plannerBridge';
import { PRESET_NAMES, type PresetName } from '../scenarios/presets';

export type Brush = 'wall' | 'wind' | 'patrol' | 'target' | 'erase';

const BRUSHES: { id: Brush; label: string }[] = [
  { id: 'wall', label: 'Draw Wall' },
  { id: 'wind', label: 'Wind Zone (4x)' },
  { id: 'patrol', label: 'Spawn Moving Obstacle' },
  { id: 'target', label: 'Move Target' },
  { id: 'erase', label: 'Erase' },
];

export interface ControlPanelProps {
  brush: Brush;
  onBrush: (b: Brush) => void;
  mode: PlanMode;
  onMode: (m: PlanMode) => void;
  playing: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  onClear: () => void;
  onPreset: (p: PresetName) => void;
  speed: number;
  onSpeed: (v: number) => void;
  radius: number;
  onRadius: (v: number) => void;
  showHeat: boolean;
  onShowHeat: (v: boolean) => void;
  showLidar: boolean;
  onShowLidar: (v: boolean) => void;
  apiOnline: boolean;
  /** Static demo build: replace the save/load UI with an explanatory note. */
  demo?: boolean;
  scenarios: ScenarioSummary[];
  onRefreshScenarios: () => void;
  onSave: (name: string) => Promise<string>;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{p.label}<b>{p.fmt(p.value)}</b></span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  );
}

/** Right-hand control panel: brushes, presets, algorithm, sliders, overlays and scenario storage. */
export function ControlPanel(p: ControlPanelProps) {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [listOpen, setListOpen] = useState(false);

  const save = async () => setMsg(await p.onSave(name.trim() || 'Untitled scenario'));
  const toggleList = () => {
    if (!listOpen) p.onRefreshScenarios();
    setListOpen(!listOpen);
  };

  return (
    <div className="panel">
      <section>
        <h3>Brush</h3>
        <div className="grid2">
          {BRUSHES.map((b) => (
            <button key={b.id} className={p.brush === b.id ? 'btn active' : 'btn'} onClick={() => p.onBrush(b.id)}>{b.label}</button>
          ))}
        </div>
      </section>

      <section>
        <h3>Presets</h3>
        <div className="row">
          {PRESET_NAMES.map((n) => <button key={n} className="btn" onClick={() => p.onPreset(n)}>{n}</button>)}
        </div>
      </section>

      <section>
        <h3>Algorithm</h3>
        <div className="seg">
          <button className={p.mode === 'astar' ? 'active' : ''} onClick={() => p.onMode('astar')}>A*</button>
          <button className={p.mode === 'dstar' ? 'active' : ''} onClick={() => p.onMode('dstar')}>D* Lite</button>
        </div>
      </section>

      <section>
        <div className="row">
          <button className="btn primary" onClick={p.onTogglePlay}>{p.playing ? 'Pause' : 'Play'}</button>
          <button className="btn" onClick={p.onReset}>Reset Drone</button>
          <button className="btn" onClick={p.onClear}>Clear Map</button>
        </div>
        <Slider label="Drone Speed" value={p.speed} min={0.5} max={4} step={0.5} fmt={(v) => `${v.toFixed(1)}x`} onChange={p.onSpeed} />
        <Slider label="LiDAR Radius" value={p.radius} min={3} max={8} step={1} fmt={(v) => `${v} cells`} onChange={p.onRadius} />
        <Toggle label="Show Search Heatmap" value={p.showHeat} onChange={p.onShowHeat} />
        <Toggle label="Show LiDAR Cone" value={p.showLidar} onChange={p.onShowLidar} />
      </section>

      <section>
        <h3>Scenarios {!p.apiOnline && !p.demo && <span className="badge off">API offline</span>}</h3>
        {p.demo ? (
          <div className="note">
            Saving and loading scenarios requires running the full stack locally.{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">See the README</a>.
          </div>
        ) : (
          <>
            <div className="row">
              <input className="text" placeholder="Scenario name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <button className="btn" disabled={!p.apiOnline} onClick={save}>Save Scenario</button>
            </div>
            <button className="btn wide" disabled={!p.apiOnline} onClick={toggleList}>Load Scenario</button>
            {msg && <div className="note">{msg}</div>}
            {listOpen && p.apiOnline && (
              <ul className="scenarios">
                {p.scenarios.length === 0 && <li className="note">No saved scenarios</li>}
                {p.scenarios.map((s) => (
                  <li key={s.id}>
                    <button className="link" onClick={() => p.onLoad(s.id)}>{s.name}</button>
                    <button className="link danger" aria-label={`Delete ${s.name}`} onClick={() => p.onDelete(s.id)}>delete</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}

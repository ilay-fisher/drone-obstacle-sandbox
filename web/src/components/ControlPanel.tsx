import { useId, useState, type ReactNode } from 'react';
import type { ScenarioSummary } from '../api/client';
import { REPO_URL } from '../demoMode';
import type { PlanMode } from '../engine/plannerBridge';
import { BRUSH_KEYS, type Brush } from '../input/keymap';
import { PRESET_NAMES, type PresetName } from '../scenarios/presets';
import { Dial } from './controls/Dial';
import {
  ChevronIcon, ClearIcon, EraseIcon, GoalIcon, PatrolIcon, PauseIcon, PlayIcon, ResetIcon, WallIcon, WindIcon,
} from './controls/icons';
import { Keycap } from './controls/Keycap';
import { Switch } from './controls/Switch';

export type { Brush };

/** Dial ranges, shared with the keyboard shortcuts in App so `[` and `]` step the same detents. */
export const SPEED_RANGE = { min: 0.5, max: 4, step: 0.5 } as const;
export const RADIUS_RANGE = { min: 3, max: 8, step: 1 } as const;

const TOOLS: { id: Brush; legend: string; icon: ReactNode }[] = [
  { id: 'wall', legend: 'Wall', icon: <WallIcon /> },
  { id: 'wind', legend: 'Wind', icon: <WindIcon /> },
  { id: 'patrol', legend: 'Patrol', icon: <PatrolIcon /> },
  { id: 'target', legend: 'Goal', icon: <GoalIcon /> },
  { id: 'erase', legend: 'Erase', icon: <EraseIcon /> },
];

type TabId = 'fly' | 'plan' | 'build';
const TABS: { id: TabId; label: string }[] = [
  { id: 'fly', label: 'Fly' },
  { id: 'plan', label: 'Plan' },
  { id: 'build', label: 'Build' },
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
  /** Shows a "?" keycap that replays the guided intro. */
  onReplayIntro?: () => void;
}

/** A bevelled tray holding one task group, labelled by an engraved pill. */
function Tray({ id, title, active, children }: { id: TabId; title: string; active: boolean; children: ReactNode }) {
  const labelId = useId();
  return (
    <section className="tray" id={`tray-${id}`} aria-labelledby={labelId} data-active={active || undefined}>
      <h3 className="pill tray-label" id={labelId}>{title}</h3>
      {children}
    </section>
  );
}

/** The collapsible Scenarios tray at the bottom of Build; keeps the demo note and the API-offline state. */
function Scenarios(p: ControlPanelProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const bodyId = useId();
  const online = p.apiOnline;

  const toggle = () => {
    if (!open && !p.demo) p.onRefreshScenarios();
    setOpen(!open);
  };
  const save = async () => setMsg(await p.onSave(name.trim() || 'Untitled scenario'));

  return (
    <div className="drawer" data-open={open || undefined}>
      <button type="button" className="drawer-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <span>Scenarios</span>
        {!p.demo && !online && <span className="badge off">API offline</span>}
        <ChevronIcon />
      </button>
      <div className="drawer-body" id={bodyId} {...(open ? {} : { inert: '' })}>
        <div className="drawer-inner">
          {p.demo ? (
            <div className="note">
              Saving and loading scenarios requires running the full stack locally.{' '}
              <a href={REPO_URL} target="_blank" rel="noreferrer">See the README</a>.
            </div>
          ) : (
            <>
              <div className="row">
                <input className="text" placeholder="Scenario name" aria-label="Scenario name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                <button type="button" className="btn" disabled={!online} onClick={save}>Save</button>
              </div>
              {msg && <div className="note">{msg}</div>}
              {online && (
                <ul className="scenarios">
                  {p.scenarios.length === 0 && <li className="note">No saved scenarios</li>}
                  {p.scenarios.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="link" onClick={() => p.onLoad(s.id)}>{s.name}</button>
                      <button type="button" className="link danger" aria-label={`Delete ${s.name}`} onClick={() => p.onDelete(s.id)}>delete</button>
                    </li>
                  ))}
                </ul>
              )}
              {!online && <div className="note">The API is offline, so scenarios cannot be saved or loaded.</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The console as hardware, in three task trays: Fly (play, reset, clear, speed dial), Plan
 * (algorithm switch, LiDAR dial, overlay rockers) and Build (tool keycaps, preset cartridges,
 * scenarios). Below 1024 px a segmented Fly / Plan / Build switch shows one tray at a time
 * (pure CSS on `data-tab`), which keeps the stacked console short on a phone.
 */
export function ControlPanel(p: ControlPanelProps) {
  const [tab, setTab] = useState<TabId>('fly');

  return (
    <div className="panel" data-tab={tab}>
      <div className="tabs" role="tablist" aria-label="Console group">
        {TABS.map((t) => (
          <button
            key={t.id} type="button" role="tab" className="tab"
            id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`tray-${t.id}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      <Tray id="fly" title="Fly" active={tab === 'fly'}>
        <div className="fly-row">
          <Keycap
            variant="primary" legend={p.playing ? 'Pause' : 'Play'} label={p.playing ? 'Pause' : 'Play'}
            shortcut="Space" icon={p.playing ? <PauseIcon /> : <PlayIcon />} onClick={p.onTogglePlay}
          />
          <div className="key-stack">
            <Keycap legend="Reset" shortcut="R" icon={<ResetIcon />} onClick={p.onReset} />
            <Keycap legend="Clear" icon={<ClearIcon />} onClick={p.onClear} />
          </div>
          <Dial label="Speed" value={p.speed} {...SPEED_RANGE} format={(v) => `${v.toFixed(1)}x`} onChange={p.onSpeed} />
        </div>
      </Tray>

      <Tray id="plan" title="Plan" active={tab === 'plan'}>
        <Switch
          variant="toggle" label="D* Lite planner" legends={['A*', 'D* Lite']} shortcut="M"
          checked={p.mode === 'dstar'} onChange={(on) => p.onMode(on ? 'dstar' : 'astar')}
        />
        <div className="plan-row">
          <Dial label="LiDAR radius" value={p.radius} {...RADIUS_RANGE} format={(v) => `${v} cells`} onChange={p.onRadius} />
          <div className="rockers">
            <div className="rocker-row">
              <Switch variant="rocker" label="Heatmap overlay" shortcut="H" checked={p.showHeat} onChange={p.onShowHeat} />
              <span className="rocker-name">Heatmap<kbd className="keycap-key" aria-hidden="true">H</kbd></span>
            </div>
            <div className="rocker-row">
              <Switch variant="rocker" label="LiDAR overlay" shortcut="L" checked={p.showLidar} onChange={p.onShowLidar} />
              <span className="rocker-name">LiDAR<kbd className="keycap-key" aria-hidden="true">L</kbd></span>
            </div>
          </div>
        </div>
      </Tray>

      <Tray id="build" title="Build" active={tab === 'build'}>
        <div className="tool-row">
          {TOOLS.map((t) => (
            <Keycap
              key={t.id} variant="tool" legend={t.legend} shortcut={BRUSH_KEYS[t.id]} icon={t.icon}
              pressed={p.brush === t.id} onClick={() => p.onBrush(t.id)}
            />
          ))}
        </div>
        <div className="cartridges" role="group" aria-label="Presets">
          {PRESET_NAMES.map((n) => (
            <button key={n} type="button" className="cartridge" onClick={() => p.onPreset(n)}>
              <span className="cartridge-pins" aria-hidden="true" />
              <span className="cartridge-name">{n}</span>
            </button>
          ))}
        </div>
        <Scenarios {...p} />
      </Tray>

      {p.onReplayIntro && (
        <div className="panel-foot">
          <Keycap legend="Intro" label="Show the intro again" shortcut="?" onClick={p.onReplayIntro} />
        </div>
      )}
    </div>
  );
}

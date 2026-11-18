import { useRef } from 'react';
import type { EngineMode } from '../engine/plannerBridge';
import type { SimStats } from '../engine/simulation';
import { Counter } from './instruments/CounterReadout';
import { nextDeltaState, type DeltaState } from './instruments/delta';
import { Gauge } from './instruments/GaugeDial';

interface Props {
  engine: EngineMode;
  stats: SimStats;
  apiOnline: boolean;
  /** Static demo build: there is no backend, so show a label instead of online/offline. */
  demo?: boolean;
}

/**
 * Instrument strip under the map: a status lamp, a latency needle gauge, mechanical counters
 * for nodes and replans, a path cost well with a delta chip, and engraved engine and API
 * pills. It receives a plain snapshot, so it re-renders only on the 200 ms telemetry tick.
 * Every value is exactly what `SimStats` holds; only the latency text is formatted (under
 * 0.1 ms it reads "< 0.1 ms" because the timer cannot resolve it).
 */
export function TelemetryHud({ engine, stats, apiOnline, demo = false }: Props) {
  const statusClass = stats.status.replace(' ', '-').toLowerCase();
  const memo = useRef<DeltaState>({ replans: stats.replans, cost: stats.pathCost, delta: null });
  memo.current = nextDeltaState(memo.current, stats.replans, stats.pathCost);
  const { delta } = memo.current;

  return (
    <section className="hud" aria-label="Telemetry">
      <div className="hud-status">
        <span className={`status ${statusClass}`} role="status" aria-label={`Mission status: ${stats.status}`}>
          <i className="lamp" aria-hidden="true" />
          <span className="status-word">{stats.status.toUpperCase()}</span>
        </span>
        <span className="pill"><span className="pill-k">Engine</span>{engine}</span>
        <span className="pill">
          <i className={apiOnline ? 'dot on' : 'dot off'} aria-hidden="true" />
          <span className="pill-k">API</span>{demo ? 'demo' : apiOnline ? 'online' : 'offline'}
        </span>
      </div>
      <Gauge ms={stats.lastLatencyMs} />
      <Counter label="Nodes expanded" value={stats.lastExpanded} minWidth={4} />
      <Counter label="Total replans" value={stats.replans} minWidth={3} />
      <div className="readout cost">
        <span className="readout-k">Path cost</span>
        <output className="readout-v">{stats.pathCost < 0 ? 'no path' : stats.pathCost.toFixed(2)}</output>
        {delta && (
          <span className="delta" data-dir={delta.dir} key={stats.replans} aria-label={`Changed by ${delta.text} after the last replan`}>
            {delta.text}
          </span>
        )}
      </div>
    </section>
  );
}

import type { EngineMode } from '../engine/plannerBridge';
import type { SimStats } from '../engine/simulation';

interface Props {
  engine: EngineMode;
  stats: SimStats;
  apiOnline: boolean;
  /** Static demo build: there is no backend, so show a label instead of online/offline. */
  demo?: boolean;
}

/** Live telemetry readout. Receives a plain snapshot, so it re-renders a few times per second. */
export function TelemetryHud({ engine, stats, apiOnline, demo = false }: Props) {
  const rows: [string, string][] = [
    ['Engine Mode', engine],
    ['Replan Latency', `${stats.lastLatencyMs.toFixed(3)} ms`],
    ['Nodes Expanded', String(stats.lastExpanded)],
    ['Path Cost', stats.pathCost < 0 ? 'no path' : stats.pathCost.toFixed(2)],
    ['Total Replans', String(stats.replans)],
    ['Mission Status', stats.status],
  ];
  return (
    <div className="hud">
      <h3>Telemetry</h3>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="hud-row">
            <dt>{k}</dt>
            <dd className={k === 'Mission Status' ? `status ${stats.status.replace(' ', '-').toLowerCase()}` : ''}>{v}</dd>
          </div>
        ))}
        <div className="hud-row">
          <dt>API</dt>
          <dd>
            <span className={apiOnline ? 'dot on' : 'dot off'} />
            {demo ? 'demo (no backend)' : apiOnline ? 'online' : 'offline'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

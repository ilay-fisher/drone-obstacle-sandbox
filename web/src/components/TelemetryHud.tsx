import { formatLatency } from '../format';
import type { EngineMode } from '../engine/plannerBridge';
import type { SimStats } from '../engine/simulation';

interface Props {
  engine: EngineMode;
  stats: SimStats;
  apiOnline: boolean;
  /** Static demo build: there is no backend, so show a label instead of online/offline. */
  demo?: boolean;
}

/**
 * Live telemetry readout. Receives a plain snapshot, so it re-renders a few times per
 * second. Every value is exactly what `SimStats` holds; only the latency text is formatted
 * (values under 0.1 ms read "< 0.1 ms" because the timer cannot resolve them).
 */
export function TelemetryHud({ engine, stats, apiOnline, demo = false }: Props) {
  const statusClass = stats.status.replace(' ', '-').toLowerCase();
  const rows: [string, string][] = [
    ['Replan Latency', formatLatency(stats.lastLatencyMs)],
    ['Nodes Expanded', String(stats.lastExpanded)],
    ['Path Cost', stats.pathCost < 0 ? 'no path' : stats.pathCost.toFixed(2)],
    ['Total Replans', String(stats.replans)],
  ];
  return (
    <section className="hud" aria-label="Telemetry">
      <div className="hud-status">
        <span className="hud-label">Mission Status</span>
        <span className={`status ${statusClass}`}><i className="lamp" />{stats.status}</span>
      </div>
      <dl className="hud-grid">
        {rows.map(([k, v]) => (
          <div key={k} className="readout">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="chips">
        <span className="chip"><span className="chip-k">Engine</span>{engine}</span>
        <span className="chip">
          <i className={apiOnline ? 'dot on' : 'dot off'} />
          <span className="chip-k">API</span>{demo ? 'demo (no backend)' : apiOnline ? 'online' : 'offline'}
        </span>
      </div>
    </section>
  );
}

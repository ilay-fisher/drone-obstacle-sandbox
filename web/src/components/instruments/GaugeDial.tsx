import { formatLatency } from '../../format';
import { GAUGE_TICKS, gaugeAngle } from './gauge';

/** Pivot of the needle in the SVG box and the radii of the printed scale. */
const CX = 60;
const CY = 62;
const R_OUT = 50;
const R_TICK = 44;
const R_LABEL = 36;
const NEEDLE = 42;

/** Point on the dial at `deg` (0 is straight up) and radius `r`. */
function polar(deg: number, r: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}

/**
 * Latency needle gauge, 0 to 5 ms (linear to 1 ms, log after). The needle is a CSS `rotate`
 * with the snappy spring transition, so each new value springs into place; under reduced
 * motion the transition is off and it snaps. The exact formatted number sits under the dial.
 */
export function Gauge({ ms }: { ms: number }) {
  const text = formatLatency(ms);
  const [x0, y0] = polar(gaugeAngle(0), R_OUT);
  const [x1, y1] = polar(gaugeAngle(5), R_OUT);
  return (
    <div className="readout gauge">
      <span className="readout-k">Replan latency</span>
      <svg viewBox="0 0 120 70" className="gauge-dial" role="img" aria-label={`Latency needle ${text}`} focusable="false">
        <path className="gauge-arc" d={`M ${x0} ${y0} A ${R_OUT} ${R_OUT} 0 0 1 ${x1} ${y1}`} />
        {GAUGE_TICKS.map((t) => {
          const a = gaugeAngle(t.ms);
          const [ax, ay] = polar(a, R_TICK);
          const [bx, by] = polar(a, R_OUT - 2);
          const [lx, ly] = polar(a, R_LABEL);
          return (
            <g key={t.ms}>
              <line className={t.major ? 'gauge-tick major' : 'gauge-tick'} x1={ax} y1={ay} x2={bx} y2={by} />
              {t.label && <text className="gauge-num" x={lx} y={ly + 3} textAnchor="middle">{t.label}</text>}
            </g>
          );
        })}
        <g className="gauge-needle" style={{ rotate: `${gaugeAngle(ms)}deg`, transformOrigin: `${CX}px ${CY}px` }}>
          <line x1={CX} y1={CY + 6} x2={CX} y2={CY - NEEDLE} />
        </g>
        <circle className="gauge-hub" cx={CX} cy={CY} r={5} />
      </svg>
      <output className="readout-v">{text}</output>
    </div>
  );
}

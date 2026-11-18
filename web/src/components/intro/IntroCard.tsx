import { useEffect, useId, useRef } from 'react';
import { INTRO_STEPS, OUTRO_CAPTION } from '../../intro/introScript';

/** Buildings of the Urban Canyon sketch: [x, y, w, h] on a 240 x 150 sheet, an avenue between the two rows. */
const TOP = [[14, 8, 34, 46], [58, 8, 34, 40], [102, 8, 34, 46], [146, 8, 34, 42], [190, 8, 36, 46]];
const BOT = [[14, 98, 34, 44], [58, 102, 34, 40], [102, 98, 34, 44], [146, 100, 34, 42], [190, 98, 36, 44]];
const BLOCKS = [...TOP, ...BOT];
const START = { x: 20, y: 76 };
const GOAL = { x: 222, y: 76 };
/** The wall of steps 3 and 4: five cells across the avenue, clear of the buildings. */
const WALL = [58, 62, 8, 28];
const ROUTE_STRAIGHT = `M${START.x} ${START.y} H${GOAL.x}`;
const ROUTE_REPAIRED = `M${START.x} ${START.y} H46 C54 76 52 56 62 56 H64 C74 56 72 76 82 76 H${GOAL.x}`;

/** Shared gradients and filters, defined once; the panels only reference them. Static, so no per-frame cost. */
function ArtDefs() {
  return (
    <svg className="art-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {/* top-left light: the roof is lighter at the top-left and falls off to the lower right */}
        <linearGradient id="art-roof" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="art-roof-hi" />
          <stop offset="1" className="art-roof-lo" />
        </linearGradient>
        <filter id="art-contact" x="-30%" y="-30%" width="170%" height="170%"><feGaussianBlur stdDeviation="2.6" /></filter>
        <filter id="art-glow" x="-10%" y="-80%" width="120%" height="260%"><feGaussianBlur stdDeviation="3" /></filter>
        <filter id="art-region" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="7" /></filter>
        <filter id="art-ring" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
    </svg>
  );
}

function Building({ b, wall = false }: { b: number[]; wall?: boolean }) {
  const [x, y, w, h] = b;
  const r = wall ? 2.4 : 4.5;
  return (
    <g>
      <rect x={x + 3} y={y + 4.5} width={w} height={h} rx={r} className="art-contact" filter="url(#art-contact)" />
      <rect x={x + 1} y={y + 2.4} width={w} height={h} rx={r} className="art-side" />
      <rect x={x} y={y} width={w} height={h} rx={r} className="art-roof" />
      <rect x={x + 0.6} y={y + 0.6} width={w - 1.2} height={h - 1.2} rx={r - 0.6} className="art-lit" />
    </g>
  );
}

function Drone({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="art-drone">
      <circle cx="0" cy="1.5" r="9" className="art-drone-shadow" />
      {[[-5.4, -5.4], [5.4, -5.4], [-5.4, 5.4], [5.4, 5.4]].map(([dx, dy]) => <circle key={`${dx}${dy}`} cx={dx} cy={dy} r="3.6" className="art-rotor" />)}
      <circle r="3" className="art-body" />
      <circle cx="0" cy="-1.4" r="0.9" className="art-nav" />
    </g>
  );
}

function Goal() {
  return (
    <g transform={`translate(${GOAL.x} ${GOAL.y})`}>
      <circle r="6" className="art-goal-glow" filter="url(#art-ring)" />
      <circle r="5.6" className="art-goal" />
      <circle r="1.8" className="art-goal-dot" />
    </g>
  );
}

function Route({ d }: { d: string }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} className="art-route-glow" filter="url(#art-glow)" />
      <path d={d} className="art-route" />
      <path d={d} className="art-route-hi" />
    </g>
  );
}

/**
 * Finished-state sketches of the four steps, drawn like the live map: rounded relief buildings
 * lit from the top left with a contact shadow to the lower right, the orange route with its soft
 * glow, a paper-white A* region, a deep-orange D* repair region, the drone and the orange goal
 * ring. Inline SVG, static, token-coloured, no motion.
 */
function PanelArt({ step }: { step: 0 | 1 | 2 | 3 }) {
  return (
    <svg viewBox="0 0 240 150" className="card-art" aria-hidden="true" focusable="false">
      <rect width="240" height="150" rx="12" className="art-ground" />
      <g className="art-dots">
        {Array.from({ length: 8 }, (_, i) => Array.from({ length: 12 }, (_, j) => <circle key={`${i}-${j}`} cx={10 + j * 20} cy={9 + i * 19} r="0.8" />))}
      </g>
      {step === 1 && <ellipse cx="92" cy="76" rx="76" ry="19" className="art-astar" filter="url(#art-region)" />}
      {step === 3 && <ellipse cx="62" cy="68" rx="24" ry="16" className="art-dstar" filter="url(#art-region)" />}
      {BLOCKS.map((b, i) => <Building key={i} b={b} />)}
      {step >= 1 && <Route d={step === 3 ? ROUTE_REPAIRED : ROUTE_STRAIGHT} />}
      {step === 2 && <path d="M20 76 L65.3 54.9 A50 50 0 0 1 65.3 97.1 Z" className="art-lidar-fill" />}
      {step === 2 && <circle cx={START.x} cy={START.y} r="50" className="art-lidar" />}
      {step >= 2 && <Building b={WALL} wall />}
      <Goal />
      <Drone x={START.x} y={START.y} />
    </svg>
  );
}

/**
 * Reduced-motion form of the intro: a static four-panel card in a modal dialog. Focus moves to
 * the dismiss button on open and returns to where it was on close; Tab stays inside the card
 * (the only element in it that takes focus is the button), and Esc closes it.
 */
export function IntroCard({ onDismiss }: { onDismiss: () => void }) {
  const titleId = useId();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onDismiss(); }
      else if (e.key === 'Tab') { e.preventDefault(); button.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); before?.focus?.(); };
  }, [onDismiss]);
  return (
    <div className="intro-backdrop">
      <div className="intro-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>How the drone flies</h2>
        <ArtDefs />
        <ol className="card-steps">
          {INTRO_STEPS.map((s, i) => (
            <li key={s.id}>
              <PanelArt step={i as 0 | 1 | 2 | 3} />
              <p><span className="card-num">{s.id}</span>{s.caption}</p>
            </li>
          ))}
        </ol>
        <p className="card-turn">{OUTRO_CAPTION}</p>
        <button ref={button} type="button" className="card-btn" onClick={onDismiss}>Got it</button>
      </div>
    </div>
  );
}

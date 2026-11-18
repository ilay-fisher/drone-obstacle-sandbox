import { useEffect, useId, useRef } from 'react';
import { INTRO_STEPS, OUTRO_CAPTION } from '../../intro/introScript';

const BLOCKS = [[16, 14, 18, 22], [46, 10, 16, 26], [76, 16, 20, 20], [110, 12, 18, 28], [18, 58, 20, 24], [52, 62, 16, 20], [84, 58, 18, 26], [116, 60, 20, 22]];

/** Finished-state sketches of the four steps: static, token-coloured, no motion. */
function PanelArt({ step }: { step: 0 | 1 | 2 | 3 }) {
  const route = step >= 3 ? 'M8 50 L40 50 L40 44 L72 44 L72 50 L100 50 L100 44 L152 44' : 'M8 50 L152 50';
  return (
    <svg viewBox="0 0 160 100" className="card-art" aria-hidden="true" focusable="false">
      <rect width="160" height="100" rx="10" className="art-ground" />
      {BLOCKS.map((b, i) => <rect key={'s' + i} x={b[0] + 1} y={b[1] + 1.6} width={b[2]} height={b[3]} rx="4" className="art-wall-shadow" />)}
      {BLOCKS.map((b, i) => <rect key={i} x={b[0]} y={b[1]} width={b[2]} height={b[3]} rx="4" className="art-wall" />)}
      {step === 1 && [34, 52, 70, 88, 106].map((x, i) => <circle key={x} cx={x} cy="50" r={4 + i * 2.5} className="art-wave" />)}
      {step >= 1 && <path d={route} className="art-route" />}
      {step >= 2 && <rect x="84" y="36" width="5" height="28" rx="2" className="art-block" />}
      {step === 2 && <path d="M30 34 a16 16 0 0 1 0 32" className="art-lidar" />}
      {step === 3 && [[84, 46], [90, 46], [96, 46], [84, 52], [90, 52]].map(([x, y]) => <rect key={x + '-' + y} x={x} y={y} width="5" height="5" rx="1.5" className="art-ember" />)}
      <circle cx="8" cy="50" r="3.5" className="art-drone" />
      <circle cx="152" cy="50" r="4" className="art-goal" />
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

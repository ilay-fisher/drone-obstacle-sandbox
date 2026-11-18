import { INTRO_STEPS } from '../../intro/introScript';
import type { IntroUi } from './useIntro';

/**
 * The caption pill, bottom centre of the map. A polite live region, so a screen reader hears
 * each step once. It never takes focus and has no pointer events; the shield above the page
 * (see `IntroShield`) is what turns a click into "skip".
 */
export function IntroPill({ ui }: { ui: IntroUi }) {
  if (ui.status !== 'running' && ui.status !== 'outro') return null;
  const outro = ui.status === 'outro';
  return (
    <div className="intro-pill" data-outro={outro || undefined} data-step={ui.step}>
      <span className="intro-pips" aria-hidden="true">
        {INTRO_STEPS.map((s, i) => (
          <i key={s.id} data-on={outro || i <= ui.step || undefined} data-now={i === ui.step || undefined} />
        ))}
      </span>
      <span className="intro-caption" role="status" aria-live="polite">
        <span key={ui.caption} className="intro-caption-text">{ui.caption}</span>
      </span>
      {!outro && <span className="intro-skip" aria-hidden="true"><kbd>Esc</kbd> skip</span>}
    </div>
  );
}

/** A transparent sheet over the page while the animated intro runs: any click or tap skips it. Not focusable, so nothing is trapped. */
export function IntroShield({ active, onSkip }: { active: boolean; onSkip: () => void }) {
  if (!active) return null;
  return <div className="intro-shield" aria-hidden="true" onPointerDown={(e) => { e.preventDefault(); onSkip(); }} />;
}

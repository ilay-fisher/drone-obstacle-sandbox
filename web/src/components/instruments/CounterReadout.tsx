import { memo, useLayoutEffect, useRef, useState } from 'react';
import { SPRING_SNAPPY, prefersReducedMotion, settleTime, springToLinear } from '../../motion/spring';
import { digitsOf, rollPath } from './counter';

/** The snappy spring as a CSS `linear()` string, the same easing as `--spring-snappy`, for the Web Animations API. */
const SNAPPY_EASING = springToLinear(SPRING_SNAPPY);
const ROLL_MS = settleTime(SPRING_SNAPPY) * 1000;

/**
 * One counter wheel. When its digit changes it renders the digits it passes (forward only,
 * like an odometer) and slides that strip on the snappy spring with the Web Animations API,
 * then collapses back to a single digit. Under reduced motion the digit just changes.
 */
const Wheel = memo(function Wheel({ digit, lit }: { digit: number; lit: boolean }) {
  const [path, setPath] = useState<number[]>([digit]);
  const target = useRef(digit);
  const strip = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (digit === target.current) return;
    const from = target.current;
    target.current = digit;
    if (prefersReducedMotion() || typeof strip.current?.animate !== 'function') setPath([digit]);
    else setPath(rollPath(from, digit));
  }, [digit]);

  useLayoutEffect(() => {
    const el = strip.current;
    if (!el || path.length < 2) return;
    const anim = el.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(${(-(path.length - 1) * 100) / path.length}%)` }],
      { duration: ROLL_MS, easing: SNAPPY_EASING, fill: 'forwards' },
    );
    let live = true;
    anim.onfinish = () => { if (live) setPath([target.current]); };
    return () => { live = false; anim.cancel(); };
  }, [path]);

  return (
    <span className={lit ? 'wheel' : 'wheel is-dim'}>
      <span className="wheel-strip" ref={strip}>
        {path.map((d, i) => <i key={i}>{d}</i>)}
      </span>
    </span>
  );
});

/**
 * A mechanical counter: a row of digit wheels in an engraved window. The visible text is the
 * plain number for assistive tech (the wheels are decoration), so the readout stays exactly
 * the `SimStats` value.
 */
export function Counter({ value, minWidth, label }: { value: number; minWidth: number; label: string }) {
  const digits = digitsOf(value, minWidth);
  return (
    <div className="readout counter">
      <span className="readout-k">{label}</span>
      <span className="wheels" role="img" aria-label={`${label}: ${Math.max(0, Math.floor(value || 0))}`}>
        {digits.map((d, i) => <Wheel key={digits.length - i} digit={d.digit} lit={d.lit} />)}
      </span>
    </div>
  );
}

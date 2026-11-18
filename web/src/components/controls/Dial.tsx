import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  angleToValue, detentValues, dragMode, keyToValue, pointerAngle, snapToDetent, valueToAngle,
  verticalDragValue, type DialRange,
} from './dialMath';

export interface DialProps extends DialRange {
  label: string;
  value: number;
  /** Engraved readout text, e.g. "1.5x". */
  format: (v: number) => string;
  onChange: (v: number) => void;
}

/** Radius of the tick ring in the 100 unit SVG box, and tick length. */
const TICK_INNER = 40;
const TICK_OUTER = 46;

/**
 * A rotary dial with detents. Underneath is a real `<input type=range>` (visually hidden but
 * focusable), so assistive tech, arrow keys, Page keys and Home/End all work; the pointer
 * layer on top turns it by dragging the rim in a circle or the centre cap vertically. The
 * needle is a CSS `rotate` with the snappy spring transition, so every detent change
 * settles with a small overshoot, and the transition is removed under reduced motion.
 * The maths lives in `dialMath.ts`.
 */
export function Dial({ label, value, min, max, step, format, onChange }: DialProps) {
  const range: DialRange = { min, max, step };
  const faceRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ mode: 'circular' | 'vertical'; startY: number; startValue: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const emit = (v: number) => { if (v !== value) onChange(v); };

  const centre = () => {
    const r = faceRef.current!.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 };
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const { cx, cy, radius } = centre();
    const mode = dragMode(Math.hypot(e.clientX - cx, e.clientY - cy), radius);
    drag.current = { mode, startY: e.clientY, startValue: value };
    e.currentTarget.setPointerCapture(e.pointerId);
    inputRef.current?.focus({ preventScroll: true });
    setDragging(true);
    if (mode === 'circular') emit(angleToValue(pointerAngle(cx, cy, e.clientX, e.clientY), range));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'circular') {
      const { cx, cy } = centre();
      emit(angleToValue(pointerAngle(cx, cy, e.clientX, e.clientY), range));
    } else {
      emit(verticalDragValue(d.startValue, e.clientY - d.startY, range));
    }
  };
  const onUp = () => { drag.current = null; setDragging(false); };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const v = keyToValue(e.key, value, range);
    if (v === null) return;
    e.preventDefault();
    emit(v);
  };

  return (
    <div className="dial" data-dragging={dragging || undefined}>
      <div
        ref={faceRef}
        className="dial-face"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <svg className="dial-rim" viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
          {detentValues(range).map((v) => (
            <line
              key={v}
              className={v === value ? 'dial-tick is-now' : v < value ? 'dial-tick is-lit' : 'dial-tick'}
              x1={0} y1={-TICK_INNER} x2={0} y2={-TICK_OUTER}
              transform={`rotate(${valueToAngle(v, range)})`}
            />
          ))}
        </svg>
        <div className="dial-cap">
          <div className="dial-rotor" style={{ rotate: `${valueToAngle(value, range)}deg` }}>
            <i className="dial-mark" />
          </div>
        </div>
        <input
          ref={inputRef}
          className="dial-input"
          type="range"
          min={min} max={max} step={step} value={value}
          aria-label={label}
          aria-valuetext={format(value)}
          onKeyDown={onKey}
          onChange={(e) => emit(snapToDetent(Number(e.target.value), range))}
        />
      </div>
      <output className="dial-readout" aria-hidden="true">{format(value)}</output>
      <span className="dial-label">{label}</span>
    </div>
  );
}

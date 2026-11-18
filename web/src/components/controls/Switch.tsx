export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name; the visible legends are decoration. */
  label: string;
  /** `toggle`: a two-legend slide switch with a thumb. `rocker`: a small rocker with an indicator lamp. */
  variant?: 'toggle' | 'rocker';
  /** Legends printed left (off) and right (on) on a toggle. */
  legends?: [string, string];
  shortcut?: string;
}

/**
 * A switch on a real `<button role="switch">`, so Space and Enter work natively and
 * `aria-checked` carries the state. The throw (thumb slide or rocker tilt) is a CSS transition
 * on the snappy spring token, which gives it a snap with a little overshoot.
 */
export function Switch({ checked, onChange, label, variant = 'toggle', legends, shortcut }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className={`switch switch-${variant}`}
      aria-checked={checked}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      onClick={() => onChange(!checked)}
    >
      {variant === 'toggle' ? (
        <>
          <span className="switch-thumb" aria-hidden="true" />
          <span className="switch-legend" aria-hidden="true">{legends?.[0]}</span>
          <span className="switch-legend" aria-hidden="true">{legends?.[1]}</span>
        </>
      ) : (
        <span className="rocker-face" aria-hidden="true"><i className="rocker-led" /></span>
      )}
    </button>
  );
}

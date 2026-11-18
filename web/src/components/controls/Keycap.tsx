import type { ReactNode } from 'react';

/** Visual family of a key: the one primary accent, a tool that can sit down, or a plain action. */
export type KeycapVariant = 'primary' | 'tool' | 'plain';

export interface KeycapProps {
  /** Engraved legend; also the accessible name unless `label` overrides it. */
  legend: string;
  /** Shortcut letter printed on the cap and announced via aria-keyshortcuts. */
  shortcut?: string;
  icon?: ReactNode;
  /** Present for keys that latch (tools): true sits the key down. Omit for plain actions. */
  pressed?: boolean;
  variant?: KeycapVariant;
  /** Overrides the accessible name, e.g. "Pause" while the legend still reads "Play". */
  label?: string;
  onClick: () => void;
}

/**
 * A hardware keycap on a real `<button>`. Press squash, release overshoot and the
 * "sitting down" look of a latched tool are pure CSS (see `.keycap` in styles.css), driven by
 * `:active` and `aria-pressed`, so there is no per-press JavaScript and nothing to re-render.
 */
export function Keycap({ legend, shortcut, icon, pressed, variant = 'plain', label, onClick }: KeycapProps) {
  return (
    <button
      type="button"
      className={`keycap keycap-${variant}`}
      aria-pressed={pressed}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      onClick={onClick}
    >
      {icon && <span className="keycap-icon">{icon}</span>}
      <span className="keycap-legend">{legend}</span>
      {shortcut && <kbd className="keycap-key" aria-hidden="true">{shortcut}</kbd>}
    </button>
  );
}

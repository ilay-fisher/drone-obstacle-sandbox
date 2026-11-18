/**
 * Keyboard shortcut map, pure so it can be tested without a DOM. `resolveShortcut` turns a
 * key event into an action; `useShortcuts` (the hook next to it) filters targets and
 * dispatches. D stays the Wind brush as printed on its keycap, so the algorithm toggle
 * lives on M ("mode") instead of clashing with it.
 */

/** Map brushes, as engraved on the Build keycaps. */
export type Brush = 'wall' | 'wind' | 'patrol' | 'target' | 'erase';

/** What a shortcut asks the app to do. */
export type ShortcutAction =
  | { type: 'togglePlay' }
  | { type: 'reset' }
  | { type: 'toggleMode' }
  | { type: 'toggleHeat' }
  | { type: 'toggleLidar' }
  | { type: 'brush'; brush: Brush }
  | { type: 'speed'; dir: 1 | -1 };

/** The subset of KeyboardEvent the map needs. */
export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

/** The subset of an event target the filters need. */
export interface TargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Shortcut letter shown on each tool keycap. */
export const BRUSH_KEYS: Record<Brush, string> = { wall: 'W', wind: 'D', patrol: 'P', target: 'G', erase: 'E' };

const BY_KEY: Record<string, ShortcutAction> = {
  ' ': { type: 'togglePlay' },
  r: { type: 'reset' },
  m: { type: 'toggleMode' },
  h: { type: 'toggleHeat' },
  l: { type: 'toggleLidar' },
  w: { type: 'brush', brush: 'wall' },
  d: { type: 'brush', brush: 'wind' },
  p: { type: 'brush', brush: 'patrol' },
  g: { type: 'brush', brush: 'target' },
  e: { type: 'brush', brush: 'erase' },
  '[': { type: 'speed', dir: -1 },
  ']': { type: 'speed', dir: 1 },
};

/** Maps a key event to an action, or null. Modified keys are left to the browser. */
export function resolveShortcut(e: KeyEventLike): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key === 'Spacebar' ? ' ' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const action = BY_KEY[key] ?? null;
  if (!action) return null;
  // Holding a toggle must not flicker it; speed and brush picks are idempotent enough to repeat.
  if (e.repeat && action.type !== 'speed') return null;
  return action;
}

const TEXT_INPUT_TYPES_OFF = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'image']);

/** True when the user is typing, so letters must reach the field instead of triggering shortcuts. */
export function isTypingTarget(t: TargetLike | null): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !TEXT_INPUT_TYPES_OFF.has((t.type ?? 'text').toLowerCase());
  return false;
}

/**
 * True for controls that already act on Space themselves. A focused keycap clicks on Space
 * natively, so the global play shortcut must stand down or it would fire twice.
 */
export function swallowsSpace(t: TargetLike | null): boolean {
  if (!t) return false;
  const tag = (t.tagName ?? '').toUpperCase();
  return tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SUMMARY';
}

/** Human readable shortcut table, rendered in the docs and used to keep them honest. */
export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Space', label: 'Play / pause' },
  { keys: 'R', label: 'Reset drone' },
  { keys: 'M', label: 'Switch algorithm (A* / D* Lite)' },
  { keys: 'W', label: 'Wall tool' },
  { keys: 'D', label: 'Wind tool' },
  { keys: 'P', label: 'Patrol tool' },
  { keys: 'G', label: 'Goal tool' },
  { keys: 'E', label: 'Erase tool' },
  { keys: '[', label: 'Slower' },
  { keys: ']', label: 'Faster' },
  { keys: 'H', label: 'Toggle heatmap' },
  { keys: 'L', label: 'Toggle LiDAR' },
];

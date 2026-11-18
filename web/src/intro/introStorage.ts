/**
 * First-visit logic for the guided intro. Pure: storage is injected, so it is tested with
 * fakes (including storage that throws, as in some private windows and sandboxed iframes).
 *
 * `?intro=1` forces the intro and `?intro=0` disables it. Tests and evidence capture use
 * `?intro=0`; `?intro=1` is for demos and for checking the intro without clearing storage.
 */

export const INTRO_STORAGE_KEY = 'drone-sandbox.intro-seen.v1';

/** The two methods of `Storage` the intro uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type IntroOverride = 'on' | 'off' | null;
export type IntroMode = 'animated' | 'card';
export type IntroDecision = { show: false } | { show: true; mode: IntroMode };

/** Reads `?intro=1` (on) or `?intro=0` (off) from a location search string; anything else is no override. */
export function parseIntroOverride(search: string): IntroOverride {
  let v: string | null = null;
  try {
    v = new URLSearchParams(search).get('intro');
  } catch {
    return null;
  }
  return v === '1' ? 'on' : v === '0' ? 'off' : null;
}

/** True when the intro was shown before, false on a first visit, null when storage cannot be read. */
export function hasSeenIntro(storage: StorageLike | null | undefined): boolean | null {
  if (!storage) return null;
  try {
    return storage.getItem(INTRO_STORAGE_KEY) !== null;
  } catch {
    return null;
  }
}

/** Remembers that the intro was shown. Returns false (and never throws) when storage refuses. */
export function markIntroSeen(storage: StorageLike | null | undefined): boolean {
  if (!storage) return false;
  try {
    storage.setItem(INTRO_STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Reduced motion gets the static four-panel card instead of the animated run. */
export function selectIntroMode(reducedMotion: boolean): IntroMode {
  return reducedMotion ? 'card' : 'animated';
}

/**
 * Whether the intro opens on its own at load. The override wins; otherwise only a first
 * visit shows it. When storage is unreadable the answer is no: without a way to remember,
 * showing it would nag on every load (the "?" key still replays it).
 */
export function decideIntro(input: { search: string; seen: boolean | null; reducedMotion: boolean }): IntroDecision {
  const override = parseIntroOverride(input.search);
  if (override === 'off') return { show: false };
  if (override === 'on' || input.seen === false) return { show: true, mode: selectIntroMode(input.reducedMotion) };
  return { show: false };
}

/** `window.localStorage`, or null when the browser refuses even to hand it over. */
export function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

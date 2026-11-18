import { describe, expect, it } from 'vitest';
import {
  INTRO_STORAGE_KEY, decideIntro, hasSeenIntro, markIntroSeen, parseIntroOverride, selectIntroMode, type StorageLike,
} from './introStorage';

function memory(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}
const throwing: StorageLike = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

describe('?intro= override', () => {
  it('1 forces, 0 disables, anything else is no override', () => {
    expect(parseIntroOverride('?intro=1')).toBe('on');
    expect(parseIntroOverride('?perf=1&intro=1')).toBe('on');
    expect(parseIntroOverride('?intro=0')).toBe('off');
    expect(parseIntroOverride('?intro=2')).toBeNull();
    expect(parseIntroOverride('?intro=')).toBeNull();
    expect(parseIntroOverride('')).toBeNull();
    expect(parseIntroOverride('?perf=1')).toBeNull();
  });
});

describe('seen flag', () => {
  it('is false on a fresh store and true once marked', () => {
    const s = memory();
    expect(hasSeenIntro(s)).toBe(false);
    expect(markIntroSeen(s)).toBe(true);
    expect(s.data[INTRO_STORAGE_KEY]).toBeDefined();
    expect(hasSeenIntro(s)).toBe(true);
  });

  it('reports unreadable (null) instead of throwing when storage throws or is missing', () => {
    expect(hasSeenIntro(throwing)).toBeNull();
    expect(hasSeenIntro(null)).toBeNull();
    expect(hasSeenIntro(undefined)).toBeNull();
  });

  it('marking never throws and reports failure', () => {
    expect(markIntroSeen(throwing)).toBe(false);
    expect(markIntroSeen(null)).toBe(false);
  });
});

describe('reduced-motion selection', () => {
  it('animated normally, static card under reduced motion', () => {
    expect(selectIntroMode(false)).toBe('animated');
    expect(selectIntroMode(true)).toBe('card');
  });
});

describe('decideIntro', () => {
  it('plays on the first visit, in the mode the motion preference selects', () => {
    expect(decideIntro({ search: '', seen: false, reducedMotion: false })).toEqual({ show: true, mode: 'animated' });
    expect(decideIntro({ search: '', seen: false, reducedMotion: true })).toEqual({ show: true, mode: 'card' });
  });

  it('does not repeat once seen', () => {
    expect(decideIntro({ search: '', seen: true, reducedMotion: false })).toEqual({ show: false });
  });

  it('does not nag when storage is unreadable', () => {
    expect(decideIntro({ search: '', seen: null, reducedMotion: false })).toEqual({ show: false });
  });

  it('?intro=0 disables even on a first visit', () => {
    expect(decideIntro({ search: '?intro=0', seen: false, reducedMotion: false })).toEqual({ show: false });
  });

  it('?intro=1 forces even when seen or unreadable, still honouring reduced motion', () => {
    expect(decideIntro({ search: '?intro=1', seen: true, reducedMotion: false })).toEqual({ show: true, mode: 'animated' });
    expect(decideIntro({ search: '?intro=1', seen: null, reducedMotion: false })).toEqual({ show: true, mode: 'animated' });
    expect(decideIntro({ search: '?intro=1', seen: true, reducedMotion: true })).toEqual({ show: true, mode: 'card' });
  });
});

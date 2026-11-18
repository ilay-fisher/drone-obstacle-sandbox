import { describe, expect, it } from 'vitest';
import { BRUSH_KEYS, SHORTCUTS, isTypingTarget, resolveShortcut, swallowsSpace } from './keymap';

describe('resolveShortcut', () => {
  it('Space plays and pauses', () => {
    expect(resolveShortcut({ key: ' ' })).toEqual({ type: 'togglePlay' });
  });
  it('R resets the drone', () => {
    expect(resolveShortcut({ key: 'r' })).toEqual({ type: 'reset' });
    expect(resolveShortcut({ key: 'R' })).toEqual({ type: 'reset' });
  });
  it('M toggles the algorithm, so D stays free for the wind brush', () => {
    expect(resolveShortcut({ key: 'm' })).toEqual({ type: 'toggleMode' });
    expect(resolveShortcut({ key: 'd' })).toEqual({ type: 'brush', brush: 'wind' });
    expect(resolveShortcut({ key: 'a' })).toBeNull();
  });
  it('W D P G E select tools', () => {
    expect(resolveShortcut({ key: 'w' })).toEqual({ type: 'brush', brush: 'wall' });
    expect(resolveShortcut({ key: 'd' })).toEqual({ type: 'brush', brush: 'wind' });
    expect(resolveShortcut({ key: 'p' })).toEqual({ type: 'brush', brush: 'patrol' });
    expect(resolveShortcut({ key: 'g' })).toEqual({ type: 'brush', brush: 'target' });
    expect(resolveShortcut({ key: 'e' })).toEqual({ type: 'brush', brush: 'erase' });
  });
  it('H and L toggle the overlays', () => {
    expect(resolveShortcut({ key: 'h' })).toEqual({ type: 'toggleHeat' });
    expect(resolveShortcut({ key: 'l' })).toEqual({ type: 'toggleLidar' });
  });
  it('[ and ] step the speed down and up', () => {
    expect(resolveShortcut({ key: '[' })).toEqual({ type: 'speed', dir: -1 });
    expect(resolveShortcut({ key: ']' })).toEqual({ type: 'speed', dir: 1 });
  });
  it('ignores browser and OS chords', () => {
    expect(resolveShortcut({ key: 'r', metaKey: true })).toBeNull();
    expect(resolveShortcut({ key: 'r', ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ key: 'w', altKey: true })).toBeNull();
  });
  it('does not repeat toggles while a key is held, but speed may repeat', () => {
    expect(resolveShortcut({ key: ' ', repeat: true })).toBeNull();
    expect(resolveShortcut({ key: 'r', repeat: true })).toBeNull();
    expect(resolveShortcut({ key: ']', repeat: true })).toEqual({ type: 'speed', dir: 1 });
  });
  it('ignores unrelated keys', () => {
    expect(resolveShortcut({ key: 'x' })).toBeNull();
    expect(resolveShortcut({ key: 'Enter' })).toBeNull();
    expect(resolveShortcut({ key: 'Tab' })).toBeNull();
  });
});

describe('target filtering', () => {
  it('typing targets are ignored', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
  it('range inputs and buttons are not typing', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
  it('native activators keep Space so a focused keycap is not double-fired', () => {
    expect(swallowsSpace({ tagName: 'BUTTON' })).toBe(true);
    expect(swallowsSpace({ tagName: 'A' })).toBe(true);
    expect(swallowsSpace({ tagName: 'INPUT', type: 'range' })).toBe(true);
    expect(swallowsSpace({ tagName: 'DIV' })).toBe(false);
    expect(swallowsSpace({ tagName: 'BODY' })).toBe(false);
  });
});

describe('shortcut table', () => {
  it('lists every shortcut once and covers all brushes', () => {
    const keys = SHORTCUTS.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(BRUSH_KEYS).toEqual({ wall: 'W', wind: 'D', patrol: 'P', target: 'G', erase: 'E' });
  });
  it('every key in the table resolves to an action', () => {
    for (const s of SHORTCUTS) {
      for (const k of s.keys.split(' ')) {
        const key = k === 'Space' ? ' ' : k;
        expect(resolveShortcut({ key }), key).not.toBeNull();
      }
    }
  });
});

describe('replay intro shortcut', () => {
  it('? replays the intro', () => {
    expect(resolveShortcut({ key: '?' })).toEqual({ type: 'replayIntro' });
  });
  it('is not repeated while held and leaves modified keys alone', () => {
    expect(resolveShortcut({ key: '?', repeat: true })).toBeNull();
    expect(resolveShortcut({ key: '?', ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ key: '?', metaKey: true })).toBeNull();
  });
  it('is documented in the shortcut table', () => {
    expect(SHORTCUTS.some((s) => s.keys === '?')).toBe(true);
  });
});

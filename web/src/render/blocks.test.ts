import { describe, expect, it } from 'vitest';
import { blockHeight, cellHash, diffGrid, labelBlocks } from './blocks';

/** Parses an ASCII map: '#' is a wall, anything else is free. */
function parse(rows: string[]): { cells: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0].length;
  const cells = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') cells[y * w + x] = 1; }));
  return { cells, w, h };
}

function label(rows: string[]) {
  const { cells, w, h } = parse(rows);
  const ids = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const count = labelBlocks(cells, w, h, ids, stack);
  return { ids, count, w, h };
}

describe('labelBlocks', () => {
  it('gives every cell of a 4-connected block the same id: the lowest cell index', () => {
    const { ids, count, w } = label([
      '.....',
      '.##..',
      '.#...',
      '.....',
    ]);
    expect(count).toBe(1);
    const root = 1 * w + 1;
    expect(ids[1 * w + 1]).toBe(root);
    expect(ids[1 * w + 2]).toBe(root);
    expect(ids[2 * w + 1]).toBe(root);
    expect(ids[0]).toBe(-1);
  });

  it('does not join diagonal neighbours', () => {
    const { ids, count, w } = label([
      '#..',
      '.#.',
      '..#',
    ]);
    expect(count).toBe(3);
    expect(new Set([ids[0], ids[w + 1], ids[2 * w + 2]]).size).toBe(3);
  });

  it('labels separate blocks separately and walks a snake', () => {
    const { ids, count, w } = label([
      '###..#',
      '..#..#',
      '###..#',
      '...#..',
    ]);
    expect(count).toBe(3);
    expect(ids[2]).toBe(ids[0]);
    expect(ids[2 * w]).toBe(ids[0]);
    expect(ids[5]).toBe(ids[2 * w + 5]);
    expect(ids[5]).not.toBe(ids[0]);
    expect(ids[3 * w + 3]).not.toBe(ids[0]); // the lone wall below is its own block
    expect(ids[3 * w + 3]).toBe(3 * w + 3);
  });

  it('is reusable: relabelling after an edit overwrites stale ids', () => {
    const { cells, w, h } = parse(['.#.', '...', '.#.']);
    const ids = new Int32Array(w * h);
    const stack = new Int32Array(w * h);
    expect(labelBlocks(cells, w, h, ids, stack)).toBe(2);
    cells[1 * w + 1] = 1; // bridge the two walls
    expect(labelBlocks(cells, w, h, ids, stack)).toBe(1);
    expect(ids[1]).toBe(ids[2 * w + 1]);
  });

  it('treats wind and free cells as non-walls', () => {
    const cells = new Uint8Array([2, 1, 2]);
    const ids = new Int32Array(3);
    expect(labelBlocks(cells, 3, 1, ids, new Int32Array(3))).toBe(1);
    expect(ids[0]).toBe(-1);
    expect(ids[2]).toBe(-1);
  });
});

describe('cellHash', () => {
  it('is deterministic, in [0, 1) and well spread', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const a = cellHash(i);
      expect(a).toBe(cellHash(i));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
      seen.add(a);
    }
    expect(seen.size).toBeGreaterThan(900);
  });

  it('is pinned for a few cells so a refactor cannot silently reshuffle the skyline', () => {
    const expected = [0.54217, 0.40707, 0.3126, 0.12927, 0.83456];
    [0, 1, 2, 100, 1439].forEach((cell, k) => expect(cellHash(cell)).toBeCloseTo(expected[k], 4));
  });

  it('maps to a building height inside the allowed band', () => {
    for (let i = 0; i < 500; i++) {
      const h = blockHeight(i);
      expect(h).toBeGreaterThanOrEqual(0.35);
      expect(h).toBeLessThanOrEqual(1.3);
    }
  });
});

describe('diffGrid', () => {
  it('lists the changed indices and returns the true total even when the list is full', () => {
    const prev = new Uint8Array([0, 1, 0, 2, 0, 0]);
    const cur = new Uint8Array([0, 0, 1, 2, 1, 1]);
    const out = new Int32Array(8);
    expect(diffGrid(prev, cur, out)).toBe(4);
    expect([...out.slice(0, 4)]).toEqual([1, 2, 4, 5]);
    const small = new Int32Array(2);
    expect(diffGrid(prev, cur, small)).toBe(4);
    expect([...small]).toEqual([1, 2]);
  });

  it('returns 0 for identical grids', () => {
    const a = new Uint8Array([1, 0, 2]);
    expect(diffGrid(a, a.slice(), new Int32Array(3))).toBe(0);
  });
});

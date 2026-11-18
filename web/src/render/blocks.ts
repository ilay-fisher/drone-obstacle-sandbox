/**
 * Pure helpers for the building layer: grouping wall cells into blocks, a stable hash that
 * gives each block its height, and a grid diff. No DOM, so everything here is unit tested.
 */

/**
 * A stable pseudo random number in [0, 1) for a cell index. Used to pick building heights, so
 * the skyline of a map never reshuffles between frames, rebuilds or reloads.
 */
export function cellHash(i: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Lowest and highest building height, in cell units (a cell is 1 x 1). */
export const BLOCK_H_MIN = 0.5;
export const BLOCK_H_MAX = 0.95;

/** Height in cell units for the block whose root cell index is `root`. One value per block, so a block reads as one solid. */
export function blockHeight(root: number): number {
  return BLOCK_H_MIN + (BLOCK_H_MAX - BLOCK_H_MIN) * cellHash(root);
}

/**
 * Groups 4-connected wall cells (value 1) into blocks. `ids[i]` becomes the lowest cell index
 * of the block that cell `i` belongs to, or -1 for non-wall cells; the return value is the
 * number of blocks. Diagonal neighbours do not join. `ids` and `stack` are caller-owned
 * buffers of `w * h` entries so a relabel after an edit allocates nothing.
 *
 * The lowest index is the first cell met by the row-major scan, which makes the id (and thus
 * the height) of an unedited block independent of what happens elsewhere on the map.
 */
export function labelBlocks(cells: Uint8Array, w: number, h: number, ids: Int32Array, stack: Int32Array): number {
  const n = w * h;
  ids.fill(-1, 0, n);
  let blocks = 0;
  for (let i = 0; i < n; i++) {
    if (cells[i] !== 1 || ids[i] !== -1) continue;
    blocks++;
    let sp = 0;
    stack[sp++] = i;
    ids[i] = i;
    while (sp > 0) {
      const c = stack[--sp];
      const x = c % w;
      if (x > 0 && cells[c - 1] === 1 && ids[c - 1] === -1) { ids[c - 1] = i; stack[sp++] = c - 1; }
      if (x < w - 1 && cells[c + 1] === 1 && ids[c + 1] === -1) { ids[c + 1] = i; stack[sp++] = c + 1; }
      if (c >= w && cells[c - w] === 1 && ids[c - w] === -1) { ids[c - w] = i; stack[sp++] = c - w; }
      if (c < n - w && cells[c + w] === 1 && ids[c + w] === -1) { ids[c + w] = i; stack[sp++] = c + w; }
    }
  }
  return blocks;
}

/**
 * Writes the indices where `prev` and `cur` differ into `out` (up to its length) and returns
 * the true number of differences, which may exceed `out.length`. Callers use the total to
 * decide that a change is a bulk load (preset, import) rather than a hand edit.
 */
export function diffGrid(prev: Uint8Array, cur: Uint8Array, out: Int32Array): number {
  let n = 0;
  for (let i = 0; i < cur.length; i++) {
    if (prev[i] === cur[i]) continue;
    if (n < out.length) out[n] = i;
    n++;
  }
  return n;
}

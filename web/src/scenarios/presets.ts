import type { SimState } from '../engine/simulation';

export const PRESET_NAMES = ['Urban Canyon', 'Dynamic Patrols', 'Empty Arena'] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

/** Rectangle helper writing `v` into the flat grid; clipped to the map. */
function rect(c: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, v: number): void {
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) c[y * w + x] = v;
  }
}

/**
 * Builds a preset map for a `w x h` grid (designed for the 48x30 default).
 * Presets are pure data so they can be unit-tested and saved through the API unchanged.
 */
export function buildPreset(name: PresetName, w: number, h: number): SimState {
  const cells = new Uint8Array(w * h);
  const mid = Math.floor(h / 2);
  const state: SimState = {
    cells,
    start: { x: 2, y: mid },
    goal: { x: w - 3, y: mid },
    patrols: [],
  };
  if (name === 'Urban Canyon') {
    // Two rows of buildings flank a central avenue; side streets run between blocks.
    for (let i = 0; i < 5; i++) {
      const x0 = 6 + i * 8;
      rect(cells, w, h, x0, 2, x0 + 4, mid - 5, 1);
      rect(cells, w, h, x0, mid + 4, x0 + 4, h - 3, 1);
    }
    // Jamming zones: a band across the avenue and a patch in a side street.
    rect(cells, w, h, 22, mid - 4, 25, mid + 3, 2);
    rect(cells, w, h, 11, 2, 13, mid - 5, 2);
    rect(cells, w, h, 35, mid + 4, 37, h - 3, 2);
    // Chicane walls inside the avenue.
    rect(cells, w, h, 16, mid - 4, 16, mid, 1);
    rect(cells, w, h, 30, mid, 30, mid + 3, 1);
  } else if (name === 'Dynamic Patrols') {
    rect(cells, w, h, 20, 8, 21, 11, 1);
    rect(cells, w, h, 20, 19, 21, 22, 1);
    rect(cells, w, h, 30, mid - 1, 31, mid + 1, 2);
    const cols = [9, 14, 25, 34, 39];
    cols.forEach((x, i) => {
      state.patrols.push({ x, y: 3 + ((i * 7) % (h - 6)), dx: 0, dy: i % 2 === 0 ? 1 : -1 });
    });
    state.patrols.push({ x: 28, y: 6, dx: 1, dy: 0 });
  }
  return state;
}

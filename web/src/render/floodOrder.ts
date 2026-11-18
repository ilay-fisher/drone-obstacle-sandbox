/**
 * Flood order reconstruction. The planner (C++ or TS) reports how many times each cell was
 * expanded, not in which order, and `cpp/` is off limits. To animate a search front we
 * rebuild a plausible order in JS: a shortest-path flood through the visited cells (heat > 0)
 * from the search origin, so a cell lights up after the cells that lead to it.
 *
 * - Distances use a 5 / 7 chamfer (orthogonal / diagonal step), so the front is round
 *   instead of a diamond or a square.
 * - Only visited cells are walked. A visited cell the origin cannot reach through visited
 *   cells (a pocket the search touched from another side) is appended after the rest, by its
 *   distance from the reached set.
 * - An origin that was not itself visited (a freshly painted wall, say) starts the flood at
 *   the nearest visited cells.
 *
 * Pure and allocation-free after construction: every buffer is sized once for the grid.
 */

const ORTHO = 5;
const DIAG = 7;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const DW = [ORTHO, ORTHO, ORTHO, ORTHO, DIAG, DIAG, DIAG, DIAG];

/** Result and scratch buffers for one grid size. Reuse one instance for every replan. */
export class FloodOrder {
  /** Per cell: 0 at the origin up to 1 at the last cell reached; -1 for cells that were not visited. */
  readonly rank: Float32Array;
  /** Visited cells in flood order (nondecreasing rank); only the first `count` entries are valid. */
  readonly order: Int32Array;
  /** Number of visited cells. */
  count = 0;
  private readonly dist: Int32Array;
  private readonly tmp: Int32Array;
  private readonly done: Uint8Array;
  private readonly hk: Int32Array;
  private readonly hv: Int32Array;
  private hs = 0;

  constructor(readonly w: number, readonly h: number) {
    const n = w * h;
    this.rank = new Float32Array(n);
    this.order = new Int32Array(n);
    this.dist = new Int32Array(n);
    this.tmp = new Int32Array(n);
    this.done = new Uint8Array(n);
    this.hk = new Int32Array(9 * n + 16);
    this.hv = new Int32Array(9 * n + 16);
  }

  /**
   * Computes `rank`, `order` and `count` for `heat` (visit counts, length w * h) and the
   * first `nOrigins` entries of `origins` (cell indices).
   */
  compute(heat: Uint8Array, origins: ArrayLike<number>, nOrigins: number): void {
    const { w, h, rank, order, dist, tmp, done } = this;
    const n = w * h;
    rank.fill(-1);
    dist.fill(-1);
    done.fill(0);
    this.count = 0;
    this.hs = 0;
    let total = 0;
    for (let i = 0; i < n; i++) if (heat[i] > 0) total++;
    if (total === 0) return;

    // Seeds: the origins that were visited.
    for (let k = 0; k < nOrigins; k++) {
      const o = origins[k];
      if (o >= 0 && o < n && heat[o] > 0 && dist[o] !== 0) { dist[o] = 0; this.push(0, o); }
    }
    if (this.hs === 0 && !this.seedFromNearest(heat, origins, nOrigins)) return;

    // Flood through visited cells only.
    let count = 0;
    let maxD = 0;
    while (this.hs > 0) {
      const u = this.pop();
      const d = this.lastKey;
      if (done[u] || d !== dist[u]) continue;
      done[u] = 1;
      order[count++] = u;
      maxD = d;
      const ux = u % w;
      const uy = (u / w) | 0;
      for (let k = 0; k < 8; k++) {
        const x = ux + DX[k];
        const y = uy + DY[k];
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = y * w + x;
        if (heat[v] === 0) continue;
        const nd = d + DW[k];
        if (dist[v] < 0 || nd < dist[v]) { dist[v] = nd; this.push(nd, v); }
      }
    }

    // Visited cells the flood could not reach: append by distance from the reached set, over any cell.
    if (count < total) {
      tmp.fill(-1);
      this.hs = 0;
      for (let k = 0; k < count; k++) { tmp[order[k]] = 0; this.push(0, order[k]); }
      const base = maxD;
      while (this.hs > 0 && count < total) {
        const u = this.pop();
        const d = this.lastKey;
        if (d !== tmp[u]) continue;
        if (heat[u] > 0 && !done[u]) {
          done[u] = 1;
          dist[u] = base + d;
          order[count++] = u;
          maxD = base + d;
        }
        const ux = u % w;
        const uy = (u / w) | 0;
        for (let k = 0; k < 8; k++) {
          const x = ux + DX[k];
          const y = uy + DY[k];
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const v = y * w + x;
          const nd = d + DW[k];
          if (tmp[v] < 0 || nd < tmp[v]) { tmp[v] = nd; this.push(nd, v); }
        }
      }
    }

    this.count = count;
    const inv = maxD > 0 ? 1 / maxD : 0;
    for (let k = 0; k < count; k++) rank[order[k]] = dist[order[k]] * inv;
  }

  /** No visited origin: walk outward over every cell and seed the flood at the first visited cells found. */
  private seedFromNearest(heat: Uint8Array, origins: ArrayLike<number>, nOrigins: number): boolean {
    const { w, h, tmp, dist } = this;
    const n = w * h;
    tmp.fill(-1);
    this.hs = 0;
    for (let k = 0; k < nOrigins; k++) {
      const o = origins[k];
      if (o >= 0 && o < n && tmp[o] !== 0) { tmp[o] = 0; this.push(0, o); }
    }
    let found = -1;
    // Visited cells found at the first distance, kept in `done` order slots of the heap afterwards.
    let seeds = 0;
    const seedList = this.order;
    while (this.hs > 0) {
      const u = this.pop();
      const d = this.lastKey;
      if (d !== tmp[u]) continue;
      if (found >= 0 && d > found) break;
      if (heat[u] > 0) {
        if (found < 0) found = d;
        seedList[seeds++] = u;
        continue;
      }
      const ux = u % w;
      const uy = (u / w) | 0;
      for (let k = 0; k < 8; k++) {
        const x = ux + DX[k];
        const y = uy + DY[k];
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = y * w + x;
        const nd = d + DW[k];
        if (tmp[v] < 0 || nd < tmp[v]) { tmp[v] = nd; this.push(nd, v); }
      }
    }
    this.hs = 0;
    for (let k = 0; k < seeds; k++) { dist[seedList[k]] = 0; this.push(0, seedList[k]); }
    return seeds > 0;
  }

  private lastKey = 0;

  private push(key: number, val: number): void {
    const { hk, hv } = this;
    let i = this.hs++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= key) break;
      hk[i] = hk[p];
      hv[i] = hv[p];
      i = p;
    }
    hk[i] = key;
    hv[i] = val;
  }

  private pop(): number {
    const { hk, hv } = this;
    const top = hv[0];
    this.lastKey = hk[0];
    const n = --this.hs;
    if (n > 0) {
      const key = hk[n];
      const val = hv[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= key) break;
        hk[i] = hk[c];
        hv[i] = hv[c];
        i = c;
      }
      hk[i] = key;
      hv[i] = val;
    }
    return top;
  }
}

/** How many cells (the first entries of `order`) the front has reached when it stands at rank `front`. */
export function frontCount(f: FloodOrder, front: number): number {
  let lo = 0;
  let hi = f.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (f.rank[f.order[mid]] <= front) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

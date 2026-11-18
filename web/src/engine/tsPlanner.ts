import type { CellValue, PlanMode, PlanResult, Planner } from './plannerBridge';

const WIND = 4.0;
const SQ2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Indexed binary min-heap keyed by (k1, k2). Each node index appears at most once and
 * supports decrease/increase-key, so capacity is exactly the cell count and nothing is
 * allocated after construction (CONTRIBUTING: no allocation in hot loops).
 */
class IndexedHeap {
  size = 0;
  private readonly heap: Int32Array;
  private readonly pos: Int32Array;
  readonly k1: Float64Array;
  readonly k2: Float64Array;

  constructor(n: number) {
    this.heap = new Int32Array(n);
    this.pos = new Int32Array(n).fill(-1);
    this.k1 = new Float64Array(n);
    this.k2 = new Float64Array(n);
  }

  has(i: number): boolean { return this.pos[i] >= 0; }
  top(): number { return this.heap[0]; }

  clear(): void {
    for (let i = 0; i < this.size; i++) this.pos[this.heap[i]] = -1;
    this.size = 0;
  }

  /** Inserts node `i` or updates its key if already present. */
  set(i: number, a: number, b: number): void {
    this.k1[i] = a;
    this.k2[i] = b;
    if (this.pos[i] < 0) {
      this.heap[this.size] = i;
      this.pos[i] = this.size++;
    }
    this.sift(this.pos[i]);
  }

  remove(i: number): void {
    const p = this.pos[i];
    if (p < 0) return;
    const last = this.heap[--this.size];
    this.pos[i] = -1;
    if (p < this.size) {
      this.heap[p] = last;
      this.pos[last] = p;
      this.sift(p);
    }
  }

  private less(a: number, b: number): boolean {
    return this.k1[a] < this.k1[b] || (this.k1[a] === this.k1[b] && this.k2[a] < this.k2[b]);
  }

  private swap(p: number, q: number): void {
    const a = this.heap[p];
    const b = this.heap[q];
    this.heap[p] = b; this.pos[b] = p;
    this.heap[q] = a; this.pos[a] = q;
  }

  private sift(p: number): void {
    while (p > 0) {
      const parent = (p - 1) >> 1;
      if (!this.less(this.heap[p], this.heap[parent])) break;
      this.swap(p, parent);
      p = parent;
    }
    for (;;) {
      const l = 2 * p + 1;
      const r = l + 1;
      let m = p;
      if (l < this.size && this.less(this.heap[l], this.heap[m])) m = l;
      if (r < this.size && this.less(this.heap[r], this.heap[m])) m = r;
      if (m === p) return;
      this.swap(p, m);
      p = m;
    }
  }
}

/**
 * TypeScript planner with the same semantics as the C++ engine: 8-directional, no corner
 * cutting, octile heuristic, 4x wind, A* and incremental D* Lite over flat typed arrays.
 * It is the fallback when the Wasm artifact is missing, and the reference for tests.
 */
class TsPlanner implements Planner {
  readonly mode = 'TS Fallback' as const;
  private readonly cells: Uint8Array;
  private readonly heatBuf: Uint8Array;
  private readonly pathBuf: Int32Array;
  private pathLen = 0;
  private replans = 0;
  private readonly heapQ: IndexedHeap;
  // A* state
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly closed: Uint8Array;
  // D* Lite state
  private readonly rhs: Float64Array;
  private readonly dg: Float64Array;
  private readonly dirty: Uint8Array;
  private readonly dirtyList: Int32Array;
  private dirtyCount = 0;
  private dInit = false;
  private dGoal = -1;
  private km = 0;
  private sx = 0;
  private sy = 0;
  private expanded = 0;

  constructor(readonly width: number, readonly height: number) {
    const n = width * height;
    this.cells = new Uint8Array(n);
    this.heatBuf = new Uint8Array(n);
    this.pathBuf = new Int32Array(n);
    this.heapQ = new IndexedHeap(n);
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.rhs = new Float64Array(n);
    this.dg = new Float64Array(n);
    this.dirty = new Uint8Array(n);
    this.dirtyList = new Int32Array(n);
  }

  grid(): Uint8Array { return this.cells; }
  heat(): Uint8Array { return this.heatBuf; }
  replanCount(): number { return this.replans; }
  private inb(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.width && y < this.height; }

  getCell(x: number, y: number): CellValue {
    return this.inb(x, y) ? (this.cells[y * this.width + x] as CellValue) : 1;
  }

  setCell(x: number, y: number, v: CellValue): void {
    if (!this.inb(x, y) || v < 0 || v > 2) return;
    const i = y * this.width + x;
    if (this.cells[i] === v) return;
    this.cells[i] = v;
    if (this.dInit && !this.dirty[i]) {
      this.dirty[i] = 1;
      this.dirtyList[this.dirtyCount++] = i;
    }
  }

  clearGrid(): void {
    this.cells.fill(0);
    this.heatBuf.fill(0);
    this.pathLen = 0;
    this.replans = 0;
    this.dInit = false;
    this.dGoal = -1;
    this.dirty.fill(0);
    this.dirtyCount = 0;
  }

  /** Cost of stepping from (x,y) along direction k, or -1 if impassable. */
  private step(x: number, y: number, k: number): number {
    const nx = x + DX[k];
    const ny = y + DY[k];
    if (!this.inb(nx, ny)) return -1;
    const v = this.cells[ny * this.width + nx];
    if (v === 1) return -1;
    let base = 1;
    if (DX[k] !== 0 && DY[k] !== 0) {
      if (this.cells[y * this.width + nx] === 1 || this.cells[ny * this.width + x] === 1) return -1;
      base = SQ2;
    }
    return v === 2 ? base * WIND : base;
  }

  /** Octile distance with the minimum step cost, so it never overestimates. */
  private h(x0: number, y0: number, x1: number, y1: number): number {
    const dx = Math.abs(x0 - x1);
    const dy = Math.abs(y0 - y1);
    return dx + dy + (SQ2 - 2) * Math.min(dx, dy);
  }

  computePath(sx: number, sy: number, gx: number, gy: number, mode: PlanMode): PlanResult {
    const t0 = performance.now();
    this.replans++;
    this.heatBuf.fill(0);
    this.expanded = 0;
    this.pathLen = 0;
    const ok = this.inb(sx, sy) && this.inb(gx, gy)
      && this.cells[sy * this.width + sx] !== 1 && this.cells[gy * this.width + gx] !== 1;
    let found = false;
    if (ok) found = mode === 'astar' ? this.runAStar(sx, sy, gx, gy) : this.runDStar(sx, sy, gx, gy);
    let cost = -1;
    if (found) cost = this.pathCost();
    return {
      found,
      path: this.pathBuf.subarray(0, this.pathLen),
      cost,
      expanded: this.expanded,
      latencyMs: performance.now() - t0,
    };
  }

  private pathCost(): number {
    let c = 0;
    for (let i = 1; i < this.pathLen; i++) {
      const a = this.pathBuf[i - 1];
      const b = this.pathBuf[i];
      const diag = a % this.width !== b % this.width && ((a / this.width) | 0) !== ((b / this.width) | 0);
      c += (diag ? SQ2 : 1) * (this.cells[b] === 2 ? WIND : 1);
    }
    return c;
  }

  private bump(i: number): void {
    if (this.heatBuf[i] < 255) this.heatBuf[i]++;
    this.expanded++;
  }

  private runAStar(sx: number, sy: number, gx: number, gy: number): boolean {
    const w = this.width;
    const s = sy * w + sx;
    const goal = gy * w + gx;
    const q = this.heapQ;
    q.clear();
    this.g.fill(Infinity);
    this.closed.fill(0);
    this.g[s] = 0;
    const h0 = this.h(sx, sy, gx, gy);
    q.set(s, h0, h0);
    while (q.size > 0) {
      const u = q.top();
      q.remove(u);
      this.closed[u] = 1;
      this.bump(u);
      if (u === goal) break;
      const ux = u % w;
      const uy = (u / w) | 0;
      for (let k = 0; k < 8; k++) {
        const c = this.step(ux, uy, k);
        if (c < 0) continue;
        const v = (uy + DY[k]) * w + ux + DX[k];
        if (this.closed[v]) continue;
        const ng = this.g[u] + c;
        if (ng < this.g[v]) {
          this.g[v] = ng;
          this.parent[v] = u;
          const hv = this.h(ux + DX[k], uy + DY[k], gx, gy);
          q.set(v, ng + hv, hv);
        }
      }
    }
    q.clear();
    if (!this.closed[goal]) return false;
    let n = 0;
    for (let v = goal; v !== s; v = this.parent[v]) this.pathBuf[n++] = v;
    this.pathBuf[n++] = s;
    this.pathBuf.subarray(0, n).reverse();
    this.pathLen = n;
    return true;
  }

  // ---- D* Lite (Koenig & Likhachev), searching backward from the goal ----

  private key(u: number): void {
    const m = Math.min(this.dg[u], this.rhs[u]);
    this.heapQ.set(u, m + this.h(this.sx, this.sy, u % this.width, (u / this.width) | 0) + this.km, m);
  }

  private updateVertex(u: number): void {
    const w = this.width;
    const ux = u % w;
    const uy = (u / w) | 0;
    if (u !== this.dGoal) {
      let best = Infinity;
      if (this.cells[u] !== 1) {
        for (let k = 0; k < 8; k++) {
          const c = this.step(ux, uy, k);
          if (c < 0) continue;
          const t = c + this.dg[(uy + DY[k]) * w + ux + DX[k]];
          if (t < best) best = t;
        }
      }
      this.rhs[u] = best;
    }
    if (this.dg[u] !== this.rhs[u]) this.key(u);
    else this.heapQ.remove(u);
  }

  private updatePreds(u: number): void {
    const w = this.width;
    const ux = u % w;
    const uy = (u / w) | 0;
    for (let k = 0; k < 8; k++) {
      const px = ux + DX[k];
      const py = uy + DY[k];
      if (this.inb(px, py)) this.updateVertex(py * w + px);
    }
  }

  private runDStar(sx: number, sy: number, gx: number, gy: number): boolean {
    const w = this.width;
    const s = sy * w + sx;
    const goal = gy * w + gx;
    const q = this.heapQ;
    if (!this.dInit || this.dGoal !== goal) {
      q.clear();
      this.dg.fill(Infinity);
      this.rhs.fill(Infinity);
      this.dirty.fill(0);
      this.dirtyCount = 0;
      this.dInit = true;
      this.dGoal = goal;
      this.km = 0;
      this.sx = sx; this.sy = sy;
      this.rhs[goal] = 0;
      this.key(goal);
    } else {
      this.km += this.h(this.sx, this.sy, sx, sy);
      this.sx = sx; this.sy = sy;
      for (let n = 0; n < this.dirtyCount; n++) {
        const c = this.dirtyList[n];
        this.dirty[c] = 0;
        const cx = c % w;
        const cy = (c / w) | 0;
        this.updateVertex(c);
        for (let k = 0; k < 8; k++) {
          if (this.inb(cx + DX[k], cy + DY[k])) this.updateVertex((cy + DY[k]) * w + cx + DX[k]);
        }
      }
      this.dirtyCount = 0;
    }
    while (q.size > 0) {
      const u = q.top();
      const a = q.k1[u];
      const b = q.k2[u];
      const m = Math.min(this.dg[s], this.rhs[s]);
      const sk1 = m + this.km; // h(start,start) = 0
      if (!(a < sk1 || (a === sk1 && b < m)) && this.dg[s] === this.rhs[s]) break;
      const mu = Math.min(this.dg[u], this.rhs[u]);
      const nk1 = mu + this.h(this.sx, this.sy, u % w, (u / w) | 0) + this.km;
      if (a < nk1 || (a === nk1 && b < mu)) {
        q.set(u, nk1, mu);
      } else if (this.dg[u] > this.rhs[u]) {
        this.bump(u);
        this.dg[u] = this.rhs[u];
        q.remove(u);
        this.updatePreds(u);
      } else {
        this.bump(u);
        this.dg[u] = Infinity;
        this.updateVertex(u);
        this.updatePreds(u);
      }
    }
    if (this.dg[s] === Infinity) return false;
    // Greedy descent on c(u,v) + g(v) yields the optimal path from the start.
    let u = s;
    let n = 0;
    this.pathBuf[n++] = u;
    while (u !== goal) {
      const ux = u % w;
      const uy = (u / w) | 0;
      let best = Infinity;
      let next = -1;
      for (let k = 0; k < 8; k++) {
        const c = this.step(ux, uy, k);
        if (c < 0) continue;
        const v = (uy + DY[k]) * w + ux + DX[k];
        const t = c + this.dg[v];
        if (t < best) { best = t; next = v; }
      }
      if (next < 0 || n >= this.pathBuf.length) return false;
      this.pathBuf[n++] = next;
      u = next;
    }
    this.pathLen = n;
    return true;
  }

  hasPathObstruction(dx: number, dy: number, radius: number, fromIndex: number): boolean {
    const w = this.width;
    const r2 = radius * radius;
    for (let i = Math.max(0, fromIndex); i < this.pathLen; i++) {
      const c = this.pathBuf[i];
      if (this.cells[c] !== 1) continue;
      const cx = c % w;
      const cy = (c / w) | 0;
      if ((cx - dx) * (cx - dx) + (cy - dy) * (cy - dy) > r2) continue;
      if (this.lineOfSight(dx, dy, cx, cy)) return true;
    }
    return false;
  }

  /** Bresenham ray from the drone; blocked if a wall lies strictly between the endpoints. */
  private lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    const adx = Math.abs(x1 - x0);
    const ady = Math.abs(y1 - y0);
    let err = adx - ady;
    let x = x0;
    let y = y0;
    while (x !== x1 || y !== y1) {
      const e2 = 2 * err;
      if (e2 > -ady) { err -= ady; x += sx; }
      if (e2 < adx) { err += adx; y += sy; }
      if ((x !== x1 || y !== y1) && this.getCell(x, y) === 1) return false;
    }
    return true;
  }
}

/** Creates the TypeScript fallback planner for a `width x height` grid. */
export function createTsPlanner(width: number, height: number): Planner {
  return new TsPlanner(width, height);
}

/**
 * Frame-time probe. Pure statistics plus a fixed-size ring buffer; the DOM overlay and the
 * `window.__perf` hook live in `perfProbe.ts` and only exist when the URL has `?perf=1`.
 */

/** One 60 Hz frame budget in milliseconds, rounded the way a profiler would. */
export const FRAME_BUDGET_MS = 16.7;

/** Summary of a window of frame times, all in milliseconds except the counts. */
export interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  /** Number of frames that took longer than `FRAME_BUDGET_MS`. */
  over16_7: number;
}

/** Nearest-rank percentile of an ascending-sorted array. */
function percentile(sorted: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Computes percentiles, max and over-budget count. Does not mutate `times`. */
export function computeFrameStats(times: readonly number[]): FrameStats {
  if (times.length === 0) return { frames: 0, p50: 0, p95: 0, max: 0, over16_7: 0 };
  const sorted = [...times].sort((a, b) => a - b);
  let over = 0;
  for (const t of times) if (t > FRAME_BUDGET_MS) over++;
  return {
    frames: times.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    over16_7: over,
  };
}

/** Fixed-capacity ring of numbers. Pushing never allocates once constructed. */
export class FrameRing {
  private readonly buf: Float64Array;
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.buf = new Float64Array(capacity);
  }

  /** Number of stored values (at most `capacity`). */
  get size(): number {
    return this.count;
  }

  /** Stores a value, overwriting the oldest when full. */
  push(v: number): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Stored values, oldest first. */
  values(): number[] {
    const out: number[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) out.push(this.buf[(start + i) % this.capacity]);
    return out;
  }

  /** Forgets everything. */
  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

/** True when the query string contains `perf=1`. */
export function perfEnabled(search: string): boolean {
  return new URLSearchParams(search).get('perf') === '1';
}

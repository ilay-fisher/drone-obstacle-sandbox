import { FrameRing, FRAME_BUDGET_MS, computeFrameStats, perfEnabled, type FrameStats } from './frameStats';

/** What `window.__perf()` returns: the interval stats plus the same stats for per-frame work time. */
export interface PerfReport extends FrameStats {
  /** Time spent inside the frame callback (simulation tick plus drawing), same statistics. */
  work: FrameStats;
}

/** Handle the render loop uses to feed the probe. Only exists when the URL has `?perf=1`. */
export interface PerfProbe {
  /**
   * Records one frame: `interval` since the previous frame and `work` spent in the callback,
   * in ms. The first frame after `resume()` (and the very first frame) is dropped, because
   * its interval spans a pause rather than a real frame.
   */
  record(interval: number, work: number): void;
  /** Call when the loop resumes, so a pause is never counted as a long frame. */
  resume(): void;
}

declare global {
  interface Window {
    __perf?: () => PerfReport;
    __perfReset?: () => void;
  }
}

/** Ten seconds at 60 Hz with headroom. */
const RING_SIZE = 1200;

/**
 * Installs the frame-time probe when the page URL has `?perf=1`, else returns null and
 * does nothing at all (no timers, no DOM, no listeners), so the normal build pays nothing.
 * Exposes `window.__perf()` and `window.__perfReset()` and a small fixed overlay.
 */
export function installPerfProbe(): PerfProbe | null {
  if (typeof window === 'undefined' || !perfEnabled(window.location.search)) return null;
  const intervals = new FrameRing(RING_SIZE);
  const works = new FrameRing(RING_SIZE);
  let skip = true;

  const report = (): PerfReport => ({
    ...computeFrameStats(intervals.values()),
    work: computeFrameStats(works.values()),
  });
  window.__perf = report;
  window.__perfReset = () => { intervals.clear(); works.clear(); };

  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:1000;padding:6px 12px;border-radius:999px;' +
    'background:rgba(12,16,20,0.88);color:#ece8df;font:500 10px/1.4 "Martian Mono",ui-monospace,monospace;white-space:nowrap;max-width:calc(100vw - 24px);overflow:hidden;' +
    'pointer-events:none;box-shadow:2px 4px 12px rgba(0,0,0,0.5)';
  document.body.appendChild(el);
  setInterval(() => {
    const r = report();
    el.textContent =
      `${r.frames} fr  p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(1)}  ` +
      `>${FRAME_BUDGET_MS} ${r.over16_7}  work p95 ${r.work.p95.toFixed(2)}`;
  }, 500);

  return {
    record(interval, work) {
      if (skip) { skip = false; return; }
      intervals.push(interval);
      works.push(work);
    },
    resume() { skip = true; },
  };
}

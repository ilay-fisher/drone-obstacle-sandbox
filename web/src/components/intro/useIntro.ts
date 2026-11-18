import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanMode } from '../../engine/plannerBridge';
import type { Simulation, SimState } from '../../engine/simulation';
import { defaultStorage, markIntroSeen, type IntroMode } from '../../intro/introStorage';
import { IntroRunner } from '../../intro/introRunner';
import { INTRO_STEPS, OUTRO_CAPTION, OUTRO_MS } from '../../intro/introScript';
import { buildPreset } from '../../scenarios/presets';

export type IntroStatus = 'idle' | 'running' | 'outro' | 'card';

export interface IntroUi {
  status: IntroStatus;
  /** 0 to 3 during the steps, -1 otherwise. */
  step: number;
  caption: string | null;
}

export interface UseIntroArgs {
  sim: Simulation | null;
  gridW: number;
  gridH: number;
  /** Opens by itself once the simulation exists; null for no auto-start. */
  auto: IntroMode | null;
  setMode: (m: PlanMode) => void;
  setPlaying: (on: boolean) => void;
  /** Puts the user's own speed back on the simulation. */
  restoreSpeed: () => void;
  /** Read by the render loop every frame: true while the city is still being painted. */
  quietRef: { current: boolean };
  /** Read by the render loop every frame: true while D* Lite's first (full) plan runs quietly. */
  calmRef: { current: boolean };
}

const IDLE: IntroUi = { status: 'idle', step: -1, caption: null };
/** A frame this long (a background tab coming back) advances the script by no more than this. */
const MAX_FRAME_MS = 100;

/**
 * Runs the guided intro: one rAF loop drives `IntroRunner` and mirrors only the caption and
 * step into React (a few updates in ten seconds, never per frame). The loop is cancelled on
 * skip, finish and unmount, so nothing is left running.
 */
export function useIntro(a: UseIntroArgs) {
  const { sim, gridW, gridH, auto, quietRef, calmRef } = a;
  const [ui, setUi] = useState<IntroUi>(IDLE);
  const uiRef = useRef(ui);
  uiRef.current = ui;
  const argsRef = useRef(a);
  argsRef.current = a;
  const raf = useRef(0);
  const runner = useRef<IntroRunner | null>(null);

  const stopLoop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const begin = useCallback((mode: IntroMode) => {
    if (!sim) return;
    stopLoop();
    markIntroSeen(defaultStorage());
    const city = buildPreset('Urban Canyon', gridW, gridH);
    const empty: SimState = { cells: new Uint8Array(city.cells.length), start: city.start, goal: city.goal, patrols: [] };
    const host = {
      setMode: (m: PlanMode) => argsRef.current.setMode(m),
      setPlaying: (on: boolean) => argsRef.current.setPlaying(on),
      setQuiet: (q: boolean) => { quietRef.current = q; },
      setCalm: (c: boolean) => { calmRef.current = c; },
      restore: () => argsRef.current.restoreSpeed(),
    };
    const r = new IntroRunner(sim, host, city, empty);
    runner.current = r;
    if (mode === 'card') {
      r.showFinished();
      setUi({ status: 'card', step: -1, caption: null });
      return;
    }
    r.start();
    let t = 0;
    let last = performance.now();
    let outroAt = -1;
    setUi({ status: 'running', step: 0, caption: INTRO_STEPS[0].caption });
    const frame = (now: number) => {
      t += Math.min(Math.max(now - last, 0), MAX_FRAME_MS);
      last = now;
      if (outroAt < 0) {
        r.update(t);
        if (r.done) {
          outroAt = t;
          r.finish();
          setUi({ status: 'outro', step: -1, caption: OUTRO_CAPTION });
        } else if (r.step !== uiRef.current.step) {
          setUi({ status: 'running', step: r.step, caption: INTRO_STEPS[r.step].caption });
        }
      } else if (t - outroAt >= OUTRO_MS) {
        setUi(IDLE);
        raf.current = 0;
        return;
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  }, [sim, gridW, gridH, quietRef, calmRef, stopLoop]);

  /** Esc or a click: leave a normal state (Urban Canyon, A*, paused, console lit). */
  const skip = useCallback(() => {
    const s = uiRef.current.status;
    if (s === 'idle') return;
    stopLoop();
    if (s === 'running') runner.current?.skip();
    setUi(IDLE);
  }, [stopLoop]);

  /** Replays on demand ("?" or the console key), in the form the user's motion setting allows. */
  const replay = useCallback((mode: IntroMode) => {
    if (uiRef.current.status === 'running' || uiRef.current.status === 'card') return;
    begin(mode);
  }, [begin]);

  useEffect(() => {
    if (sim && auto) begin(auto);
    return stopLoop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim]);

  useEffect(() => {
    if (ui.status !== 'running' && ui.status !== 'outro') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') skip(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui.status, skip]);

  return { ui, skip, replay };
}

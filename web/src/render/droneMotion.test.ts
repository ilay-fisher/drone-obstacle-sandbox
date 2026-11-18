import { describe, expect, it } from 'vitest';
import {
  MAX_BANK,
  angleDiff,
  bankTarget,
  coverFor,
  createDroneMotion,
  droneFinalState,
  kickRecoil,
  lampMix,
  shadowLook,
  speedNorm,
  stepDroneMotion,
  type MotionInput,
} from './droneMotion';

const DT = 1 / 60;

function input(over: Partial<MotionInput> = {}): MotionInput {
  return { x: 5.5, y: 5.5, heading: 0, reached: false, cover: 0, reduced: false, ...over };
}

/** Runs `seconds` of frames; `mk` builds each frame's input, `onFrame` observes the state after it. */
function run(m: ReturnType<typeof createDroneMotion>, seconds: number, mk: (t: number) => MotionInput, onFrame?: () => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    stepDroneMotion(m, mk(i * DT), DT);
    onFrame?.();
  }
}

describe('angleDiff', () => {
  it('is the shortest signed turn', () => {
    expect(angleDiff(0, 1)).toBeCloseTo(1, 12);
    expect(angleDiff(1, 0)).toBeCloseTo(-1, 12);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12);
    expect(angleDiff(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 12);
  });
  it('is zero for equal angles a whole turn apart', () => {
    expect(angleDiff(0.3, 0.3 + 4 * Math.PI)).toBeCloseTo(0, 9);
  });
});

describe('bankTarget', () => {
  it('is zero on a straight line and leans the way the drone turns', () => {
    expect(bankTarget(0)).toBe(0);
    expect(bankTarget(2)).toBeGreaterThan(0);
    expect(bankTarget(-2)).toBeLessThan(0);
  });
  it('never exceeds the maximum lean', () => {
    expect(bankTarget(1000)).toBeCloseTo(MAX_BANK, 12);
    expect(bankTarget(-1000)).toBeCloseTo(-MAX_BANK, 12);
  });
});

describe('speedNorm', () => {
  it('maps cells per second to 0..1 and clamps', () => {
    expect(speedNorm(0)).toBe(0);
    expect(speedNorm(-3)).toBe(0);
    expect(speedNorm(1e6)).toBe(1);
    expect(speedNorm(6)).toBeGreaterThan(0.2);
    expect(speedNorm(6)).toBeLessThan(0.8);
  });
});

describe('heading and bank', () => {
  it('stay put on a straight line', () => {
    const m = createDroneMotion();
    run(m, 1, () => input());
    expect(m.heading.x).toBeCloseTo(0, 6);
    expect(Math.abs(m.bank.x)).toBeLessThan(1e-3);
  });

  it('smooths the heading with a spring: a 90 degree turn is not a snap', () => {
    const m = createDroneMotion();
    run(m, 0.5, () => input());
    stepDroneMotion(m, input({ heading: Math.PI / 2 }), DT);
    expect(m.heading.x).toBeGreaterThan(0);
    expect(m.heading.x).toBeLessThan(Math.PI / 4);
    run(m, 2, () => input({ heading: Math.PI / 2 }));
    expect(m.heading.x).toBeCloseTo(Math.PI / 2, 2);
  });

  it('turns the short way across the +-pi seam', () => {
    const m = createDroneMotion();
    run(m, 0.3, () => input({ heading: Math.PI - 0.2 }));
    const before = m.heading.x;
    run(m, 1.5, () => input({ heading: -Math.PI + 0.2 }));
    // 0.4 rad of travel, not 2*pi - 0.4 the long way.
    expect(Math.abs(m.heading.x - before)).toBeLessThan(0.8);
  });

  it('leans into a turn, within the limit, and settles level again', () => {
    const m = createDroneMotion();
    run(m, 0.5, () => input());
    let peak = 0;
    run(m, 1.2, () => input({ heading: Math.PI / 2 }), () => { peak = Math.max(peak, m.bank.x); });
    expect(peak).toBeGreaterThan(0.1);
    // The spring may overshoot the soft target a little, never wildly.
    expect(peak).toBeLessThan(MAX_BANK * 1.25);
    run(m, 3, () => input({ heading: Math.PI / 2 }));
    expect(Math.abs(m.bank.x)).toBeLessThan(0.01);
  });

  it('leans the other way for a left turn', () => {
    const m = createDroneMotion();
    run(m, 0.5, () => input());
    let low = 0;
    run(m, 1, () => input({ heading: -Math.PI / 2 }), () => { low = Math.min(low, m.bank.x); });
    expect(low).toBeLessThan(-0.1);
  });

  it('bank is itself spring smoothed, not an instant function of the turn', () => {
    const m = createDroneMotion();
    run(m, 0.5, () => input());
    stepDroneMotion(m, input({ heading: Math.PI / 2 }), DT);
    expect(Math.abs(m.bank.x)).toBeLessThan(0.05);
  });

  it('snaps (no swing across the map) when the drone teleports, e.g. on reset', () => {
    const m = createDroneMotion();
    run(m, 0.5, () => input({ heading: 0.4 }));
    stepDroneMotion(m, input({ x: 30.5, y: 20.5, heading: 2.5 }), DT);
    expect(m.heading.x).toBeCloseTo(2.5, 9);
    expect(m.bank.x).toBe(0);
    expect(m.speed).toBe(0);
  });
});

describe('speed', () => {
  it('approaches the real ground speed and falls back to zero when the drone stops', () => {
    const m = createDroneMotion();
    let x = 5.5;
    run(m, 1, () => { x += 6 * DT; return input({ x }); });
    expect(m.speed).toBeGreaterThan(4.5);
    expect(m.speed).toBeLessThan(6.5);
    run(m, 1, () => input({ x }));
    expect(m.speed).toBeLessThan(0.1);
  });
});

describe('altitude and landing', () => {
  it('hovers at 1 while flying', () => {
    const m = createDroneMotion();
    run(m, 1, () => input());
    expect(m.alt.x).toBeCloseTo(1, 3);
  });

  it('settles to 0 on Reached with a damped overshoot below the pad, then rests', () => {
    const m = createDroneMotion();
    run(m, 0.5, () => input());
    let low = 1;
    run(m, 2.5, () => input({ reached: true }), () => { low = Math.min(low, m.alt.x); });
    expect(low).toBeLessThan(-0.01);
    expect(low).toBeGreaterThan(-0.25);
    expect(Math.abs(m.alt.x)).toBeLessThan(0.01);
  });

  it('takes off again when the mission restarts', () => {
    const m = createDroneMotion();
    run(m, 2.5, () => input({ reached: true }));
    run(m, 2.5, () => input({ reached: false }));
    expect(m.alt.x).toBeCloseTo(1, 2);
  });
});

describe('recoil', () => {
  it('kicks away from the blockage, then springs back to rest', () => {
    const m = createDroneMotion();
    run(m, 0.3, () => input());
    kickRecoil(m, -1, 0, 1);
    let farthest = 0;
    run(m, 0.3, () => input(), () => { farthest = Math.max(farthest, Math.abs(m.rx.x)); });
    expect(farthest).toBeGreaterThan(0.05);
    expect(farthest).toBeLessThan(0.6);
    run(m, 1, () => input());
    expect(Math.hypot(m.rx.x, m.ry.x)).toBeLessThan(0.01);
  });
});

describe('rotors', () => {
  it('spin while flying and stay still under reduced motion', () => {
    const flying = createDroneMotion();
    run(flying, 1, () => input());
    expect(flying.rotor).not.toBe(0);

    const reduced = createDroneMotion();
    run(reduced, 1, () => input({ reduced: true }));
    expect(reduced.rotor).toBe(0);
  });
});

describe('cover and the ground shadow', () => {
  it('is covered when the drone is over a wall and half covered when the shadow lands on one', () => {
    expect(coverFor(false, false)).toBe(0);
    expect(coverFor(true, false)).toBe(1);
    expect(coverFor(false, true)).toBeGreaterThan(0);
    expect(coverFor(false, true)).toBeLessThan(1);
  });

  it('is pushed lower right, further with speed and altitude', () => {
    const still = shadowLook(0, 1, 0);
    const fast = shadowLook(1, 1, 0);
    expect(still.dx).toBeGreaterThan(0);
    expect(still.dy).toBeGreaterThan(0);
    expect(fast.dx).toBeGreaterThan(still.dx);
    expect(fast.dy).toBeGreaterThan(still.dy);
    const landed = shadowLook(0, 0, 0);
    expect(landed.dx).toBeLessThan(still.dx);
  });

  it('shrinks and fades over a building', () => {
    const open = shadowLook(0.5, 1, 0);
    const over = shadowLook(0.5, 1, 1);
    expect(over.scale).toBeLessThan(open.scale);
    expect(over.alpha).toBeLessThan(open.alpha);
    expect(over.soft).toBeGreaterThan(open.soft);
  });
});

describe('droneFinalState (reduced motion selector)', () => {
  it('shows no bank, sweep or pulse and the final heading', () => {
    const s = droneFinalState(true, 'En Route', 1.234);
    expect(s).toEqual({ animate: false, heading: 1.234, bank: 0, altitude: 1, sweep: false, pulse: false });
  });
  it('lands instantly under reduced motion', () => {
    expect(droneFinalState(true, 'Reached', 0).altitude).toBe(0);
  });
  it('animates everything otherwise', () => {
    const s = droneFinalState(false, 'En Route', 0.5);
    expect(s.animate).toBe(true);
    expect(s.sweep).toBe(true);
    expect(s.pulse).toBe(true);
  });
});

describe('reduced motion in the motion state', () => {
  it('draws the final heading, level, with no recoil, and lands in one step', () => {
    const m = createDroneMotion();
    stepDroneMotion(m, input({ heading: 1.1, reduced: true }), DT);
    expect(m.heading.x).toBe(1.1);
    stepDroneMotion(m, input({ heading: 2.2, reduced: true }), DT);
    expect(m.heading.x).toBe(2.2);
    expect(m.bank.x).toBe(0);
    kickRecoil(m, 1, 0, 1);
    stepDroneMotion(m, input({ heading: 2.2, reduced: true }), DT);
    expect(m.rx.x).toBe(0);
    stepDroneMotion(m, input({ heading: 2.2, reduced: true, reached: true }), DT);
    expect(m.alt.x).toBe(0);
  });
});

describe('lampMix (pad lamp going green)', () => {
  it('is off until Reached and the drone has come down', () => {
    expect(lampMix(1, false, false)).toBe(0);
    expect(lampMix(1, true, false)).toBe(0);
  });
  it('is fully green once the drone has settled', () => {
    expect(lampMix(0, true, false)).toBe(1);
    expect(lampMix(-0.05, true, false)).toBe(1);
  });
  it('is between while landing', () => {
    const v = lampMix(0.4, true, false);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });
  it('is instant under reduced motion', () => {
    expect(lampMix(1, true, true)).toBe(1);
    expect(lampMix(0, false, true)).toBe(0);
  });
});

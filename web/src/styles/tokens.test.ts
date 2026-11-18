import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPRING_SNAPPY, SPRING_SOFT, springToLinear } from '../motion/spring';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const squash = (s: string) => s.replace(/\s+/g, '');

describe('tokens.css', () => {
  it('carries the spring easings generated from spring.ts, so CSS and JS cannot drift', () => {
    expect(squash(css)).toContain(squash(`--spring-soft: ${springToLinear(SPRING_SOFT)};`));
    expect(squash(css)).toContain(squash(`--spring-snappy: ${springToLinear(SPRING_SNAPPY)};`));
  });
  it('defines the palette and radius ladder', () => {
    for (const t of ['--stage: #0c1014', '--paint: #ff5a1f', '--paint-hi: #ffb347', '--paint-deep: #a8300f',
      '--radius-chip: 10px', '--radius-control: 16px', '--radius-card: 24px', '--radius-stage: 36px', '--radius-pill: 999px']) {
      expect(css.toLowerCase()).toContain(t);
    }
  });
});

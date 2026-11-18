import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dial } from './Dial';
import { Keycap } from './Keycap';
import { Switch } from './Switch';
import { ControlPanel, type ControlPanelProps } from '../ControlPanel';

const noop = () => {};

describe('Keycap', () => {
  it('a tool keycap reports its pressed state and shows the shortcut letter', () => {
    const on = renderToStaticMarkup(<Keycap legend="Wall" shortcut="W" pressed onClick={noop} />);
    const off = renderToStaticMarkup(<Keycap legend="Wind" shortcut="D" pressed={false} onClick={noop} />);
    expect(on).toContain('aria-pressed="true"');
    expect(off).toContain('aria-pressed="false"');
    expect(on).toContain('>W<');
    expect(on).toContain('<button');
    expect(on).toContain('type="button"');
  });
  it('an action keycap carries no pressed state', () => {
    expect(renderToStaticMarkup(<Keycap legend="Reset" onClick={noop} />)).not.toContain('aria-pressed');
  });
  it('exposes the shortcut to assistive tech', () => {
    expect(renderToStaticMarkup(<Keycap legend="Wall" shortcut="W" onClick={noop} />)).toContain('aria-keyshortcuts="W"');
  });
});

describe('Switch', () => {
  it('is a role=switch with aria-checked', () => {
    const on = renderToStaticMarkup(<Switch label="D* Lite planner" checked onChange={noop} />);
    const off = renderToStaticMarkup(<Switch label="Heatmap" checked={false} onChange={noop} />);
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(off).toContain('aria-checked="false"');
    expect(on).toContain('aria-label="D* Lite planner"');
  });
});

describe('Dial', () => {
  it('has a real range input underneath with the detent range and a spoken value', () => {
    const html = renderToStaticMarkup(
      <Dial label="Speed" value={1.5} min={0.5} max={4} step={0.5} format={(v) => `${v.toFixed(1)}x`} onChange={noop} />,
    );
    expect(html).toContain('type="range"');
    expect(html).toContain('min="0.5"');
    expect(html).toContain('max="4"');
    expect(html).toContain('step="0.5"');
    expect(html).toContain('value="1.5"');
    expect(html).toContain('aria-valuetext="1.5x"');
    expect(html).toContain('aria-label="Speed"');
    expect(html).toContain('1.5x');
  });
  it('draws one tick per detent', () => {
    const html = renderToStaticMarkup(<Dial label="LiDAR radius" value={6} min={3} max={8} step={1} format={String} onChange={noop} />);
    expect(html.match(/class="dial-tick/g)?.length).toBe(6);
  });
});

describe('ControlPanel', () => {
  const props: ControlPanelProps = {
    brush: 'wind', onBrush: noop, mode: 'dstar', onMode: noop, playing: true, onTogglePlay: noop,
    onReset: noop, onClear: noop, onPreset: noop, speed: 2, onSpeed: noop, radius: 5, onRadius: noop,
    showHeat: true, onShowHeat: noop, showLidar: false, onShowLidar: noop, apiOnline: false, demo: true,
    scenarios: [], onRefreshScenarios: noop, onSave: async () => '', onLoad: noop, onDelete: noop,
  };
  const html = renderToStaticMarkup(<ControlPanel {...props} />);
  it('shows three task groups with label pills', () => {
    for (const g of ['Fly', 'Plan', 'Build']) expect(html).toContain(`>${g}<`);
  });
  it('the active tool is pressed, the others are not', () => {
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>(?:(?!<\/button>).)*Wind/s);
  });
  it('the planner switch reflects the mode and the overlays reflect their flags', () => {
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="D\* Lite planner"|aria-label="D\* Lite planner"[^>]*aria-checked="true"/);
    expect(html).toMatch(/aria-label="Heatmap overlay"[^>]*aria-checked="true"|aria-checked="true"[^>]*aria-label="Heatmap overlay"/);
    expect(html).toMatch(/aria-label="LiDAR overlay"[^>]*aria-checked="false"|aria-checked="false"[^>]*aria-label="LiDAR overlay"/);
  });
  it('the play keycap offers Pause while playing', () => {
    expect(html).toContain('aria-label="Pause"');
  });
  it('demo mode keeps the run-locally note', () => {
    expect(html).toContain('requires running the full stack locally');
  });
});

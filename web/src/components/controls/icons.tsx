/** Small engraved glyphs for the keycaps. Stroke and fill follow currentColor so legends light up with the key. */
const common = {
  width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, focusable: false,
};

export const PlayIcon = () => (
  <svg {...common} aria-hidden="true"><path d="M6.5 4.2 15.4 10l-8.9 5.8Z" fill="currentColor" /></svg>
);
export const PauseIcon = () => (
  <svg {...common} aria-hidden="true"><rect x="5" y="4.2" width="3.4" height="11.6" rx="1.2" fill="currentColor" /><rect x="11.6" y="4.2" width="3.4" height="11.6" rx="1.2" fill="currentColor" /></svg>
);
export const ResetIcon = () => (
  <svg {...common} aria-hidden="true"><path d="M4.4 10a5.6 5.6 0 1 0 1.8-4.1" /><path d="M4.2 3.6v3.3h3.3" /></svg>
);
export const ClearIcon = () => (
  <svg {...common} aria-hidden="true"><path d="M4.5 6h11M8 6V4.4h4V6M6 6l.6 9.4h6.8L14 6" /></svg>
);
export const WallIcon = () => (
  <svg {...common} aria-hidden="true"><rect x="3.6" y="4.6" width="12.8" height="10.8" rx="2.4" /><path d="M3.8 10h12.4M10 4.8v5" /></svg>
);
export const WindIcon = () => (
  <svg {...common} aria-hidden="true"><path d="M3.5 7h8.2a2.2 2.2 0 1 0-2.1-2.8M3.5 11h11.2a2.2 2.2 0 1 1-2.1 2.8M3.5 15h5" /></svg>
);
export const PatrolIcon = () => (
  <svg {...common} aria-hidden="true"><circle cx="10" cy="10.6" r="5.2" /><path d="M10 2.6v2.8" /></svg>
);
export const GoalIcon = () => (
  <svg {...common} aria-hidden="true"><circle cx="10" cy="10" r="6.4" /><circle cx="10" cy="10" r="2.4" fill="currentColor" /></svg>
);
export const EraseIcon = () => (
  <svg {...common} aria-hidden="true"><path d="m4.3 12.2 6.6-6.6a1.6 1.6 0 0 1 2.3 0l1.2 1.2a1.6 1.6 0 0 1 0 2.3l-4.9 4.9H7Z" /><path d="M9.8 15.8h6" /></svg>
);
export const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable={false}><path d="m3 4.5 3 3 3-3" /></svg>
);

import { useEffect, useRef } from 'react';
import { isTypingTarget, resolveShortcut, swallowsSpace, type ShortcutAction } from './keymap';

/**
 * Installs one window keydown listener that maps keys to actions via the pure keymap. The
 * handler is read through a ref, so the listener is attached once and never re-bound on the
 * 200 ms telemetry re-render.
 */
export function useShortcuts(onAction: (a: ShortcutAction) => void): void {
  const ref = useRef(onAction);
  ref.current = onAction;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (isTypingTarget(t)) return;
      const action = resolveShortcut(e);
      if (!action) return;
      if (action.type === 'togglePlay' && swallowsSpace(t)) return;
      e.preventDefault();
      ref.current(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

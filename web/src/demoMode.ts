/** Repository URL shown to visitors of the static demo, which has no backend. */
export const REPO_URL = 'https://github.com/ilay-fisher/drone-obstacle-sandbox#readme';

/**
 * Interprets the raw `VITE_DEMO_MODE` build-time value. Only the literal string "true"
 * enables demo mode, so a stray "1" or "false" in an env file cannot disable the API by accident.
 */
export function parseDemoFlag(raw: string | undefined): boolean {
  return raw === 'true';
}

/**
 * True when the app was built for the static GitHub Pages demo (`VITE_DEMO_MODE=true`).
 * Read at call time rather than module load so tests can stub the environment. In demo
 * mode the API client never touches the network, which keeps the browser console free of
 * failing `/api` and `/health` requests on a host that has no backend.
 */
export function isDemoMode(): boolean {
  return parseDemoFlag(import.meta.env?.VITE_DEMO_MODE as string | undefined);
}

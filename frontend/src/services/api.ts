/**
 * Where the backend lives.
 *
 * Served by FastAPI (Render's Docker image, or `vite dev` with its proxy), the backend is the same
 * origin and `VITE_API_URL` stays empty. Built for Vercel, `VITE_API_URL` is the Render URL: REST
 * goes there with CORS, and WebSockets connect to it directly (Vercel can't proxy WebSockets).
 */

const API_BASE = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/$/, "");

/** Absolute URL for a backend HTTP path such as `/menu`. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/** WebSocket URL for a backend path such as `/ws/realtime?table_id=T4`. */
export function wsUrl(path: string): string {
  const base = API_BASE ? new URL(API_BASE) : new URL(location.href);
  const proto = base.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${base.host}${path}`;
}

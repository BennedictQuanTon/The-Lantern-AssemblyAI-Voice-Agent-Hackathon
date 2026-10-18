/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin when the app is hosted apart from it (Vercel → Render). Empty = same origin. */
  readonly VITE_API_URL?: string;
}

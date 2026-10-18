/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin on Render. */
  readonly VITE_API_URL?: string;
  /** Older name for VITE_API_URL. */
  readonly VITE_APP_URL?: string;
}

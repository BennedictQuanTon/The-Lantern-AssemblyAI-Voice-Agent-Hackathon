import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo.html"),
      },
    },
  },
  server: {
    port: 5174,
    // The page reuses the app's styles and orb from ../frontend, the single source of the UI.
    fs: { allow: [resolve(__dirname, "..")] },
  },
});

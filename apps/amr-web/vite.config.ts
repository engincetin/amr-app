import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Geliştirmede /admin ve /v1 istekleri AMR sunucusuna (4000) yönlenir; üretimde dist sunucudan servis edilir.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/admin": { target: "http://localhost:4000", changeOrigin: true },
      "/v1": { target: "http://localhost:4000", changeOrigin: true, ws: true },
      "/health": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

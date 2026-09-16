import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("recharts")) return "recharts";
            if (id.includes("framer-motion")) return "motion";
            if (id.includes("lucide-react")) return "lucide";
          }
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  test: {
    // Include .tsx/.spec and worker tests as well: the toolchain
    // (eslint + tsconfigs) already anticipates .tsx tests, and a .ts-only
    // pattern would silently skip the first real DOM test.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "worker/**/*.{test,spec}.{ts,tsx}"],
  },
});

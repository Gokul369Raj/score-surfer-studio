import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // relative base so the built app works when hosted under a sub-path
  // (e.g. GitHub Pages: /score-surfer-studio/)
  base: "./",
  plugins: [react()],
  server: {
    host: true,
  },
});

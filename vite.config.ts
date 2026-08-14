import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
    port: 4173,
  },
  preview: {
    strictPort: true,
    port: 4173,
  },
});

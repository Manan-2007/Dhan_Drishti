import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxy API + health to the Fastify server so the browser stays same-origin
    // (session cookies just work, no CORS needed in dev).
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:4000", changeOrigin: true },
    },
  },
});

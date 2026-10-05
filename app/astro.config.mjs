// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  vite: {
    server: {
      // During `npm run dev`, forward /api to the chat backend (node api/server.mjs).
      // In Docker, nginx does this instead.
      proxy: { "/api": "http://localhost:3000" },
    },
  },
});
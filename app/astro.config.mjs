// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://lala-home.uk",
  integrations: [sitemap()],
  vite: {
    // Never inline scripts into the HTML: the Content-Security-Policy in
    // security-headers.conf only allows script files from this site.
    build: { assetsInlineLimit: 0 },
    server: {
      // During `npm run dev`, forward /api to the chat backend (node api/server.mjs).
      // In Docker, nginx does this instead.
      proxy: { "/api": "http://localhost:3000" },
    },
  },
});
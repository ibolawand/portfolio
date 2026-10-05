# Portfolio App

This is the Astro application behind the personal portfolio and local AI assistant.

## Overview

The app renders the portfolio landing page, project overview, and chat interface. It serves a dark, minimal front end with custom motion and a 3D avatar overlay, while the backend chat API runs separately and talks to a local Ollama model.

## Local development

```bash
npm install
npm run dev
```

Open the site at:

- http://localhost:4321

During local development, `/api` requests are proxied to the Node chat backend running on port `3000`.

## Production build

```bash
npm run build
```

## Docker

The app is meant to be deployed behind Docker and Nginx from the project root:

```bash
docker compose up --build -d
```

This exposes the built site on port `8080` and routes `/api` traffic via the local chat service.

## Important files

- `src/pages/index.astro` — main portfolio page
- `src/pages/overview.astro` — overview/detail page
- `api/server.mjs` — local chat backend
- `api/about.md` — public facts the AI is allowed to reference
- `docker-compose.yaml` — app, API, and tunnel setup

## Notes

This project is intentionally opinionated and self-hosted. The assistant answers only from curated public facts and is designed to stay tightly scoped to Lawand Ibo's work and background.

# Lawand Ibo Portfolio

A personal portfolio and self-hosted developer site built with Astro, TypeScript, Docker, and a local AI chat layer. The project showcases work, stack, and projects while giving visitors a way to ask a constrained local assistant about the site owner.

## What this project is

This is more than a static portfolio. It combines:

- an interactive portfolio landing page
- a lightweight project overview and tech stack section
- a local AI assistant that answers questions using a curated knowledge base
- Docker-based deployment with Nginx and an API service
- optional public access via Cloudflare Tunnel

The site is designed to feel modern, minimal, and personal while keeping the technical footprint simple and self-hosted.

## Key features

- Portfolio overview with project cards and technology groups
- Minimal dark-mode design with custom motion and cursor effects
- Local model-backed chat experience using Ollama
- Guardrails so the AI only answers from the facts on the site
- Rate limiting and request size controls on the chat backend
- Production-ready container setup for self-hosting

## Tech stack

- Astro
- TypeScript
- Node.js
- Nginx
- Docker / Docker Compose
- Ollama (local LLM backend)
- Cloudflare Tunnel

## Project structure

```text
portfolio/
├── README.md
└── app/
    ├── api/
    │   ├── server.mjs         # chat API (no dependencies)
    │   ├── about.md           # bio + contact facts for the AI
    │   └── site-data.json     # projects + skills, shared by the Overview page and the AI
    ├── public/
    │   ├── models/            # avatar .vrm (not in git, copy it in manually)
    │   ├── og.png             # link-preview image
    │   └── favicon.svg / .ico / apple-touch-icon.png
    ├── src/
    │   ├── pages/             # index.astro (chat), overview.astro (portfolio)
    │   ├── scripts/avatar.ts  # 3D avatar, lazy-loaded
    │   └── styles/            # fonts.css (self-hosted), global, ask, home
    ├── .env.example           # copy to .env
    ├── astro.config.mjs       # site URL, sitemap, no inline scripts (CSP)
    ├── docker-compose.yaml    # portfolio (nginx) + chat-api + cloudflared
    ├── Dockerfile
    ├── nginx.conf
    ├── security-headers.conf  # CSP and other headers, included by nginx.conf
    └── AGENTS.md              # notes for coding agents (CLAUDE.md points here)
```

## Editing content

- Projects and skills: `app/api/site-data.json`. The Overview page and the AI both read it.
- Everything else the AI knows: `app/api/about.md`.
- Restart the chat API after editing either file (`docker compose up -d --build`).

## Local development

Requirements:

- Node.js 22.12+
- npm
- Docker (optional, for containerized runs)
- Ollama installed locally with a model such as `qwen2.5:7b`
- On Linux with an NVIDIA GPU: the proprietary NVIDIA driver, so Ollama uses CUDA.
  With the open-source nouveau driver it falls back to Vulkan and answers take minutes instead of ~1 s.

From the app directory:

```bash
cd portfolio/app
npm install
npm run dev
```

Then open:

- http://localhost:4321 for the frontend
- the local API is proxied to `http://localhost:3000` during development

## Production build

```bash
cd portfolio/app
npm run build
```

You can also serve the built app in Docker:

```bash
cd portfolio/app
docker compose up --build -d
```

This setup runs:

- the Astro app on port `8080`
- the chat API service on the internal Docker network
- Cloudflared for tunnel exposure when configured

## AI chat backend

The chat experience is powered by a small Node.js service in `app/api/server.mjs`.

- Receives chat requests from the frontend
- Sends requests to a local Ollama model
- Applies a strict system prompt based on the facts in `app/api/about.md`
- Enforces input limits and rate limiting
- Returns brief, site-grounded responses only

This keeps the assistant focused on the owner's work, skills, and projects instead of drifting into unrelated general-purpose chat.

## Deployment notes

The project is intended for self-hosting. A typical deployment includes:

- Docker Compose for app + API + tunnel
- Cloudflare Tunnel for public access without exposing local services directly
- Nginx as the static frontend server in production

Copy `app/.env.example` to `app/.env` and set the tunnel token and model.

Pushing to GitHub does not deploy. After changes, rebuild on the server with
`docker compose up -d --build` in `app/`. Docker must start on boot, otherwise the
site is down after a reboot (`systemctl --user enable docker-desktop` with Docker Desktop).

Port 8080 is bound to localhost only: public traffic has to come through the
Cloudflare Tunnel, which the chat API's rate limit relies on.

## Who this is for

This project is designed for:

- personal portfolio hosting
- showcasing software engineering work
- demonstrating a self-hosted AI assistant pattern
- building a lightweight home lab / developer presence

## Contact

- Email: ibolawand432@gmail.com
- GitHub: https://github.com/ibolawand

## License

This project is a personal portfolio and is not intended as a reusable starter kit unless explicitly adapted for reuse.

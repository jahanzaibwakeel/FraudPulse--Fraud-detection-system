# FraudPulse Deployment Guide

FraudPulse is designed for local deployment with free and open-source services only. The default Docker Compose stack runs PostgreSQL, Valkey, API, worker, simulator, Next.js, Prometheus, and Grafana on one machine.

## Local Production Run

```bash
cp .env.example .env
docker compose up -d --build
npm run smoke
```

Open:

- Dashboard: http://localhost:13000
- API health: http://localhost:14000/health
- Prometheus: http://localhost:19090
- Grafana: http://localhost:13001

Grafana login defaults to `admin` / `fraudpulse`.

## Oracle Free VM Production Run

Use the Oracle-specific Compose stack for a public deployment:

```bash
cp .env.oracle.example .env
nano .env
docker compose -f docker-compose.oracle.yml up -d --build
```

That stack runs Caddy on ports `80` and `443`, keeps PostgreSQL and Valkey private on the Docker network, and builds the Next.js frontend with the production API/WebSocket URLs.

For CI/CD, prefer the image-based Oracle stack:

```bash
docker compose -f docker-compose.oracle.images.yml pull
docker compose -f docker-compose.oracle.images.yml up -d
```

GitHub Actions builds and pushes the API, worker, simulator, and web images to GitHub Container Registry, then the Oracle VM pulls those images instead of compiling on the small VM.

Full guide: [oracle-deployment.md](oracle-deployment.md)

## Required Configuration

Before presenting or sharing a long-running local deployment, rotate the demo values in `.env`:

- `API_TOKENS`
- `NEXT_PUBLIC_API_TOKEN`
- `API_SERVICE_TOKEN`
- `POSTGRES_PASSWORD`
- `GF_SECURITY_ADMIN_PASSWORD`
- `ALLOWED_ORIGINS`

The Security page can generate a local token rotation plan. Apply the replacement token lines to `.env`, restart Docker Compose, and discard the generated plan.

## Verification Checklist

Run these after every deployment:

```bash
npm test
npm run build
docker compose config --quiet
docker compose up -d --build
npm run smoke
set PLAYWRIGHT_BASE_URL=http://127.0.0.1:13000
npm run test:e2e -w @fraudpulse/web
```

On macOS/Linux, use `export PLAYWRIGHT_BASE_URL=http://127.0.0.1:13000`.

## Operations

- API and worker logs are structured JSON.
- Authentication and session activity appear in the Security dashboard.
- Dead-letter jobs appear in Operations and can be replayed by admins.
- Model benchmark, training, recalibration, and promotion events are stored for auditability.
- Prometheus scrapes API and worker metrics; Grafana loads the bundled dashboard JSON.

## CI

The GitHub Actions workflow runs:

- `npm ci`
- `docker compose config --quiet`
- `npm test`
- `npm run build`
- Docker Compose smoke checks
- Playwright E2E against the Docker web app
- Dashboard screenshot capture as a CI artifact
- Oracle deployment workflow builds GHCR images, deploys `main` to the Oracle VM through SSH, pulls the images, and restarts the image-based Compose stack when repository secrets and variables are configured.

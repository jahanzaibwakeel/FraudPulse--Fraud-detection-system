# Oracle Free VM Deployment

This guide deploys FraudPulse like a Vercel-style Git deploy, but on an Oracle Always Free Ubuntu VM.

## What This Setup Does

```txt
GitHub push to main
  -> GitHub Actions
  -> SSH into Oracle Ubuntu VM
  -> git pull
  -> docker compose -f docker-compose.oracle.yml up -d --build
  -> Caddy serves HTTPS traffic
```

Oracle does not provide the same one-click GitHub deployment UI as Vercel for this kind of full-stack Docker app, so GitHub Actions becomes the deploy controller.

## One-Time Server Setup

From Windows PowerShell:

```powershell
ssh -i "C:\Users\Dossani Computer\Downloads\ssh-key-2026-06-11.key" ubuntu@80.225.243.147
```

On the Oracle Ubuntu server:

```bash
sudo apt update
sudo apt install git curl nano -y
git clone https://github.com/jahanzaibwakeel/FraudPulse--Fraud-detection-system.git
cd FraudPulse--Fraud-detection-system
bash scripts/oracle-server-setup.sh
```

Log out and SSH back in if Docker permissions do not work immediately.

## Create Production `.env`

On the Oracle server:

```bash
cd ~/FraudPulse--Fraud-detection-system
cp .env.oracle.example .env
nano .env
```

Change at least these values for a normal domain deployment:

```env
WEB_DOMAIN=your-web-domain.example.com
API_DOMAIN=your-api-domain.example.com
NEXT_PUBLIC_API_URL=https://your-web-domain.example.com/api
NEXT_PUBLIC_WS_URL=https://your-web-domain.example.com
ALLOWED_ORIGINS=https://your-web-domain.example.com

POSTGRES_PASSWORD=long-random-password
DATABASE_URL=postgres://fraudpulse:long-random-password@postgres:5432/fraudpulse

API_TOKENS=viewer-token:viewer.demo:viewer,analyst-token:casey.ops:analyst,admin-token:lead.ops:admin,service-token:pipeline.service:service
API_SERVICE_TOKEN=service-token
NEXT_PUBLIC_API_TOKEN=admin-token

GF_SECURITY_ADMIN_PASSWORD=long-random-grafana-password
```

Do not commit `.env`.

For a quick IP-only Oracle demo before you have a domain, use the same public IP for the frontend and same-origin API route:

```env
WEB_DOMAIN=:80
API_DOMAIN=:8080
NEXT_PUBLIC_API_URL=http://80.225.243.147/api
NEXT_PUBLIC_WS_URL=http://80.225.243.147
ALLOWED_ORIGINS=http://80.225.243.147
```

The Caddy config routes `/api/*` and `/socket.io/*` to the backend, so the browser does not need a public `8080` port.

## DNS

Point two DNS records to the Oracle public IP:

```txt
your-web-domain.example.com  -> 80.225.243.147
your-api-domain.example.com  -> 80.225.243.147
```

For a free domain, use a free subdomain provider such as DuckDNS. For example:

```txt
fraudpulse-demo.duckdns.org
fraudpulse-api.duckdns.org
```

## Oracle Firewall Rules

In Oracle Cloud, allow inbound:

```txt
22/tcp   SSH
80/tcp   HTTP
443/tcp  HTTPS
```

Do not publicly open PostgreSQL, Valkey, Prometheus, or Grafana.

The Oracle Compose stack exposes only Caddy on `80` and `443`. Internal services stay on the Docker network.

## First Manual Deploy

On the Oracle server:

```bash
cd ~/FraudPulse--Fraud-detection-system
docker compose -f docker-compose.oracle.yml config --quiet
docker compose -f docker-compose.oracle.yml up -d --build
docker compose -f docker-compose.oracle.yml ps
```

Check:

```bash
TOKEN=$(grep '^NEXT_PUBLIC_API_TOKEN=' .env | cut -d= -f2-)
curl -i -H "Authorization: Bearer $TOKEN" http://localhost/api/admin/overview
```

Open:

```txt
https://your-web-domain.example.com
https://your-web-domain.example.com/api/health
```

## GitHub Secrets For Auto Deploy

In GitHub:

```txt
Repository -> Settings -> Secrets and variables -> Actions -> New repository secret
```

Create:

```txt
ORACLE_HOST=80.225.243.147
ORACLE_USER=ubuntu
ORACLE_SSH_KEY=<contents of your private .key file>
```

Then create this repository variable:

```txt
Repository -> Settings -> Secrets and variables -> Actions -> Variables -> New repository variable

ORACLE_AUTO_DEPLOY=true
```

Without `ORACLE_AUTO_DEPLOY=true`, pushes to `main` will skip deployment. You can still deploy manually from the Actions tab.

To copy the key contents on Windows PowerShell:

```powershell
Get-Content "C:\Users\Dossani Computer\Downloads\ssh-key-2026-06-11.key" -Raw
```

Paste the full output into `ORACLE_SSH_KEY`.

Never commit the `.key` file to GitHub.

## Auto Deploy

After secrets and `ORACLE_AUTO_DEPLOY=true` are configured, every push to `main` runs:

```txt
.github/workflows/deploy-oracle.yml
```

The workflow connects to Oracle, pulls the latest repo, rebuilds Docker images, restarts containers, and prints service status.

You can also deploy manually from GitHub:

```txt
Actions -> Deploy to Oracle VM -> Run workflow
```

## Monitoring

Monitoring is optional on Oracle:

```bash
docker compose -f docker-compose.oracle.yml --profile monitoring up -d
```

Grafana and Prometheus bind to `127.0.0.1` only. Use an SSH tunnel to view them safely:

```powershell
ssh -i "C:\Users\Dossani Computer\Downloads\ssh-key-2026-06-11.key" -L 13001:127.0.0.1:13001 ubuntu@80.225.243.147
```

Then open:

```txt
http://localhost:13001
```

## Backups

Run on the Oracle server:

```bash
docker compose -f docker-compose.oracle.yml exec postgres pg_dump -U fraudpulse fraudpulse > fraudpulse-backup.sql
```

Keep the backup somewhere outside the server too.

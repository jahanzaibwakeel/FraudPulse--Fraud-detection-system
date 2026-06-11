#!/usr/bin/env bash
set -euo pipefail

echo "Updating Ubuntu packages..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nano

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
else
  echo "Docker is already installed."
fi

sudo usermod -aG docker "$USER"

echo "Docker version:"
docker --version || true
echo "Docker Compose version:"
docker compose version || true

cat <<'MSG'

Server setup is done.

Important: log out and SSH back in if Docker says permission denied.
Then clone FraudPulse or let GitHub Actions clone it during first deploy.
MSG

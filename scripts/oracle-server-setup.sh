#!/usr/bin/env bash
set -euo pipefail

echo "Updating Ubuntu packages..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nano

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
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

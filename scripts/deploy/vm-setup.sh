#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 22.04+ VM (Azure / Hetzner / Oracle
# / DigitalOcean / any Debian-family Linux). Installs Docker + clones
# the repo + leaves you ready to fill .env and `docker compose up`.
#
# Usage on a fresh VM:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/deploy/vm-setup.sh | sudo bash
# OR (after cloning manually):
#   sudo bash scripts/deploy/vm-setup.sh

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Mikbal34/writer.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/quilpen}"
BRANCH="${BRANCH:-main}"

echo "==> apt update + base packages"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates ufw

echo "==> install Docker (official script)"
if ! command -v docker >/dev/null 2>&1; then
	curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> firewall: allow 22 (ssh), 80, 443"
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

echo "==> clone repo to $INSTALL_DIR"
if [ ! -d "$INSTALL_DIR/.git" ]; then
	git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
	git -C "$INSTALL_DIR" fetch
	git -C "$INSTALL_DIR" checkout "$BRANCH"
	git -C "$INSTALL_DIR" pull
fi

echo "==> seed .env from template if missing"
if [ ! -f "$INSTALL_DIR/.env" ]; then
	cp "$INSTALL_DIR/.env.production.example" "$INSTALL_DIR/.env"
	chmod 600 "$INSTALL_DIR/.env"
	echo
	echo "==> NEXT STEP:"
	echo "    1. Edit $INSTALL_DIR/.env and fill in real secrets"
	echo "    2. cd $INSTALL_DIR && docker compose -f docker-compose.prod.yml up -d --build"
	echo "    3. (first build ~10-20 min: Tesseract + sentence-transformers)"
	echo "    4. Point DNS A record at this VM's IP → Caddy auto-issues SSL"
else
	echo "    .env already exists, skipping. Run docker compose to (re)deploy."
fi

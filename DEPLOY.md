# Deploy — provider-agnostic runbook

Quilpen runs as 4 containers (caddy + web + worker + python) via
Docker Compose. The same setup works **identically** on any provider:

- Azure VM (B4ms, ~$121/mo)
- Hetzner Cloud (CCX23, ~$19/mo)
- Oracle Cloud (Always Free ARM, $0/mo)
- DigitalOcean Droplet (~$50/mo)
- AWS Lightsail / Linode / Vultr — same idea

External services stay the same when you move providers: **Neon**
(Postgres), **Upstash** (Redis), **Cloudflare R2** (PDF blob), **Modal**
(Surya GPU OCR), **Anthropic** (Claude), **Resend** (email).

Sizing: 4 vCPU + 16 GB RAM + 80 GB SSD is comfortable for the current
stack. Single tenant + occasional bursts fit comfortably; for 50+
concurrent uploads, scale up to 8 vCPU (Azure resize takes 5 min, no
downtime).

---

## First-time deploy on a fresh VM

Assumptions: Ubuntu 22.04+, SSH access, sudo.

```bash
# 1. SSH into VM as root or sudo user
ssh azureuser@<VM_IP>

# 2. Run the bootstrap script (installs Docker, clones repo, seeds .env)
sudo bash <(curl -fsSL https://raw.githubusercontent.com/Mikbal34/writer/main/scripts/deploy/vm-setup.sh)

# 3. Edit .env with real secrets (copy from password manager)
sudo nano /opt/quilpen/.env

# 4. Build + start (first build ~10-20 min for Tesseract + sentence-transformers)
cd /opt/quilpen
sudo docker compose -f docker-compose.prod.yml up -d --build

# 5. Watch logs to confirm healthy startup
sudo docker compose -f docker-compose.prod.yml logs -f
```

When you see `[worker] up — queue="library-ingest" concurrency=4` and
`INFO: Application startup complete.` from python, it's live.

## DNS cutover (zero-downtime style)

Caddy auto-issues + renews Let's Encrypt certs as long as DNS for the
domain points at the VM's public IP.

1. **Test first** via temporary subdomain (e.g. `staging.quilpen.com`)
   pointed at the new VM. Hit it in a browser; verify upload works.
2. When confident, change the main `quilpen.com` A record to the new
   IP. Caddy issues the cert within ~30 seconds of the first hit.
3. Old provider (Fly) stays running for ~24 h as a fallback. Stop it
   when the new host has been stable for a day.

## Updates / new deploys

```bash
ssh azureuser@<VM_IP>
cd /opt/quilpen
sudo git pull
sudo docker compose -f docker-compose.prod.yml up -d --build
```

`--build` only rebuilds layers that changed (fast on second run).

## Health checks

```bash
# Container status
sudo docker compose -f docker-compose.prod.yml ps

# Worker logs (live)
sudo docker compose -f docker-compose.prod.yml logs -f worker

# Python logs (live)
sudo docker compose -f docker-compose.prod.yml logs -f python

# Caddy access logs
sudo docker compose -f docker-compose.prod.yml logs -f caddy

# Quick port test
curl http://localhost/healthz   # → "ok"
curl https://quilpen.com        # → live site
```

## Moving to a different provider (e.g. Azure → Hetzner)

The setup is portable by design — nothing here depends on the cloud
provider. To move:

1. Provision new VM on the target provider (Ubuntu 22.04, same size).
2. Run the bootstrap script as above.
3. Copy the existing `.env` over (scp or copy-paste from password
   manager). External services (Neon, R2, Upstash, Modal) are
   provider-independent, so the same credentials work.
4. `docker compose up -d --build` on the new VM.
5. Update DNS A record to the new IP.
6. Caddy re-issues the cert on first request (LE remembers the
   account, no rate-limit penalty).
7. After 24 h stable, destroy the old VM.

Typical migration: **~30 minutes** of active work + ~20 minutes of
build/cert provisioning.

## Cost-tier reference

| Provider | Instance | vCPU/RAM | $/mo | Notes |
|----------|----------|----------|------|-------|
| Azure | B4ms | 4 / 16 | $121 | $200 free trial = 1.6 months |
| Azure | B8ms | 8 / 32 | $240 | 2× burst capacity for bigger workloads |
| Hetzner | CCX23 | 4 / 16 | $19 | EU-based, cheapest serious VM |
| Hetzner | CCX33 | 8 / 32 | $40 | When 4 vCPU is too tight |
| Oracle | A1.Flex (Always Free) | 4 / 24 | $0 | ARM, capacity often unavailable |
| DigitalOcean | Premium Intel 4cpu/8gb | 4 / 8 | $48 | Simple PaaS |

## Troubleshooting

**Build OOMs / fails on small VM** — Next.js build needs ~4 GB RAM.
On a 2 GB VM, build a swap file first:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

**Caddy cert not issuing** — check DNS actually resolves to the VM's
IP (`dig quilpen.com`). Also: ports 80 + 443 must be open on the
firewall (the bootstrap script opens them via ufw).

**Python service slow / OOM** — bump VM size or set `OCR_WORKERS=2`
(lower concurrency) in `.env`. Heavy scans (>120 pages or >25 MB)
already auto-route to Modal Surya GPU; no local OCR pressure.

**Worker stays at "queued"** — check Redis connectivity:
`sudo docker compose -f docker-compose.prod.yml exec worker node -e
"require('ioredis').default; console.log('ok')"` and verify REDIS_URL
in `.env`.

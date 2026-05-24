#!/usr/bin/env bash
# Security hardening for a fresh Ubuntu VM running quilpen. Run AFTER
# vm-setup.sh, AFTER docker compose up is verified. Sets up:
#   • fail2ban — block SSH brute-force after 3 failed attempts
#   • unattended-upgrades — automatic security patches (no app reboots)
#   • SSH hardened — key-only login, no root, no password
#   • Daily docker prune — keep disk usage in check
#
# Run: sudo bash scripts/deploy/harden-vm.sh

set -euo pipefail

echo "==> install fail2ban + unattended-upgrades + tools"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
	fail2ban unattended-upgrades apt-listchanges

echo "==> fail2ban: enable sshd jail (defaults are sensible)"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
port = ssh
maxretry = 3
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> unattended-upgrades: enable security-only auto-updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
# Default config already auto-installs security updates only; we just
# need to disable the automatic reboot to avoid interrupting OCR mid-job.
sed -i 's|//\s*Unattended-Upgrade::Automatic-Reboot ".*";|Unattended-Upgrade::Automatic-Reboot "false";|' /etc/apt/apt.conf.d/50unattended-upgrades || true

echo "==> SSH hardening: key-only, no root login"
SSHD_CONFIG=/etc/ssh/sshd_config.d/99-quilpen.conf
cat > "$SSHD_CONFIG" <<'EOF'
# Key-only, no root login. Drops password-brute attack surface to zero.
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
EOF
systemctl reload ssh || systemctl reload sshd

echo "==> daily docker prune cron (keep disk clean)"
cat > /etc/cron.daily/docker-prune <<'EOF'
#!/bin/bash
# Reclaim unused images/containers/networks weekly. Volumes preserved.
docker system prune -af --filter "until=168h" > /dev/null 2>&1 || true
EOF
chmod +x /etc/cron.daily/docker-prune

echo "==> verify"
echo "fail2ban status:"
fail2ban-client status sshd | tail -5
echo
echo "unattended-upgrades:"
unattended-upgrade --dry-run 2>&1 | tail -3 || true
echo
echo "==> DONE. SSH brute-force now auto-blocks; security patches install nightly."

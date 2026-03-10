#!/bin/bash
# CallAnalyzer — EC2 User Data (bootstrap) Script
# This runs once on first boot when launching the EC2 instance.
#
# Usage: Paste into EC2 Launch → Advanced Details → User Data
#        OR pass via: aws ec2 run-instances --user-data file://deploy/ec2/user-data.sh
#
# Prerequisites:
#   - Amazon Linux 2023 AMI (al2023-ami-*)
#   - t3.micro instance type
#   - Security group with ports 22, 80, 443 open
#   - IAM role with S3 + Bedrock access attached to the instance

set -euo pipefail
exec > >(tee /var/log/callanalyzer-setup.log) 2>&1

echo "=== CallAnalyzer EC2 Setup — $(date) ==="

# --- System updates ---
dnf update -y

# --- Install Node.js 20 LTS ---
dnf install -y nodejs20 npm git

# Verify
node --version
npm --version

# --- Install Caddy ---
dnf install -y 'dnf-command(copr)'
dnf copr enable -y @caddy/caddy
dnf install -y caddy

# --- Verify EC2 Instance Connect (pre-installed on AL2023) ---
echo "Verifying EC2 Instance Connect..."
rpm -q ec2-instance-connect || dnf install -y ec2-instance-connect
echo "EC2 Instance Connect: $(rpm -q ec2-instance-connect)"

# --- Create application user ---
useradd --system --shell /usr/sbin/nologin --home-dir /opt/callanalyzer callanalyzer
mkdir -p /opt/callanalyzer
chown callanalyzer:callanalyzer /opt/callanalyzer

# --- Create Caddy log directory ---
mkdir -p /var/log/caddy
chown caddy:caddy /var/log/caddy

# --- Clone and build the application ---
cd /opt/callanalyzer
# NOTE: Replace with your actual repo URL
# git clone https://github.com/YOUR_ORG/assemblyai_tool.git .
# npm ci --production=false
# npm run build
# npm prune --production

# --- Create placeholder .env ---
# IMPORTANT: You must fill in real values after first boot!
cat > /opt/callanalyzer/.env << 'ENVFILE'
# === REQUIRED ===
ASSEMBLYAI_API_KEY=your_key_here
SESSION_SECRET=CHANGE_ME_TO_RANDOM_STRING

# === Authentication ===
# Format: username:bcrypt_hash:role:displayName (comma-separated for multiple)
AUTH_USERS=admin:$2b$10$CHANGE_ME:admin:Admin User

# === AWS (Bedrock AI + S3 Storage) ===
# If using an IAM instance role, you can omit these — the app uses the role automatically
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1

# === Storage ===
S3_BUCKET=ums-call-archive

# === Optional ===
PORT=5000
RETENTION_DAYS=90
ENVFILE

chown callanalyzer:callanalyzer /opt/callanalyzer/.env
chmod 600 /opt/callanalyzer/.env

# --- Install systemd service ---
# NOTE: Copy the service file from the repo after cloning:
# cp /opt/callanalyzer/deploy/ec2/callanalyzer.service /etc/systemd/system/
# For now, create it inline:
cat > /etc/systemd/system/callanalyzer.service << 'SERVICEFILE'
[Unit]
Description=CallAnalyzer - AI-Powered Call Quality Analysis
After=network.target

[Service]
Type=simple
User=callanalyzer
Group=callanalyzer
WorkingDirectory=/opt/callanalyzer
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=5000
EnvironmentFile=/opt/callanalyzer/.env
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/callanalyzer
PrivateTmp=true
LimitNOFILE=65535
MemoryMax=512M
StandardOutput=journal
StandardError=journal
SyslogIdentifier=callanalyzer

[Install]
WantedBy=multi-user.target
SERVICEFILE

systemctl daemon-reload
systemctl enable callanalyzer

# --- Install Caddyfile ---
# NOTE: Replace YOUR_DOMAIN before running!
cat > /etc/caddy/Caddyfile << 'CADDYFILE'
YOUR_DOMAIN {
    reverse_proxy localhost:5000

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        -Server
    }

    log {
        output file /var/log/caddy/access.log {
            roll_size 50mb
            roll_keep 10
            roll_keep_for 90d
        }
        format json
    }

    request_body {
        max_size 50MB
    }
}
CADDYFILE

systemctl enable caddy

# --- Enable EBS encryption (reminder) ---
echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "Next steps:"
echo "  1. Connect via EC2 Instance Connect (AWS Console → EC2 → Connect) or: mssh ec2-user@INSTANCE_ID"
echo "  2. Clone your repo to /opt/callanalyzer/"
echo "  3. Run: npm ci && npm run build && npm prune --production"
echo "  4. Edit /opt/callanalyzer/.env with real credentials"
echo "  5. Edit /etc/caddy/Caddyfile — replace YOUR_DOMAIN"
echo "  6. Point your domain's DNS A record to this instance's public IP"
echo "  7. Start services: sudo systemctl start callanalyzer && sudo systemctl start caddy"
echo "  8. Verify: curl https://YOUR_DOMAIN/api/auth/me"
echo ""

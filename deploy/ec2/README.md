# CallAnalyzer — EC2 Deployment Guide (Lean Setup)

**Estimated monthly cost: ~$13/month** (t3.micro + EBS + Elastic IP, after free tier)

This guide sets up CallAnalyzer on a single EC2 instance with Caddy for automatic TLS — no ALB, no NAT gateway, no extra services.

> **Render is still available** as a parallel deployment target for testing with non-PHI data. This EC2 setup is for the production HIPAA-compliant environment.

---

## Architecture

```
Internet → Caddy (:443, auto TLS) → Node.js (:5000) → S3 / Bedrock / AssemblyAI
```

- **EC2 t3.micro** in a public subnet (2 vCPU, 1GB RAM)
- **Caddy** handles TLS termination (free Let's Encrypt certs, auto-renewal)
- **systemd** manages the Node.js process (auto-restart, boot start)
- **IAM instance role** for S3 + Bedrock access (no hardcoded AWS keys on the instance)
- **EBS gp3 20GB** with encryption enabled

---

## Prerequisites

1. **A domain name** pointed to your EC2 instance's public IP (required for TLS)
2. **AWS account** with access to EC2, S3, Bedrock, IAM
3. **AssemblyAI API key**
4. **Your repo** accessible from the EC2 instance (GitHub deploy key or HTTPS)

---

## Step 1: Launch EC2 Instance

### Via AWS Console

1. Go to **EC2 → Launch Instance**
2. **Name**: `callanalyzer`
3. **AMI**: Amazon Linux 2023 (al2023-ami-*)
4. **Instance type**: `t3.micro`
5. **Key pair**: Create or select an SSH key pair
6. **Network settings**:
   - VPC: Default VPC (or your VPC)
   - Subnet: Public subnet
   - Auto-assign public IP: **Enable**
   - Security group: Create new with rules below
7. **Storage**: 20 GiB gp3, **Encrypted: Yes**
8. **Advanced → IAM instance profile**: Create and attach `CallAnalyzerEC2Role` (see IAM section)
9. **Advanced → User data**: Paste contents of `user-data.sh`
10. **Launch**

### Security Group Rules

| Type  | Port | Source      | Purpose                           |
|-------|------|-------------|-----------------------------------|
| SSH   | 22   | Your IP/32  | Admin access (restrict to your IP)|
| HTTP  | 80   | 0.0.0.0/0   | Caddy ACME challenge + redirect   |
| HTTPS | 443  | 0.0.0.0/0   | Application traffic               |

> See `security-group.json` for CLI-friendly format.

### Allocate Elastic IP

1. **EC2 → Elastic IPs → Allocate**
2. **Associate** with your instance
3. **Point your domain** A record to this IP

---

## Step 2: IAM Instance Role

Create an IAM role so the app accesses S3 and Bedrock without hardcoded keys.

1. **IAM → Roles → Create Role**
2. **Trusted entity**: AWS Service → EC2
3. **Create inline policy** (JSON):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::ums-call-archive", "arn:aws:s3:::ums-call-archive/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": "*"
    }
  ]
}
```

4. **Name**: `CallAnalyzerEC2Role`
5. **Attach** to the EC2 instance (Actions → Security → Modify IAM Role)

---

## Step 3: Configure the Instance

SSH into the instance:

```bash
ssh -i your-key.pem ec2-user@YOUR_ELASTIC_IP
```

### If user-data ran successfully, skip to configuration:

```bash
# Check setup log
cat /var/log/callanalyzer-setup.log
```

### Clone and build the app:

```bash
cd /opt/callanalyzer
sudo -u callanalyzer git clone https://github.com/YOUR_ORG/assemblyai_tool.git .
sudo -u callanalyzer npm ci --production=false
sudo -u callanalyzer npm run build
sudo -u callanalyzer npm prune --production
```

### Configure environment:

```bash
sudo nano /opt/callanalyzer/.env
```

Fill in:
- `ASSEMBLYAI_API_KEY` — your actual key
- `SESSION_SECRET` — generate with: `openssl rand -base64 32`
- `AUTH_USERS` — your admin user(s)
- `S3_BUCKET` — `ums-call-archive` (or your bucket)
- Remove `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` if using IAM role (recommended)

### Configure Caddy:

```bash
sudo nano /etc/caddy/Caddyfile
# Replace YOUR_DOMAIN with your actual domain
```

### Start services:

```bash
sudo systemctl start callanalyzer
sudo systemctl start caddy

# Verify
sudo systemctl status callanalyzer
sudo systemctl status caddy
curl -I https://YOUR_DOMAIN
```

---

## Step 4: Verify HIPAA Compliance Checklist

| Requirement | How it's met |
|-------------|-------------|
| Encryption in transit | Caddy auto-TLS (Let's Encrypt) |
| Encryption at rest | EBS encryption enabled + S3 SSE |
| Access control | Role-based auth + session timeouts |
| Audit logging | Express audit middleware + Caddy access logs + journald |
| Account lockout | 5 failed attempts → 15-min lockout |
| Data retention | Auto-purge after RETENTION_DAYS (default 90) |
| Network security | Security group restricts to 22/80/443 only |
| No hardcoded secrets | IAM instance role for AWS, .env for app secrets |

---

## Ongoing Operations

### Deploy updates

```bash
sudo /opt/callanalyzer/deploy/ec2/deploy.sh main
```

Or manually:
```bash
cd /opt/callanalyzer
sudo -u callanalyzer git pull origin main
sudo -u callanalyzer npm ci --production=false
sudo -u callanalyzer npm run build
sudo -u callanalyzer npm prune --production
sudo systemctl restart callanalyzer
```

### View logs

```bash
# App logs
sudo journalctl -u callanalyzer -f

# Caddy access logs
sudo tail -f /var/log/caddy/access.log

# Setup log (first boot only)
cat /var/log/callanalyzer-setup.log
```

### Backup .env

```bash
# Keep a local encrypted copy of your .env — it's not in the repo
scp -i your-key.pem ec2-user@YOUR_IP:/opt/callanalyzer/.env ./env-backup-$(date +%F).enc
```

### Monitor costs

Set a billing alarm in AWS:
1. **CloudWatch → Alarms → Create Alarm**
2. **Metric**: `EstimatedCharges` → `Currency: USD`
3. **Threshold**: `> 20` (or your comfort level)
4. **Notification**: Your email via SNS

---

## Parallel Render Deployment (Non-PHI Testing)

Render remains available for quick testing with non-PHI / synthetic data:

- **Render dashboard**: Configure build (`npm run build`) and start (`npm run start`) commands
- **Environment variables**: Set in Render dashboard (use test/demo credentials)
- **No code changes needed** — the same codebase works on both platforms
- **Key difference**: Render handles TLS and process management automatically

Use Render for:
- Demo / staging environment
- Testing UI changes before deploying to EC2
- Sharing preview links with stakeholders

Use EC2 for:
- Production with real call recordings
- HIPAA-compliant PHI processing
- Long-term cost savings

---

## Files in this directory

| File | Purpose |
|------|---------|
| `Caddyfile` | Caddy reverse proxy config (copy to `/etc/caddy/Caddyfile`) |
| `callanalyzer.service` | systemd unit file (copy to `/etc/systemd/system/`) |
| `user-data.sh` | EC2 first-boot bootstrap script |
| `deploy.sh` | Code update / redeployment script |
| `security-group.json` | Security group + IAM role reference |
| `README.md` | This file |

# Disaster Recovery Plan — CallAnalyzer

**Last Updated**: 2026-03-19

## Overview

This document describes the disaster recovery (DR) strategy for CallAnalyzer, including cross-region replication, backup procedures, recovery objectives, and restoration steps.

---

## Recovery Objectives

| Metric | Target | Notes |
|--------|--------|-------|
| **RPO** (Recovery Point Objective) | 1 hour | Maximum acceptable data loss |
| **RTO** (Recovery Time Objective) | 4 hours | Maximum acceptable downtime |
| **MTTR** (Mean Time To Recover) | 2 hours | Average expected recovery time |

---

## Architecture Components

| Component | Primary Region | DR Region | Replication Method |
|-----------|---------------|-----------|-------------------|
| **S3 (audio, analysis)** | us-east-1 | us-west-2 | S3 Cross-Region Replication (CRR) |
| **RDS PostgreSQL** | us-east-1 | us-west-2 | RDS Cross-Region Read Replica |
| **EC2 Application** | us-east-1 | us-west-2 | AMI snapshot + launch template |
| **Route 53 DNS** | Global | Global | Health-check failover routing |

---

## 1. S3 Cross-Region Replication Setup

### Prerequisites
- Destination bucket in DR region (e.g., `ums-call-archive-dr` in us-west-2)
- IAM role with replication permissions
- Versioning enabled on both source and destination buckets

### Setup Steps

```bash
# 1. Create destination bucket in DR region
aws s3 mb s3://ums-call-archive-dr --region us-west-2

# 2. Enable versioning on destination bucket
aws s3api put-bucket-versioning \
  --bucket ums-call-archive-dr \
  --versioning-configuration Status=Enabled

# 3. Verify versioning on source bucket
aws s3api get-bucket-versioning --bucket ums-call-archive

# 4. Create IAM role for replication (see iam-replication-policy.json below)

# 5. Configure replication on source bucket
aws s3api put-bucket-replication \
  --bucket ums-call-archive \
  --replication-configuration file://replication-config.json
```

### replication-config.json
```json
{
  "Role": "arn:aws:iam::ACCOUNT_ID:role/s3-crr-role",
  "Rules": [
    {
      "ID": "ReplicateAll",
      "Status": "Enabled",
      "Priority": 1,
      "Filter": {},
      "Destination": {
        "Bucket": "arn:aws:s3:::ums-call-archive-dr",
        "StorageClass": "STANDARD_IA",
        "EncryptionConfiguration": {
          "ReplicaKmsKeyID": "arn:aws:kms:us-west-2:ACCOUNT_ID:key/DR_KMS_KEY_ID"
        }
      },
      "SourceSelectionCriteria": {
        "SseKmsEncryptedObjects": {
          "Status": "Enabled"
        }
      },
      "DeleteMarkerReplication": {
        "Status": "Enabled"
      }
    }
  ]
}
```

### Verification
```bash
# Check replication status
aws s3api get-bucket-replication --bucket ums-call-archive

# Verify an object replicated
aws s3api head-object --bucket ums-call-archive-dr --key calls/test-object.json
```

---

## 2. RDS Cross-Region Read Replica

### Setup
```bash
# Create cross-region read replica
aws rds create-db-instance-read-replica \
  --db-instance-identifier callanalyzer-dr-replica \
  --source-db-instance-identifier callanalyzer-primary \
  --source-region us-east-1 \
  --region us-west-2 \
  --db-instance-class db.t3.medium \
  --storage-encrypted \
  --kms-key-id arn:aws:kms:us-west-2:ACCOUNT_ID:key/DR_KMS_KEY_ID
```

### Promotion During Failover
```bash
# Promote read replica to standalone (during DR event)
aws rds promote-read-replica \
  --db-instance-identifier callanalyzer-dr-replica \
  --region us-west-2

# Wait for promotion to complete
aws rds wait db-instance-available \
  --db-instance-identifier callanalyzer-dr-replica \
  --region us-west-2
```

---

## 3. EC2 Application Recovery

### AMI Snapshot Schedule
```bash
# Create AMI from current production instance (run weekly or after deployments)
aws ec2 create-image \
  --instance-id i-PRODUCTION_INSTANCE_ID \
  --name "callanalyzer-$(date +%Y%m%d)" \
  --description "CallAnalyzer production snapshot" \
  --no-reboot

# Copy AMI to DR region
aws ec2 copy-image \
  --source-image-id ami-SOURCE_AMI_ID \
  --source-region us-east-1 \
  --region us-west-2 \
  --name "callanalyzer-dr-$(date +%Y%m%d)"
```

### Launch in DR Region
```bash
# Launch from DR AMI
aws ec2 run-instances \
  --image-id ami-DR_AMI_ID \
  --instance-type t3.medium \
  --key-name callanalyzer-dr-key \
  --security-group-ids sg-DR_SECURITY_GROUP \
  --subnet-id subnet-DR_SUBNET \
  --region us-west-2 \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=callanalyzer-dr}]'
```

---

## 4. DNS Failover (Route 53)

### Health Check Configuration
```bash
# Create health check for primary
aws route53 create-health-check --caller-reference "primary-$(date +%s)" \
  --health-check-config '{
    "IPAddress": "PRIMARY_EC2_IP",
    "Port": 443,
    "Type": "HTTPS",
    "ResourcePath": "/api/health",
    "RequestInterval": 30,
    "FailureThreshold": 3
  }'

# Configure failover record set
# Primary record (FAILOVER = PRIMARY)
# Secondary record (FAILOVER = SECONDARY) pointing to DR instance
```

---

## 5. Failover Procedure

### Automated Steps (via CloudWatch Alarm + Lambda)
1. Route 53 health check detects primary is down (3 consecutive failures)
2. DNS automatically routes to DR instance IP
3. CloudWatch alarm triggers notification to ops team

### Manual Steps (Incident Commander)
1. **Assess**: Confirm primary region outage via AWS Health Dashboard
2. **Promote DB**: Promote RDS read replica to standalone primary
3. **Update Config**: Update DR instance `.env` with new `DATABASE_URL` pointing to promoted replica
4. **Start App**: `pm2 start dist/index.js --name callanalyzer`
5. **Verify**: Check `/api/health` endpoint and test key workflows
6. **Notify**: Update status page and notify users

### Recovery (Return to Primary)
1. Restore primary region infrastructure
2. Set up replication from DR back to primary
3. Wait for full sync
4. Switch DNS back to primary
5. Demote DR back to read replica

---

## 6. Backup Schedule

| Data | Method | Frequency | Retention |
|------|--------|-----------|-----------|
| **S3 audio/analysis** | CRR + versioning | Continuous | 90 days (RETENTION_DAYS) |
| **RDS database** | Automated snapshots | Daily | 35 days |
| **RDS database** | Cross-region replica | Continuous | Real-time |
| **EC2 AMI** | Manual/scripted snapshot | Weekly + post-deploy | 30 days |
| **Application code** | GitHub repository | Every push | Indefinite |
| **.env configuration** | AWS Systems Manager Parameter Store | On change | Indefinite |

---

## 7. Testing Schedule

| Test Type | Frequency | Description |
|-----------|-----------|-------------|
| **Backup restoration** | Quarterly | Restore RDS from snapshot, verify data integrity |
| **S3 replication verification** | Monthly | Upload test object, verify replication to DR bucket |
| **DR failover drill** | Semi-annually | Full failover to DR region, verify app functionality |
| **DNS failover test** | Quarterly | Simulate primary health check failure |

---

## 8. Verification Commands

```bash
# Verify S3 replication is active
aws s3api get-bucket-replication --bucket ums-call-archive

# Check RDS replica status and lag
aws rds describe-db-instances \
  --db-instance-identifier callanalyzer-dr-replica \
  --query 'DBInstances[0].{Status:DBInstanceStatus,ReplicaLag:StatusInfos}'

# List RDS snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier callanalyzer-primary \
  --query 'DBSnapshots[*].{ID:DBSnapshotIdentifier,Created:SnapshotCreateTime,Status:Status}' \
  --output table

# Verify DR AMI exists
aws ec2 describe-images \
  --owners self \
  --filters "Name=name,Values=callanalyzer-dr-*" \
  --region us-west-2 \
  --query 'Images[*].{ID:ImageId,Name:Name,Created:CreationDate}' \
  --output table

# Test health endpoint on DR instance
curl -s https://dr.umscallanalyzer.com/api/health
```

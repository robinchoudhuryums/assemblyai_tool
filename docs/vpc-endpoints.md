# VPC Endpoints for CallAnalyzer

## Overview

CallAnalyzer's EC2 instance communicates with AWS S3 (audio storage) and AWS Bedrock (AI analysis) over the public internet by default. VPC endpoints route this traffic through AWS's private network instead, providing two benefits:

1. **Security** -- S3 and Bedrock API calls never leave the AWS backbone, eliminating exposure to the public internet. This strengthens HIPAA compliance by reducing the attack surface for PHI in transit.
2. **Performance** -- Private network paths typically have lower latency and higher throughput than internet-routed paths.

### What Needs Endpoints

| Service | Endpoint Type | Cost | Priority |
|---------|--------------|------|----------|
| **S3** | Gateway | Free | High -- every call upload/download uses S3 |
| **Bedrock** | Interface (PrivateLink) | ~$0.01/hr per AZ + data processing | Medium -- used for AI analysis |
| **RDS** | None needed | N/A | N/A -- already runs inside the VPC |
| **AssemblyAI** | Not applicable | N/A | N/A -- third-party service, must use internet |

---

## Prerequisites

Before starting, gather these values:

```bash
# Find your VPC ID
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*callanalyzer*" \
  --query "Reservations[].Instances[].VpcId" \
  --region us-east-1 --output text

# Find your route table IDs (needed for S3 Gateway endpoint)
aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=<YOUR_VPC_ID>" \
  --query "RouteTables[].RouteTableId" \
  --region us-east-1 --output text

# Find your subnet IDs (needed for Bedrock Interface endpoint)
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=<YOUR_VPC_ID>" \
  --query "Subnets[].[SubnetId, AvailabilityZone]" \
  --region us-east-1 --output text

# Find the security group used by your EC2 instance
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*callanalyzer*" \
  --query "Reservations[].Instances[].SecurityGroups" \
  --region us-east-1 --output table
```

Set these as shell variables for the commands below:

```bash
VPC_ID="vpc-xxxxxxxxxxxxxxxxx"
ROUTE_TABLE_IDS="rtb-xxxxxxxxxxxxxxxxx"        # comma-separated if multiple
SUBNET_IDS="subnet-aaa,subnet-bbb"             # subnets where EC2 runs
EC2_SG_ID="sg-xxxxxxxxxxxxxxxxx"                # EC2 instance security group
```

---

## 1. S3 Gateway Endpoint (Free, Recommended)

Gateway endpoints are free and add a route to your VPC route table that directs S3 traffic through the AWS private network. No DNS or security group changes needed.

### Create the Endpoint

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id $VPC_ID \
  --service-name com.amazonaws.us-east-1.s3 \
  --route-table-ids $ROUTE_TABLE_IDS \
  --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=callanalyzer-s3-endpoint},{Key=Project,Value=CallAnalyzer}]" \
  --region us-east-1
```

### Restrict to Your Bucket (Optional but Recommended)

Create a policy file `s3-endpoint-policy.json`:

```json
{
  "Statement": [
    {
      "Sid": "AllowCallAnalyzerBucket",
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::ums-call-archive",
        "arn:aws:s3:::ums-call-archive/*"
      ]
    }
  ]
}
```

Apply it:

```bash
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id vpce-xxxxxxxxxxxxxxxxx \
  --policy-document file://s3-endpoint-policy.json \
  --region us-east-1
```

### Route Table Verification

After creation, verify the route was added:

```bash
aws ec2 describe-route-tables \
  --route-table-ids $ROUTE_TABLE_IDS \
  --query "RouteTables[].Routes[?GatewayId!=null && starts_with(GatewayId, 'vpce-')]" \
  --region us-east-1 --output table
```

You should see a route with destination `pl-xxxxxxxx` (the S3 prefix list) pointing to the VPC endpoint.

---

## 2. Bedrock Interface Endpoint (PrivateLink)

Interface endpoints create elastic network interfaces (ENIs) in your subnets with private IP addresses. Bedrock requires two endpoints: one for the runtime API (inference calls) and one for batch inference if you use `BEDROCK_BATCH_MODE`.

### Create Security Group for the Endpoint

The endpoint ENIs need a security group that allows HTTPS (port 443) inbound from your EC2 instance:

```bash
# Create a dedicated security group
ENDPOINT_SG_ID=$(aws ec2 create-security-group \
  --group-name callanalyzer-vpce-bedrock \
  --description "Allow HTTPS from CallAnalyzer EC2 to Bedrock VPC endpoint" \
  --vpc-id $VPC_ID \
  --region us-east-1 \
  --query "GroupId" --output text)

# Allow inbound HTTPS from the EC2 security group
aws ec2 authorize-security-group-ingress \
  --group-id $ENDPOINT_SG_ID \
  --protocol tcp \
  --port 443 \
  --source-group $EC2_SG_ID \
  --region us-east-1

echo "Endpoint security group: $ENDPOINT_SG_ID"
```

### Create the Bedrock Runtime Endpoint

This handles `InvokeModel` calls (used by `server/services/bedrock.ts` for on-demand analysis):

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id $VPC_ID \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.us-east-1.bedrock-runtime \
  --subnet-ids $SUBNET_IDS \
  --security-group-ids $ENDPOINT_SG_ID \
  --private-dns-enabled \
  --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=callanalyzer-bedrock-runtime},{Key=Project,Value=CallAnalyzer}]" \
  --region us-east-1
```

### Create the Bedrock API Endpoint (If Using Batch Mode)

Only needed if `BEDROCK_BATCH_MODE=true`. This handles `CreateModelInvocationJob` and `GetModelInvocationJob` calls:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id $VPC_ID \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.us-east-1.bedrock \
  --subnet-ids $SUBNET_IDS \
  --security-group-ids $ENDPOINT_SG_ID \
  --private-dns-enabled \
  --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=callanalyzer-bedrock-api},{Key=Project,Value=CallAnalyzer}]" \
  --region us-east-1
```

### Private DNS

The `--private-dns-enabled` flag makes the endpoint work transparently -- `bedrock-runtime.us-east-1.amazonaws.com` resolves to private IPs inside your VPC. No application code changes are needed; the app's existing SigV4 signing in `server/services/bedrock.ts` works as-is.

**Requirement**: Your VPC must have `enableDnsSupport` and `enableDnsHostnames` set to `true`:

```bash
aws ec2 describe-vpc-attribute --vpc-id $VPC_ID --attribute enableDnsSupport --region us-east-1
aws ec2 describe-vpc-attribute --vpc-id $VPC_ID --attribute enableDnsHostnames --region us-east-1

# Enable if not already set:
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support --region us-east-1
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames --region us-east-1
```

---

## 3. Verification

### Confirm Endpoints Exist

```bash
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "VpcEndpoints[].[VpcEndpointId, ServiceName, VpcEndpointType, State]" \
  --region us-east-1 --output table
```

### Test S3 Connectivity

SSH into the EC2 instance and confirm S3 operations still work:

```bash
# Upload a test file
echo "vpc-endpoint-test" > /tmp/vpc-test.txt
aws s3 cp /tmp/vpc-test.txt s3://ums-call-archive/vpc-test.txt

# Download it back
aws s3 cp s3://ums-call-archive/vpc-test.txt /tmp/vpc-test-download.txt
cat /tmp/vpc-test-download.txt

# Clean up
aws s3 rm s3://ums-call-archive/vpc-test.txt
rm /tmp/vpc-test.txt /tmp/vpc-test-download.txt
```

### Test Bedrock Connectivity

Restart the app and verify Bedrock calls succeed:

```bash
pm2 restart all
pm2 logs --lines 20   # Watch for successful startup

# Upload a short test call and check that AI analysis completes
# (monitor via WebSocket or check pm2 logs for "Analysis complete")
```

### Verify Traffic Routing (S3 Gateway)

Check VPC Flow Logs (if enabled) to confirm S3 traffic no longer goes through the internet gateway. Alternatively, trace the route:

```bash
# From EC2 instance -- this should show a private path
traceroute s3.us-east-1.amazonaws.com
```

### Verify Traffic Routing (Bedrock Interface)

Confirm DNS resolves to private IPs:

```bash
# From EC2 instance
nslookup bedrock-runtime.us-east-1.amazonaws.com

# Should return private IPs (10.x.x.x or 172.x.x.x), NOT public IPs
```

---

## 4. CloudFormation Template (Optional)

For infrastructure-as-code deployments:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: VPC Endpoints for CallAnalyzer (S3 Gateway + Bedrock PrivateLink)

Parameters:
  VpcId:
    Type: AWS::EC2::VPC::Id
    Description: VPC where CallAnalyzer EC2 runs
  RouteTableIds:
    Type: List<AWS::EC2::RouteTable::Id>
    Description: Route tables for S3 Gateway endpoint
  SubnetIds:
    Type: List<AWS::EC2::Subnet::Id>
    Description: Subnets for Bedrock Interface endpoint
  EC2SecurityGroupId:
    Type: AWS::EC2::SecurityGroup::Id
    Description: Security group of the CallAnalyzer EC2 instance
  EnableBatchEndpoint:
    Type: String
    Default: 'false'
    AllowedValues: ['true', 'false']
    Description: Create Bedrock API endpoint (needed for BEDROCK_BATCH_MODE)

Conditions:
  CreateBatchEndpoint: !Equals [!Ref EnableBatchEndpoint, 'true']

Resources:
  S3GatewayEndpoint:
    Type: AWS::EC2::VPCEndpoint
    Properties:
      VpcId: !Ref VpcId
      ServiceName: !Sub com.amazonaws.${AWS::Region}.s3
      VpcEndpointType: Gateway
      RouteTableIds: !Ref RouteTableIds
      PolicyDocument:
        Statement:
          - Sid: AllowCallAnalyzerBucket
            Effect: Allow
            Principal: '*'
            Action:
              - s3:GetObject
              - s3:PutObject
              - s3:DeleteObject
              - s3:ListBucket
              - s3:GetBucketLocation
            Resource:
              - arn:aws:s3:::ums-call-archive
              - arn:aws:s3:::ums-call-archive/*

  BedrockEndpointSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupName: callanalyzer-vpce-bedrock
      GroupDescription: Allow HTTPS from CallAnalyzer EC2 to Bedrock VPC endpoint
      VpcId: !Ref VpcId
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 443
          ToPort: 443
          SourceSecurityGroupId: !Ref EC2SecurityGroupId

  BedrockRuntimeEndpoint:
    Type: AWS::EC2::VPCEndpoint
    Properties:
      VpcId: !Ref VpcId
      ServiceName: !Sub com.amazonaws.${AWS::Region}.bedrock-runtime
      VpcEndpointType: Interface
      SubnetIds: !Ref SubnetIds
      SecurityGroupIds:
        - !Ref BedrockEndpointSecurityGroup
      PrivateDnsEnabled: true

  BedrockApiEndpoint:
    Type: AWS::EC2::VPCEndpoint
    Condition: CreateBatchEndpoint
    Properties:
      VpcId: !Ref VpcId
      ServiceName: !Sub com.amazonaws.${AWS::Region}.bedrock
      VpcEndpointType: Interface
      SubnetIds: !Ref SubnetIds
      SecurityGroupIds:
        - !Ref BedrockEndpointSecurityGroup
      PrivateDnsEnabled: true

Outputs:
  S3EndpointId:
    Value: !Ref S3GatewayEndpoint
  BedrockRuntimeEndpointId:
    Value: !Ref BedrockRuntimeEndpoint
  BedrockApiEndpointId:
    Condition: CreateBatchEndpoint
    Value: !Ref BedrockApiEndpoint
```

Deploy with:

```bash
aws cloudformation deploy \
  --template-file vpc-endpoints.yaml \
  --stack-name callanalyzer-vpc-endpoints \
  --parameter-overrides \
    VpcId=$VPC_ID \
    RouteTableIds=$ROUTE_TABLE_IDS \
    SubnetIds=$SUBNET_IDS \
    EC2SecurityGroupId=$EC2_SG_ID \
    EnableBatchEndpoint=false \
  --region us-east-1
```

---

## 5. Cost Considerations

| Endpoint | Type | Hourly Cost | Monthly Estimate |
|----------|------|-------------|-----------------|
| S3 | Gateway | **Free** | $0 |
| Bedrock Runtime | Interface | $0.01/hr per AZ | ~$7.20/AZ/month |
| Bedrock API (batch) | Interface | $0.01/hr per AZ | ~$7.20/AZ/month |
| Data processing | Interface only | $0.01/GB | Varies with usage |

**Recommendations**:
- Always create the S3 Gateway endpoint -- it is free and improves security with zero downside.
- For Bedrock, deploy the Interface endpoint in a single AZ initially (the one where your EC2 instance runs) to minimize cost. You can add AZs later for redundancy.
- If you only use on-demand Bedrock (not batch mode), you only need the `bedrock-runtime` endpoint, not the `bedrock` endpoint.

---

## 6. Rollback

If you need to remove endpoints:

```bash
# List endpoints
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "VpcEndpoints[].[VpcEndpointId, ServiceName]" \
  --region us-east-1 --output table

# Delete a specific endpoint
aws ec2 delete-vpc-endpoints \
  --vpc-endpoint-ids vpce-xxxxxxxxxxxxxxxxx \
  --region us-east-1

# Delete the security group (after removing Interface endpoints)
aws ec2 delete-security-group \
  --group-id $ENDPOINT_SG_ID \
  --region us-east-1
```

No application changes are needed -- removing the endpoints simply reverts traffic to the default internet path.

---

## 7. Application Impact

**No code changes required.** VPC endpoints are transparent to the application:

- **S3 Gateway**: Routes are added at the VPC level. The app's S3 REST API calls in `server/services/s3.ts` continue to target `ums-call-archive.s3.us-east-1.amazonaws.com` -- the VPC route table handles redirection.
- **Bedrock Interface**: Private DNS resolves `bedrock-runtime.us-east-1.amazonaws.com` to private IPs. The SigV4 signing in `server/services/bedrock.ts` works identically.
- **RDS**: Already communicates over private VPC networking. No change needed.
- **AssemblyAI**: Third-party service -- must continue to use the public internet. Ensure your EC2 instance retains internet access (NAT gateway or public IP) for AssemblyAI transcription requests.

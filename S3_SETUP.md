# S3 Upload Setup Guide

## Why S3 Upload? 🚀

The **"Maximum response size reached"** error happens when trying to stream large video files (50-500MB) directly through HTTP responses. 

**S3 Upload solves this by:**
- ✅ No response size limits
- ✅ No timeout issues
- ✅ Faster for clients (CDN distribution)
- ✅ Reliable downloads (resumable)
- ✅ Persistent storage (videos don't disappear)
- ✅ Industry standard approach

## How It Works

```
┌─────────────────┐
│  Create Video   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Upload to S3   │  (3-5 seconds)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Return URL     │  {"videoUrl": "https://..."}
└─────────────────┘
```

**Client gets:**
```json
{
  "success": true,
  "videoUrl": "https://your-bucket.s3.us-east-1.amazonaws.com/videos/abc123/final_video.mp4",
  "fileSize": "45.3 MB",
  "jobId": "abc123-def456-...",
  "timestamp": "2025-10-26T04:30:00.000Z"
}
```

## Option 1: AWS S3 Setup (Recommended)

### Step 1: Create AWS Account
1. Go to https://aws.amazon.com/
2. Sign up for free tier (12 months free, 5GB storage)

### Step 2: Create S3 Bucket
```bash
# Option A: Using AWS Console
1. Go to https://console.aws.amazon.com/s3/
2. Click "Create bucket"
3. Bucket name: sebestian-videos (must be globally unique)
4. Region: us-east-1 (or your preferred region)
5. Uncheck "Block all public access" (we need public read)
6. Click "Create bucket"

# Option B: Using AWS CLI
aws s3 mb s3://sebestian-videos --region us-east-1
```

### Step 3: Configure Bucket Policy (Public Read)
1. Go to your bucket → Permissions → Bucket Policy
2. Add this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::sebestian-videos/*"
    }
  ]
}
```

### Step 4: Create IAM User with S3 Access
```bash
# Option A: Using AWS Console
1. Go to https://console.aws.amazon.com/iam/
2. Click "Users" → "Add users"
3. User name: sebestian-api
4. Select "Programmatic access"
5. Click "Next: Permissions"
6. Click "Attach policies directly"
7. Select "AmazonS3FullAccess" (or create custom policy below)
8. Click "Next" → "Create user"
9. SAVE the Access Key ID and Secret Access Key

# Option B: Custom Policy (More Secure - Only This Bucket)
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::sebestian-videos/*"
    }
  ]
}
```

### Step 5: Configure Environment Variables
```bash
# Copy .env.example to .env
cp .env.example .env

# Edit .env and add your AWS credentials
nano .env
```

Add these values:
```env
PORT=5000
NODE_ENV=production

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_S3_BUCKET=sebestian-videos
AWS_REGION=us-east-1
```

### Step 6: Install AWS SDK
```bash
npm install
```

### Step 7: Test S3 Upload
```bash
# Restart your server
pm2 restart sebestian-api

# Test the endpoint
curl --location 'http://localhost:5000/api/ffmpeg/create-video' \
--header 'Content-Type: application/json' \
--data '{
    "files": ["https://example.com/audio1.mp3"],
    "imageUrl": "https://example.com/image.png",
    "vibe": "Test Upload",
    "subtitle": "S3 Test"
}'

# Expected response (JSON with URL):
{
  "success": true,
  "videoUrl": "https://sebestian-videos.s3.us-east-1.amazonaws.com/videos/abc123/final_video.mp4",
  "fileSize": "45.3 MB",
  "jobId": "abc123-...",
  "timestamp": "2025-10-26T04:30:00.000Z"
}
```

## Option 2: Direct Download (Fallback)

If S3 is **not configured**, the API automatically falls back to direct file download.

### How It Works
- Video streams directly through HTTP response
- Works for smaller files (<50MB)
- May have timeout issues for large files
- No persistent storage

### When Direct Download Fails
```
Error: Maximum response size reached
Error: Request timeout
Error: Socket hang up
```

### Using Direct Download
Simply don't configure AWS credentials in `.env`. The API will detect this and use direct download mode.

**Logs will show:**
```
[Download] S3 not configured, using direct download...
[Download] Note: For large files, consider using S3 upload instead
```

## Alternative Cloud Storage

### Option 3: Cloudflare R2 (S3-Compatible, Cheaper)

Cloudflare R2 is S3-compatible but with **free egress** (no bandwidth charges).

```bash
# 1. Sign up at https://dash.cloudflare.com/
# 2. Create R2 bucket
# 3. Get API token from R2 settings
# 4. Use same code, just change endpoint:
```

```javascript
// In helpers/s3Upload.js, modify S3Client:
const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
```

**Pricing Comparison:**
| Service | Storage | Egress | Best For |
|---------|---------|--------|----------|
| AWS S3 | $0.023/GB | $0.09/GB | Enterprise |
| Cloudflare R2 | $0.015/GB | **FREE** | High traffic |
| Backblaze B2 | $0.005/GB | $0.01/GB | Budget |

### Option 4: DigitalOcean Spaces (S3-Compatible)

```env
# .env
AWS_ACCESS_KEY_ID=your_spaces_key
AWS_SECRET_ACCESS_KEY=your_spaces_secret
AWS_S3_BUCKET=sebestian-videos
AWS_REGION=nyc3
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
```

Modify S3Client endpoint:
```javascript
endpoint: process.env.DO_SPACES_ENDPOINT || undefined
```

## Comparing Both Methods

| Feature | S3 Upload | Direct Download |
|---------|-----------|-----------------|
| **Max File Size** | No limit | ~100MB |
| **Reliability** | ✅ High | ⚠️ Medium |
| **Speed** | ✅ Fast (CDN) | ⚠️ Server dependent |
| **Persistent Storage** | ✅ Yes | ❌ No |
| **Cost** | ~$1-5/month | Free |
| **Setup Complexity** | Medium | None |
| **Recommended For** | **Production** | Development |

## Security Best Practices

### 1. Use IAM Roles (Production)
Instead of access keys, use IAM roles on EC2/Lambda:
```javascript
// No credentials needed
const s3Client = new S3Client({ region: "us-east-1" });
```

### 2. Set Bucket Lifecycle Rules
Auto-delete old videos to save costs:
```bash
# AWS Console: S3 → Bucket → Management → Lifecycle rules
- Delete files older than 7 days
- Move to Glacier after 30 days (archive)
```

### 3. Enable CORS (If Accessing from Browser)
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": []
  }
]
```

### 4. Use Signed URLs (Private Videos)
For private videos, generate temporary signed URLs:
```javascript
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand } = require("@aws-sdk/client-s3");

// Generate URL valid for 1 hour
const command = new GetObjectCommand({
  Bucket: "sebestian-videos",
  Key: fileName,
});
const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
```

## Monitoring & Cost Management

### Monitor S3 Usage
```bash
# Check bucket size
aws s3 ls s3://sebestian-videos --recursive --human-readable --summarize

# Get cost estimate
aws ce get-cost-and-usage --time-period Start=2025-01-01,End=2025-01-31 \
  --granularity MONTHLY --metrics BlendedCost
```

### Expected Costs (Example)
```
Storage: 100GB × $0.023 = $2.30/month
Uploads: 1,000 videos × $0.005/1000 = $0.005/month
Downloads: 500GB × $0.09 = $45/month (use CloudFront CDN to reduce)

Total: ~$47/month for high traffic
```

### Cost Optimization Tips
1. **Use CloudFront CDN**: Reduce S3 egress costs by 50-80%
2. **Enable compression**: Smaller files = less bandwidth
3. **Auto-delete old videos**: Lifecycle rules
4. **Use Intelligent-Tiering**: Auto moves to cheaper storage

## Troubleshooting

### Error: "Access Denied"
```bash
# Check IAM permissions
aws s3 ls s3://sebestian-videos --profile your-profile

# Verify bucket policy allows PutObject
```

### Error: "Bucket does not exist"
```bash
# Check bucket name and region in .env
# Bucket names are case-sensitive
```

### Error: "Invalid Access Key"
```bash
# Regenerate access keys in IAM console
# Update .env with new keys
# Restart server: pm2 restart sebestian-api
```

### Videos Not Accessible
```bash
# Check bucket is public:
aws s3api get-bucket-acl --bucket sebestian-videos

# Make specific file public:
aws s3api put-object-acl --bucket sebestian-videos --key videos/test.mp4 --acl public-read
```

## Testing Checklist

- [ ] AWS account created
- [ ] S3 bucket created and public
- [ ] IAM user created with S3 access
- [ ] Credentials added to `.env`
- [ ] Dependencies installed (`npm install`)
- [ ] Server restarted (`pm2 restart sebestian-api`)
- [ ] Test upload successful
- [ ] Video URL accessible in browser
- [ ] Cleanup working (temp files deleted)

## Production Deployment

```bash
# Ubuntu VPS setup
sudo nano /var/www/sebestian/.env
# Add AWS credentials

# Restart application
pm2 restart sebestian-api

# Test
curl -X POST http://localhost:5000/api/ffmpeg/create-video \
  -H "Content-Type: application/json" \
  -d '{"files":["..."], "imageUrl":"...", "vibe":"...", "subtitle":"..."}'

# Should return JSON with videoUrl
```

## Automatic Mode Selection

The API automatically detects which mode to use:

```javascript
// helpers/s3Upload.js
const isS3Configured = () => {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET
  );
};
```

**S3 configured** → Returns JSON with `videoUrl`  
**S3 not configured** → Streams file directly (may fail for large files)

## Summary

✅ **For Production:** Use S3 upload (reliable, scalable)  
⚠️ **For Development:** Direct download works for testing  
🚀 **Best Practice:** Start with S3 from the beginning

---

**Need Help?**
- AWS Documentation: https://docs.aws.amazon.com/s3/
- AWS Free Tier: https://aws.amazon.com/free/
- Pricing Calculator: https://calculator.aws/

**Last Updated:** October 2025

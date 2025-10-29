# Download Endpoints (Without S3)

## Overview

When S3 is not configured, the API creates publicly accessible download URLs for video and thumbnail files. These URLs point to temporary files on your VPS server.

## How It Works

### With S3 (Recommended)
```
Video created → Upload to S3 → Return permanent S3 URL
```

### Without S3 (Fallback)
```
Video created → Store locally → Return temporary download URL
```

## Response Format

### API Response (Without S3)
```json
{
  "success": true,
  "message": "Video and thumbnail created successfully",
  "videoUrl": "http://your-vps-server.com/api/ffmpeg/download/video/abc-123-def-456",
  "thumbnailUrl": "http://your-vps-server.com/api/ffmpeg/download/thumbnail/abc-123-def-456",
  "videoSize": "45.3 MB",
  "thumbnailSize": "234.56 KB",
  "jobId": "abc-123-def-456",
  "timestamp": "2025-10-26T23:30:00.000Z",
  "note": "For production use, configure S3 upload in .env file"
}
```

**Note:** URLs are automatically generated with your server's hostname and protocol.

## Download Endpoints

### 1. Download Video

**Endpoint:** `GET /api/ffmpeg/download/video/:jobId`

**Example:**
```bash
curl http://your-vps-server.com/api/ffmpeg/download/video/abc-123-def-456 \
  --output my-video.mp4
```

**Response:**
- **Content-Type:** `video/mp4`
- **Content-Disposition:** `attachment; filename="video_abc-123-def-456.mp4"`
- **Content-Length:** File size in bytes
- **Accept-Ranges:** `bytes` (supports resume)
- **Cache-Control:** `public, max-age=3600` (1 hour cache)

**Browser:**
```
http://your-vps-server.com/api/ffmpeg/download/video/abc-123-def-456
```
Opens download dialog for video file.

### 2. Download Thumbnail

**Endpoint:** `GET /api/ffmpeg/download/thumbnail/:jobId`

**Example:**
```bash
curl http://your-vps-server.com/api/ffmpeg/download/thumbnail/abc-123-def-456 \
  --output my-thumbnail.jpg
```

**Response:**
- **Content-Type:** `image/jpeg`
- **Content-Disposition:** `inline; filename="thumbnail_abc-123-def-456.jpg"`
- **Content-Length:** File size in bytes
- **Cache-Control:** `public, max-age=3600` (1 hour cache)

**Browser:**
```
http://your-vps-server.com/api/ffmpeg/download/thumbnail/abc-123-def-456
```
Displays thumbnail image in browser.

## Use Cases

### 1. Direct Download from Browser
```javascript
// User clicks download button
window.location.href = response.videoUrl;
```

### 2. Display Thumbnail in HTML
```html
<img src="http://your-vps-server.com/api/ffmpeg/download/thumbnail/abc-123" 
     alt="Video Thumbnail">
```

### 3. Video Player Embed
```html
<video controls poster="http://your-vps-server.com/api/ffmpeg/download/thumbnail/abc-123">
  <source src="http://your-vps-server.com/api/ffmpeg/download/video/abc-123" type="video/mp4">
</video>
```

### 4. Share Links
```javascript
// Share video URL
const shareUrl = response.videoUrl;
navigator.share({
  title: 'Check out this video',
  url: shareUrl
});
```

### 5. Download with JavaScript
```javascript
const response = await fetch('/api/ffmpeg/create-video', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ files, imageUrl, vibe, subtitle })
});

const { videoUrl, thumbnailUrl } = await response.json();

// Download video
const videoBlob = await fetch(videoUrl).then(r => r.blob());
const url = URL.createObjectURL(videoBlob);

// Trigger download
const a = document.createElement('a');
a.href = url;
a.download = 'my-video.mp4';
a.click();
```

## Important Notes

### ⚠️ Temporary Files

**Files are cleaned on the next API request!**

```
Request 1: Creates video → Files stored in temp/job-1/
Request 2: Cleanup temp → Delete temp/job-1/ → Creates video → Files stored in temp/job-2/
```

**Timeline:**
- Files available immediately after creation
- Files remain until next video creation request
- Files are NOT persistent

**Recommendation:** Download files immediately or use S3 for persistent storage.

### ⚠️ Single Request Processing

Due to aggressive cleanup, only one request should be processed at a time:

```
Request A: Clean → Create → Return URLs
Request B: Wait for A to complete
Request B: Clean (deletes A's files) → Create → Return URLs
```

**If concurrent:** Request B would delete Request A's files before they're downloaded!

**Solutions:**
1. **Use S3** (recommended) - Files persist after cleanup
2. **Download immediately** - Get files before next request
3. **Add job queue** - Process one at a time

### ⚠️ Public URLs

Download URLs are **publicly accessible** without authentication:

```
Anyone with the URL can download:
http://your-vps-server.com/api/ffmpeg/download/video/abc-123
```

**Security considerations:**
- Job IDs are UUIDs (hard to guess)
- Files are temporary (cleaned regularly)
- For sensitive content, use S3 with signed URLs

## URL Generation

The API automatically detects your server URL:

```javascript
const protocol = req.protocol; // 'http' or 'https'
const host = req.get('host');  // 'your-vps-server.com:5000'
const baseUrl = `${protocol}://${host}`;

videoUrl = `${baseUrl}/api/ffmpeg/download/video/${jobId}`;
```

**Examples:**
- Local: `http://localhost:5000/api/ffmpeg/download/video/abc-123`
- VPS: `http://123.45.67.89:5000/api/ffmpeg/download/video/abc-123`
- Domain: `https://api.yourdomain.com/api/ffmpeg/download/video/abc-123`

## Error Handling

### 404 Not Found

**When:** File doesn't exist or was cleaned up

**Response:**
```json
{
  "error": "Video not found",
  "message": "Video may have been cleaned up. Please create a new video."
}
```

**Solution:** Create video again

### 500 Server Error

**When:** File streaming fails

**Response:**
```json
{
  "error": "Failed to stream video",
  "details": "Error message here"
}
```

**Solution:** Check server logs, retry

## Testing

### Test Video Download
```bash
# Create video
curl -X POST http://localhost:5000/api/ffmpeg/create-video \
  -H "Content-Type: application/json" \
  -d '{
    "files": ["https://example.com/audio.mp3"],
    "imageUrl": "https://example.com/image.png",
    "vibe": "Test",
    "subtitle": "Download Test"
  }' | jq .

# Extract videoUrl from response
# {"videoUrl": "http://localhost:5000/api/ffmpeg/download/video/abc-123", ...}

# Download video
curl http://localhost:5000/api/ffmpeg/download/video/abc-123 \
  --output test-video.mp4

# Verify video
ffprobe test-video.mp4
```

### Test Thumbnail Download
```bash
# Download thumbnail
curl http://localhost:5000/api/ffmpeg/download/thumbnail/abc-123 \
  --output test-thumbnail.jpg

# Verify thumbnail
file test-thumbnail.jpg
# Output: test-thumbnail.jpg: JPEG image data, ...
```

### Test File Cleanup
```bash
# Create first video
curl -X POST http://localhost:5000/api/ffmpeg/create-video \
  -H "Content-Type: application/json" \
  -d '{...}' | jq -r .videoUrl

# Get URL: http://localhost:5000/api/ffmpeg/download/video/job-1

# Download works
curl http://localhost:5000/api/ffmpeg/download/video/job-1 --output video1.mp4
# Success!

# Create second video (cleans first)
curl -X POST http://localhost:5000/api/ffmpeg/create-video \
  -H "Content-Type: application/json" \
  -d '{...}' | jq -r .videoUrl

# Try to download first video again
curl http://localhost:5000/api/ffmpeg/download/video/job-1
# Error: Video not found (cleaned up)
```

## Comparison: S3 vs Download URLs

| Feature | S3 URLs | Download URLs |
|---------|---------|---------------|
| **Persistence** | Permanent | Temporary |
| **Cleanup** | Manual/lifecycle | Automatic (next request) |
| **Performance** | CDN (fast) | VPS (slower) |
| **Bandwidth** | Offloaded | VPS bandwidth |
| **Cost** | $1-5/month | Free |
| **Concurrent** | Unlimited | One at a time |
| **Security** | Signed URLs | Public (UUID) |
| **Production** | ✅ Recommended | ❌ Not recommended |
| **Development** | Optional | ✅ Good for testing |

## Migration to S3

When ready for production, add S3 credentials:

```env
# .env
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_S3_BUCKET=your-bucket
AWS_REGION=us-east-1
```

**Restart server:**
```bash
pm2 restart sebestian-api
```

**Response will automatically switch to S3 URLs:**
```json
{
  "videoUrl": "https://bucket.s3.amazonaws.com/videos/.../video.mp4",
  "thumbnailUrl": "https://bucket.s3.amazonaws.com/videos/.../thumbnail.jpg"
}
```

No code changes needed!

## Monitoring

### Check Active Files
```bash
curl http://localhost:5000/api/ffmpeg/storage-info
```

Response:
```json
{
  "tempDirectorySize": "145.67 MB",
  "activeTempDirectories": 1,
  "tempDirectoryPath": "C:\\...\\temp"
}
```

### Check Logs
```bash
pm2 logs sebestian-api | grep Download
```

Expected:
```
[Download] Streaming video for job: abc-123
[Download] Streaming thumbnail for job: abc-123
```

## Best Practices

### ✅ DO:
- Download files immediately after creation
- Use S3 for production deployments
- Cache downloaded files on client side
- Handle 404 errors gracefully
- Process one request at a time

### ❌ DON'T:
- Rely on files being available after hours
- Share download URLs for long-term use
- Process concurrent requests without S3
- Store download URLs in database
- Use in production without S3

## Summary

✅ **Download URLs work** - Files are publicly accessible via HTTP  
✅ **Temporary storage** - Files cleaned on next request  
✅ **Auto-generated URLs** - Uses your VPS hostname  
✅ **Easy to use** - Direct download links  
⚠️ **Not for production** - Use S3 for persistent storage  
⚠️ **Download immediately** - Files won't last long  

**For development: Perfect! For production: Use S3!** 🚀

---

**Feature:** Download Endpoints  
**Mode:** Fallback (S3 not configured)  
**Status:** Temporary file access  
**Recommendation:** Configure S3 for production

# Sebestian - Automated Lo-Fi Video Creator API

A robust Node.js backend API that merges multiple audio files, adds a background image, and overlays text to create professional video content. Perfect for creating lo-fi music videos, podcast videos, or any audio-visual content.

## Features

- **Multiple Audio Merging:** Seamlessly merge up to 20 audio files
- **Professional Video Output:** 1920x1080 Full HD MP4 videos (clean, no text overlay)
- **Thumbnail Generation:** Creates separate 1920x1080 thumbnail image with text overlay
- **Text Overlay:** Vibe and subtitle text with borders (on thumbnail ONLY)
- **Image Processing:** Automatic scaling, cropping, and subtle zoom effects
- **Audio Normalization:** EBU R128 loudness normalization for consistent volume
- **S3 Upload Support:** Upload video and thumbnail to AWS S3 (recommended for production)
- **Automatic Cleanup:** Smart temp file management to prevent disk overflow
- **Robust Error Handling:** Multiple fallback mechanisms for reliability
- **Production Ready:** Graceful shutdown, logging, and health checks
- **Ubuntu VPS Optimized:** Designed for deployment on Ubuntu servers

## Prerequisites

- Node.js v18 or higher
- FFmpeg (automatically installed on npm install)
- Ubuntu 18.04+ (for production deployment)
- 2GB+ RAM recommended
- Sufficient disk space for temp files

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start development server with auto-reload
npm run dev

# Or start production server
npm start
```

Server will start on `http://localhost:5000`

### Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive Ubuntu VPS deployment instructions.

## API Endpoints

### Create Video
**POST** `/api/ffmpeg/create-video`

Creates a video by merging audio files with a background image and text overlay.

**Request Body:**
```json
{
  "files": [
    "https://example.com/audio1.mp3",
    "https://example.com/audio2.mp3"
  ],
  "imageUrl": "https://example.com/background.png",
  "vibe": "Ocean Breeze",
  "subtitle": "Lo Fi Focus Mix"
}
```

**Response (Two Modes):**

**Mode 1: S3 Upload (Recommended - Default when configured)**
```json
{
  "success": true,
  "message": "Video and thumbnail created successfully",
  "videoUrl": "https://your-bucket.s3.amazonaws.com/videos/.../final_video_123.mp4",
  "thumbnailUrl": "https://your-bucket.s3.amazonaws.com/videos/.../thumbnail_123.jpg",
  "videoSize": "45.3 MB",
  "thumbnailSize": "234.56 KB",
  "jobId": "uuid-here",
  "timestamp": "2025-10-26T04:30:00.000Z"
}
```

**Mode 2: Download URLs (Fallback when S3 not configured)**
```json
{
  "success": true,
  "message": "Video and thumbnail created successfully",
  "videoUrl": "http://your-server.com/api/ffmpeg/download/video/uuid-here",
  "thumbnailUrl": "http://your-server.com/api/ffmpeg/download/thumbnail/uuid-here",
  "videoSize": "45.3 MB",
  "thumbnailSize": "234.56 KB",
  "jobId": "uuid-here",
  "timestamp": "2025-10-26T04:30:00.000Z",
  "note": "For production use, configure S3 upload in .env file"
}
```

**Download Endpoints:**
- `GET /api/ffmpeg/download/video/:jobId` - Download video file
- `GET /api/ffmpeg/download/thumbnail/:jobId` - Download thumbnail image

**Note:** Files are stored temporarily and cleaned on the next API request.

**Supported Formats:**
- Audio: MP3, WAV, OGG, M4A, AAC
- Images: JPG, JPEG, PNG, GIF, BMP, WEBP

**Limits:**
- Maximum 20 audio files per request
- Maximum 100MB per file
- Text fields: 100 characters max

### API Documentation
**GET** `/api/ffmpeg/create-video`

Returns API documentation and usage examples.

### Storage Info
**GET** `/api/ffmpeg/storage-info`

Returns current temp directory storage usage and active jobs.

### Health Check
**GET** `/health`

Returns server health status and uptime.

### API Info
**GET** `/`

Returns API information and available endpoints.

## Testing

### Using cURL

```bash
# Health check
curl http://localhost:5000/health

# Create video
curl --location 'http://localhost:5000/api/ffmpeg/create-video' \
--header 'Content-Type: application/json' \
--data '{
    "files": [
        "https://lalals.s3.amazonaws.com/conversions/standard/fabfe467-12bb-4504-ab69-4f7fc9f7ac22.mp3",
        "https://lalals.s3.amazonaws.com/conversions/standard/c8c6b449-d338-4696-97fd-6ee6ddbf8202.mp3"
    ],
    "imageUrl": "https://oaidalleapiprodscus.blob.core.windows.net/private/org-example/user-example/img-example.png",
    "vibe": "Ocean Breeze",
    "subtitle": "Lo Fi Focus Mix"
}' --output output.mp4

# Check storage
curl http://localhost:5000/api/ffmpeg/storage-info
```

### Using Postman

1. Create new POST request to `http://localhost:5000/api/ffmpeg/create-video`
2. Set Headers: `Content-Type: application/json`
3. Set Body (raw JSON) with the payload structure above
4. Click Send
5. Save response as MP4 file

## Video Processing Pipeline

1. **Download**: Fetches all audio files and image from URLs
2. **Convert**: Converts all audio to WAV format (44.1kHz stereo)
3. **Merge**: Concatenates audio files sequentially
4. **Normalize**: Applies EBU R128 loudness normalization
5. **Create Video**: 
   - Scales and crops image to 1920x1080
   - Applies subtle zoom effect (1.0x to 1.5x)
   - Overlays two text lines with borders
   - Encodes with H.264/AAC codecs
6. **Cleanup**: Automatically removes temp files

## Technical Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Video Processing**: FFmpeg via @ffmpeg-installer/ffmpeg
- **File Management**: fs-extra
- **HTTP Client**: Axios
- **Process Management**: PM2 (production)

## Project Structure

```bash
Sebestian/
├── app.js                      # Main application entry point
├── controllers/
│   └── ffmpeg_controller.js    # Video creation logic
├── routes/
│   ├── index.js                # Route exports
│   └── ffmpeg_routes.js        # API routes
├── configurations/
│   └── routes.js               # Route configuration
├── temp/                       # Temporary files (auto-cleanup)
├── package.json                # Dependencies
├── .env                        # Environment variables
├── README.md                   # This file
└── DEPLOYMENT.md               # Deployment guide
```

## Security Features

- Input validation for all parameters
- URL format validation
- File size limits (100MB per file)
- Text sanitization to prevent command injection
- Maximum file count limits
- Automatic timeout for long-running processes

## Automatic Cleanup

The API implements **simple and efficient cleanup** to ensure your VPS never runs out of disk space:

- 🔴 **ONLY on API call:** Empties ENTIRE temp directory before processing (guaranteed fresh start)
- ❌ **NO cleanup after completion:** Files stay until next request
- ❌ **NO periodic cleanup:** Not needed
- ❌ **NO startup cleanup:** Not needed
- ❌ **NO shutdown cleanup:** Not needed

**Strategy:** Single cleanup point = Simple and reliable. Temp directory is emptied when the next request arrives.

**Result:** Each request starts with clean slate. No complex cleanup logic. Perfect for VPS with limited storage.

## Configuration

### Environment Variables

Create a `.env` file:

```env
PORT=5000
NODE_ENV=production

# S3 Upload (RECOMMENDED for production - avoids "Maximum response size" errors)
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_S3_BUCKET=your-bucket-name
AWS_REGION=us-east-1
```

**Important:** If S3 credentials are not provided, the API falls back to direct file download, which may fail for large videos (>50MB) with "Maximum response size reached" error.

See **[S3_SETUP.md](S3_SETUP.md)** for complete AWS S3 configuration guide.

### Memory Management

For large video processing, adjust Node.js memory:

```bash
node --max-old-space-size=2048 app.js
```

## Monitoring

### View Logs
```bash
# With PM2
pm2 logs sebestian-api

# Direct
npm start
```

### Check Storage
```bash
curl http://localhost:5000/api/ffmpeg/storage-info
```

### Monitor Resources
```bash
pm2 monit
```

## Troubleshooting

### FFmpeg Not Found
The `@ffmpeg-installer/ffmpeg` package should handle this automatically. If issues persist:
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# Verify
ffmpeg -version
```

## License

ISC License - See LICENSE file for details.

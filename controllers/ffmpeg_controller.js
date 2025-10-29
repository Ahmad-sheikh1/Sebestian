const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { exec } = require("child_process");
const { promisify } = require("util");
// const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const { uploadToS3, isS3Configured } = require("../helpers/s3Upload");

const execAsync = promisify(exec);
const TEMP_DIR = path.join(process.cwd(), "temp");

// Get FFmpeg path automatically for all platforms
// const FFMPEG_PATH = ffmpegInstaller.path;
const FFMPEG_PATH = "/usr/bin/ffmpeg";


// console.log(`[FFmpeg] Using FFmpeg at: ${FFMPEG_PATH}`);
// console.log(`[FFmpeg] FFmpeg version: ${ffmpegInstaller.version}`);

// Ensure temp directory exists on startup (no cleanup - will be done on first API call)
(async () => {
  try {
    await fs.ensureDir(TEMP_DIR);
    console.log(`[STARTUP] Temp directory initialized: ${TEMP_DIR}`);
    console.log(`[STARTUP] Cleanup will happen on first API request`);
  } catch (err) {
    console.error(`[STARTUP ERROR] Failed to initialize temp directory: ${err.message}`);
  }
})();

// Helper to run ffmpeg commands with timeout and error handling
const runCommand = (cmd, timeout = 300000) => {
  return new Promise((resolve, reject) => {
    console.log(`[FFmpeg] Executing: ${cmd}`);

    const process = exec(cmd, { timeout }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[FFmpeg Error] Command: ${cmd}`);
        console.error(`[FFmpeg Error] Error: ${error.message}`);
        if (stderr) {
          console.error(`[FFmpeg Error] Stderr: ${stderr}`);
        }
        reject(new Error(`FFmpeg command failed: ${error.message}`));
      } else {
        console.log(`[FFmpeg] Command completed successfully`);
        resolve(stdout);
      }
    });

    // Handle process timeout
    process.on('timeout', () => {
      console.error(`[FFmpeg Error] Command timed out: ${cmd}`);
      process.kill();
      reject(new Error('FFmpeg command timed out'));
    });
  });
};

// Helper to safely download files with timeout and size limits
const downloadFile = async (url, filePath, maxSize = 100 * 1024 * 1024) => { // 100MB limit
  try {
    const response = await axios({
      url,
      responseType: "arraybuffer",
      timeout: 60000, // 1 minute timeout
      maxContentLength: maxSize,
      maxRedirects: 5
    });

    if (response.data.length > maxSize) {
      throw new Error(`File too large: ${response.data.length} bytes`);
    }

    await fs.writeFile(filePath, response.data);
    return filePath;
  } catch (error) {
    console.error(`[Download Error] URL: ${url}`);
    console.error(`[Download Error] Error: ${error.message}`);
    throw new Error(`Failed to download file: ${error.message}`);
  }
};

// Helper to safely clean up directory
const safeCleanup = async (dirPath) => {
  try {
    if (await fs.pathExists(dirPath)) {
      await fs.remove(dirPath);
      console.log(`[CLEANUP] Successfully deleted: ${dirPath}`);
    }
  } catch (error) {
    console.error(`[CLEANUP ERROR] Failed to delete ${dirPath}: ${error.message}`);
  }
};

// Helper to clean up ALL temp directories (aggressive cleanup on each API call)
const cleanupAllTempFiles = async () => {
  try {
    if (!(await fs.pathExists(TEMP_DIR))) {
      await fs.ensureDir(TEMP_DIR);
      return;
    }

    const dirs = await fs.readdir(TEMP_DIR);
    let cleanedCount = 0;
    let freedSpace = 0;

    for (const dir of dirs) {
      const dirPath = path.join(TEMP_DIR, dir);
      try {
        // Calculate size before deletion
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stats = await fs.stat(filePath);
          freedSpace += stats.size;
        }

        // Remove directory
        await fs.remove(dirPath);
        cleanedCount++;
        console.log(`[REQUEST CLEANUP] Removed temp directory: ${dir}`);
      } catch (error) {
        console.error(`[REQUEST CLEANUP ERROR] Failed to process ${dir}: ${error.message}`);
      }
    }

    if (cleanedCount > 0) {
      const freedMB = (freedSpace / (1024 * 1024)).toFixed(2);
      console.log(`[REQUEST CLEANUP] Cleaned up ${cleanedCount} temp directories, freed ${freedMB} MB`);
    } else {
      console.log(`[REQUEST CLEANUP] Temp directory is already empty`);
    }
  } catch (error) {
    console.error(`[REQUEST CLEANUP ERROR] Failed to clean temp directory: ${error.message}`);
  }
};

// NO PERIODIC CLEANUP - Only cleanup on API call received

// Helper to get temp directory size
const getTempDirSize = async () => {
  try {
    if (!(await fs.pathExists(TEMP_DIR))) {
      return 0;
    }

    const dirs = await fs.readdir(TEMP_DIR);
    let totalSize = 0;

    for (const dir of dirs) {
      const dirPath = path.join(TEMP_DIR, dir);
      try {
        const stats = await fs.stat(dirPath);
        if (stats.isDirectory()) {
          const files = await fs.readdir(dirPath);
          for (const file of files) {
            const filePath = path.join(dirPath, file);
            const fileStats = await fs.stat(filePath);
            totalSize += fileStats.size;
          }
        }
      } catch (error) {
        // Ignore individual file errors
      }
    }

    return totalSize;
  } catch (error) {
    console.error(`[SIZE CHECK ERROR] Failed to calculate temp directory size: ${error.message}`);
    return 0;
  }
};

const Convert = async (req, res) => {
  let jobId = null;
  let jobDir = null;

  try {
    // AGGRESSIVE CLEANUP: Empty entire temp directory on every API call
    console.log(`[REQUEST] New video creation request received`);
    await cleanupAllTempFiles();

    // Check temp directory is now empty
    const currentSize = await getTempDirSize();
    const sizeInMB = (currentSize / (1024 * 1024)).toFixed(2);
    console.log(`[STORAGE] Temp directory size after cleanup: ${sizeInMB} MB`);

    const { files, imageUrl, vibe, subtitle } = req.body;

    // Comprehensive input validation
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Please provide an array of audio file URLs in 'files'." });
    }

    if (files.length > 20) {
      return res.status(400).json({ error: "Maximum 20 audio files allowed." });
    }

    // Validate URLs
    const urlRegex = /^https?:\/\/.+/;
    for (const file of files) {
      if (typeof file !== 'string' || !urlRegex.test(file)) {
        return res.status(400).json({ error: "All files must be valid HTTP/HTTPS URLs." });
      }
    }

    if (!imageUrl || typeof imageUrl !== 'string' || !urlRegex.test(imageUrl)) {
      return res.status(400).json({ error: "Please provide a valid image URL in 'imageUrl'." });
    }

    // Validate image format (check before query parameters)
    const urlWithoutParams = imageUrl.split('?')[0]; // Remove query parameters
    const supportedImageFormats = /\.(jpg|jpeg|png|gif|bmp|webp)$/i;
    if (!supportedImageFormats.test(urlWithoutParams)) {
      return res.status(400).json({
        error: "Unsupported image format. Supported formats: JPG, JPEG, PNG, GIF, BMP, WEBP"
      });
    }
    if (!vibe || typeof vibe !== 'string' || vibe.trim().length === 0) {
      return res.status(400).json({ error: "Please provide a valid 'vibe' text." });
    }

    if (!subtitle || typeof subtitle !== 'string' || subtitle.trim().length === 0) {
      return res.status(400).json({ error: "Please provide a valid 'subtitle' text." });
    }

    // Sanitize text inputs to prevent command injection
    const sanitizedVibe = vibe.trim().replace(/['"\\]/g, '');
    const sanitizedSubtitle = subtitle.trim().replace(/['"\\]/g, '');

    if (sanitizedVibe.length > 100 || sanitizedSubtitle.length > 100) {
      return res.status(400).json({ error: "Vibe and subtitle must be 100 characters or less." });
    }

    jobId = uuidv4();
    jobDir = path.join(TEMP_DIR, jobId);
    await fs.ensureDir(jobDir);

    console.log(`[Sebestian] Starting video creation job: ${jobId}}`);

    // Step 1: Download all audio files with error handling
    const downloadedFiles = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const url = files[i];
        const filePath = path.join(jobDir, `audio_${i}.mp3`);
        await downloadFile(url, filePath);
        downloadedFiles.push(filePath);
        console.log(`[Download] Audio file ${i + 1}/${files.length} downloaded successfully`);
      } catch (error) {
        console.error(`[Download Error] Failed to download audio file ${i + 1}: ${error.message}`);
        throw new Error(`Failed to download audio file ${i + 1}: ${error.message}`);
      }
    }

    // Step 1.5: Download image file with error handling
    // Determine image format from URL (reuse urlWithoutParams from validation above)
    const imageExtension = urlWithoutParams.toLowerCase().match(/\.(jpg|jpeg|png|gif|bmp|webp)$/)?.[1] || 'jpg';
    const imagePath = path.join(jobDir, `background.${imageExtension}`);

    try {
      await downloadFile(imageUrl, imagePath);
      console.log(`[Download] Image downloaded successfully as ${imageExtension.toUpperCase()}`);
    } catch (error) {
      console.error(`[Download Error] Failed to download image: ${error.message}`);
      throw new Error(`Failed to download image: ${error.message}`);
    }

    // Step 2: Create concat list file (use MP3 files directly - no conversion needed!)
    const listFile = path.join(jobDir, "list.txt");
    // Create silence file (1 second, 44.1kHz, AAC)
    const silenceFile = path.join(jobDir, "silence.m4a");
    await runCommand(
      `"${FFMPEG_PATH}" -f lavfi -i anullsrc=r=44100:cl=stereo -t 1 -c:a aac -b:a 128k "${silenceFile}"`
    );

    let concatLines = [];
    for (let i = 0; i < downloadedFiles.length; i++) {
      concatLines.push(`file '${downloadedFiles[i]}'`);
      // Add silence after each file except the last one
      if (i < downloadedFiles.length - 1) {
        concatLines.push(`file '${silenceFile}'`);
      }
    }

    const concatText = concatLines.join("\n");
    await fs.writeFile(listFile, concatText);

    console.log(`[Concat List] Created list with ${downloadedFiles.length} audio files`);

    // Step 3: Merge and normalize in one step (output as AAC - much smaller than WAV)
    const finalFile = path.join(jobDir, "final_audio.m4a");
    try {
      // Merge MP3 files, normalize, and encode to AAC in one efficient step
      // This saves disk space and processing time
      await runCommand(`"${FFMPEG_PATH}" -y -f concat -safe 0 -i "${listFile}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 128k -ar 44100 "${finalFile}"`);
      console.log(`[Merge + Normalize] Audio files merged and normalized successfully`);

      // Check output file size
      const audioStats = await fs.stat(finalFile);
      const audioSizeMB = (audioStats.size / (1024 * 1024)).toFixed(2);
      console.log(`[Audio] Final audio size: ${audioSizeMB} MB`);
    } catch (error) {
      console.error(`[Merge Error] Failed to merge and normalize audio: ${error.message}`);
      throw new Error(`Failed to merge and normalize audio: ${error.message}`);
    }

    // Step 6: Create video with image and subtitles with error handling
    const videoFile = path.join(jobDir, "final_video.mp4");

    try {
      console.log(`[Video] Starting video creation...`);
      console.log(`[Video] Image path: ${imagePath}`);
      console.log(`[Video] Audio path: ${finalFile}`);
      console.log(`[Video] Output path: ${videoFile}`);

      // Create subtitle text overlay using sanitized values
      const vibeText = sanitizedVibe;
      const subtitleTextLine = sanitizedSubtitle;
      console.log(`[Video] Creating video WITHOUT text overlay (text only on thumbnail)`);

      // Optimized video settings for smaller file size with excellent quality
      // CRF 23 = Good quality with smaller size (range: 0-51, lower = better quality)
      // preset medium = Good balance of speed and compression
      // Audio: Copy AAC from input (already 128k) - no re-encoding needed
      // NO TEXT OVERLAY - Clean video with zoom effect only
      const videoCommand = `"${FFMPEG_PATH}" -y -loop 1 -i "${imagePath}" -i "${finalFile}" \
-c:v libx264 -preset slow -crf 18 -tune stillimage \
-b:v 5000k -maxrate 8000k -bufsize 10000k \
-c:a copy -pix_fmt yuv420p -movflags +faststart -shortest \
-vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" "${videoFile}"`;

      await runCommand(videoCommand, 600000); // 10 minutes timeout for video creation
      console.log(`[Video] Video created successfully at 1920x1080 resolution (no text overlay)`);

      // Log final video size
      const videoStats = await fs.stat(videoFile);
      const videoSizeMB = (videoStats.size / (1024 * 1024)).toFixed(2);
      console.log(`[Video] Final video size: ${videoSizeMB} MB`);
    } catch (error) {
      console.error(`[Video Error] Failed to create video with zoom effect: ${error.message}`);

      // Fallback: Create simple video without zoom effect
      try {
        console.log(`[Video] Fallback: Creating simple video without zoom effect...`);

        const simpleCommand = `"${FFMPEG_PATH}" -y -loop 1 -i "${imagePath}" -i "${finalFile}" -c:v libx264 -preset medium -crf 23 -tune stillimage -c:a copy -pix_fmt yuv420p -movflags +faststart -shortest -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" "${videoFile}"`;

        await runCommand(simpleCommand, 600000);
        console.log(`[Video] Video created successfully (simple method, no zoom)`);

        const videoStats = await fs.stat(videoFile);
        const videoSizeMB = (videoStats.size / (1024 * 1024)).toFixed(2);
        console.log(`[Video] Final video size: ${videoSizeMB} MB`);
      } catch (finalError) {
        console.error(`[Video Error] All approaches failed: ${finalError.message}`);
        throw new Error(`Failed to create video after all fallback attempts: ${error.message}`);
      }
    }

    // Step 7: Create thumbnail with text overlay
    const thumbnailFile = path.join(jobDir, "thumbnail.jpg");

    // Helper function to escape text for FFmpeg drawtext filter
    const escapeDrawtext = (text) => text
      .replace(/\\/g, '\\\\\\\\')  // Escape backslashes
      .replace(/:/g, '\\:')         // Escape colons
      .replace(/'/g, "'\\\\\\''")   // Escape single quotes
      .replace(/\[/g, '\\[')        // Escape square brackets
      .replace(/\]/g, '\\]')        // Escape square brackets
      .replace(/,/g, '\\,')         // Escape commas
      .replace(/;/g, '\\;');        // Escape semicolons

    try {
      console.log(`[Thumbnail] Creating thumbnail with text overlay...`);

      // Escape text for FFmpeg drawtext filter
      const escapedVibe = escapeDrawtext(sanitizedVibe);
      const escapedSubtitle = escapeDrawtext(sanitizedSubtitle);

      // Use system font
      const fontFile = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

      // Build drawtext filter for thumbnail (same text as video)
      const thumbnailTextFilter = `drawtext=fontfile='${fontFile}':text='${escapedVibe}':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-80:borderw=3:bordercolor=black,drawtext=fontfile='${fontFile}':text='${escapedSubtitle}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+40:borderw=2:bordercolor=black`;

      // Create thumbnail (1920x1080) with text overlay
      const thumbnailCommand = `"${FFMPEG_PATH}" -y -i "${imagePath}" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,${thumbnailTextFilter}" -frames:v 1 -q:v 2 "${thumbnailFile}"`;

      await runCommand(thumbnailCommand, 60000); // 1 minute timeout

      // Check thumbnail size
      const thumbnailStats = await fs.stat(thumbnailFile);
      const thumbnailSizeKB = (thumbnailStats.size / 1024).toFixed(2);
      console.log(`[Thumbnail] Thumbnail created successfully - Size: ${thumbnailSizeKB} KB`);

    } catch (thumbnailError) {
      console.error(`[Thumbnail Error] Failed with font: ${thumbnailError.message}`);

      // Fallback: Try without font file specification
      try {
        console.log(`[Thumbnail] Retrying without font specification...`);

        const escapedVibe = escapeDrawtext(sanitizedVibe);
        const escapedSubtitle = escapeDrawtext(sanitizedSubtitle);

        const thumbnailTextFilter = `drawtext=text='${escapedVibe}':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-80:borderw=3:bordercolor=black,drawtext=text='${escapedSubtitle}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+40:borderw=2:bordercolor=black`;

        const thumbnailCommand = `"${FFMPEG_PATH}" -y -i "${imagePath}" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,${thumbnailTextFilter}" -frames:v 1 -q:v 2 "${thumbnailFile}"`;

        await runCommand(thumbnailCommand, 60000);
        console.log(`[Thumbnail] Thumbnail created with default font`);

      } catch (fallbackError) {
        console.error(`[Thumbnail Error] Fallback failed: ${fallbackError.message}`);

        // Final fallback: Create thumbnail without text
        try {
          console.log(`[Thumbnail] Creating thumbnail without text overlay...`);
          const simpleThumbnailCommand = `"${FFMPEG_PATH}" -y -i "${imagePath}" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" -frames:v 1 -q:v 2 "${thumbnailFile}"`;

          await runCommand(simpleThumbnailCommand, 60000);
          console.log(`[Thumbnail] Thumbnail created without text overlay`);
        } catch (finalThumbnailError) {
          console.error(`[Thumbnail Error] All attempts failed: ${finalThumbnailError.message}`);
          throw new Error(`Failed to create thumbnail: ${thumbnailError.message}`);
        }
      }
    }

    // Step 8: Return video and thumbnail to client - S3 upload (recommended) or direct download
    try {
      // Check if video file exists and has content
      const stats = await fs.stat(videoFile);
      if (stats.size === 0) {
        throw new Error("Generated video file is empty");
      }

      const videoSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`[Response] Video file ready - Size: ${videoSizeMB} MB`);

      // Check if S3 is configured
      if (isS3Configured()) {
        // OPTION 1: Upload to S3 and return URLs (RECOMMENDED for production)
        console.log(`[S3] Uploading video and thumbnail to S3...`);

        const timestamp = Date.now();
        const videoFileName = `videos/${jobId}/final_video_${timestamp}.mp4`;
        const thumbnailFileName = `videos/${jobId}/thumbnail_${timestamp}.jpg`;

        // Upload video
        const videoUrl = await uploadToS3(videoFile, videoFileName);
        console.log(`[S3] Video uploaded: ${videoUrl}`);

        // Upload thumbnail
        const thumbnailUrl = await uploadToS3(thumbnailFile, thumbnailFileName, 'image/jpeg');
        console.log(`[S3] Thumbnail uploaded: ${thumbnailUrl}`);

        // Get thumbnail size
        const thumbnailStats = await fs.stat(thumbnailFile);
        const thumbnailSizeKB = (thumbnailStats.size / 1024).toFixed(2);

        // Return JSON with both URLs
        res.json({
          success: true,
          message: "Video and thumbnail created successfully",
          videoUrl: videoUrl,
          thumbnailUrl: thumbnailUrl,
          videoSize: videoSizeMB + " MB",
          thumbnailSize: thumbnailSizeKB + " KB",
          jobId: jobId,
          timestamp: new Date().toISOString()
        });

        // NO CLEANUP - Will be cleaned on next API call

      } else {
        // OPTION 2: Return download URLs (S3 not configured)
        console.log(`[Response] S3 not configured - creating download URLs`);
        console.log(`[Warning] Configure S3 for production use`);

        // Get thumbnail size
        const thumbnailStats = await fs.stat(thumbnailFile);
        const thumbnailSizeKB = (thumbnailStats.size / 1024).toFixed(2);

        // Get server URL from environment or request
        const protocol = req.protocol || 'http';
        const host = req.get('host') || 'localhost:5000';
        const baseUrl = `${protocol}://${host}`;

        // Return JSON with download URLs
        res.json({
          success: true,
          message: "Video and thumbnail created successfully",
          videoUrl: `${baseUrl}/api/ffmpeg/download/video/${jobId}`,
          thumbnailUrl: `${baseUrl}/api/ffmpeg/download/thumbnail/${jobId}`,
          videoSize: videoSizeMB + " MB",
          thumbnailSize: thumbnailSizeKB + " KB",
          jobId: jobId,
          timestamp: new Date().toISOString(),
          note: "For production use, configure S3 upload in .env file"
        });

        console.log(`[Success] Video and thumbnail created - download URLs generated`);

        // NO CLEANUP - Will be cleaned on next API call
      }

      // Log final storage usage
      const finalSize = await getTempDirSize();
      const finalSizeInMB = (finalSize / (1024 * 1024)).toFixed(2);
      console.log(`[STORAGE] Final temp directory size: ${finalSizeInMB} MB`);

    } catch (error) {
      console.error(`[Response Error] Failed to return video: ${error.message}`);
      throw new Error(`Failed to return video: ${error.message}`);
    }

  } catch (err) {
    console.error(`[ERROR] Video creation failed for job ${jobId}:`, err.message);

    // NO CLEANUP - Will be cleaned on next API call

    // Send appropriate error response
    if (res.headersSent) {
      console.error(`[ERROR] Response already sent, cannot send error response`);
      return;
    }

    const errorResponse = {
      error: "Video creation failed",
      details: err.message,
      jobId: jobId || "unknown"
    };

    res.status(500).json(errorResponse);
  }
};

// NO PERIODIC CLEANUP - Only cleanup on API call received

// Storage monitoring endpoint
const getStorageInfo = async (req, res) => {
  try {
    const tempSize = await getTempDirSize();
    const tempSizeInMB = (tempSize / (1024 * 1024)).toFixed(2);

    // Count active temp directories
    let activeDirs = 0;
    if (await fs.pathExists(TEMP_DIR)) {
      const dirs = await fs.readdir(TEMP_DIR);
      activeDirs = dirs.length;
    }

    res.json({
      tempDirectorySize: `${tempSizeInMB} MB`,
      tempDirectorySizeBytes: tempSize,
      activeTempDirectories: activeDirs,
      tempDirectoryPath: TEMP_DIR,
      lastChecked: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[STORAGE INFO ERROR] ${error.message}`);
    res.status(500).json({ error: "Failed to get storage info", details: error.message });
  }
};

// Download video file
const downloadVideo = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({ error: "Job ID is required" });
    }

    const jobDir = path.join(TEMP_DIR, jobId);
    const videoFile = path.join(jobDir, "final_video.mp4");

    // Check if file exists
    if (!(await fs.pathExists(videoFile))) {
      return res.status(404).json({
        error: "Video not found",
        message: "Video may have been cleaned up. Please create a new video."
      });
    }

    // Get file stats
    const stats = await fs.stat(videoFile);

    // Set headers for video streaming
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="video_${jobId}.mp4"`);
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");

    // Stream file
    const fileStream = fs.createReadStream(videoFile, {
      highWaterMark: 64 * 1024 // 64KB chunks
    });

    fileStream.on("error", (error) => {
      console.error(`[Download Error] Video stream error: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream video" });
      }
    });

    fileStream.pipe(res);
    console.log(`[Download] Streaming video for job: ${jobId}`);

  } catch (error) {
    console.error(`[Download Error] ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to download video", details: error.message });
    }
  }
};

// Download thumbnail file
const downloadThumbnail = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({ error: "Job ID is required" });
    }

    const jobDir = path.join(TEMP_DIR, jobId);
    const thumbnailFile = path.join(jobDir, "thumbnail.jpg");

    // Check if file exists
    if (!(await fs.pathExists(thumbnailFile))) {
      return res.status(404).json({
        error: "Thumbnail not found",
        message: "Thumbnail may have been cleaned up. Please create a new video."
      });
    }

    // Get file stats
    const stats = await fs.stat(thumbnailFile);

    // Set headers for image
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", `inline; filename="thumbnail_${jobId}.jpg"`);
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Cache-Control", "public, max-age=3600");

    // Stream file
    const fileStream = fs.createReadStream(thumbnailFile);

    fileStream.on("error", (error) => {
      console.error(`[Download Error] Thumbnail stream error: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream thumbnail" });
      }
    });

    fileStream.pipe(res);
    console.log(`[Download] Streaming thumbnail for job: ${jobId}`);

  } catch (error) {
    console.error(`[Download Error] ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to download thumbnail", details: error.message });
    }
  }
};

module.exports = { Convert, getStorageInfo, downloadVideo, downloadThumbnail };

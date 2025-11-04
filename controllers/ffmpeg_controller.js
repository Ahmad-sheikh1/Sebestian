const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { exec } = require("child_process");
const { promisify } = require("util");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const { uploadToS3, isS3Configured } = require("../helpers/s3Upload");

const execAsync = promisify(exec);
const TEMP_DIR = path.join(process.cwd(), "temp");

// ---------- FFmpeg PATH (Windows + Ubuntu) ----------
function getFfmpegPath() {
  // Prefer system ffmpeg on Linux if present
  const linuxPath = "/usr/bin/ffmpeg";
  try {
    if (process.platform !== "win32" && fs.existsSync(linuxPath)) {
      return linuxPath;
    }
  } catch (_) { }
  // Fallback to packaged installer (works on Windows/Mac too)
  return ffmpegInstaller.path;
}
const FFMPEG_PATH = getFfmpegPath();

// ---------- Startup temp ensure ----------
(async () => {
  try {
    await fs.ensureDir(TEMP_DIR);
    console.log(`[STARTUP] Temp directory initialized: ${TEMP_DIR}`);
    console.log(`[STARTUP] Cleanup will happen on first API request`);
  } catch (err) {
    console.error(`[STARTUP ERROR] Failed to initialize temp directory: ${err.message}`);
  }
})();

// ---------- Shell helpers ----------
const runCommand = (cmd, timeoutMs = 10 * 60 * 1000) => { // default 10 min
  return new Promise((resolve, reject) => {
    console.log(`[FFmpeg] Executing: ${cmd}`);
    const child = exec(cmd, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 64, // 64MB buffer for long stderr
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[FFmpeg Error] ${error.message}`);
        if (stderr) console.error(`[FFmpeg Error] Stderr:\n${stderr}`);
        return reject(new Error(stderr || error.message));
      }
      console.log(`[FFmpeg] Command completed successfully`);
      resolve(stdout || stderr || "");
    });

    child.on("error", (e) => {
      console.error(`[FFmpeg Error] Process error: ${e.message}`);
      reject(e);
    });
  });
};

// ---------- Utilities ----------
const isHttpUrl = (u) => typeof u === "string" && /^https?:\/\/.+/i.test(u);

// Hardened download (size + content-type checks)
const downloadFile = async (url, filePath, {
  maxSizeBytes = 100 * 1024 * 1024, // 100MB
  timeoutMs = 60 * 1000,
  acceptedContentTypes = [], // leave empty to accept all
} = {}) => {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: timeoutMs,
      maxContentLength: maxSizeBytes,
      validateStatus: (s) => s >= 200 && s < 400,
    });

    if (response.data?.length > maxSizeBytes) {
      throw new Error(`File too large: ${(response.data.length / 1024 / 1024).toFixed(2)} MB`);
    }

    const ct = (response.headers["content-type"] || "").toLowerCase();
    if (acceptedContentTypes.length && !acceptedContentTypes.some(t => ct.includes(t))) {
      throw new Error(`Unexpected content-type: ${ct}`);
    }

    await fs.writeFile(filePath, response.data);
    const stats = await fs.stat(filePath);
    if (stats.size < 2048) { // <2KB — consider corrupt/empty
      throw new Error(`Downloaded file too small (${stats.size} bytes)`);
    }
    return filePath;
  } catch (err) {
    console.error(`[Download Error] URL: ${url}`);
    console.error(`[Download Error] ${err.message}`);
    throw new Error(`Failed to download file: ${err.message}`);
  }
};

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

const cleanupAllTempFiles = async () => {
  try {
    if (!(await fs.pathExists(TEMP_DIR))) {
      await fs.ensureDir(TEMP_DIR);
      return;
    }
    const dirs = await fs.readdir(TEMP_DIR);
    let cleaned = 0, freed = 0;
    for (const d of dirs) {
      const dirPath = path.join(TEMP_DIR, d);
      try {
        const files = await fs.readdir(dirPath);
        for (const f of files) {
          const fp = path.join(dirPath, f);
          const st = await fs.stat(fp);
          freed += st.size;
        }
        await fs.remove(dirPath);
        cleaned++;
        console.log(`[REQUEST CLEANUP] Removed temp directory: ${d}`);
      } catch (e) {
        console.error(`[REQUEST CLEANUP ERROR] ${d}: ${e.message}`);
      }
    }
    if (cleaned) {
      console.log(`[REQUEST CLEANUP] Cleaned ${cleaned} dirs, freed ${(freed / 1024 / 1024).toFixed(2)} MB`);
    } else {
      console.log(`[REQUEST CLEANUP] Temp directory is already empty`);
    }
  } catch (error) {
    console.error(`[REQUEST CLEANUP ERROR] Failed to clean temp directory: ${error.message}`);
  }
};

const getTempDirSize = async () => {
  try {
    if (!(await fs.pathExists(TEMP_DIR))) return 0;
    const dirs = await fs.readdir(TEMP_DIR);
    let total = 0;
    for (const d of dirs) {
      const dirPath = path.join(TEMP_DIR, d);
      try {
        const stats = await fs.stat(dirPath);
        if (stats.isDirectory()) {
          const files = await fs.readdir(dirPath);
          for (const f of files) {
            const fp = path.join(dirPath, f);
            const st = await fs.stat(fp);
            total += st.size;
          }
        }
      } catch (_) { }
    }
    return total;
  } catch (e) {
    console.error(`[SIZE CHECK ERROR] ${e.message}`);
    return 0;
  }
};

// ---------- NEW: sanitize a single MP3 → clean WAV ----------
// This guarantees FFmpeg never sees bad MP3 frames on concat.
async function sanitizeMp3ToWav(mp3Path, wavPath) {
  // Skip if MP3 missing or tiny
  const st = await fs.stat(mp3Path);
  if (st.size < 2048) {
    throw new Error(`Input too small: ${mp3Path}`);
  }

  // Decode with error-ignore to rebuild good PCM
  // (Repairs header issues & skips bad frames)
  const cmd = `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -err_detect ignore_err -i "${mp3Path}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${wavPath}"`;
  await runCommand(cmd, 5 * 60 * 1000);
  const out = await fs.stat(wavPath);
  if (out.size < 4096) throw new Error(`Sanitized WAV too small: ${wavPath}`);
  return wavPath;
}

// ---------- Controller ----------
const Convert = async (req, res) => {
  let jobId = null;
  let jobDir = null;

  try {
    console.log(`[REQUEST] New video creation request received`);
    await cleanupAllTempFiles();

    const currentSize = await getTempDirSize();
    console.log(`[STORAGE] Temp directory size after cleanup: ${(currentSize / 1024 / 1024).toFixed(2)} MB`);

    const { files, imageUrl, vibe, subtitle } = req.body;

    // Input validation (unchanged behavior)
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "Please provide an array of audio file URLs in 'files'." });
    }
    if (files.length > 20) {
      return res.status(400).json({ error: "Maximum 20 audio files allowed." });
    }
    for (const f of files) {
      if (!isHttpUrl(f)) {
        return res.status(400).json({ error: "All files must be valid HTTP/HTTPS URLs." });
      }
    }
    if (!isHttpUrl(imageUrl)) {
      return res.status(400).json({ error: "Please provide a valid image URL in 'imageUrl'." });
    }
    const urlNoQs = imageUrl.split("?")[0];
    if (!/\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(urlNoQs)) {
      return res.status(400).json({ error: "Unsupported image format. Supported: JPG, JPEG, PNG, GIF, BMP, WEBP" });
    }
    if (!vibe || !subtitle || !vibe.trim() || !subtitle.trim()) {
      return res.status(400).json({ error: "Please provide non-empty 'vibe' and 'subtitle'." });
    }

    const sanitizedVibe = vibe.trim().replace(/['"\\]/g, "");
    const sanitizedSubtitle = subtitle.trim().replace(/['"\\]/g, "");
    if (sanitizedVibe.length > 100 || sanitizedSubtitle.length > 100) {
      return res.status(400).json({ error: "Vibe and subtitle must be 100 characters or less." });
    }

    jobId = uuidv4();
    jobDir = path.join(TEMP_DIR, jobId);
    await fs.ensureDir(jobDir);
    console.log(`[Sebestian] Starting video creation job: ${jobId}}`);

    // ---------- Download audio files (MP3) ----------
    const downloadedMp3s = [];
    for (let i = 0; i < files.length; i++) {
      const url = files[i];
      const p = path.join(jobDir, `audio_${i}.mp3`);
      await downloadFile(url, p, {
        acceptedContentTypes: ["audio/", "octet-stream", "mpeg"],
      });
      const stat = await fs.stat(p);
      if (stat.size < 2048) {
        throw new Error(`Audio file ${i + 1} is too small (possibly corrupt)`);
      }
      console.log(`[Download] Audio file ${i + 1}/${files.length} downloaded successfully`);
      downloadedMp3s.push(p);
    }

    // ---------- Download image ----------
    const ext = (urlNoQs.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i)?.[1] || "jpg").toLowerCase();
    const imagePath = path.join(jobDir, `background.${ext}`);
    await downloadFile(imageUrl, imagePath, {
      acceptedContentTypes: ["image/"],
      timeoutMs: 90 * 1000,
      maxSizeBytes: 25 * 1024 * 1024, // 25MB
    });
    console.log(`[Download] Image downloaded successfully as ${ext.toUpperCase()}`);

    // ---------- NEW: sanitize each MP3 → WAV (so FFmpeg never sees corrupt frames) ----------
    const sanitizedWavs = [];
    for (let i = 0; i < downloadedMp3s.length; i++) {
      const inp = downloadedMp3s[i];
      const out = path.join(jobDir, `audio_${i}.wav`);
      try {
        await sanitizeMp3ToWav(inp, out);
        console.log(`[Sanitize] ${path.basename(inp)} → ${path.basename(out)} OK`);
        sanitizedWavs.push(out);
      } catch (e) {
        console.error(`[Sanitize Error] ${path.basename(inp)}: ${e.message}`);
        throw new Error(`Audio file ${i + 1} is invalid/corrupt and could not be repaired`);
      }
    }

    // ---------- Build concat list using WAVs + WAV silence ----------
    const listFile = path.join(jobDir, "list.txt");
    const silenceWav = path.join(jobDir, "silence.wav");
    // Create 1s silence WAV (matches sample rate/channels)
    await runCommand(
      `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -f lavfi -i anullsrc=r=44100:cl=stereo -t 1 -acodec pcm_s16le "${silenceWav}"`,
      60 * 1000
    );

    const lines = [];
    sanitizedWavs.forEach((wav, i) => {
      lines.push(`file '${wav.replace(/'/g, "'\\''")}'`);
      if (i < sanitizedWavs.length - 1) {
        lines.push(`file '${silenceWav.replace(/'/g, "'\\''")}'`);
      }
    });
    await fs.writeFile(listFile, lines.join("\n"));
    console.log(`[Concat List] Created list with ${sanitizedWavs.length} audio files`);

    // ---------- Merge WAVs to single WAV (lossless), then normalize to AAC ----------
    const mergedWav = path.join(jobDir, "merged.wav");
    try {
      // Re-encode merge so containers match 100% (safer than -c copy on mixed inputs)
      await runCommand(
        `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -f concat -safe 0 -i "${listFile}" -acodec pcm_s16le -ar 44100 -ac 2 "${mergedWav}"`,
        5 * 60 * 1000
      );
      console.log(`[Merge] Created merged.wav`);
    } catch (err) {
      console.error(`[Merge Error] ${err.message}`);
      throw new Error(`Failed to merge audio files`);
    }

    const finalAudio = path.join(jobDir, "final_audio.m4a");
    try {
      // Primary normalization: EBU R128 loudnorm
      await runCommand(
        `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -i "${mergedWav}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 128k -ar 44100 "${finalAudio}"`,
        10 * 60 * 1000
      );
      const st = await fs.stat(finalAudio);
      console.log(`[Merge + Normalize] Audio merged & normalized (${(st.size / 1024 / 1024).toFixed(2)} MB)`);
    } catch (e1) {
      console.warn(`[Normalize Warning] loudnorm failed (${e1.message}), trying dynaudnorm...`);
      try {
        await runCommand(
          `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -i "${mergedWav}" -filter:a "dynaudnorm=f=150:g=15" -c:a aac -b:a 128k -ar 44100 "${finalAudio}"`,
          6 * 60 * 1000
        );
        const st = await fs.stat(finalAudio);
        console.log(`[Normalize Fallback] dynaudnorm OK (${(st.size / 1024 / 1024).toFixed(2)} MB)`);
      } catch (e2) {
        console.warn(`[Normalize Warning] dynaudnorm failed (${e2.message}), final fallback volume=1.3`);
        await runCommand(
          `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -i "${mergedWav}" -filter:a "volume=1.3" -c:a aac -b:a 128k -ar 44100 "${finalAudio}"`,
          4 * 60 * 1000
        );
        const st = await fs.stat(finalAudio);
        console.log(`[Normalize Fallback] simple volume OK (${(st.size / 1024 / 1024).toFixed(2)} MB)`);
      }
    }

    // ---------- Create video (primary + fallback) ----------
    const videoFile = path.join(jobDir, "final_video.mp4");
    try {
      console.log(`[Video] Starting video creation...`);
      const primaryCmd = `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -loop 1 -i "${imagePath.replace(/\\/g, '/')}" -i "${finalAudio.replace(/\\/g, '/')}" \
-c:v libx264 -preset slow -crf 18 -tune stillimage \
-b:v 5000k -maxrate 8000k -bufsize 10000k \
-c:a aac -b:a 128k -pix_fmt yuv420p -movflags +faststart -shortest \
-vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" "${videoFile.replace(/\\/g, '/')}"`;


      await runCommand(primaryCmd, 10 * 60 * 1000);
      const vs = await fs.stat(videoFile);
      console.log(`[Video] Video created (slow preset) ${(vs.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (err) {
      console.error(`[Video Error] Primary failed: ${err.message}`);
      console.log(`[Video] Fallback: medium preset, CRF 23`);
      const fallbackCmd = `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -loop 1 -i "${imagePath}" -i "${finalAudio}" ` +
        `-c:v libx264 -preset medium -crf 23 -tune stillimage ` +
        `-c:a copy -pix_fmt yuv420p -movflags +faststart -shortest ` +
        `-vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" "${videoFile}"`;

      await runCommand(fallbackCmd, 10 * 60 * 1000);
      const vs = await fs.stat(videoFile);
      console.log(`[Video] Video created (fallback) ${(vs.size / 1024 / 1024).toFixed(2)} MB`);
    }

    // ---------- Thumbnail (platform-safe font) ----------
    const thumbnailFile = path.join(jobDir, "thumbnail.jpg");
    const escapeDrawtext = (text) =>
      text.replace(/\\/g, "\\\\\\\\").replace(/:/g, "\\:").replace(/'/g, "'\\\\\\''")
        .replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/,/g, "\\,").replace(/;/g, "\\;");

    const escapedVibe = escapeDrawtext(sanitizedVibe);
    const escapedSubtitle = escapeDrawtext(sanitizedSubtitle);

    // Try platform-specific bold font
    const winFont = "C:/Windows/Fonts/arialbd.ttf";
    const linuxFont = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
    let fontFile = process.platform === "win32" && fs.existsSync(winFont) ? winFont : linuxFont;

    const textFilter =
      `drawtext=fontfile='${fontFile}':text='${escapedVibe}':fontsize=92:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-80:borderw=3:bordercolor=black,` +
      `drawtext=fontfile='${fontFile}':text='${escapedSubtitle}':fontsize=68:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+40:borderw=2:bordercolor=black`;

    try {
      const thumbCmd = `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -i "${imagePath}" ` +
        `-vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,${textFilter}" ` +
        `-frames:v 1 -q:v 2 "${thumbnailFile}"`;
      await runCommand(thumbCmd, 60 * 1000);
      const ts = await fs.stat(thumbnailFile);
      console.log(`[Thumbnail] Created with text (${(ts.size / 1024).toFixed(2)} KB)`);
    } catch (e1) {
      console.warn(`[Thumbnail Warning] Font path failed (${e1.message}), trying default font...`);
      const tf2 =
        `drawtext=text='${escapedVibe}':fontsize=92:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-80:borderw=3:bordercolor=black,` +
        `drawtext=text='${escapedSubtitle}':fontsize=68:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+40:borderw=2:bordercolor=black`;
      try {
        const cmd2 = `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -i "${imagePath}" ` +
          `-vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,${tf2}" -frames:v 1 -q:v 2 "${thumbnailFile}"`;
        await runCommand(cmd2, 60 * 1000);
        console.log(`[Thumbnail] Created with default font`);
      } catch (e2) {
        console.warn(`[Thumbnail Warning] Default font failed (${e2.message}), creating without text...`);
        const cmd3 = `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -i "${imagePath}" ` +
          `-vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" -frames:v 1 -q:v 2 "${thumbnailFile}"`;
        await runCommand(cmd3, 60 * 1000);
        console.log(`[Thumbnail] Created without text overlay`);
      }
    }

    // ---------- Response (S3 or local) ----------
    const vStats = await fs.stat(videoFile);
    if (vStats.size === 0) throw new Error("Generated video file is empty");
    const videoSizeMB = (vStats.size / 1024 / 1024).toFixed(2);
    console.log(`[Response] Video file ready - Size: ${videoSizeMB} MB`);

    if (isS3Configured()) {
      console.log(`[S3] Uploading video and thumbnail to S3...`);
      const ts = Date.now();
      const videoKey = `videos/${jobId}/final_video_${ts}.mp4`;
      const thumbKey = `videos/${jobId}/thumbnail_${ts}.jpg`;
      const videoUrl = await uploadToS3(videoFile, videoKey);
      const thumbUrl = await uploadToS3(thumbnailFile, thumbKey, "image/jpeg");
      const tStats = await fs.stat(thumbnailFile);

      res.json({
        success: true,
        message: "Video and thumbnail created successfully",
        videoUrl,
        thumbnailUrl: thumbUrl,
        videoSize: `${videoSizeMB} MB`,
        thumbnailSize: `${(tStats.size / 1024).toFixed(2)} KB`,
        jobId,
        timestamp: new Date().toISOString(),
      });
    } else {
      const protocol = req.protocol || "http";
      const host = req.get("host") || "localhost:5000";
      const baseUrl = `${protocol}://${host}`;
      const tStats = await fs.stat(thumbnailFile);

      res.json({
        success: true,
        message: "Video and thumbnail created successfully",
        videoUrl: `${baseUrl}/api/ffmpeg/download/video/${jobId}`,
        thumbnailUrl: `${baseUrl}/api/ffmpeg/download/thumbnail/${jobId}`,
        videoSize: `${videoSizeMB} MB`,
        thumbnailSize: `${(tStats.size / 1024).toFixed(2)} KB`,
        jobId,
        timestamp: new Date().toISOString(),
        note: "For production use, configure S3 upload in .env file",
      });
      console.log(`[Success] Video and thumbnail created - download URLs generated`);
    }

    const finalSize = await getTempDirSize();
    console.log(`[STORAGE] Final temp directory size: ${(finalSize / 1024 / 1024).toFixed(2)} MB`);

    // NOTE: No immediate cleanup by design (you clean on next request)

  } catch (err) {
    console.error(`[ERROR] Video creation failed for job ${jobId}: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Video creation failed",
        details: err.message,
        jobId: jobId || "unknown",
      });
    }
    // No cleanup here; your policy is to clean on next call
  }
};

// ---------- Storage info ----------
const getStorageInfo = async (req, res) => {
  try {
    const tempSize = await getTempDirSize();
    const dirs = (await fs.pathExists(TEMP_DIR)) ? await fs.readdir(TEMP_DIR) : [];
    res.json({
      tempDirectorySize: `${(tempSize / 1024 / 1024).toFixed(2)} MB`,
      tempDirectorySizeBytes: tempSize,
      activeTempDirectories: dirs.length,
      tempDirectoryPath: TEMP_DIR,
      lastChecked: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`[STORAGE INFO ERROR] ${e.message}`);
    res.status(500).json({ error: "Failed to get storage info", details: e.message });
  }
};

// ---------- Downloads ----------
const downloadVideo = async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!jobId) return res.status(400).json({ error: "Job ID is required" });
    const jobDir = path.join(TEMP_DIR, jobId);
    const videoFile = path.join(jobDir, "final_video.mp4");
    if (!(await fs.pathExists(videoFile))) {
      return res.status(404).json({ error: "Video not found", message: "Video may have been cleaned up. Please create a new video." });
    }
    const stats = await fs.stat(videoFile);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="video_${jobId}.mp4"`);
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");

    const stream = fs.createReadStream(videoFile, { highWaterMark: 64 * 1024 });
    stream.on("error", (e) => {
      console.error(`[Download Error] Video: ${e.message}`);
      if (!res.headersSent) res.status(500).json({ error: "Failed to stream video" });
    });
    stream.pipe(res);
    console.log(`[Download] Streaming video for job: ${jobId}`);
  } catch (e) {
    console.error(`[Download Error] ${e.message}`);
    if (!res.headersSent) res.status(500).json({ error: "Failed to download video", details: e.message });
  }
};

const downloadThumbnail = async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!jobId) return res.status(400).json({ error: "Job ID is required" });
    const jobDir = path.join(TEMP_DIR, jobId);
    const thumbnail = path.join(jobDir, "thumbnail.jpg");
    if (!(await fs.pathExists(thumbnail))) {
      return res.status(404).json({ error: "Thumbnail not found", message: "Thumbnail may have been cleaned up. Please create a new video." });
    }
    const stats = await fs.stat(thumbnail);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", `inline; filename="thumbnail_${jobId}.jpg"`);
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Cache-Control", "public, max-age=3600");

    const stream = fs.createReadStream(thumbnail);
    stream.on("error", (e) => {
      console.error(`[Download Error] Thumbnail: ${e.message}`);
      if (!res.headersSent) res.status(500).json({ error: "Failed to stream thumbnail" });
    });
    stream.pipe(res);
    console.log(`[Download] Streaming thumbnail for job: ${jobId}`);
  } catch (e) {
    console.error(`[Download Error] ${e.message}`);
    if (!res.headersSent) res.status(500).json({ error: "Failed to download thumbnail", details: e.message });
  }
};

module.exports = { Convert, getStorageInfo, downloadVideo, downloadThumbnail };

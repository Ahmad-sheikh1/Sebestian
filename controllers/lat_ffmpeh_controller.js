const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { exec } = require("child_process");
const { promisify } = require("util");
const { spawn } = require("child_process");

const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const { uploadToS3, isS3Configured } = require("../helpers/s3Upload");

const execAsync = promisify(exec);
const TEMP_DIR = path.join(process.cwd(), "temp");

// ---------- FFmpeg PATH ----------
function getFfmpegPath() {
    const linuxPath = "/usr/bin/ffmpeg";
    return fs.existsSync(linuxPath) ? linuxPath : ffmpegInstaller.path;
    // return ffmpegInstaller.path
}
const FFMPEG_PATH = getFfmpegPath();

// ---------- Shell helper ----------
const runCommand = async (cmd, label = "") => {
    console.log(`\n[FFmpeg Start] ${label}`);
    console.log(`[FFmpeg CMD] ${cmd}`);
    const { stdout, stderr } = await execAsync(cmd, {
        timeout: 10 * 60 * 1000,
        maxBuffer: 1024 * 1024 * 64,
    });
    if (stdout) console.log(stdout);
    if (stderr) console.log(stderr);
    console.log(`[FFmpeg Done] ${label}\n`);
};

// ---------- Download helper ----------
const isHttpUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
const downloadFile = async (url, filePath) => {
    const res = await axios.get(url, { responseType: "arraybuffer" });
    await fs.writeFile(filePath, res.data);
    return filePath;
};

// ---------- Sanitize ----------
async function sanitizeMp3ToWav(mp3Path, wavPath) {
    const cmd = `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -err_detect ignore_err -i "${mp3Path}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${wavPath}"`;
    await runCommand(cmd, `Sanitize MP3 → WAV (${path.basename(mp3Path)})`);
    return wavPath;
}

// ---------- Core controller ----------
const ProcessAudio = async (req, res) => {


    // 🧹 Cleanup old temp files before starting new job
    try {
        if (await fs.pathExists(TEMP_DIR)) {
            const dirs = await fs.readdir(TEMP_DIR);
            for (const d of dirs) {
                const dirPath = path.join(TEMP_DIR, d);
                await fs.remove(dirPath);
                console.log(`[CLEANUP] Removed old temp directory: ${dirPath}`);
            }
        }
        console.log(`[CLEANUP] Temp folder emptied successfully before new job`);
    } catch (cleanupErr) {
        console.error(`[CLEANUP ERROR] Failed to clean temp folder: ${cleanupErr.message}`);
    }


    let jobId = uuidv4();
    let jobDir = path.join(TEMP_DIR, jobId);
    await fs.ensureDir(jobDir);

    try {
        const { files } = req.body;
        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: "Please provide an array of audio URLs" });
        }

        console.log(`🎧 [AudioJob] Starting audio processing job: ${jobId}`);
        console.log(`[AudioJob] Total files: ${files.length}\n`);

        // Step 1: Download all MP3s
        const mp3Paths = [];
        for (let i = 0; i < files.length; i++) {
            const url = files[i];
            if (!isHttpUrl(url)) throw new Error(`Invalid URL: ${url}`);
            const p = path.join(jobDir, `audio_${i}.mp3`);
            console.log(`[Download] Fetching ${url}`);
            await downloadFile(url, p);
            mp3Paths.push(p);
        }

        // Step 2: Sanitize to WAV
        const wavPaths = [];
        for (let i = 0; i < mp3Paths.length; i++) {
            const inp = mp3Paths[i];
            const out = path.join(jobDir, `audio_${i}.wav`);
            await sanitizeMp3ToWav(inp, out);
            wavPaths.push(out);
        }

        // Step 3: Generate silence + concat list
        const listFile = path.join(jobDir, "list.txt");
        const silence = path.join(jobDir, "silence.wav");
        await runCommand(
            `"${FFMPEG_PATH}" -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 1 -acodec pcm_s16le "${silence}"`,
            "Create 1-second silence"
        );

        const lines = [];
        wavPaths.forEach((w, i) => {
            lines.push(`file '${w}'`);
            if (i < wavPaths.length - 1) lines.push(`file '${silence}'`);
        });
        await fs.writeFile(listFile, lines.join("\n"));
        console.log(`[Concat] Created concat list with ${lines.length} entries`);

        // Step 4: Merge + Normalize
        const mergedWav = path.join(jobDir, "merged.wav");
        const finalAudio = path.join(jobDir, "final_audio.m4a");

        await runCommand(
            `"${FFMPEG_PATH}" -y -f concat -safe 0 -i "${listFile}" -acodec pcm_s16le "${mergedWav}"`,
            "Merging WAVs"
        );

        await runCommand(
            `"${FFMPEG_PATH}" -y -i "${mergedWav}" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 128k -ar 44100 "${finalAudio}"`,
            "Normalizing final audio"
        );

        const st = await fs.stat(finalAudio);
        console.log(`[Final Audio] Ready (${(st.size / 1024 / 1024).toFixed(2)} MB)`);

        // Step 5: Upload to S3
        if (isS3Configured()) {
            console.log(`[S3] Uploading final audio to S3...`);
            const key = `audio/${jobId}/final_audio_${Date.now()}.m4a`;
            const audioUrl = await uploadToS3(finalAudio, key, "audio/mp4");

            console.log(`[S3] Upload complete: ${audioUrl}`);

            return res.json({
                success: true,
                message: "Audio processed and uploaded successfully",
                audioUrl,
                fileSize: `${(st.size / 1024 / 1024).toFixed(2)} MB`,
                jobId,
            });
        } else {
            console.log(`[LOCAL] S3 not configured — serving local link`);
            const protocol = req.protocol || "http";
            const host = req.get("host") || "localhost:5000";
            const localUrl = `${protocol}://${host}/api/audio/download/${jobId}`;

            return res.json({
                success: true,
                message: "Audio processed successfully (local mode)",
                audioUrl: localUrl,
                fileSize: `${(st.size / 1024 / 1024).toFixed(2)} MB`,
                jobId,
            });
        }
    } catch (err) {
        console.error(`[AudioJob Error] ${err.message}`);
        res.status(500).json({ error: err.message });
    }
};

// ---------- Escape text for FFmpeg ----------
const escapeText = (text) =>
    text
        .replace(/\\/g, "\\\\\\\\")
        .replace(/:/g, "\\:")
        .replace(/'/g, "'\\\\\\''")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");

// ---------- Thumbnail Controller ----------
const CreateThumbnail = async (req, res) => {
    try {
        // 🧹 Step 1: Clean /temp folder
        if (await fs.pathExists(TEMP_DIR)) {
            await fs.emptyDir(TEMP_DIR);
            console.log(`[CLEANUP] Temp folder emptied before new thumbnail job`);
        } else {
            await fs.ensureDir(TEMP_DIR);
            console.log(`[INIT] Temp folder created`);
        }

        const { imageUrl, vibe, subtitle } = req.body;
        if (!imageUrl || !vibe || !subtitle)
            return res.status(400).json({ error: "imageUrl, vibe, and subtitle are required." });

        console.log(`[Thumbnail Job] Started with image: ${imageUrl}`);

        // Step 2: Download image directly in /temp
        const ext = (imageUrl.split(".").pop() || "jpg").split("?")[0];
        const imagePath = path.join(TEMP_DIR, `background.${ext}`);
        await downloadFile(imageUrl, imagePath);
        console.log(`[Download] Image downloaded to temp folder`);

        // Step 3: Prepare overlay text
        const escapedVibe = escapeText(vibe.trim());
        const escapedSubtitle = escapeText(subtitle.trim());
        const thumbnailFile = path.join(TEMP_DIR, "thumbnail.jpg");

        const winFont = "C:/Windows/Fonts/arialbd.ttf";
        const linuxFont = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
        const fontFile = fs.existsSync(linuxFont) ? linuxFont : winFont;

        const textFilter =
            `drawtext=fontfile='${fontFile}':text='${escapedVibe}':fontsize=92:fontcolor=white:` +
            `x=(w-text_w)/2:y=(h-text_h)/2-80:borderw=3:bordercolor=black,` +
            `drawtext=fontfile='${fontFile}':text='${escapedSubtitle}':fontsize=68:fontcolor=white:` +
            `x=(w-text_w)/2:y=(h-text_h)/2+40:borderw=2:bordercolor=black`;

        // Step 4: Create thumbnail
        await runCommand(
            `"${FFMPEG_PATH}" -y -hide_banner -loglevel error -i "${imagePath}" ` +
            `-vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,${textFilter}" ` +
            `-frames:v 1 -q:v 2 "${thumbnailFile}"`,
            "Creating Thumbnail"
        );

        const st = await fs.stat(thumbnailFile);
        console.log(`[Thumbnail] Created successfully (${(st.size / 1024).toFixed(2)} KB)`);

        // Step 5: Upload to S3 (if configured)
        let thumbnailUrl;
        if (isS3Configured()) {
            console.log(`[S3] Uploading thumbnail...`);
            const key = `thumbnails/thumbnail_${Date.now()}.jpg`;
            thumbnailUrl = await uploadToS3(thumbnailFile, key, "image/jpeg");
            console.log(`[S3] Uploaded successfully: ${thumbnailUrl}`);
        } else {
            const protocol = req.protocol || "http";
            const host = req.get("host") || "localhost:5000";
            thumbnailUrl = `${protocol}://${host}/temp/thumbnail.jpg`;
        }

        return res.json({
            success: true,
            message: "Thumbnail created successfully",
            thumbnailUrl,
            fileSize: `${(st.size / 1024).toFixed(2)} KB`,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error(`[Thumbnail Error] ${err.message}`);
        res.status(500).json({ error: err.message });
    }
};


const CreateVideoFromAudio = async (req, res) => {
    const jobId = uuidv4();

    // Adjust this to your desired absolute/relative dir:
    //   const finalDir = path.join("C:\\Users\\Ahmed\\Downloads", "final_video");
    //   const TEMP_DIR = path.join(process.cwd(), "final_video");
    const finalDir = path.join(__dirname, "final_video");


    // Build file paths
    const videoPath = path.join(finalDir, `final_${jobId}.mp4`);
    const imagePath = path.join(finalDir, `background_${jobId}.jpg`); // will work even if actual format is png
    const audioPath = path.join(finalDir, `audio_${jobId}.m4a`);

    try {
        const { audioUrl, imageUrl } = req.body || {};
        if (!audioUrl || !imageUrl) {
            return res.status(400).json({ error: "Both 'audioUrl' and 'imageUrl' are required." });
        }

        // 1) Clean final_video dir
        await fs.ensureDir(finalDir);
        await fs.emptyDir(finalDir);
        console.log("[CLEANUP] Cleared final_video directory.");

        // 2) Download files INTO final_video (no external helper, inline here)
        const downloadFile = async (url, destPath, label) => {
            console.log(`[DOWNLOAD] ${label} -> ${destPath}`);
            const resp = await axios({ url, method: "GET", responseType: "stream", timeout: 300_000 });
            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(destPath);
                resp.data.pipe(writer);
                writer.on("finish", resolve);
                writer.on("error", reject);
            });
            const st = await fs.stat(destPath);
            if (st.size < 1024) throw new Error(`${label} seems empty (size < 1KB)`);
            console.log(`[DOWNLOAD] ${label} saved (${(st.size / 1024).toFixed(1)} KB)`);
        };

        await Promise.all([
            downloadFile(imageUrl, imagePath, "Image"),
            downloadFile(audioUrl, audioPath, "Audio"),
        ]);

        // 3) Run FFmpeg via spawn (no buffer limits)
        console.log("[FFMPEG] Starting render…");
        const args = [
            "-y",
            "-hide_banner",
            "-v", "error",            // keep logs minimal
            "-stats",                 // show periodic progress
            "-loop", "1",             // loop the still image
            "-i", imagePath,
            "-i", audioPath,
            "-c:v", "libx264",
            "-tune", "stillimage",
            "-pix_fmt", "yuv420p",
            "-vf", 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
            "-shortest",              // stop when audio ends
            videoPath
        ];

        await new Promise((resolve, reject) => {
            const proc = spawn(FFMPEG_PATH, args, { windowsHide: true });

            proc.stdout.on("data", d => process.stdout.write(`[FFMPEG] ${d}`));
            proc.stderr.on("data", d => process.stderr.write(`[FFMPEG] ${d}`));

            proc.on("error", err => reject(err));
            proc.on("close", code => {
                if (code === 0) return resolve();
                reject(new Error(`FFmpeg exited with code ${code}`));
            });
        });

        const exists = await fs.pathExists(videoPath);
        if (!exists) throw new Error("FFmpeg did not produce a video file.");
        const st = await fs.stat(videoPath);
        if (st.size < 1_000_000) throw new Error("Output video seems too small (<1 MB).");

        console.log(`[FFMPEG] Video created OK: ${(st.size / 1024 / 1024).toFixed(2)} MB`);

        // 4) Upload to S3 and respond with link
        if (!isS3Configured()) throw new Error("S3 is not configured.");
        console.log("[S3] Uploading…");
        const key = `videos/${jobId}/final_${Date.now()}.mp4`;
        const videoUrl = await uploadToS3(videoPath, key, "video/mp4");
        console.log(`[S3] Uploaded: ${videoUrl}`);

        return res.json({
            success: true,
            message: "✅ Video created & uploaded",
            videoUrl,
            jobId,
            sizeMB: (st.size / 1024 / 1024).toFixed(2),
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error(`[ERROR] ${err.message}`);
        return res.status(500).json({
            success: false,
            error: err.message,
            tip: "If this persists, verify URLs are reachable and FFmpeg path is correct.",
        });
    }
};



module.exports = { ProcessAudio, CreateThumbnail, CreateVideoFromAudio };

const express = require("express");
const router = express.Router();
const { Convert, getStorageInfo, downloadVideo, downloadThumbnail } = require("../controllers/ffmpeg_controller");
const { ProcessAudio, CreateThumbnail, CreateVideoFromAudio } = require("../controllers/lat_ffmpeh_controller")

// GET request handler for API status and instructions
router.get("/create-video", (req, res) => {
  res.json({
    status: "API is working!",
    message: "Sebestian Video Creation API is running",
    endpoint: "POST /api/ffmpeg/create-video",
    description: "Creates a video by merging audio files with background image and text overlay",
    videoSpecs: {
      resolution: "1920x1080 (Full HD)",
      format: "MP4 with H.264 video and AAC audio",
      features: "Automatic image cropping/scaling, subtle zoom effect, text overlay"
    },
    supportedImageFormats: ["JPG", "JPEG", "PNG", "GIF", "BMP", "WEBP"],
    requiredPayload: {
      files: ["array of audio file URLs"],
      imageUrl: "background image URL (JPG/JPEG/PNG/GIF/BMP/WEBP)",
      vibe: "main vibe text",
      subtitle: "subtitle text"
    },
    examplePayload: {
      files: [
        "https://example.com/track1.mp3",
        "https://example.com/track2.mp3"
      ],
      imageUrl: "https://example.com/background.png",
      vibe: "Ocean Breeze",
      subtitle: "Lo Fi Focus Mix"
    },
    response: "Returns MP4 video file stream",
    storageInfo: "GET /api/ffmpeg/storage-info for storage monitoring"
  });
});

// POST request handler for actual video creation
router.post("/create-video", Convert);

// Storage monitoring endpoint
router.get("/storage-info", getStorageInfo);

// Download endpoints (when S3 not configured)
router.get("/download/video/:jobId", downloadVideo);
router.get("/download/thumbnail/:jobId", downloadThumbnail);
router.post("/finalaudio", ProcessAudio)
router.post("/thumbnail-creator", CreateThumbnail)
router.post("/final-video", CreateVideoFromAudio)

module.exports = router;

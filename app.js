require("dotenv").config();
require("colors");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs-extra");
const routes = require("./configurations/routes");

const PORT = process.env.PORT || 5000;
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[GLOBAL ERROR] ${err.message}`);
  console.error(`[GLOBAL ERROR] Stack: ${err.stack}`);
  
  if (res.headersSent) {
    return next(err);
  }
  
  res.status(500).json({
    error: "Internal server error",
    message: err.message
  });
});

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  console.log(`\n[${signal}] Received shutdown signal`);
  console.log(`[SHUTDOWN] No cleanup needed - will be cleaned on next API request`);
  console.log(`[SHUTDOWN] Server shutting down gracefully`);
  process.exit(0);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error(`[UNCAUGHT EXCEPTION] ${err.message}`);
  console.error(`[UNCAUGHT EXCEPTION] Stack: ${err.stack}`);
  // Don't exit immediately, log and continue
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(`[UNHANDLED REJECTION] ${reason}`);
  console.error(`[UNHANDLED REJECTION] Promise:`, promise);
  // Don't exit immediately, log and continue
});

// Default route
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "Sebestian - Automated Lo-Fi Video Creator API",
    version: "1.0.0",
    endpoints: {
      createVideo: "POST /api/ffmpeg/create-video",
      storageInfo: "GET /api/ffmpeg/storage-info",
      apiDocs: "GET /api/ffmpeg/create-video"
    }
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Register routes
routes(app);

(async () => {
  try {
    const server = app.listen(PORT, () => {
      console.log(`╔════════════════════════════════════════════╗`.green.bold);
      console.log(`║  Sebestian API Server Started              ║`.green.bold);
      console.log(`║  Port: ${PORT}                                ║`.green.bold);
      console.log(`║  Environment: ${process.env.NODE_ENV || 'development'}             ║`.green.bold);
      console.log(`╚════════════════════════════════════════════╝`.green.bold);
      console.log(`Server is listening on http://localhost:${PORT}`.white.bold);
    });
    
    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[SERVER ERROR] Port ${PORT} is already in use`.red.bold);
      } else {
        console.error(`[SERVER ERROR] ${error.message}`.red.bold);
      }
      process.exit(1);
    });
    
  } catch (error) {
    console.error("Error starting the server:", error.message);
    process.exit(1);
  }
})();

module.exports = app;

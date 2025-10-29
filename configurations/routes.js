const { ffmpeg_route } = require("../routes");

module.exports = (app) => {
  app.use("/api/ffmpeg", ffmpeg_route);
};

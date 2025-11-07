const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs-extra");
const path = require("path");

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload file to S3 bucket
 * @param {string} filePath - Local file path
 * @param {string} fileName - Desired S3 object key/filename
 * @param {string} contentType - MIME type (default: video/mp4)
 * @returns {Promise<string>} - Public URL of uploaded file
 */
const uploadToS3 = async (filePath, fileName, contentType = "video/mp4") => {
  try {
    const fileContent = await fs.readFile(filePath);
    const bucketName = process.env.AWS_S3_BUCKET;

    if (!bucketName) {
      throw new Error("AWS_S3_BUCKET environment variable is not set");
    }

    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: fileContent,
      ContentType: contentType,
      ACL: "public-read", // Make file publicly accessible
    };

    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    // Construct public URL
    const region = process.env.AWS_REGION || "us-east-1";
    const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${fileName}`;

    console.log(`[S3] File uploaded successfully: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error(`[S3 Error] Failed to upload to S3: ${error.message}`);
    throw new Error(`S3 upload failed: ${error.message}`);
  }
};

/**
 * Check if S3 is configured
 * @returns {boolean}
 */
const isS3Configured = () => {
  return !!(
    process.env.AWS_ACCESS_KEY_ID && 
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET
  );
};

module.exports = {
  uploadToS3,
  isS3Configured,
};

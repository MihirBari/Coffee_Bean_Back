const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Checks whether valid Cloudinary credentials have been provided in environment variables.
 * Returns false if missing, blank, or placeholder values are present.
 */
const isCloudinaryConfigured = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) return false;

  const placeholders = ['your_cloud_name', 'your_api_key', 'your_api_secret', 'changeme', 'placeholder'];
  const isPlaceholder = (val) => placeholders.includes(val.trim().toLowerCase());

  if (isPlaceholder(cloudName) || isPlaceholder(apiKey) || isPlaceholder(apiSecret)) {
    return false;
  }

  return (
    cloudName.trim().length > 0 &&
    apiKey.trim().length > 0 &&
    apiSecret.trim().length > 0
  );
};

// Apply Cloudinary config if credentials exist
if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim()
  });
}

/**
 * Extracts public_id from a Cloudinary image URL.
 * Handles paths with folders and version strings, e.g. /upload/v12345/coffee-bean/products/sample.jpg
 */
const getPublicIdFromUrl = (url) => {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return null;
  try {
    const regex = /\/upload\/(?:v\d+\/)?([^\.]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  } catch (err) {
    return null;
  }
};

/**
 * Deletes an image from its respective storage location:
 * - If Cloudinary URL, deletes from Cloudinary via API
 * - If local /uploads/ URL, deletes from local filesystem
 * - If external URL (e.g. Unsplash), safely ignored
 */
const deleteStoredImage = async (imageUrl) => {
  if (!imageUrl || typeof imageUrl !== 'string') return;

  try {
    if (imageUrl.includes('cloudinary.com')) {
      const publicId = getPublicIdFromUrl(imageUrl);
      if (publicId && isCloudinaryConfigured()) {
        await cloudinary.uploader.destroy(publicId);
        console.log(`☁️ Deleted Cloudinary asset: ${publicId}`);
      }
    } else if (imageUrl.includes('/uploads/')) {
      const filename = path.basename(imageUrl);
      const filePath = path.join(__dirname, '../../uploads', filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`📁 Deleted local upload file: ${filename}`);
      }
    }
  } catch (err) {
    console.warn(`⚠️ Warning: could not delete old image (${imageUrl}):`, err.message);
  }
};

module.exports = {
  cloudinary,
  isCloudinaryConfigured,
  getPublicIdFromUrl,
  deleteStoredImage
};

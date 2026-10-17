const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { isCloudinaryConfigured } = require('../config/cloudinary');

// Standalone image upload route
router.post('/', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded' });
    }

    const isCloudinary = req.file.path && (req.file.path.startsWith('http://') || req.file.path.startsWith('https://'));
    const imageUrl = isCloudinary
      ? req.file.path
      : `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    res.json({
      success: true,
      message: isCloudinary
        ? 'Image uploaded to Cloudinary successfully'
        : 'Image uploaded to local storage successfully',
      imageUrl,
      filename: req.file.filename,
      storage: isCloudinary ? 'cloudinary' : 'local'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Image upload failed', error: error.message });
  }
});

// Storage status endpoint
router.get('/status', (req, res) => {
  const configured = isCloudinaryConfigured();
  res.json({
    activeStorage: configured ? 'cloudinary' : 'local',
    cloudinaryConfigured: configured,
    message: configured
      ? 'Cloudinary is configured and active for all image uploads.'
      : 'Cloudinary credentials are not configured yet in .env — using local disk storage fallback.'
  });
});

module.exports = router;

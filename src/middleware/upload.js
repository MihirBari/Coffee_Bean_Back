const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { cloudinary, isCloudinaryConfigured } = require('../config/cloudinary');

// Ensure local uploads directory exists (fallback when Cloudinary is not configured)
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 1. Local disk storage engine
const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `coffee-${cleanName}-${uniqueSuffix}${ext}`);
  }
});

// 2. Cloudinary storage engine
const createCloudinaryStorage = () => {
  return new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: 'coffee-bean/products',
      allowed_formats: ['jpeg', 'jpg', 'png', 'webp', 'gif'],
      transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }]
    }
  });
};

let cachedCloudinaryStorage = null;

const getActiveStorage = () => {
  if (isCloudinaryConfigured()) {
    if (!cachedCloudinaryStorage) {
      try {
        cachedCloudinaryStorage = createCloudinaryStorage();
      } catch (err) {
        console.warn('⚠️ CloudinaryStorage initialization failed, falling back to local storage:', err.message);
        return localStorage;
      }
    }
    return cachedCloudinaryStorage;
  }
  return localStorage;
};

// 3. Dynamic proxy storage engine
const dynamicStorage = {
  _handleFile(req, file, cb) {
    const storage = getActiveStorage();
    storage._handleFile(req, file, (err, info) => {
      if (!err && isCloudinaryConfigured()) {
        console.log(`☁️ Uploaded image to Cloudinary: ${info?.path || info?.secure_url || 'saved'}`);
      }
      cb(err, info);
    });
  },
  _removeFile(req, file, cb) {
    const storage = getActiveStorage();
    storage._removeFile(req, file, cb);
  }
};

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|gif/;
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  const mime = file.mimetype.toLowerCase();

  if (allowedTypes.test(ext) && allowedTypes.test(mime)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, JPG, PNG, WEBP, GIF) are allowed'), false);
  }
};

const upload = multer({
  storage: dynamicStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter
});

module.exports = upload;

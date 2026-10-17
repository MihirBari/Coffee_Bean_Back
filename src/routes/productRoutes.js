const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const upload = require('../middleware/upload');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Public endpoints: anyone can browse
router.get('/', productController.getProducts);
router.get('/:id', productController.getProductById);

// Admin-only protected endpoints
router.post('/', authenticateToken, requireAdmin, upload.single('image'), productController.createProduct);
router.put('/:id', authenticateToken, requireAdmin, upload.single('image'), productController.updateProduct);
router.patch('/:id/stock', authenticateToken, requireAdmin, productController.updateStock);
router.delete('/:id/image', authenticateToken, requireAdmin, productController.removeProductImage);
router.delete('/:id', authenticateToken, requireAdmin, productController.deleteProduct);

module.exports = router;

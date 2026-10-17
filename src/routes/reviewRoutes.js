const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticateOptional, authenticateToken, requireAdmin } = require('../middleware/auth');

// GET all reviews across all products (Admin only)
router.get('/all', authenticateToken, requireAdmin, reviewController.getAllReviews);

// GET reviews for a product
router.get('/product/:productId', reviewController.getProductReviews);

// POST a review (authenticated author or guest)
router.post('/', authenticateOptional, reviewController.createReview);

// PUT edit review (only author or admin)
router.put('/:id', authenticateOptional, reviewController.updateReview);

// DELETE review (only author or admin)
router.delete('/:id', authenticateOptional, reviewController.deleteReview);

module.exports = router;

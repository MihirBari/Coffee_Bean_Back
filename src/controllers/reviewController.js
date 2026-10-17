const { pool } = require('../config/db');

// GET /api/reviews/all (Admin all reviews across all products)
exports.getAllReviews = async (req, res) => {
  try {
    const [reviews] = await pool.query(`
      SELECT r.*, p.name AS product_name, p.image_url AS product_image
      FROM product_reviews r
      LEFT JOIN products p ON r.product_id = p.id
      ORDER BY r.created_at DESC
    `);
    res.json({
      success: true,
      count: reviews.length,
      data: reviews
    });
  } catch (error) {
    console.error('Error fetching all reviews:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving reviews', error: error.message });
  }
};

// GET /api/reviews/product/:productId
exports.getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const [reviews] = await pool.query(
      'SELECT * FROM product_reviews WHERE product_id = ? ORDER BY id DESC',
      [productId]
    );

    const count = reviews.length;
    let totalScore = 0;
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    reviews.forEach((r) => {
      const score = Math.max(1, Math.min(5, parseInt(r.rating, 10)));
      distribution[score] = (distribution[score] || 0) + 1;
      totalScore += score;
    });

    const averageRating = count > 0 ? parseFloat((totalScore / count).toFixed(1)) : 5.0;

    res.json({
      success: true,
      productId: parseInt(productId, 10),
      count,
      average_rating: averageRating,
      distribution,
      reviews
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving reviews', error: error.message });
  }
};

// POST /api/reviews
exports.createReview = async (req, res) => {
  try {
    const { product_id, reviewer_name, rating, title, comment } = req.body;

    const authorName = (reviewer_name || req.user?.name || '').trim();

    if (!product_id || !authorName || !rating || !comment) {
      return res.status(400).json({
        success: false,
        message: 'Product ID, reviewer name, rating, and review comment are required'
      });
    }

    const ratingNum = Math.max(1, Math.min(5, parseInt(rating, 10) || 5));
    let userId = null;
    if (req.user && req.user.id) {
      const [userMatch] = await pool.query('SELECT id FROM users WHERE id = ?', [req.user.id]);
      if (userMatch.length > 0) {
        userId = req.user.id;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO product_reviews (product_id, user_id, reviewer_name, rating, title, comment, is_verified_purchase)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [product_id, userId, authorName, ratingNum, (title || '').trim(), comment.trim()]
    );

    const [newReview] = await pool.query('SELECT * FROM product_reviews WHERE id = ?', [result.insertId]);

    res.status(201).json({
      success: true,
      message: 'Thank you! Your verified review has been published.',
      data: newReview[0]
    });
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({ success: false, message: 'Server error submitting review', error: error.message });
  }
};

// PUT /api/reviews/:id (Edit review by author or admin)
exports.updateReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, title, comment } = req.body;

    // Check if review exists
    const [reviews] = await pool.query('SELECT * FROM product_reviews WHERE id = ?', [id]);
    if (reviews.length === 0) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    const review = reviews[0];

    // Authorization: User must be the author (by user_id or reviewer_name) or admin
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({ 
        success: false, 
        message: 'Please sign in to edit your review.' 
      });
    }

    const isAuthor = Boolean(
      (review.user_id && Number(review.user_id) === Number(currentUser.id)) ||
      (currentUser.name && review.reviewer_name && currentUser.name.trim().toLowerCase() === review.reviewer_name.trim().toLowerCase())
    );
    const isAdmin = currentUser.role === 'admin';

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied: Only the author of this review or an administrator can edit it.'
      });
    }

    const ratingNum = Math.max(1, Math.min(5, parseInt(rating, 10) || review.rating));
    const updatedTitle = title !== undefined ? title.trim() : review.title;
    const updatedComment = comment !== undefined ? comment.trim() : review.comment;

    if (!updatedComment) {
      return res.status(400).json({ success: false, message: 'Review comment cannot be empty' });
    }

    await pool.query(
      `UPDATE product_reviews 
       SET rating = ?, title = ?, comment = ?
       WHERE id = ?`,
      [ratingNum, updatedTitle, updatedComment, id]
    );

    const [updatedRows] = await pool.query('SELECT * FROM product_reviews WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Review updated successfully!',
      data: updatedRows[0]
    });
  } catch (error) {
    console.error('Error updating review:', error);
    res.status(500).json({ success: false, message: 'Server error updating review', error: error.message });
  }
};

// DELETE /api/reviews/:id (Delete review by author or admin)
exports.deleteReview = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if review exists
    const [reviews] = await pool.query('SELECT * FROM product_reviews WHERE id = ?', [id]);
    if (reviews.length === 0) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    const review = reviews[0];

    // Authorization: User must be the author (by user_id or reviewer_name) or admin
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({ 
        success: false, 
        message: 'Please sign in to delete your review.' 
      });
    }

    const isAuthor = Boolean(
      (review.user_id && Number(review.user_id) === Number(currentUser.id)) ||
      (currentUser.name && review.reviewer_name && currentUser.name.trim().toLowerCase() === review.reviewer_name.trim().toLowerCase())
    );
    const isAdmin = currentUser.role === 'admin';

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied: Only the author of this review or an administrator can delete it.'
      });
    }

    await pool.query('DELETE FROM product_reviews WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Review deleted successfully',
      id: parseInt(id, 10),
      product_id: review.product_id
    });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ success: false, message: 'Server error deleting review', error: error.message });
  }
};

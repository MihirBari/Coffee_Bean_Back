const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcementController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Public endpoint for storefront top announcement banner
router.get('/active', announcementController.getActiveAnnouncement);

// Lightning Deals / Flash Sale Banner endpoints
router.get('/lightning-deal', announcementController.getLightningDeal); // Public
router.put('/lightning-deal', authenticateToken, requireAdmin, announcementController.updateLightningDeal); // Admin
router.patch('/lightning-deal/toggle', authenticateToken, requireAdmin, announcementController.toggleLightningDeal); // Admin
router.post('/lightning-deal/launch', authenticateToken, requireAdmin, announcementController.launchFlashSale); // Admin

// Admin-protected management endpoints for announcements
router.get('/', authenticateToken, requireAdmin, announcementController.getAllAnnouncements);
router.post('/', authenticateToken, requireAdmin, announcementController.createAnnouncement);
router.put('/:id', authenticateToken, requireAdmin, announcementController.updateAnnouncement);
router.patch('/:id/toggle', authenticateToken, requireAdmin, announcementController.toggleAnnouncementStatus);
router.delete('/:id', authenticateToken, requireAdmin, announcementController.deleteAnnouncement);

module.exports = router;

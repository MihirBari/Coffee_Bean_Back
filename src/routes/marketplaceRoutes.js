const express = require('express');
const router = express.Router();
const marketplaceController = require('../controllers/marketplaceController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const upload = require('../middleware/upload');

// Customer Orders & Live Visual Tracking
router.get('/my-orders', authenticateToken, marketplaceController.getMyOrders);
router.get('/tracking/:orderNumber', marketplaceController.getOrderTracking);

// Customer Returns & Replacements (Supports optional product damage/clarification photo)
router.post('/return-request', authenticateToken, upload.single('image'), marketplaceController.createReturnRequest);
router.get('/return-requests', authenticateToken, requireAdmin, marketplaceController.getReturnRequests);
router.put('/return-requests/:id', authenticateToken, requireAdmin, marketplaceController.updateReturnRequest);

// Order Shipping Label & Fulfillment Updates
router.put('/orders/:id/tracking', authenticateToken, requireAdmin, marketplaceController.updateOrderTracking);

// Customer Multi-Address Book
router.get('/addresses', authenticateToken, marketplaceController.getAddresses);
router.post('/addresses', authenticateToken, marketplaceController.addAddress);
router.delete('/addresses/:id', authenticateToken, marketplaceController.deleteAddress);

// Bean Coins Loyalty Wallet
router.get('/wallet', authenticateToken, marketplaceController.getWallet);

// Community Q&A
router.get('/questions/:productId', marketplaceController.getProductQuestions);
router.post('/questions', marketplaceController.askQuestion);
router.put('/questions/:id/answer', authenticateToken, requireAdmin, marketplaceController.answerQuestion);

// CRM Customers 360 & Bulk CSV Exports
router.get('/crm-customers', authenticateToken, requireAdmin, marketplaceController.getCRMCustomers);
router.put('/crm-customers/:id/verify', authenticateToken, requireAdmin, marketplaceController.verifyCustomerEmail);
router.get('/export-orders', authenticateToken, requireAdmin, marketplaceController.exportOrdersCSV);
router.get('/export-inventory', authenticateToken, requireAdmin, marketplaceController.exportInventoryCSV);

module.exports = router;

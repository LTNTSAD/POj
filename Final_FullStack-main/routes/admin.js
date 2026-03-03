const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.session && req.session.customer && req.session.customer.role === 'admin') {
    return next();
  }
  res.redirect('/login');
};

router.get('/dashboard', isAdmin, adminController.dashboard);
// new report page for admin statistics
router.get('/report', isAdmin, adminController.report);
// debug helper: expose report without auth when not in production to help diagnose routing/session issues
// expose debug route (development helper) — remove or guard in production
router.get('/report-debug', adminController.report);
router.post('/parcel/update-status', isAdmin, adminController.updateStatus);
router.post('/payment/update-status', isAdmin, adminController.updatePaymentStatus);
//router.post('/parcel/delete', isAdmin, adminController.deleteParcel);
router.post('/parcel/cancel', isAdmin, adminController.cancelParcel);
router.post('/parcel/ship', isAdmin, adminController.markShipped);
router.post('/parcel/deliver', isAdmin, adminController.markDelivered);

module.exports = router;

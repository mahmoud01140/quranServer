import express from 'express';
import { protect } from '../middleware/auth.middleware.js';
import { adminOnly } from '../middleware/role.middleware.js';
import { uploadReceipt } from '../middleware/upload.middleware.js';
import {
  getPaymentConfig,
  submitPaymentRequest,
  getMyPayments,
  getAllPaymentsAdmin,
  approvePaymentAdmin,
  rejectPaymentAdmin,
  activateSubscriptionManually,
  getPaymentSettingsAdmin,
  updatePaymentSettingsAdmin,
} from '../controllers/payment.controller.js';

const router = express.Router();

// ─── Public / Shared Routes ──────────────────────────────────────
// Get active plans and payment instructions (Vodafone Cash & InstaPay)
router.get('/plans', getPaymentConfig);
router.get('/public-config', getPaymentConfig);

// ─── Student Routes (Protected) ──────────────────────────────────
// Submit receipt & request subscription
router.post('/submit', protect, uploadReceipt, submitPaymentRequest);
// Get student payment history & subscription
router.get('/my-history', protect, getMyPayments);
router.get('/subscription', protect, getMyPayments);

// ─── Admin Routes (Admin Only) ───────────────────────────────────
// List all payment requests with filter & stats
router.get('/admin/all', protect, adminOnly, getAllPaymentsAdmin);
// Approve payment & activate subscription
router.post('/admin/:id/approve', protect, adminOnly, approvePaymentAdmin);
// Reject payment with reason
router.post('/admin/:id/reject', protect, adminOnly, rejectPaymentAdmin);
// Manual activation without payment
router.post('/admin/activate/:studentId', protect, adminOnly, activateSubscriptionManually);
// Get / Update payment accounts settings (Vodafone Cash / InstaPay / Pricing)
router.get('/admin/settings', protect, adminOnly, getPaymentSettingsAdmin);
router.put('/admin/settings', protect, adminOnly, updatePaymentSettingsAdmin);

export default router;

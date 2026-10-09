import express from 'express';
import {
  getNotifications, markAsRead, markAllAsRead,
  deleteNotification, sendNotification, sendGroupNotification,
  getNotificationSettings, updateNotificationSettings, testPushNotification,
} from '../controllers/notification.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { adminOnly, teacherOnly } from '../middleware/role.middleware.js';

const router = express.Router();
router.use(protect);

router.get('/', getNotifications);
router.put('/:id/read', markAsRead);
router.put('/read-all', markAllAsRead);
router.delete('/:id', deleteNotification);
router.post('/send', adminOnly, sendNotification);
router.post('/send-group/:groupId', teacherOnly, sendGroupNotification);
router.post('/test-push', testPushNotification);
router.get('/settings', adminOnly, getNotificationSettings);
router.put('/settings', adminOnly, updateNotificationSettings);

export default router;

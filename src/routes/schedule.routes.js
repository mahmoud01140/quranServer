import express from 'express';
import {
  getScheduleSettings,
  updateScheduleSettings,
  getAvailableSlots,
  bookStudentSchedule,
} from '../controllers/schedule.controller.js';
import { protect, authorize } from '../middleware/auth.middleware.js';

const router = express.Router();

// عام أو للمستخدمين المصادق عليهم: جلب الإعدادات وحساب الفترات المتاحة
router.get('/settings', getScheduleSettings);
router.get('/available-slots', protect, getAvailableSlots);

// حجز موعد الطالب مباشرة وتوليد رابط الواتساب
router.post('/book', protect, bookStudentSchedule);

// تحديث إعدادات الجدولة (خاص بالأدمن فقط)
router.put('/settings', protect, authorize('admin'), updateScheduleSettings);

export default router;

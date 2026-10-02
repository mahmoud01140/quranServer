import express from 'express';
import { getAnalyticsStats, getAttendanceReports, getStudentReport } from '../controllers/reports.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(protect);

const allowAdminOrTeacher = (req, res, next) => {
  if (!['admin', 'teacher'].includes(req.user.role)) {
    return res.status(403).json({ message: 'هذا الإجراء يتطلب صلاحية مدير أو معلم' });
  }
  next();
};

router.get('/analytics', allowAdminOrTeacher, getAnalyticsStats);
router.get('/attendance', allowAdminOrTeacher, getAttendanceReports);
router.get('/student/:studentId', allowAdminOrTeacher, getStudentReport);

export default router;

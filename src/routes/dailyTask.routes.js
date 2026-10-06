import express from 'express';
import {
  getTodayTask,
  updatePortionStatus,
  reviewDailyTask,
  getGroupTodayTasks,
  assignStudentDailyTask,
  assignWeeklyPlan,
  getStudentTodayTask,
  getPreviousTask,
} from '../controllers/dailyTask.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(protect);

router.get('/today', getTodayTask);
router.put('/:id/portion', updatePortionStatus);
router.put('/:id/review', reviewDailyTask);
router.get('/group/:groupId/today', getGroupTodayTasks);
router.put('/student/:studentId/assign', assignStudentDailyTask);
router.post('/student/:studentId/weekly-plan', assignWeeklyPlan);
// ورد الطالب اليوم + الورد السابق (المطلوب تسميعه) — للمشرف أثناء البث
router.get('/student/:studentId/today', getStudentTodayTask);
router.get('/student/:studentId/previous', getPreviousTask);

export default router;

import express from 'express';
import {
  getGroupPlan, createGroupPlan, getGroupFullPlan,
  assignCurriculumToGroup,
  addCustomLesson, updateCustomLesson, deleteCustomLesson, toggleLessonComplete,
  getStudentPlan, createStudentPlan, getStudentPlanFull, updateStudentCustomLesson,
  updateQuranProgress, updateParentApproval,
} from '../controllers/studyPlan.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { adminOnly } from '../middleware/role.middleware.js';

const router = express.Router();
router.use(protect);

// Admin/teacher: group plan management
const allowAdminOrTeacher = (req, res, next) => {
  if (!['admin', 'teacher'].includes(req.user.role)) {
    return res.status(403).json({ message: 'غير مصرح' });
  }
  next();
};

// Group plan endpoints
router.get('/group/:groupId', getGroupPlan);
router.get('/group/:groupId/full', getGroupFullPlan);
router.post('/group/:groupId', allowAdminOrTeacher, createGroupPlan);
router.put('/group/:groupId', allowAdminOrTeacher, createGroupPlan);

// Assign base curriculum to group (admin only)
router.put('/group/:groupId/curriculum', adminOnly, assignCurriculumToGroup);

// Custom lessons (admin/teacher)
router.post('/group/:groupId/lessons', allowAdminOrTeacher, addCustomLesson);
router.put('/group/:groupId/lessons/:lessonId', allowAdminOrTeacher, updateCustomLesson);
router.put('/group/:groupId/lessons/:lessonId/toggle-complete', allowAdminOrTeacher, toggleLessonComplete);
router.delete('/group/:groupId/lessons/:lessonId', allowAdminOrTeacher, deleteCustomLesson);

// Student individual plan
router.get('/student/:studentId', getStudentPlan);
router.get('/student/:studentId/full', getStudentPlanFull);
router.post('/student/:studentId', createStudentPlan);
router.put('/student/:studentId/lessons/:lessonId', allowAdminOrTeacher, updateStudentCustomLesson);
router.put('/student/:studentId/quran-progress', updateQuranProgress);
router.put('/student/:studentId/parent-approval', updateParentApproval);

export default router;

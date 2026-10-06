import express from 'express';
import {
  getPlacementExam, getGroupExams, createExam, updateExam, deleteExam,
  assignExamToLesson,
  submitExam, submitOralExam, submitRecitationAnswers,
  getStudentResults, getResultById,
  getGroupResults, getExamResults,
  reviewOralResult, getPendingReviews,
  getMyWeakPoints, updateWeakPointStatus,
  getAdminPlacementExams, updatePlacementExam,
  getStudentAssignedExams, getAdminAllExams,
} from '../controllers/exam.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { teacherOnly, adminOnly } from '../middleware/role.middleware.js';
import { uploadMultipleAudio } from '../middleware/upload.middleware.js';

const router = express.Router();
router.use(protect);

// ── Admin Placement Management ────────────────────────────────────────────────
router.get('/admin/placement', adminOnly, getAdminPlacementExams);
router.put('/admin/placement/:registrationType', adminOnly, updatePlacementExam);
router.get('/admin/all', teacherOnly, getAdminAllExams);

// ── Student Assigned Exams ────────────────────────────────────────
router.get('/student/assigned', getStudentAssignedExams);

// ── Static paths first (before param routes) ──────────────────────
router.get('/placement/:type', getPlacementExam);
router.get('/results/pending-review', teacherOnly, getPendingReviews);
router.get('/weak-points/my', getMyWeakPoints);
router.get('/weak-points/student/:studentId', getMyWeakPoints);
router.put('/weak-points/:id', updateWeakPointStatus);
router.get('/results/student/:id', getStudentResults);
router.get('/results/:resultId', getResultById);
router.put('/results/:resultId/review', teacherOnly, reviewOralResult);

// ── Group & CRUD ──────────────────────────────────────────────────
router.get('/group/:groupId', getGroupExams);
router.get('/group/:groupId/results', adminOnly, getGroupResults);   // Admin sees all results per group
router.post('/', teacherOnly, createExam);                             // Admin + Teacher can create
router.post('/:id/assign-lesson', teacherOnly, assignExamToLesson); // إسناد امتحان بنك لطالب: حصة فردية أو مباشر
router.put('/:id', teacherOnly, updateExam);
router.delete('/:id', teacherOnly, deleteExam);                        // Admin + Teacher can delete

// ── Results for specific exam ─────────────────────────────────────
router.get('/:examId/results', teacherOnly, getExamResults);           // Admin sees results per exam

// ── Submissions ───────────────────────────────────────────────────
router.post('/:id/submit', submitExam);
router.post('/:id/submit-oral', uploadMultipleAudio, submitOralExam);
router.post('/:id/submit-recitation', uploadMultipleAudio, submitRecitationAnswers);

export default router;

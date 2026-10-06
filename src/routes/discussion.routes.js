import express from 'express';
import {
  getMyThread,
  sendStudentMessage,
  getAdminConversations,
  getAdminStudentThread,
  sendAdminReply,
  getLessonDiscussion,
  sendLessonMessage,
  pinLessonMessage,
  deleteLessonMessage,
} from '../controllers/discussion.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { adminOnly } from '../middleware/role.middleware.js';

const router = express.Router();
router.use(protect);

// ─── Direct Student-Admin Discussions (Pure HTTP, Vercel-Safe, Zero Sockets) ──

// Student Routes
router.get('/my-thread', getMyThread);
router.post('/my-thread', sendStudentMessage);

// Admin Routes
router.get('/admin/conversations', adminOnly, getAdminConversations);
router.get('/admin/conversations/:studentId', adminOnly, getAdminStudentThread);
router.post('/admin/conversations/:studentId', adminOnly, sendAdminReply);

// General message delete
router.delete('/messages/:messageId', deleteLessonMessage);

// Legacy Fallbacks (graceful redirection, prevents 500 crashes)
router.get('/lesson/:lessonId', getLessonDiscussion);
router.post('/lesson/:lessonId/messages', sendLessonMessage);
router.put('/lesson/:lessonId/messages/:messageId/pin', pinLessonMessage);
router.delete('/lesson/:lessonId/messages/:messageId', deleteLessonMessage);

export default router;

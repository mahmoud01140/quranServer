import express from 'express';
import {
  getGroupSessions, createSession, getSessionById, getActiveSession, getMySessions,
  startSession, endSession, joinSession, leaveSession, sendChatMessage, getChatMessages, getAttendees,
  startGroupLiveSession, startStudentLiveSession, checkStudentSubscription,
  // Live Attendance Sheet System
  getAttendanceSheet, saveAttendanceSheet, sendAttendancePing, respondAttendancePong,
  // Shared mushaf (HTTP polling)
  getSharedMushaf, updateSharedMushaf
} from '../controllers/live.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = express.Router();
router.use(protect);

const allowAdminOrTeacher = (req, res, next) => {
  if (!['admin', 'teacher'].includes(req.user.role)) {
    return res.status(403).json({ message: 'هذا الإجراء يتطلب صلاحية معلم أو أدمن' });
  }
  next();
};

// Student individual sessions & Group sessions
router.get('/active/me', getActiveSession);
router.get('/mine', getMySessions);
router.get('/student/:studentId/subscription-check', allowAdminOrTeacher, checkStudentSubscription);
router.post('/student/:studentId/start', allowAdminOrTeacher, startStudentLiveSession);
router.get('/group/:groupId', getGroupSessions);
router.post('/group/:groupId/start', allowAdminOrTeacher, startGroupLiveSession);

// All session management
router.post('/', allowAdminOrTeacher, createSession);
router.get('/:id', getSessionById);
router.put('/:id/start', allowAdminOrTeacher, startSession);
router.put('/:id/end', allowAdminOrTeacher, endSession);
router.put('/:id/join', joinSession);
router.post('/:id/leave', leaveSession);
router.post('/:id/chat', sendChatMessage);
router.get('/:id/chat', getChatMessages);
router.get('/:id/attendees', getAttendees);

// Live Attendance Sheet & Roll-Call endpoints
router.get('/:id/attendance-sheet', allowAdminOrTeacher, getAttendanceSheet);
router.put('/:id/attendance-sheet', allowAdminOrTeacher, saveAttendanceSheet);
router.post('/:id/attendance-ping', allowAdminOrTeacher, sendAttendancePing);
router.post('/:id/attendance-pong', respondAttendancePong);

// Shared mushaf state (polled over HTTP — no sockets)
router.get('/:id/mushaf', getSharedMushaf);
router.put('/:id/mushaf', allowAdminOrTeacher, updateSharedMushaf);

export default router;

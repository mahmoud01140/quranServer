import express from 'express';
import {
  getAllUsers, getUserById, updateUser, deleteUser,
  getPendingApproval, getUnassignedStudents, getStudentsList, getScheduleMap,
  approveUser, updatePushSubscription, getMyAttendanceStats
} from '../controllers/user.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { adminOnly, teacherOnly, requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.use(protect);

router.get('/me/attendance-stats', getMyAttendanceStats);
router.get('/', adminOnly, getAllUsers);
router.get('/students/list', teacherOnly, getStudentsList);
router.get('/schedule-map', teacherOnly, getScheduleMap);
router.get('/pending-approval', adminOnly, getPendingApproval);
router.get('/students/unassigned', adminOnly, getUnassignedStudents);
router.get('/:id', getUserById);
router.put('/:id', updateUser);
router.delete('/:id', adminOnly, deleteUser);
router.put('/:id/approve', adminOnly, approveUser);
router.put('/:id/push-subscription', updatePushSubscription);

export default router;

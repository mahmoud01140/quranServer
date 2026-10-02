import express from 'express';
import { uploadResource, getGroupResources, getGeneralResources, trackDownload, deleteResource } from '../controllers/resource.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { uploadResource as uploadMiddleware } from '../middleware/upload.middleware.js';
import { teacherOnly } from '../middleware/role.middleware.js';

const router = express.Router();
router.use(protect);

// Upload (teacher/admin)
router.post('/', teacherOnly, uploadMiddleware, uploadResource);

// Get general library (no group)
router.get('/general', getGeneralResources);

// Get group resources (any member)
router.get('/group/:groupId', getGroupResources);

// Track download
router.put('/:id/download', trackDownload);

// Delete (teacher/admin)
router.delete('/:id', teacherOnly, deleteResource);

export default router;

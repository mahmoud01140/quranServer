import express from 'express';
import { uploadResource as uploadController, getGroupResources, getGeneralResources, trackDownload, deleteResource } from '../controllers/resource.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { teacherOnly } from '../middleware/role.middleware.js';

const router = express.Router();
router.use(protect);

// جميع رفع الملفات يتم Browser → Cloudinary مباشرة.
// السيرفر يستقبل JSON فقط (fileUrl + metadata) — لا multipart، لا multer.

// Upload (teacher/admin) — JSON body with fileUrl
router.post('/', teacherOnly, uploadController);

// Get general library (no group)
router.get('/general', getGeneralResources);

// Get group resources (any member)
router.get('/group/:groupId', getGroupResources);

// Track download
router.put('/:id/download', trackDownload);

// Delete (teacher/admin)
router.delete('/:id', teacherOnly, deleteResource);

export default router;

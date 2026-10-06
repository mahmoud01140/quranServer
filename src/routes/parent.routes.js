import express from 'express';
import {
  getChildren,
  linkChild,
  unlinkChild,
  getChildProgress,
  getMyLinkCode,
  regenerateLinkCode,
} from '../controllers/parent.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.use(protect);

// Student endpoints to get or regenerate their link code
router.get('/my-link-code', getMyLinkCode);
router.post('/regenerate-link-code', regenerateLinkCode);

// Parent only endpoints
router.use(requireRole('parent'));
router.get('/children', getChildren);
router.post('/children', linkChild);
router.delete('/children/:id', unlinkChild);
router.get('/children/:id/progress', getChildProgress);

export default router;

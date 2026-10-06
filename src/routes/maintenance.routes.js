import express from 'express';
import { runStorageCleanup } from '../controllers/maintenance.controller.js';

const router = express.Router();

// No auth middleware: protected by optional CRON_SECRET inside the controller.
// Safe to expose — the job only deletes files past their retention window.
router.get('/cleanup', runStorageCleanup);

export default router;

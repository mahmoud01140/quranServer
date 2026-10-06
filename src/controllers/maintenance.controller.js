import ExamResult from '../models/ExamResult.js';
import Payment from '../models/Payment.js';
import User from '../models/User.js';
import { deleteStoredFile } from '../middleware/upload.middleware.js';

// ─── Automatic storage cleanup (saves Cloudinary/disk space) ─────
// Policy (overridable via env):
//  - Oral/recitation audio: deleted 1 day after admin review (scores & notes kept).
//  - Payment receipts: deleted 30 days after admin review (record metadata kept).
// Run daily via Vercel Cron (vercel.json) or any external cron hitting:
//   GET /api/maintenance/cleanup
// The job is time-gated (only touches files past retention), so triggering it
// early or twice is harmless. Capped per run to respect serverless timeouts.

const AUDIO_RETENTION_DAYS = Number(process.env.AUDIO_RETENTION_DAYS) || 1;
const RECEIPT_RETENTION_DAYS = Number(process.env.RECEIPT_RETENTION_DAYS) || 30;
// Small batches fit the Vercel Hobby 10s default (60s max) function window.
// The job is resumable: only successfully deleted files are cleared from the DB,
// so the next daily run picks up whatever remains.
const BATCH_LIMIT = 25;

const dayAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const cleanupReviewedAudio = async () => {
  const stats = { results: 0, filesDeleted: 0, errors: 0 };
  const cutoff = dayAgo(AUDIO_RETENTION_DAYS);
  const results = await ExamResult.find({
    status: { $in: ['reviewed', 'approved'] },
    reviewedAt: { $lte: cutoff },
  })
    .select('_id student oralRecordings')
    .limit(BATCH_LIMIT);

  for (const result of results) {
    let touched = false;
    const removedUrls = [];
    for (const rec of result.oralRecordings || []) {
      if (!rec.audioUrl) continue;
      const ok = await deleteStoredFile({
        url: rec.audioUrl,
        publicId: rec.audioPublicId,
        resourceType: rec.audioResourceType || 'video', // Cloudinary stores audio as 'video'
      });
      if (ok) {
        removedUrls.push(rec.audioUrl);
        rec.audioUrl = null;
        rec.audioPublicId = null;
        rec.audioResourceType = null;
        touched = true;
        stats.filesDeleted += 1;
      } else {
        stats.errors += 1;
      }
    }
    if (touched) {
      await result.save();
      stats.results += 1;
      // Clear the mirrored placement URLs on the student profile as well
      if (removedUrls.length && result.student) {
        try {
          await User.updateOne(
            { _id: result.student },
            { $pull: { oralExamRecordings: { $in: removedUrls } } }
          );
        } catch (_) {}
      }
    }
  }
  return stats;
};

const cleanupReviewedReceipts = async () => {
  const stats = { payments: 0, filesDeleted: 0, errors: 0 };
  const cutoff = dayAgo(RECEIPT_RETENTION_DAYS);
  const payments = await Payment.find({
    status: { $in: ['approved', 'rejected'] },
    reviewedAt: { $lte: cutoff },
    receiptUrl: { $ne: null },
  })
    .select('_id receiptUrl receiptPublicId receiptResourceType')
    .limit(BATCH_LIMIT);

  for (const payment of payments) {
    const ok = await deleteStoredFile({
      url: payment.receiptUrl,
      publicId: payment.receiptPublicId,
      resourceType: payment.receiptResourceType || 'image',
    });
    if (ok) {
      payment.receiptUrl = null;
      payment.receiptPublicId = null;
      payment.receiptResourceType = null;
      await payment.save();
      stats.payments += 1;
      stats.filesDeleted += 1;
    } else {
      stats.errors += 1;
    }
  }
  return stats;
};

// GET /api/maintenance/cleanup
export const runStorageCleanup = async (req, res) => {
  try {
    // Optional shared secret: enforced only when CRON_SECRET is configured.
    // (Send as `?secret=` or `Authorization: Bearer`.)
    const required = process.env.CRON_SECRET;
    if (required) {
      const provided =
        req.query.secret || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (provided !== required) {
        return res.status(401).json({ message: 'غير مصرح' });
      }
    }

    const [audio, receipts] = await Promise.all([
      cleanupReviewedAudio(),
      cleanupReviewedReceipts(),
    ]);

    res.json({
      message: 'اكتمل التنظيف التلقائي للتخزين',
      at: new Date().toISOString(),
      audioRetentionDays: AUDIO_RETENTION_DAYS,
      receiptRetentionDays: RECEIPT_RETENTION_DAYS,
      audio,
      receipts,
    });
  } catch (error) {
    console.error('Storage cleanup error:', error);
    res.status(500).json({ message: 'خطأ في مهمة التنظيف' });
  }
};

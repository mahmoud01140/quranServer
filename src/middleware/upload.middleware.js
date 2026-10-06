import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import os from 'os';
import {
  isCloudinaryEnabled,
  uploadBufferToCloudinary,
  cloudinaryFolderPrefix,
  deleteFromCloudinary,
} from '../config/cloudinary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Storage strategy ─────────────────────────────────────────────
// Cloudinary (25GB free, no card) when env keys exist — required on Vercel
// because serverless disks are ephemeral (/tmp wiped on redeploy/cold start).
// Otherwise: local disk fallback for offline development (unchanged behavior).
// Controllers are untouched: file.path always ends up as the final public URL
// (Cloudinary secure_url) or a local path resolved by getFileUrl() as before.

// On Vercel / serverless environments, file system is read-only except for /tmp
const isServerless = Boolean(process.env.VERCEL);
export const uploadDir = isServerless
  ? path.join(os.tmpdir(), 'uploads')
  : path.join(__dirname, '..', '..', 'uploads');

// Create upload directories if they don't exist (local fallback only)
if (!isCloudinaryEnabled) {
  ['audio', 'video', 'images', 'documents'].forEach((dir) => {
    const dirPath = path.join(uploadDir, dir);
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    } catch (err) {
      console.warn(`⚠️ Could not create upload directory ${dirPath}:`, err.message);
    }
  });
}

// Memory storage: works on Vercel (no disk) and locally.
// Files are then either pushed to Cloudinary or written to local disk below.
const storage = multer.memoryStorage();

const subDirFor = (mimetype = '') => {
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('image/')) return 'images';
  return 'documents';
};

/**
 * Persist one multer-memory file and return its final public URL.
 * - Cloudinary mode: permanent CDN URL (folder per file kind).
 * - Local mode: same on-disk layout + filenames as the old diskStorage.
 * Mutates file.path to the final URL/path so controllers keep working unchanged.
 */
const persistFile = async (file) => {
  const subDir = subDirFor(file.mimetype);
  if (isCloudinaryEnabled) {
    try {
      const result = await uploadBufferToCloudinary(file.buffer, {
        folder: `${cloudinaryFolderPrefix}/${subDir}`,
        filename: file.originalname,
      });
      file.cloudinaryUrl = result.secure_url;
      // Needed later by the storage-cleanup job to delete the file.
      // Audio uploads land as resource_type 'video' on Cloudinary.
      file.cloudinaryPublicId = result.public_id;
      file.cloudinaryResourceType = result.resource_type;
      file.path = result.secure_url;
      return result.secure_url;
    } catch (cloudinaryErr) {
      if (isServerless) {
        throw cloudinaryErr;
      }
      console.warn('⚠️ فشل الرفع إلى Cloudinary — جارٍ الحفظ كبديل على القرص المحلي:', cloudinaryErr.message);
    }
  }
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const ext = path.extname(file.originalname);
  const filename = `${file.fieldname}-${uniqueSuffix}${ext}`;
  const dirPath = path.join(uploadDir, subDir);
  fs.mkdirSync(dirPath, { recursive: true });
  const fullPath = path.join(dirPath, filename);
  fs.writeFileSync(fullPath, file.buffer);
  file.destination = dirPath;
  file.filename = filename;
  file.path = fullPath;
  return fullPath;
};

/**
 * Wrap a multer middleware so uploaded buffers are persisted (Cloudinary/disk)
 * before the controller runs. Works with .single/.array/.fields (req.file / req.files).
 */
const withPersistence = (multerMw) => {
  const mw = (req, res, next) => {
    multerMw(req, res, async (err) => {
      if (err) return next(err);
      try {
        const all = [
          ...(req.file ? [req.file] : []),
          ...(Array.isArray(req.files)
            ? req.files
            : Object.values(req.files || {}).flat()),
        ];
        await Promise.all(all.map((f) => (f?.buffer ? persistFile(f) : null)));
        next();
      } catch (uploadErr) {
        console.error('File persistence error:', uploadErr);
        next(uploadErr);
      }
    });
  };
  return mw;
};

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp3', 'audio/mpeg', 'audio/mp4',
    'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/opus', 'audio/3gpp', 'audio/3gpp2', 'audio/amr',
    'video/webm', 'video/mp4',
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`نوع الملف غير مسموح: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024, // 50MB
  },
});

const receiptFileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('صيغة الملف غير مسموحة. يرجى رفع صورة (JPG, PNG, WebP) أو ملف PDF فقط.'), false);
  }
};

const receiptUpload = multer({
  storage,
  fileFilter: receiptFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max for receipts
  },
});

// Same exported names as before — routes/controllers unchanged.
export const uploadAudio = withPersistence(upload.single('audio'));
export const uploadVideo = withPersistence(upload.single('video'));
export const uploadImage = withPersistence(upload.single('image'));
export const uploadDocument = withPersistence(upload.single('document'));
export const uploadReceipt = withPersistence(receiptUpload.single('receipt'));
export const uploadResource = withPersistence(upload.single('resource'));
// Raw multer parse only (no Cloudinary/disk persistence) — used by Google Drive path
export const uploadResourceRaw = upload.single('resource');
export { persistFile };
export const uploadMultipleAudio = withPersistence(upload.array('recordings', 10));
export const uploadHomeworkFiles = withPersistence(upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'files', maxCount: 5 }
]));

/**
 * Verify a browser-uploaded Cloudinary URL before trusting it in the DB.
 * Direct browser uploads (unsigned preset) bypass our server, so we must ensure
 * the URL really points at OUR Cloudinary cloud — otherwise anyone could inject
 * arbitrary external links as "recordings" or "receipts".
 */
export const isTrustedCloudinaryUrl = (url) => {
  if (!url || typeof url !== 'string' || url.length > 2000) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== 'res.cloudinary.com') return false;
  // https://res.cloudinary.com/<cloud_name>/...
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const firstSegment = parsed.pathname.split('/').filter(Boolean)[0];
  if (cloudName && firstSegment !== cloudName) return false;
  return true;
};

/** Sanitize an optional public_id coming from the client (strict charset). */
export const sanitizePublicId = (value) => {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, 300);
  return /^[\w\-/.]+$/.test(trimmed) ? trimmed : undefined;
};

/**
 * Build oralRecordings entries from browser-direct uploads.
 * Accepts the JSON array sent after direct-to-Cloudinary upload:
 *   [{ taskId|questionId, audioUrl, audioPublicId, audioResourceType }]
 * Returns [] when nothing usable was provided (caller falls back to req.files).
 * Every URL must pass isTrustedCloudinaryUrl; publicIds are charset-sanitized.
 */
export const buildDirectRecordings = (list, idField) => {
  if (!Array.isArray(list) || list.length === 0) return [];
  return list
    .filter((r) => r && isTrustedCloudinaryUrl(r.audioUrl))
    .slice(0, 10)
    .map((r) => ({
      [idField]: r[idField] ?? r.taskId ?? r.questionId ?? null,
      audioUrl: r.audioUrl,
      audioPublicId: sanitizePublicId(r.audioPublicId),
      audioResourceType:
        typeof r.audioResourceType === 'string' ? r.audioResourceType.slice(0, 20) : undefined,
    }));
};

export const getFileUrl = (req, filePath) => {
  if (!filePath) return null;
  // Cloudinary (or any absolute) URL: store as-is
  if (/^https?:\/\//i.test(filePath)) return filePath;
  const relativePath = filePath.replace(uploadDir, '').replace(/\\/g, '/');
  return `${req.protocol}://${req.get('host')}/uploads${relativePath}`;
};

/**
 * Delete a stored file by its DB reference (used by the storage-cleanup job).
 * - Cloudinary mode: destroys via publicId (+resourceType).
 * - Local-disk mode: unlinks /uploads/... file (path-traversal guarded).
 * Accepts { url, publicId, resourceType }. Returns true on success or
 * when there is nothing to delete (keeps DB consistent either way).
 */
export const deleteStoredFile = async ({ url, publicId, resourceType } = {}) => {
  if (publicId) {
    return deleteFromCloudinary(publicId, resourceType);
  }
  // Local-disk files are stored as absolute URLs containing '/uploads/...'
  // (Cloudinary URLs never contain that segment).
  if (url && url.includes('/uploads/')) {
    try {
      const relative = url.split('/uploads')[1];
      if (!relative) return true;
      const fullPath = path.normalize(path.join(uploadDir, relative));
      if (!fullPath.startsWith(path.normalize(uploadDir))) return false; // traversal guard
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      return true;
    } catch (err) {
      console.error('Local file delete error:', err?.message || err);
      return false;
    }
  }
  // Remote URL without publicId (legacy): nothing we can delete — treat as done
  // so the job still clears the stale DB reference.
  return true;
};

export default upload;

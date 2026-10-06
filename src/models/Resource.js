import mongoose from 'mongoose';

const resourceSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 200 },
  description: { type: String, maxlength: 500 },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: false }, // فارغ = مكتبة عامة للجميع
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // File info
  fileUrl: { type: String, required: true },
  filePublicId: { type: String },       // Cloudinary public_id
  fileResourceType: { type: String },   // Cloudinary resource_type
  driveFileId: { type: String },        // Google Drive file ID
  storageProvider: { type: String, enum: ['cloudinary', 'google_drive', 'local'], default: 'cloudinary' },
  fileName: { type: String },
  fileType: { type: String, enum: ['pdf', 'video', 'audio', 'image', 'other'], default: 'other' },
  fileSize: { type: Number }, // bytes
  mimeType: { type: String },

  // Category
  category: {
    type: String,
    enum: ['tajweed', 'memorization', 'summary', 'exam_prep', 'other'],
    default: 'other',
  },

  // Stats
  downloadCount: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

resourceSchema.index({ group: 1, createdAt: -1 });
resourceSchema.index({ group: 1, category: 1 });

const Resource = mongoose.model('Resource', resourceSchema);
export default Resource;

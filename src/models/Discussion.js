import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderRole: { type: String, enum: ['student', 'admin', 'teacher', 'parent'], default: 'student' },
  content: { type: String, required: true, maxlength: 3000 },
  type: { type: String, enum: ['text', 'image', 'file', 'system'], default: 'text' },
  fileUrl: { type: String, default: '' },
  replyTo: { type: mongoose.Schema.Types.ObjectId, default: null },
  isPinned: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

const maxArrayLength = (max) => ({
  validator: (v) => !v || v.length <= max,
  message: `Array exceeds maximum length of ${max}`,
});

// Single direct discussion thread per student with Admin
const discussionSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  lastMessage: { type: String, default: '' },
  lastMessageAt: { type: Date, default: Date.now },
  lastSender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  unreadByAdminCount: { type: Number, default: 0 },
  unreadByStudentCount: { type: Number, default: 0 },
  messages: { type: [messageSchema], validate: maxArrayLength(5000) },
  isActive: { type: Boolean, default: true },
  // Optional legacy fields for backward compatibility
  lessonId: { type: String, required: false },
  lessonTitle: { type: String, default: '' },
}, { timestamps: true });

// Indexes for super fast lookups and inbox ordering
discussionSchema.index({ lastMessageAt: -1 });
discussionSchema.index({ unreadByAdminCount: -1 });

const Discussion = mongoose.model('Discussion', discussionSchema);
export default Discussion;

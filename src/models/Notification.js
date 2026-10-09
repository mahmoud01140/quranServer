import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['live_starting', 'exam_scheduled', 'exam', 'result_ready', 'grade_posted', 'group_assigned', 'plan_updated', 'progress_update', 'attendance', 'feedback', 'message', 'general', 'payment_submitted', 'payment_approved', 'payment_rejected', 'discussion_reply', 'session_due'],
    required: true,
  },
  title:   { type: String, required: true },
  body:    { type: String, required: true },
  data:    { type: Object },
  isRead:  { type: Boolean, default: false },
  sentAt:  { type: Date, default: Date.now },
  readAt:  { type: Date },
}, { timestamps: true });

// Polled every ~30s per user: find({ recipient }).sort({ sentAt: -1 }).limit(50)
// Plus mark-all-read: updateMany({ recipient, isRead: false }).
notificationSchema.index({ recipient: 1, sentAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;

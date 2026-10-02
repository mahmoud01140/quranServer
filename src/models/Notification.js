import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['live_starting', 'exam_scheduled', 'exam', 'result_ready', 'grade_posted', 'group_assigned', 'plan_updated', 'progress_update', 'attendance', 'feedback', 'message', 'general', 'payment_submitted', 'payment_approved', 'payment_rejected'],
    required: true,
  },
  title:   { type: String, required: true },
  body:    { type: String, required: true },
  data:    { type: Object },
  isRead:  { type: Boolean, default: false },
  sentAt:  { type: Date, default: Date.now },
  readAt:  { type: Date },
}, { timestamps: true });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;

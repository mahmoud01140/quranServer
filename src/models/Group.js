import mongoose from 'mongoose';

const groupSchema = new mongoose.Schema({
  name: { type: String },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  level: { type: String },
  schedule: [{ dayOfWeek: String, startTime: String, endTime: String }],
  isActive: { type: Boolean, default: false },
}, { timestamps: true });

const Group = mongoose.models.Group || mongoose.model('Group', groupSchema);
export default Group;

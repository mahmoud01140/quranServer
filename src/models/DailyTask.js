import mongoose from 'mongoose';

const quranPortionSchema = new mongoose.Schema({
  surahNumber: { type: Number },
  surahName:   { type: String },
  fromVerse:   { type: Number },
  toVerse:     { type: Number },
  juzNumber:   { type: Number },
  versesCount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['pending', 'completed', 'reviewed'],
    default: 'pending',
  },
  rating: { type: Number, min: 1, max: 5 },
  score:  { type: Number, min: 0, max: 100 },
}, { _id: false });

const dailyTaskSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  group:   { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: false },
  date:    { type: Date, default: Date.now },

  // Pillar 1: New Memorization (الحفظ الجديد - السبق)
  newHifz: { type: quranPortionSchema, default: () => ({}) },

  // Pillar 2: Near Revision / Link (الماضي القريب / السبقي - آخر 5-10 أوجه)
  nearRevision: { type: quranPortionSchema, default: () => ({}) },

  // Pillar 3: Cumulative Revision / Solidification (الماضي البعيد / المحكم والتمكين)
  cumulativeRevision: { type: quranPortionSchema, default: () => ({}) },

  // Pillar 4: Additional Exercise / Training (تدريب إضافي / تجويد / استماع)
  additionalExercise: {
    title:   { type: String },
    details: { type: String },
    status: {
      type: String,
      enum: ['pending', 'completed', 'reviewed'],
      default: 'pending',
    },
    rating: { type: Number, min: 1, max: 5 },
  },

  // Live Session Recitation Link & Mistakes
  evaluatedInLiveSession: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession' },
  mistakesCount: { type: Number, default: 0 },

  // Overall evaluation
  overallStatus: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'reviewed'],
    default: 'pending',
  },
  teacherNotes: { type: String, maxlength: 600 },
  reviewedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt:   { type: Date },
}, { timestamps: true });

dailyTaskSchema.index({ student: 1, date: -1 });
dailyTaskSchema.index({ group: 1, date: -1 });

const DailyTask = mongoose.model('DailyTask', dailyTaskSchema);
export default DailyTask;

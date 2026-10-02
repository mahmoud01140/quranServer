import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  time:     { type: String },
  task:     { type: String },
  duration: { type: Number },
  type: { type: String, enum: ['new_lesson', 'review', 'memorization', 'live_class', 'exam'] },
}, { _id: false });

const dayScheduleSchema = new mongoose.Schema({
  day:   { type: String },
  tasks: [taskSchema],
}, { _id: false });

// Admin-created custom lesson for a specific group
const customLessonSchema = new mongoose.Schema({
  lessonNumber:   { type: Number },
  title:          { type: String, required: true },
  description:    { type: String },
  type: {
    type: String,
    enum: ['reading', 'writing', 'dictation', 'memorization', 'tajweed', 'recitation', 'live_class', 'exam', 'review'],
    default: 'reading',
  },
  duration:       { type: Number, default: 45 },
  isLiveRequired: { type: Boolean, default: false },
  resources:      { type: String },
  videoUrl:       { type: String },
  exam:           { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
  order:          { type: Number, default: 0 },
  // Completion tracking — auto-set when the linked broadcast ends
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed'],
    default: 'pending',
  },
  completedAt:          { type: Date },
  completedBySessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession' },
  // Default homework for this lesson
  defaultHomework:      { type: String },
  defaultQuranHomework: {
    surahName: { type: String },
    fromVerse: { type: Number },
    toVerse:   { type: Number },
    type:      { type: String, enum: ['hifz', 'recitation', 'tajweed', 'exercise'], default: 'hifz' },
  },
}, { timestamps: true });

const studyPlanSchema = new mongoose.Schema({
  group:   { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type:    { type: String, enum: ['group', 'individual'], default: 'group' },

  // Base curriculum template assigned to this group by admin
  curriculum: { type: mongoose.Schema.Types.ObjectId, ref: 'Curriculum' },

  // Lessons added specifically for this group by the admin
  customLessons: [customLessonSchema],

  quranCompletionPlan: {
    targetDate:   { type: Date },
    dailyPages:   { type: Number, default: 1 },
    dailyVerses:  { type: Number, default: 10 },
    reviewDays:   [String],
    currentJuz:   { type: Number, default: 1 },
    completedJuz: [Number],
  },

  weeklySchedule: [dayScheduleSchema],

  parentApproval: {
    parentName:    { type: String },
    parentContact: { type: String },
    approvedAt:    { type: Date },
    notes:         { type: String },
  },
}, { timestamps: true });

const StudyPlan = mongoose.model('StudyPlan', studyPlanSchema);
export default StudyPlan;

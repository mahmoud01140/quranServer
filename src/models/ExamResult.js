import mongoose from 'mongoose';

const examResultSchema = new mongoose.Schema({
  exam:     { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
  student:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  examType: {
    type: String,
    enum: ['placement', 'weekly', 'monthly', 'final', 'oral', 'lesson'],
  },

  // Written answers
  writtenAnswers: [{
    questionId:      { type: mongoose.Schema.Types.ObjectId },
    selectedAnswer:  { type: Number },      // MCQ: option index
    writtenAnswer:   { type: String },      // Written: student's text answer
    isCorrect:       { type: Boolean },
    points:          { type: Number },
  }],
  writtenScore:      { type: Number, default: 0 },
  writtenPercentage: { type: Number, default: 0 },

  // Oral recordings
  // audioPublicId/audioResourceType power the auto-cleanup job that deletes
  // recordings from storage 1 day after admin review (audioUrl is nulled then,
  // scores and notes are kept).
  oralRecordings: [{
    taskId:       { type: mongoose.Schema.Types.Mixed },
    audioUrl:     { type: String },
    audioPublicId: { type: String },
    audioResourceType: { type: String },
    teacherScore: { type: Number },
    teacherNotes: { type: String },
    teacherAudioUrl: { type: String }, // Voice feedback from teacher for this question
  }],
  oralScore:    { type: Number },
  teacherReview: { type: String },
  teacherAudioUrl: { type: String }, // General voice feedback from teacher
  flaggedVerses: [{
    surahNumber: { type: Number },
    surahName:   { type: String },
    verseNumber: { type: Number },
    errorType:   { type: String, enum: ['hifz', 'tajweed', 'tashkeel', 'other'], default: 'hifz' },
    notes:       { type: String },
  }],
  reviewedAt:    { type: Date },
  reviewedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Survey answers (for placement only)
  surveyAnswers: [{
    questionIndex:  { type: Number },
    selectedOption: { type: Number },
    questionText:   { type: String },
    answerText:     { type: String },
  }],

  // Overall result
  totalScore:      { type: Number, default: 0 },
  totalPercentage: { type: Number, default: 0 },
  xpEarned:        { type: Number, default: 0 },
  isPassed:        { type: Boolean, default: false },  // alias used in frontend
  teacherNotes:    { type: String },
  status: {
    type: String,
    enum: ['submitted', 'pending_oral_review', 'reviewed', 'approved'],
    default: 'submitted',
  },
  assignedLevel: {
    type: String,
    enum: ['foundation', 'memorization', 'teacher_prep', 'senior'],
  },

  submittedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Prevent duplicate exam submissions at database level
examResultSchema.index({ exam: 1, student: 1 }, { unique: true });
// Student history queries: find({ student }).sort({ createdAt: -1 })
// (exam-led queries are already served by the unique compound prefix above)
examResultSchema.index({ student: 1, createdAt: -1 });

const ExamResult = mongoose.model('ExamResult', examResultSchema);
export default ExamResult;

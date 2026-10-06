import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  questionNumber:    { type: Number },
  text:              { type: String },
  arabicText:        { type: String },
  type:              { type: String, enum: ['mcq', 'true_false', 'written', 'recitation'], default: 'mcq' },
  options:           [String],
  correctAnswer:     { type: Number },      // index into options (MCQ)
  correctAnswerBool: { type: Boolean },     // correct answer for true/false questions
  correctAnswerText: { type: String },      // correct text answer (written)
  points:            { type: Number, default: 1 },
  instruction:       { type: String },      // instruction for recitation questions
  mode:              { type: String, enum: ['practice', 'quiz'], default: 'practice' },
  surahNumber:       { type: Number },
  fromVerse:         { type: Number },
  toVerse:           { type: Number },
});

const oralTaskSchema = new mongoose.Schema({
  taskNumber:   { type: Number },
  instruction:  { type: String },
  arabicText:   { type: String },
  duration:     { type: Number }, // seconds
  mode:         { type: String, enum: ['practice', 'quiz'], default: 'practice' },
  surahNumber:  { type: Number },
  fromVerse:    { type: Number },
  toVerse:      { type: Number },
});

const examSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  type: {
    type: String,
    enum: ['placement', 'weekly', 'monthly', 'final', 'oral', 'lesson'],
    required: true,
  },
  level: {
    type: String,
    enum: ['foundation', 'memorization', 'teacher_prep', 'senior', 'all'],
  },
  registrationType: {
    type: String,
    enum: ['student', 'teacher', 'senior'],
  },
  targetType: {
    type: String,
    enum: ['level', 'group', 'individual', 'bank'],
    default: 'group',
  },
  targetStudent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  group:        { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  lessonId:     { type: String },            // custom lesson _id
  lessonTitle:  { type: String },            // lesson name for display
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  questions:  [questionSchema],
  oralTasks:  [oralTaskSchema],

  totalPoints:  { type: Number, default: 0 },
  passingScore: { type: Number, default: 60 },
  duration:     { type: Number }, // minutes
  allowRetries: { type: Number, default: 3 }, // Number of retries allowed for lesson activities
  isActive:     { type: Boolean, default: true },
}, { timestamps: true });

examSchema.index({ targetType: 1, targetStudent: 1, group: 1, level: 1 });

const Exam = mongoose.model('Exam', examSchema);
export default Exam;

import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

const attendeeSchema = new mongoose.Schema({
  student:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  joinedAt: { type: Date },
  leftAt:   { type: Date },
  duration: { type: Number },
}, { _id: false });

const attendanceRecordSchema = new mongoose.Schema({
  student:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status:          { type: String, enum: ['present', 'late', 'absent', 'excused'], default: 'absent' },
  markedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  markedAt:        { type: Date, default: Date.now },
  notes:           { type: String },
  joinedAt:        { type: Date },
  leftAt:          { type: Date },
  durationMinutes: { type: Number, default: 0 },
}, { _id: false });

const chatMessageSchema = new mongoose.Schema({
  sender:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: { type: String },
  sentAt:  { type: Date, default: Date.now },
  type:    { type: String, enum: ['text', 'audio', 'question'], default: 'text' },
});

const homeworkSubmissionSchema = new mongoose.Schema({
  student:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedAt:     { type: Date, default: Date.now },
  notes:           { type: String },
  audioUrl:        { type: String },
  files:           [{ name: String, url: String }],
  isChecked:       { type: Boolean, default: false },
  teacherFeedback: { type: String },
  rating:          { type: Number, min: 1, max: 5 },
  earnedPoints:    { type: Number, default: 0 },
});

const recitationTurnSchema = new mongoose.Schema({
  student:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['waiting', 'hand_raised', 'reciting', 'completed', 'skipped'],
    default: 'waiting',
  },
  order:         { type: Number, default: 0 },
  handRaisedAt:  { type: Date },
  startedAt:     { type: Date },
  completedAt:   { type: Date },
  evaluation: {
    score:         { type: Number, min: 0, max: 100 },
    rating:        { type: Number, min: 1, max: 5 },
    mistakesCount: { type: Number, default: 0 },
    notes:         { type: String, maxlength: 600 },
    portionType:   { type: String, enum: ['newHifz', 'nearRevision', 'cumulativeRevision', 'all'], default: 'newHifz' },
    evaluatedAt:   { type: Date },
  },
}, { timestamps: true });

const liveSessionSchema = new mongoose.Schema({
  group:       { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: false },
  student:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lesson:      { type: mongoose.Schema.Types.ObjectId },
  teacher:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:       { type: String, required: true },
  scheduledAt: { type: Date },
  startedAt:   { type: Date },
  endedAt:     { type: Date },
  status: {
    type: String,
    enum: ['scheduled', 'live', 'ended', 'cancelled'],
    default: 'scheduled',
  },

  roomId:       { type: String, unique: true, default: () => uuidv4() },
  recordingUrl: { type: String },
  teacherSocketId: { type: String },
  lastHeartbeat:   { type: Date },
  isRecorded:   { type: Boolean, default: true },

  attendees: [attendeeSchema],
  attendanceRecords: [attendanceRecordSchema],

  // Live Recitation Queue System
  recitationQueue: [recitationTurnSchema],
  currentSpeaker:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  sessionType: {
    type: String,
    enum: ['lesson', 'review', 'recitation', 'exam'],
    default: 'lesson',
  },
  lessonCovered:    { type: mongoose.Schema.Types.Mixed },
  lessonTitle:      { type: String },
  notes:            { type: String },
  homework:         { type: String },
  homeworkDeadline: { type: Date },
  quranHomework: {
    surahNumber: { type: Number },
    surahName:   { type: String },
    fromVerse:   { type: Number },
    toVerse:     { type: Number },
  },

  homeworkSubmissions: [homeworkSubmissionSchema],

  chatMessages: [chatMessageSchema],

  // Shared mushaf state (teacher-driven, polled by student over HTTP)
  sharedMushaf: {
    sharing:   { type: Boolean, default: false },
    surah:     { type: Number, min: 1, max: 114 },
    fromVerse: { type: Number, min: 1 },
    toVerse:   { type: Number, min: 1 },
    updatedAt: { type: Date },
  },
}, { timestamps: true });

const LiveSession = mongoose.model('LiveSession', liveSessionSchema);
export default LiveSession;

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const subscriptionSchema = new mongoose.Schema({
  plan: { type: String, default: 'monthly' },
  status: { type: String, enum: ['trial', 'active', 'expired', 'cancelled', 'pending'], default: 'trial' },
  startDate: Date,
  endDate: Date,
  paymentMethod: { type: String, enum: ['none', 'trial', 'vodafone_cash', 'instapay', 'manual', 'stripe'], default: 'trial' },
  lastPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  // 1 free trial session mechanism
  trialSessionsAttended: { type: Number, default: 0 },
  trialSessionsAllowed: { type: Number, default: 1 },
  lastReminderSentAt: Date,
  stripeCustomerId: String,
  stripeSubscriptionId: String,
}, { _id: false });

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName:  { type: String, required: true, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:     { type: String, trim: true },
  password:  { type: String, required: true, minlength: 6 },
  country:   { type: String },
  dateOfBirth: { type: Date },
  gender:    { type: String, enum: ['male', 'female'] },
  avatar:    { type: String, default: '' },

  role:             { type: String, enum: ['student', 'teacher', 'admin', 'parent'], default: 'student' },
  registrationType: { type: String, enum: ['student', 'teacher', 'senior'] },
  children:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  isVerified: { type: Boolean, default: true },
  isActive:   { type: Boolean, default: true },
  isApproved: { type: Boolean, default: false },

  // Email OTP
  otp:           { type: String },
  otpExpires:    { type: Date },

  // Password reset
  resetToken:    { type: String },
  resetTokenExpires: { type: Date },

  // Placement exam results
  placementExamTaken: { type: Boolean, default: false },
  placementExamScore: { type: Number },
  surveyAnswers: [{ questionId: String, answer: String, questionText: String, answerText: String }],
  oralExamRecordings: [String],
  assignedLevel: { type: String, enum: ['foundation', 'memorization', 'teacher_prep', 'senior'] },
  scheduleDays: [{ type: String }],
  sessionTime: { type: String },

  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },

  subscription: {
    type: subscriptionSchema,
    default: () => ({
      plan: 'monthly',
      status: 'trial',
      trialSessionsAttended: 0,
      trialSessionsAllowed: 1,
    }),
  },

  // Web Push
  pushSubscription: { type: Object },
  notificationPreferences: {
    liveClass:  { type: Boolean, default: true },
    exam:       { type: Boolean, default: true },
    progress:   { type: Boolean, default: true },
  },

  // Gamification & Progress
  points: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  lastActiveDate: { type: Date },
  completedLessons: [{ type: mongoose.Schema.Types.ObjectId }],
  memorizedVerses:  { type: Number, default: 0 },
  totalStudyHours:  { type: Number, default: 0 },
  badges: [{
    title:     { type: String },
    icon:      { type: String },
    awardedAt: { type: Date, default: Date.now }
  }],
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Virtual: full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Remove password from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.otp;
  delete obj.otpExpires;
  delete obj.resetToken;
  delete obj.resetTokenExpires;
  return obj;
};

const User = mongoose.model('User', userSchema);
export default User;

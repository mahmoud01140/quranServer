import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  plan: {
    type: String,
    default: 'monthly',
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'quarterly', 'annual'],
    default: 'monthly',
  },
  amount: {
    type: Number,
    required: true,
  },
  // الدفع بالجنيه المصري فقط — تُبقى القيم القديمة (SAR/USD) في الـ enum
  // حتى تظل المدفوعات التاريخية قابلة للقراءة والحفظ عند المراجعة،
  // بينما تُفرض 'EGP' على كل المدفوعات الجديدة في submitPaymentRequest.
  currency: {
    type: String,
    enum: ['EGP', 'SAR', 'USD'],
    default: 'EGP',
  },
  method: {
    type: String,
    enum: ['vodafone_cash', 'instapay'],
    required: true,
  },
  // Sender details
  senderPhone: {
    type: String,
    trim: true,
  },
  senderName: {
    type: String,
    trim: true,
  },
  referenceNumber: {
    type: String,
    trim: true,
  },
  // Proof of payment
  // receiptPublicId/ResourceType power the auto-cleanup job that deletes the
  // receipt image 30 days after admin review (record metadata is kept).
  // Not required: the cleanup job nulls it after retention, and the record stays.
  receiptUrl: {
    type: String,
  },
  receiptPublicId: { type: String },
  receiptResourceType: { type: String },
  // Review Status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  rejectionReason: {
    type: String,
    trim: true,
  },
  activationDurationDays: {
    type: Number,
    default: 30,
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  reviewedAt: {
    type: Date,
  },
  notes: {
    type: String,
    trim: true,
  },
}, { timestamps: true });

// findOne({ user, status:'pending' }) + student history;
// admin lists filter by status and sort by createdAt.
paymentSchema.index({ user: 1, status: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;

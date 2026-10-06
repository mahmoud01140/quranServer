import mongoose from 'mongoose';

const paymentSettingSchema = new mongoose.Schema({
  // Vodafone Cash settings
  vodafoneCashNumbers: {
    type: [String],
    default: ['01012345678'],
  },
  vodafoneInstructions: {
    type: String,
    default: 'قم بتحويل المبلغ عبر كود *9*7*الرقم*المبلغ# أو تطبيق "أنا فودافون" ثم ارفع صورة إشعار أو رسالة التحويل.',
  },
  vodafoneEnabled: {
    type: Boolean,
    default: true,
  },

  // InstaPay settings
  instaPayAddress: {
    type: String,
    default: 'quran-academy@instapay',
  },
  instaPayPhone: {
    type: String,
    default: '01012345678',
  },
  instaPayAccountName: {
    type: String,
    default: 'أكاديمية تحفيظ القرآن الكريم',
  },
  instaPayInstructions: {
    type: String,
    default: 'قم بالتحويل عبر تطبيق انستاباي (InstaPay) باستخدام العنوان اللحظي (IPA) أو رقم الهاتف الموضح، ثم ارفع صورة إيصال العملية.',
  },
  instaPayEnabled: {
    type: Boolean,
    default: true,
  },

  // Single Unified Subscription Plan (No free plan, 1 plan only)
  plan: {
    name: { type: String, default: 'الاشتراك الشهري في الحلقات' },
    description: { type: String, default: 'اشتراك شهري شامل لحضور كافة الحلقات المباشرة، خطة الحفظ والختم، وتصحيح التلاوات مع المعلم' },
    priceEGP: { type: Number, default: 250 },
    quarterlyDiscountPercent: { type: Number, default: 10 },
    annualDiscountPercent: { type: Number, default: 20 },
  },

  // Free trial lecture settings (1 lecture free on registration)
  freeTrialSessionsCount: {
    type: Number,
    default: 1,
  },

  // Days before expiry to send reminder alert to student
  reminderDaysBeforeExpiry: {
    type: Number,
    default: 3,
  },

  supportPhone: {
    type: String,
    default: '01012345678',
  },
  supportWhatsapp: {
    type: String,
    default: '201012345678',
  },
}, { timestamps: true });

paymentSettingSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

const PaymentSetting = mongoose.model('PaymentSetting', paymentSettingSchema);
export default PaymentSetting;

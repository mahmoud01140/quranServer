import mongoose from 'mongoose';

// Singleton: admin-controlled on/off switch for all notifications.
// - enabled=false pauses EVERYTHING (DB + push) — e.g. maintenance, exams.
// - categories allow fine-grained control per family (all default true).
const notificationSettingSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: true },
  categories: {
    live: { type: Boolean, default: true },       // بدء البث، مواعيد الحصص
    exams: { type: Boolean, default: true },       // امتحانات، نتائج، تقييمات
    payments: { type: Boolean, default: true },    // سداد، اشتراكات
    discussion: { type: Boolean, default: true }, // رسائل المناقشات
    general: { type: Boolean, default: true },    // قبول، خطط، حضور، رسائل عامة
  },
}, { timestamps: true });

notificationSettingSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  // Backfill any category added after the document was first created
  let dirty = false;
  for (const key of ['live', 'exams', 'payments', 'discussion', 'general']) {
    if (settings.categories?.[key] === undefined) {
      settings.categories[key] = true;
      dirty = true;
    }
  }
  if (dirty) await settings.save().catch(() => {});
  return settings;
};

const NotificationSetting = mongoose.model('NotificationSetting', notificationSettingSchema);
export default NotificationSetting;

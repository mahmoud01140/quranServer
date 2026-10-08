import mongoose from 'mongoose';

const scheduleSettingSchema = new mongoose.Schema({
  lectureDuration: {
    type: Number,
    default: 45, // مدة المحاضرة بالدقائق (مثال: 30, 45, 60)
    min: 15,
    max: 180,
  },
  workStartTime: {
    type: String,
    default: '09:00', // ساعة بداية العمل بصيغة HH:mm
  },
  workEndTime: {
    type: String,
    default: '22:00', // ساعة نهاية العمل بصيغة HH:mm
  },
  breakBetweenLectures: {
    type: Number,
    default: 0, // استراحة بين المحاضرات بالدقائق
    min: 0,
    max: 60,
  },
  maxStudentsPerSlot: {
    type: Number,
    default: 1, // الحلقات فردية (طالب واحد لكل موعد لمنع أي تداخل)
    min: 1,
  },
  workingDays: {
    type: [String],
    default: ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'],
  },
  customerServicePhone: {
    type: String,
    default: '201012345678', // رقم واتساب خدمة العملاء بصيغة دولية بدون +
  },
  whatsappMessageTemplate: {
    type: String,
    default: 'السلام عليكم ورحمة الله، أنا الطالب {studentName}، أتممت الامتحان بنجاح وحجزت موعدي في الأيام ({days}) الساعة ({time}). رقم هاتفي: {phone}. برجاء تأكيد الحجز.',
  },
}, { timestamps: true });

const ScheduleSetting = mongoose.model('ScheduleSetting', scheduleSettingSchema);

export default ScheduleSetting;

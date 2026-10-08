import ScheduleSetting from '../models/ScheduleSetting.js';
import User from '../models/User.js';

// Helper: Convert "HH:mm" to minutes from midnight
const timeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Helper: Convert minutes from midnight to "HH:mm"
const minutesToTime = (mins) => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Helper: Get or initialize settings
const getOrCreateSettings = async () => {
  let settings = await ScheduleSetting.findOne();
  if (!settings) {
    settings = await ScheduleSetting.create({});
  }
  return settings;
};

/**
 * جلب إعدادات الجدولة العامة
 * GET /api/schedule/settings
 */
export const getScheduleSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error('Error fetching schedule settings:', error);
    res.status(500).json({ message: 'فشل جلب إعدادات الجدولة' });
  }
};

/**
 * تحديث إعدادات الجدولة (خاص بالأدمن فقط)
 * PUT /api/schedule/settings
 */
export const updateScheduleSettings = async (req, res) => {
  try {
    const {
      lectureDuration,
      workStartTime,
      workEndTime,
      breakBetweenLectures,
      workingDays,
      customerServicePhone,
      whatsappMessageTemplate,
      maxStudentsPerSlot,
    } = req.body;

    let settings = await getOrCreateSettings();

    if (lectureDuration !== undefined) settings.lectureDuration = Number(lectureDuration);
    if (workStartTime !== undefined) settings.workStartTime = workStartTime;
    if (workEndTime !== undefined) settings.workEndTime = workEndTime;
    if (breakBetweenLectures !== undefined) settings.breakBetweenLectures = Number(breakBetweenLectures);
    if (workingDays !== undefined) settings.workingDays = workingDays;
    if (customerServicePhone !== undefined) settings.customerServicePhone = customerServicePhone.replace(/[^\d]/g, '');
    if (whatsappMessageTemplate !== undefined) settings.whatsappMessageTemplate = whatsappMessageTemplate;
    if (maxStudentsPerSlot !== undefined) settings.maxStudentsPerSlot = Number(maxStudentsPerSlot);

    await settings.save();

    res.json({
      success: true,
      message: 'تم تحديث إعدادات الجدولة بنجاح',
      settings,
    });
  } catch (error) {
    console.error('Error updating schedule settings:', error);
    res.status(500).json({ message: 'فشل تحديث إعدادات الجدولة' });
  }
};

/**
 * حساب وإرجاع الأوقات المتاحة لليوم المحدد بناءً على إعدادات الأدمن ومواعيد الطلاب
 * GET /api/schedule/available-slots?day=السبت
 */
export const getAvailableSlots = async (req, res) => {
  try {
    const { day } = req.query;
    const settings = await getOrCreateSettings();

    const duration = settings.lectureDuration || 45;
    const breakTime = settings.breakBetweenLectures || 0;
    const startMins = timeToMinutes(settings.workStartTime || '09:00');
    const endMins = timeToMinutes(settings.workEndTime || '22:00');
    const maxCapacity = settings.maxStudentsPerSlot || 1;

    // 1. حساب جميع الفترات الزمنية الممكنة لليوم
    const allSlots = [];
    let currentMins = startMins;

    while (currentMins + duration <= endMins) {
      const slotStart = minutesToTime(currentMins);
      const slotEnd = minutesToTime(currentMins + duration);
      allSlots.push({
        start: slotStart,
        end: slotEnd,
        label: `${slotStart} - ${slotEnd}`,
        duration,
      });
      currentMins += (duration + breakTime);
    }

    // 2. إذا تم تمرير يوم معين، فحص الطلاب المجدولين في هذا اليوم
    let bookedCountsByTime = {};

    if (day) {
      // استخراج الطلاب النشطين الذين لديهم هذا اليوم محجوز ومحدد لهم وقت
      const currentStudentId = req.user?._id;
      const query = {
        role: 'student',
        isActive: { $ne: false },
        scheduleDays: day,
        sessionTime: { $exists: true, $ne: '' },
      };

      // إذا كان المستخدم طالباً، لا نحتسب حجزه السابق كحاجز ضده لو أراد تغيير موعده
      if (currentStudentId) {
        query._id = { $ne: currentStudentId };
      }

      const busyStudents = await User.find(query).select('sessionTime firstName lastName');

      busyStudents.forEach((student) => {
        const time = student.sessionTime;
        if (time) {
          bookedCountsByTime[time] = (bookedCountsByTime[time] || 0) + 1;
        }
      });
    }

    // 3. تحديد المتاح والمحجوز
    const processedSlots = allSlots.map((slot) => {
      const bookedCount = bookedCountsByTime[slot.start] || 0;
      const isAvailable = bookedCount < maxCapacity;

      return {
        ...slot,
        bookedCount,
        isAvailable,
      };
    });

    res.json({
      success: true,
      day: day || null,
      settings: {
        lectureDuration: settings.lectureDuration,
        workStartTime: settings.workStartTime,
        workEndTime: settings.workEndTime,
        workingDays: settings.workingDays,
        customerServicePhone: settings.customerServicePhone,
      },
      slots: processedSlots,
      availableSlots: processedSlots.filter((s) => s.isAvailable),
    });
  } catch (error) {
    console.error('Error calculating available slots:', error);
    res.status(500).json({ message: 'فشل حساب المواعيد المتاحة' });
  }
};

/**
 * حجز موعد الطالب المباشر وتحديث بياناته وتوليد رابط الواتساب
 * POST /api/schedule/book
 */
export const bookStudentSchedule = async (req, res) => {
  try {
    const studentId = req.user?._id;
    if (!studentId) {
      return res.status(401).json({ message: 'غير مصرح' });
    }

    const { days, sessionTime } = req.body;

    if (!Array.isArray(days) || days.length === 0) {
      return res.status(400).json({ message: 'يرجى اختيار يوم واحد على الأقل للمحاضرات' });
    }

    if (!sessionTime || typeof sessionTime !== 'string') {
      return res.status(400).json({ message: 'يرجى اختيار توقيت المحاضرة' });
    }

    const settings = await getOrCreateSettings();
    const maxCapacity = settings.maxStudentsPerSlot || 1;

    // التحقق من عدم تعارض الموعد في أي من الأيام المختارة مع طلاب آخرين
    for (const day of days) {
      const conflictingStudentsCount = await User.countDocuments({
        _id: { $ne: studentId },
        role: 'student',
        isActive: { $ne: false },
        scheduleDays: day,
        sessionTime: sessionTime,
      });

      if (conflictingStudentsCount >= maxCapacity) {
        return res.status(409).json({
          message: `عذراً، موعد الساعة ${sessionTime} في يوم (${day}) محجوز بالفعل لطالب آخر. يرجى اختيار موعد متاح.`,
        });
      }
    }

    // تحديث بيانات الطالب
    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    student.scheduleDays = days;
    student.sessionTime = sessionTime;
    student.placementExamTaken = true; // تم الامتحان وجدولة الموعد
    await student.save();

    // تجهيز رابط الواتساب لخدمة العملاء
    const phone = settings.customerServicePhone || '201012345678';
    const cleanPhone = phone.replace(/[^\d]/g, '');

    const daysText = days.join('، ');
    const studentFullName = `${student.firstName} ${student.lastName}`.trim();
    const studentPhone = student.phone || 'غير مسجل';

    let messageText = settings.whatsappMessageTemplate ||
      'السلام عليكم ورحمة الله، أنا الطالب {studentName}، قمت بجدولة موعدي بنجاح:\n- الأيام: {days}\n- توقيت المحاضرة: {time}\n- رقم الهاتف: {phone}\nبرجاء تأكيد حجزي.';

    messageText = messageText
      .replace('{studentName}', studentFullName)
      .replace('{days}', daysText)
      .replace('{time}', sessionTime)
      .replace('{phone}', studentPhone);

    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;

    res.json({
      success: true,
      message: 'تم حجز وتثبيت جدولك بنجاح!',
      booking: {
        days,
        sessionTime,
        studentName: studentFullName,
      },
      customerServicePhone: cleanPhone,
      whatsappUrl,
      user: student,
    });
  } catch (error) {
    console.error('Error booking student schedule:', error);
    res.status(500).json({ message: 'فشل حجز الجدول' });
  }
};

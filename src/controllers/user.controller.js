import crypto from 'crypto';
import User from '../models/User.js';
import Group from '../models/Group.js';
import Notification from '../models/Notification.js';
import ExamResult from '../models/ExamResult.js';
import { sendGroupAssignmentEmail } from '../utils/email.js';
import { sendWebPush } from '../utils/webpush.js';

// GET /api/users — admin only
export const getAllUsers = async (req, res) => {
  try {
    const { role, level, status, country, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (level) filter.assignedLevel = level;
    if (status === 'pending') { filter.isApproved = false; }
    if (status === 'active') { filter.isApproved = true; filter.isActive = true; }
    if (status === 'inactive') { filter.isActive = false; }
    if (country) filter.country = country;
    if (search && search.trim()) {
      // ReDoS-safe: escape user input before building RegExp + cap length
      const escaped = search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sRegex = new RegExp(escaped, 'i');
      filter.$or = [
        { firstName: sRegex },
        { lastName: sRegex },
        { email: sRegex },
        { phone: sRegex },
      ];
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-password -otp -otpExpires -resetToken')
      .populate('group', 'name level')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    res.json({ users, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب المستخدمين' });
  }
};

// GET /api/users/pending-approval
export const getPendingApproval = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const filter = { isApproved: false, role: 'student', isActive: { $ne: false } };
    const total = await User.countDocuments(filter);

    let query = User.find(filter)
      .select('-password -otp')
      .sort({ createdAt: -1 });

    if (page && limit) {
      query = query.skip((parseInt(page) - 1) * parseInt(limit)).limit(parseInt(limit));
    }

    const users = await query;
    res.json({
      users,
      total,
      page: page ? parseInt(page) : 1,
      pages: limit ? Math.ceil(total / parseInt(limit)) : 1,
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/users/schedule-map — teacher & admin: lightweight schedule lookup for conflict checks
export const getScheduleMap = async (req, res) => {
  try {
    const students = await User.find({ role: 'student', isActive: { $ne: false } })
      .select('firstName lastName scheduleDays sessionTime')
      .limit(2000);
    res.json({ students });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب خريطة المواعيد' });
  }
};

// GET /api/users/students/list — teacher & admin: students roster for 1-on-1 work
export const getStudentsList = async (req, res) => {
  try {
    const students = await User.find({ role: 'student', isActive: { $ne: false } })
      .select('firstName lastName email phone avatar role assignedLevel scheduleDays sessionTime isApproved country createdAt placementExamScore')
      .sort({ createdAt: -1 })
      .limit(500);
    res.json({ students, total: students.length });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب قائمة الطلاب' });
  }
};

// GET /api/users/students/unassigned
export const getUnassignedStudents = async (req, res) => {
  try {
    const { level, page, limit } = req.query;

    // Show ALL students without a group — including those pending approval
    // Admin needs to see them to assign & optionally approve simultaneously
    const filter = {
      role: 'student',
      $or: [{ group: null }, { group: { $exists: false } }],
    };
    if (level) filter.assignedLevel = level;

    const total = await User.countDocuments(filter);

    let query = User.find(filter)
      .select('firstName lastName email assignedLevel scheduleDays sessionTime country avatar createdAt isApproved isVerified registrationType placementExamTaken placementExamScore oralExamRecordings')
      .sort({ createdAt: -1 });

    if (page && limit) {
      query = query.skip((parseInt(page) - 1) * parseInt(limit)).limit(parseInt(limit));
    }

    const students = await query;
    const studentIds = students.map(s => s._id);

    // Fetch placement exam results for these unassigned students
    const examResults = await ExamResult.find({
      student: { $in: studentIds },
    }).populate('exam', 'title type questions passingScore totalPoints').sort({ createdAt: -1 });

    const resultsMap = {};
    examResults.forEach(r => {
      const isPlacement = r.examType === 'placement' || r.examType === 'oral' || r.exam?.type === 'placement';
      if (!isPlacement) return;
      const sid = r.student.toString();
      // Keep result, prioritizing ones with oral recordings
      if (!resultsMap[sid] || (!resultsMap[sid].oralRecordings?.length && r.oralRecordings?.length)) {
        resultsMap[sid] = r;
      }
    });

    const enrichedStudents = students.map(st => {
      const studentObj = st.toObject ? st.toObject() : JSON.parse(JSON.stringify(st));
      const r = resultsMap[st._id.toString()];

      let audioRecordings = [];
      if (r?.oralRecordings?.length) {
        audioRecordings = r.oralRecordings.map(rec => rec.audioUrl).filter(Boolean);
      }
      if (!audioRecordings.length && st.oralExamRecordings?.length) {
        audioRecordings = st.oralExamRecordings.filter(Boolean);
      }

      const hasTakenExam = Boolean(st.placementExamTaken || r);
      const hasOral = audioRecordings.length > 0;

      studentObj.placementExamInfo = {
        hasTakenExam,
        writtenScore: r?.writtenScore ?? null,
        writtenPercentage: r?.writtenPercentage ?? st.placementExamScore ?? null,
        hasOral,
        audioRecordings,
        status: r?.status || (hasTakenExam ? (hasOral ? 'pending_oral_review' : 'submitted') : 'not_taken'),
        submittedAt: r?.submittedAt || null,
        examTitle: r?.exam?.title || 'امتحان تحديد المستوى',
      };

      return studentObj;
    });

    res.json({
      students: enrichedStudents,
      total,
      page: page ? parseInt(page) : 1,
      pages: limit ? Math.ceil(total / parseInt(limit)) : 1,
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/users/:id
export const getUserById = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض بيانات هذا المستخدم' });
    }
    const user = await User.findById(req.params.id)
      .select('-password -otp -otpExpires -resetToken')
      .populate('group', 'name level schedule teacher');
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// PUT /api/users/:id
export const updateUser = async (req, res) => {
  try {
    // Prevent IDOR: only the user themselves or an admin can update this profile
    if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ message: 'غير مصرح لك بتعديل بيانات هذا المستخدم' });
    }

    // An admin must never demote their own account (would lock everyone out)
    if (
      req.user.role === 'admin' &&
      req.user._id.toString() === req.params.id &&
      req.body.role && req.body.role !== 'admin'
    ) {
      return res.status(400).json({ message: 'لا يمكنك تخفيض صلاحيات حسابك الخاص' });
    }

    const allowedFields = ['firstName', 'lastName', 'phone', 'country', 'avatar', 'notificationPreferences', 'dateOfBirth', 'gender', 'registrationType'];
    const updates = {};
    allowedFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    // وحّد رقم الهاتف عند التعديل (مهم لإضافة هواتف الحسابات القديمة) — مع رفض الصيغ الباطلة
    // المسح التام عبر $unset (لا null) حتى لا يتعارض مع unique index
    let unsetPhone = false;
    if (updates.phone !== undefined) {
      const { normalizePhone } = await import('../models/User.js');
      if (updates.phone && !normalizePhone(updates.phone)) {
        return res.status(400).json({ message: 'رقم الهاتف غير صالح — أدخل رقماً مصرياً (01xxxxxxxxx)' });
      }
      const normalized = normalizePhone(updates.phone);
      if (normalized) {
        updates.phone = normalized;
      } else {
        delete updates.phone;
        unsetPhone = true;
      }
    }

    // Admin can update role
    if (req.user.role === 'admin' && req.body.role) updates.role = req.body.role;
    if (req.user.role === 'admin' && req.body.isActive !== undefined) updates.isActive = req.body.isActive;

    const updateDoc = unsetPhone ? { $set: updates, $unset: { phone: 1 } } : updates;
    const user = await User.findByIdAndUpdate(req.params.id, updateDoc, { new: true })
      .select('-password -otp');
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
    res.json({ message: 'تم التحديث بنجاح', user });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في التحديث' });
  }
};

// PUT /api/users/:id/reset-password — admin only
// تعيين كلمة مرور مؤقتة لمستخدم نسيها (بديل الاستعادة بالبريد لمستخدمي الهاتف).
// تُعرض مرة واحدة للأدمن لإيصالها للطالب — غيّرها الطالب بعد الدخول.
export const resetUserPassword = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('+password');
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
    if (user.role === 'admin' && req.user._id.toString() !== user._id.toString()) {
      return res.status(403).json({ message: 'لا يمكن تعيين كلمة مرور لأدمن آخر' });
    }

    const customPassword = req.body?.password;
    if (customPassword) {
      if (typeof customPassword !== 'string' || customPassword.length < 6) {
        return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
      }
      user.password = customPassword;
      user.resetToken = undefined;
      user.resetTokenExpires = undefined;
      await user.save();
      return res.json({
        message: `تم تحديث كلمة المرور لـ ${user.firstName} ${user.lastName} بنجاح`,
      });
    }

    const tempPassword = crypto.randomBytes(4).toString('hex'); // 8 أحرف
    user.password = tempPassword;
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save(); // pre-save hook يشفرها تلقائياً
    res.json({
      message: `تم تعيين كلمة مرور مؤقتة لـ ${user.firstName} ${user.lastName} — أوصلها له واطلب منه تغييرها بعد الدخول`,
      tempPassword,
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تعيين كلمة المرور' });
  }
};

// PUT /api/users/:id/approve — admin only
export const approveUser = async (req, res) => {
  try {
    const { assignedLevel, scheduleDays, sessionTime } = req.body;
    const LEVEL_ENUM = ['foundation', 'memorization', 'teacher_prep', 'senior'];
    if (!assignedLevel || !LEVEL_ENUM.includes(assignedLevel)) {
      return res.status(400).json({ message: 'حدد مستوى صحيحاً قبل القبول (التأسيس / التحفيظ / إعداد معلم / كبار السن)' });
    }

    const updateFields = {
      isApproved: true,
      assignedLevel,
    };
    if (Array.isArray(scheduleDays)) updateFields.scheduleDays = scheduleDays;
    if (sessionTime) updateFields.sessionTime = sessionTime;

    // منع حجز نفس اليوم والساعة لطالبين (مصدر الحقيقة — الواجهة تتحقق مسبقاً أيضاً)
    if (Array.isArray(scheduleDays) && scheduleDays.length && sessionTime) {
      const clash = await User.findOne({
        _id: { $ne: req.params.id },
        role: 'student',
        isActive: { $ne: false },
        scheduleDays: { $in: scheduleDays },
        sessionTime,
      }).select('firstName lastName scheduleDays sessionTime');
      if (clash) {
        const clashDay = (clash.scheduleDays || []).find(d => scheduleDays.includes(d)) || scheduleDays[0];
        return res.status(409).json({
          message: `تعارض في الموعد: الطالب ${clash.firstName} ${clash.lastName} محجوز مسبقاً يوم ${clashDay} الساعة ${clash.sessionTime} — اختر وقتاً آخر`,
          conflict: {
            studentId: clash._id,
            studentName: `${clash.firstName} ${clash.lastName}`,
            day: clashDay,
            sessionTime: clash.sessionTime,
          },
        });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });

    // Send notification (DB + Web Push; frontend polls — no socket.io)
    const scheduleDesc = (user.scheduleDays?.length ? `أيامك: ${user.scheduleDays.join('، ')}` : '') + (user.sessionTime ? ` الساعة ${user.sessionTime}` : '');
    const notification = await Notification.create({
      recipient: user._id,
      type: 'general',
      title: 'تم اعتماد حسابك وجدولة مواعيدك بنجاح ✅',
      body: `مرحباً ${user.firstName}! تم اعتماد مستواك ومواعيدك للبث المباشر الفردي. ${scheduleDesc}`,
    });
    if (user.pushSubscription) {
      await sendWebPush(user.pushSubscription, notification.title, notification.body);
    }

    res.json({ message: 'تم قبول الطالب وتحديد مستواه ومواعيده', user });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في القبول' });
  }
};

// DELETE /api/users/:id — admin only (permanent)
export const deleteUser = async (req, res) => {
  try {
    // An admin must never delete their own account
    if (req.user._id.toString() === req.params.id) {
      return res.status(400).json({ message: 'لا يمكنك حذف حسابك الخاص' });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
    // Free the group seat so member counts stay correct
    if (user.group) {
      await Group.findByIdAndUpdate(user.group, { $pull: { students: user._id } });
    }
    res.json({ message: 'تم حذف المستخدم نهائياً' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الحذف' });
  }
};

// GET /api/users/me/attendance-stats
export const getMyAttendanceStats = async (req, res) => {
  try {
    const studentId = req.user._id;
    const user = await User.findById(studentId);
    if (!user || !user.group) {
      return res.json({ attendanceRate: 100, attendedCount: 0, totalSessions: 0, history: [] });
    }

    const LiveSession = (await import('../models/LiveSession.js')).default;
    const sessions = await LiveSession.find({
      group: user.group,
      status: { $in: ['ended', 'live'] }
    }).sort({ startedAt: -1 }).limit(25);

    let attendedCount = 0;
    const history = [];

    sessions.forEach(session => {
      const rec = session.attendanceRecords?.find(r => r.student?.toString() === studentId.toString());
      const isAttendee = session.attendees?.some(a => a.student?.toString() === studentId.toString());

      let status = 'absent';
      if (rec) {
        status = rec.status;
      } else if (isAttendee) {
        status = 'present';
      }

      if (['present', 'late', 'excused'].includes(status)) {
        attendedCount++;
      }

      history.push({
        sessionId: session._id,
        sessionTitle: session.title,
        date: session.startedAt || session.scheduledAt || session.createdAt,
        status,
        notes: rec?.notes || ''
      });
    });

    const totalSessions = sessions.length;
    const attendanceRate = totalSessions > 0 ? Math.round((attendedCount / totalSessions) * 100) : 100;

    res.json({
      attendanceRate,
      attendedCount,
      totalSessions,
      history
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب إحصائيات الحضور' });
  }
};

// PUT /api/users/:id/push-subscription
export const updatePushSubscription = async (req, res) => {
  try {
    // Prevent IDOR: only the user themselves or an admin can update this subscription
    if (req.user.role !== 'admin' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ message: 'غير مصرح لك بتعديل اشتراك هذا المستخدم' });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { pushSubscription: req.body.subscription },
      { new: true }
    ).select('_id');
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
    res.json({ message: 'تم تحديث اشتراك الإشعارات' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

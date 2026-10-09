import User from '../models/User.js';
import ExamResult from '../models/ExamResult.js';
import LiveSession from '../models/LiveSession.js';
import DailyTask from '../models/DailyTask.js';
import Payment from '../models/Payment.js';
import { evaluateUserSubscription } from './payment.controller.js';

// Helper to generate secure random 6-digit code
const generate6DigitCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// GET /api/parents/my-link-code (Student gets or creates their 6-digit link code)
export const getMyLinkCode = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const linkedParents = await User.find({
      role: 'parent',
      children: req.user._id
    }).select('firstName lastName phone email');

    const formattedParents = linkedParents.map(p => ({
      _id: p._id,
      name: `${p.firstName} ${p.lastName}`.trim(),
      phone: p.phone,
      email: p.email
    }));

    const now = new Date();
    // If student already has a valid code (valid for 14 days), reuse it
    if (user.parentLinkCode && user.parentLinkCodeExpires && user.parentLinkCodeExpires > now) {
      return res.json({
        code: user.parentLinkCode,
        expiresAt: user.parentLinkCodeExpires,
        linkedParents: formattedParents,
      });
    }

    // Otherwise generate a fresh code
    const code = generate6DigitCode();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days validity

    user.parentLinkCode = code;
    user.parentLinkCodeExpires = expiresAt;
    await user.save();

    res.json({
      code,
      expiresAt,
      linkedParents: formattedParents,
    });
  } catch (error) {
    console.error('Error in getMyLinkCode:', error);
    res.status(500).json({ message: 'خطأ في توليد رمز ربط ولي الأمر' });
  }
};

// POST /api/parents/regenerate-link-code (Student regenerates a fresh 6-digit code)
export const regenerateLinkCode = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const linkedParents = await User.find({
      role: 'parent',
      children: req.user._id
    }).select('firstName lastName phone email');

    const formattedParents = linkedParents.map(p => ({
      _id: p._id,
      name: `${p.firstName} ${p.lastName}`.trim(),
      phone: p.phone,
      email: p.email
    }));

    const code = generate6DigitCode();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    user.parentLinkCode = code;
    user.parentLinkCodeExpires = expiresAt;
    await user.save();

    res.json({
      message: 'تم تجديد رمز الربط بنجاح',
      code,
      expiresAt,
      linkedParents: formattedParents,
    });
  } catch (error) {
    console.error('Error in regenerateLinkCode:', error);
    res.status(500).json({ message: 'خطأ في تجديد رمز الربط' });
  }
};

// GET /api/parents/children
export const getChildren = async (req, res) => {
  try {
    const parent = await User.findById(req.user._id).populate({
      path: 'children',
      select: 'firstName lastName email phone assignedLevel scheduleDays sessionTime points completedLessons memorizedVerses avatar group subscription isApproved',
      populate: {
        path: 'group',
        select: 'name level schedule teacher',
        populate: { path: 'teacher', select: 'firstName lastName avatar phone' }
      }
    });

    if (!parent) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    res.json({ children: parent.children || [] });
  } catch (error) {
    console.error('Error fetching children:', error);
    res.status(500).json({ message: 'خطأ في جلب بيانات الأبناء' });
  }
};

// POST /api/parents/children
export const linkChild = async (req, res) => {
  try {
    const { linkCode, childEmail, childPhone } = req.body;

    let child = null;

    // 1. If 6-digit linkCode provided (Primary recommended flow)
    const trimmedCode = linkCode?.toString().replace(/\s+/g, '').trim();
    if (trimmedCode) {
      const now = new Date();
      child = await User.findOne({
        parentLinkCode: trimmedCode,
        parentLinkCodeExpires: { $gt: now },
        role: 'student'
      });

      if (!child) {
        return res.status(400).json({
          message: 'رمز الربط غير صحيح أو انتهت صلاحيته. يرجى التحقق من الرمز في حساب الابن.'
        });
      }
    } else if (childEmail?.trim()) {
      // 2. Fallback: by childEmail
      child = await User.findOne({
        email: childEmail.trim().toLowerCase(),
        role: 'student'
      });

      if (!child) {
        return res.status(404).json({ message: 'لم يتم العثور على طالب مسجل بهذا البريد الإلكتروني' });
      }

      // Security Verification: If child has a phone registered and input provided, verify match
      if (child.phone && childPhone?.trim()) {
        const normalizedChildPhone = child.phone.replace(/[\s\-\+]/g, '');
        const normalizedInputPhone = childPhone.trim().replace(/[\s\-\+]/g, '');
        if (!normalizedChildPhone.endsWith(normalizedInputPhone) && !normalizedInputPhone.endsWith(normalizedChildPhone)) {
          return res.status(400).json({ message: 'رقم هاتف الطالب غير متطابق مع البيانات المسجلة' });
        }
      }
    } else {
      return res.status(400).json({ message: 'يرجى إدخال رمز الربط أو البريد الإلكتروني للابن' });
    }

    const parent = await User.findById(req.user._id);
    if (parent.children.some(c => c.toString() === child._id.toString())) {
      return res.status(400).json({ message: 'هذا الابن مرتبط بحسابك بالفعل' });
    }

    parent.children.push(child._id);
    await parent.save();

    // Create a notification for the student (dispatcher honors admin switch)
    try {
      const { notifyUser } = await import('../utils/notify.js');
      await notifyUser({
        recipient: child._id,
        type: 'general',
        title: 'تم ربط حسابك بولي أمر 👨‍👩‍👧',
        body: `قام ولي الأمر (${parent.firstName} ${parent.lastName}) بربط حسابك لمتابعة أدائك في الحلقات والورد القرآني.`,
        data: { parentId: parent._id },
        push: false,
      });
    } catch (notifErr) {
      console.warn('Could not send student linking notification:', notifErr.message);
    }

    await child.populate({
      path: 'group',
      select: 'name level teacher',
      populate: { path: 'teacher', select: 'firstName lastName avatar phone' }
    });

    res.status(200).json({
      message: `تم ربط الابن (${child.firstName} ${child.lastName}) بنجاح!`,
      child: {
        _id: child._id,
        firstName: child.firstName,
        lastName: child.lastName,
        email: child.email,
        phone: child.phone,
        assignedLevel: child.assignedLevel,
        scheduleDays: child.scheduleDays || [],
        sessionTime: child.sessionTime || '',
        group: child.group
      }
    });
  } catch (error) {
    console.error('Error linking child:', error);
    res.status(500).json({ message: 'خطأ في ربط الابن' });
  }
};

// DELETE /api/parents/children/:id
export const unlinkChild = async (req, res) => {
  try {
    const { id } = req.params;
    const parent = await User.findById(req.user._id);

    if (!parent.children.some(c => c.toString() === id.toString())) {
      return res.status(400).json({ message: 'هذا الابن غير مرتبط بحسابك' });
    }

    parent.children = parent.children.filter(childId => childId.toString() !== id.toString());
    await parent.save();

    res.json({ message: 'تم إلغاء ربط الابن بنجاح' });
  } catch (error) {
    console.error('Error unlinking child:', error);
    res.status(500).json({ message: 'خطأ في إلغاء ربط الابن' });
  }
};

// GET /api/parents/children/:id/progress
export const getChildProgress = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const parent = await User.findById(req.user._id);
    if (!parent.children?.some(c => c.toString() === id.toString())) {
      return res.status(403).json({ message: 'غير مصرح لك بالوصول لبيانات هذا الطالب' });
    }

    const student = await User.findById(id).populate({
      path: 'group',
      select: 'name level schedule teacher',
      populate: { path: 'teacher', select: 'firstName lastName avatar phone' }
    });

    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود' });
    }

    // 1. Subscription & Payments status
    const subscription = await evaluateUserSubscription(student);
    const recentPayments = await Payment.find({ user: id })
      .select('amount billingCycle status createdAt receiptUrl referenceNumber method')
      .sort({ createdAt: -1 })
      .limit(5);

    // 2. Daily Quran Tasks (الورد القرآني الحقيقي)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const latestTasks = await DailyTask.find({ student: id })
      .populate('reviewedBy', 'firstName lastName')
      .sort({ date: -1, createdAt: -1 })
      .limit(7);

    const todayTask = latestTasks.find(t => {
      const d = new Date(t.date || t.createdAt);
      d.setHours(0, 0, 0, 0);
      return d.getTime() === today.getTime();
    }) || latestTasks[0] || null;

    // 3. Attendance & Today's Live Session
    let attendanceRate = 100;
    let totalClassesCount = 0;
    let attendedClassesCount = 0;
    let todaySessionInfo = null;

    const queryGroup = student.group?._id ? { group: student.group._id } : null;
    const queryStudent = {
      $or: [
        ...(queryGroup ? [queryGroup] : []),
        { 'attendanceRecords.student': student._id },
        { 'attendees.student': student._id }
      ]
    };

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const todaySession = await LiveSession.findOne({
      ...queryStudent,
      $or: [
        { status: 'live' },
        { startedAt: { $gte: startOfToday, $lte: endOfToday } },
        { scheduledAt: { $gte: startOfToday, $lte: endOfToday } }
      ]
    }).sort({ startedAt: -1, scheduledAt: -1 });

    if (todaySession) {
      const rec = todaySession.attendanceRecords?.find(r => r.student?.toString() === id);
      const isAttendee = todaySession.attendees?.some(a => a.student?.toString() === id);

      let attStatus = 'not_started';
      if (rec) {
        attStatus = rec.status; // present, late, absent, excused
      } else if (isAttendee) {
        attStatus = 'present';
      } else if (todaySession.status === 'live') {
        attStatus = 'in_progress';
      } else if (todaySession.status === 'ended') {
        attStatus = 'absent';
      }

      todaySessionInfo = {
        sessionId: todaySession._id,
        title: todaySession.title || 'الحلقة المباشرة',
        sessionStatus: todaySession.status,
        startedAt: todaySession.startedAt || todaySession.scheduledAt,
        attendanceStatus: attStatus,
        notes: rec?.notes || ''
      };
    }

    const pastSessions = await LiveSession.find({
      ...queryStudent,
      status: 'ended'
    }).sort({ startedAt: -1 }).limit(20);

    totalClassesCount = pastSessions.length;
    pastSessions.forEach(session => {
      const rec = session.attendanceRecords?.find(r => r.student?.toString() === id);
      const isAttendee = session.attendees?.some(a => a.student?.toString() === id);
      const status = rec ? rec.status : isAttendee ? 'present' : 'absent';
      if (['present', 'late', 'excused'].includes(status)) {
        attendedClassesCount++;
      }
    });

    if (totalClassesCount > 0) {
      attendanceRate = Math.round((attendedClassesCount / totalClassesCount) * 100);
    }

    // 4. Exam Results
    const examResults = await ExamResult.find({ student: id })
      .populate('exam', 'title type passingScore totalPoints')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ submittedAt: -1 })
      .limit(10);

    // 5. Smart Alerts
    const alerts = [];
    if (totalClassesCount >= 3 && attendanceRate < 75) {
      alerts.push({
        type: 'attendance',
        severity: 'danger',
        title: 'غياب متكرر وحضور منخفض ⚠️',
        message: `نسبة حضور الابن في الحلقات المباشرة انخفضت إلى ${attendanceRate}% (حضر ${attendedClassesCount} من آخر ${totalClassesCount} حلقات).`
      });
    }

    if (subscription?.isExpired) {
      alerts.push({
        type: 'subscription',
        severity: 'danger',
        title: 'الاشتراك منتهي 💳',
        message: 'انتهت مدة اشتراك الابن. يرجى تجديد الاشتراك ليتمكن من الاستمرار في حضور الحلقات.'
      });
    } else if (subscription?.isExpiringSoon) {
      alerts.push({
        type: 'subscription',
        severity: 'warning',
        title: 'الاشتراك قارب على الانتهاء ⏳',
        message: `متبقي ${subscription.daysRemaining} أيام على نهاية اشتراك الابن.`
      });
    }

    const latestTeacherNote = todayTask?.teacherNotes || latestTasks.find(t => t.teacherNotes)?.teacherNotes || '';

    res.json({
      student: {
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        phone: student.phone,
        assignedLevel: student.assignedLevel,
        scheduleDays: student.scheduleDays || [],
        sessionTime: student.sessionTime || '',
        points: student.points || 0,
        avatar: student.avatar,
        teacher: student.group?.teacher || null,
        groupName: student.group?.name || null,
      },
      subscription,
      recentPayments,
      todayTask,
      latestTasks,
      latestTeacherNote,
      attendance: {
        rate: attendanceRate,
        totalClasses: totalClassesCount,
        attendedClasses: attendedClassesCount,
        todaySession: todaySessionInfo,
      },
      examResults,
      alerts
    });
  } catch (error) {
    console.error('Error in getChildProgress:', error);
    res.status(500).json({ message: 'خطأ في جلب تفاصيل تقدم الابن' });
  }
};

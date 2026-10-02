import User from '../models/User.js';
import ExamResult from '../models/ExamResult.js';
import LiveSession from '../models/LiveSession.js';

// GET /api/parents/children
export const getChildren = async (req, res) => {
  try {
    const parent = await User.findById(req.user._id).populate({
      path: 'children',
      select: 'firstName lastName email assignedLevel points completedLessons memorizedVerses totalStudyHours avatar group',
      populate: { path: 'group', select: 'name level schedule teacher' }
    });

    if (!parent) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    res.json({ children: parent.children || [] });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب بيانات الأبناء' });
  }
};

// POST /api/parents/children
export const linkChild = async (req, res) => {
  try {
    const { childEmail, childPhone } = req.body;
    if (!childEmail?.trim()) {
      return res.status(400).json({ message: 'البريد الإلكتروني للابن مطلوب' });
    }

    const child = await User.findOne({
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

    const parent = await User.findById(req.user._id);
    if (parent.children.includes(child._id)) {
      return res.status(400).json({ message: 'هذا الابن مرتبط بحسابك بالفعل' });
    }

    parent.children.push(child._id);
    await parent.save();

    // Create a notification for the student
    try {
      const Notification = (await import('../models/Notification.js')).default;
      await Notification.create({
        recipient: child._id,
        type: 'general',
        title: 'تم ربط حسابك بولي أمر 👨‍👩‍👧',
        body: `قام ولي الأمر (${parent.firstName} ${parent.lastName}) بربط حسابك لمتابعة أدائك في الحلقات وحفظ القرآن.`,
        data: { parentId: parent._id }
      });
    } catch (notifErr) {
      console.warn('Could not send student linking notification:', notifErr.message);
    }

    // Populate group details for child to return
    await child.populate('group', 'name level');

    res.status(200).json({
      message: 'تم ربط الابن بنجاح',
      child: {
        _id: child._id,
        firstName: child.firstName,
        lastName: child.lastName,
        email: child.email,
        assignedLevel: child.assignedLevel,
        group: child.group
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في ربط الابن' });
  }
};

// DELETE /api/parents/children/:id
export const unlinkChild = async (req, res) => {
  try {
    const { id } = req.params;
    const parent = await User.findById(req.user._id);

    if (!parent.children.includes(id)) {
      return res.status(400).json({ message: 'هذا الابن غير مرتبط بحسابك' });
    }

    parent.children = parent.children.filter(childId => childId.toString() !== id);
    await parent.save();

    res.json({ message: 'تم إلغاء ربط الابن بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إلغاء ربط الابن' });
  }
};

// GET /api/parents/children/:id/progress
export const getChildProgress = async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const parent = await User.findById(req.user._id);
    if (!parent.children.includes(id)) {
      return res.status(403).json({ message: 'غير مصرح لك بالوصول لبيانات هذا الطالب' });
    }

    const student = await User.findById(id).populate('group', 'name level schedule teacher');
    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود' });
    }

    // 1. Weekly stats (daily records feature deleted → zeros, shape kept)
    const weeklyRecords = [];
    const totalVersesMemorized = 0;
    const totalVersesReviewed = 0;

    // Last records list (feature deleted → empty, shape kept)
    const recentRecords = [];

    // 2. Attendance reports & Today's session status
    let attendanceRate = 100;
    let totalClassesCount = 0;
    let attendedClassesCount = 0;
    let attendanceDetails = [];
    let todaySessionInfo = null;

    if (student.group) {
      // 2.1 Check Today's session
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);

      const todaySession = await LiveSession.findOne({
        group: student.group._id,
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
          title: todaySession.title,
          sessionStatus: todaySession.status,
          startedAt: todaySession.startedAt || todaySession.scheduledAt,
          attendanceStatus: attStatus,
          notes: rec?.notes || ''
        };
      }

      // 2.2 Calculate overall attendance from past ended sessions
      const endedSessions = await LiveSession.find({
        group: student.group._id,
        status: 'ended'
      }).sort({ startedAt: -1 }).limit(20);

      totalClassesCount = endedSessions.length;
      endedSessions.forEach(session => {
        const rec = session.attendanceRecords?.find(r => r.student?.toString() === id);
        const isAttendee = session.attendees?.some(a => a.student?.toString() === id);

        let finalStatus = 'absent';
        if (rec) {
          finalStatus = rec.status;
        } else if (isAttendee) {
          finalStatus = 'present';
        }

        if (finalStatus === 'present' || finalStatus === 'late' || finalStatus === 'excused') {
          attendedClassesCount++;
        }

        attendanceDetails.push({
          sessionId: session._id,
          title: session.title,
          date: session.startedAt || session.scheduledAt,
          status: finalStatus,
          notes: rec?.notes || ''
        });
      });

      if (totalClassesCount > 0) {
        attendanceRate = Math.round((attendedClassesCount / totalClassesCount) * 100);
      }
    }

    // 3. Test Results
    const examResults = await ExamResult.find({ student: id })
      .populate('exam', 'title type passingScore totalPoints')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ submittedAt: -1 });

    // 3.5 Homework: محذوف نهائياً من النظام — يعتمد على الامتحانات فقط
    const homeworkDetails = [];

    // 4. Low Performance Alerts
    const alerts = [];

    // Alert: Low attendance
    if (totalClassesCount >= 3 && attendanceRate < 75) {
      alerts.push({
        type: 'attendance',
        severity: 'danger',
        title: 'غياب متكرر وحضور منخفض ⚠️',
        message: `نسبة حضور الابن في الحلقات المباشرة انخفضت إلى ${attendanceRate}% (حضر ${attendedClassesCount} من أصل آخر ${totalClassesCount} حلقات).`
      });
    }

    // Alert: Failed exams
    const failedExams = examResults.filter(r => r.status === 'reviewed' && !r.isPassed);
    failedExams.forEach(result => {
      alerts.push({
        type: 'exam',
        severity: 'warning',
        title: 'إخفاق في اختبار 📝',
        message: `حصل الابن على نتيجة (${result.totalPercentage}%) في اختبار "${result.exam?.title}" وهي دون درجة النجاح المطلوبة (${result.exam?.passingScore || 60}%).`
      });
    });

    // Alert: session feedback removed with the feature (no-op)

    res.json({
      student: {
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        assignedLevel: student.assignedLevel,
        points: student.points,
        completedLessons: student.completedLessons,
        memorizedVerses: student.memorizedVerses,
        totalStudyHours: student.totalStudyHours,
        avatar: student.avatar,
        group: student.group
      },
      stats: {
        totalVersesMemorized,
        totalVersesReviewed,
        weeklyRecordsCount: weeklyRecords.length
      },
      attendance: {
        rate: attendanceRate,
        totalClasses: totalClassesCount,
        attendedClasses: attendedClassesCount,
        todaySession: todaySessionInfo,
        history: attendanceDetails
      },
      examResults,
      alerts,
      recentRecords,
      homework: homeworkDetails
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب تفاصيل تقدم الابن' });
  }
};

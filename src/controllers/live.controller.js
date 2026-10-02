import crypto from 'crypto';
import LiveSession from '../models/LiveSession.js';
import Group from '../models/Group.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { sendWebPush } from '../utils/webpush.js';
import { evaluateUserSubscription } from './payment.controller.js';

export const getSecureLiveRoomName = (sessionId) => {
  const secret = process.env.JWT_SECRET || 'live_quran_platform_secret';
  const hash = crypto.createHmac('sha256', secret).update(sessionId.toString()).digest('hex').substring(0, 18);
  return `quran_${hash}`;
};


// GET /api/live/group/:groupId
export const getGroupSessions = async (req, res) => {
  try {
    const sessions = await LiveSession.find({ group: req.params.groupId })
      .populate('teacher', 'firstName lastName avatar')
      .sort({ scheduledAt: -1 })
      .limit(20);
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/live/mine — student's own 1-on-1 sessions history (individual system)
export const getMySessions = async (req, res) => {
  try {
    const sessions = await LiveSession.find({ student: req.user._id })
      .select('title status startedAt endedAt scheduledAt teacher student attendees attendanceRecords homework quranHomework homeworkDeadline homeworkSubmissions lessonCovered lessonTitle createdAt')
      .populate('teacher', 'firstName lastName avatar')
      .sort({ startedAt: -1, createdAt: -1 })
      .limit(50);
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب حصصك' });
  }
};

// POST /api/live
export const createSession = async (req, res) => {
  try {
    const { groupId, title, scheduledAt, sessionType, notes, homework, homeworkDeadline, quranHomework, lessonCovered, lessonTitle } = req.body;

    if (!groupId || !title?.trim()) {
      return res.status(400).json({ message: 'معرّف المجموعة وعنوان الجلسة مطلوبان' });
    }

    // Verify teacher owns the group if not admin
    if (req.user.role === 'teacher') {
      const groupCheck = await Group.findById(groupId).select('teacher');
      if (!groupCheck || groupCheck.teacher?.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'غير مصرح لك بإنشاء جلسة لهذه المجموعة' });
      }
    }

    let finalHomework = homework;
    let finalQuranHomework = quranHomework;
    if (!finalHomework && lessonCovered) {
      try {
        const StudyPlan = (await import('../models/StudyPlan.js')).default;
        const plan = await StudyPlan.findOne({ group: groupId, type: 'group' });
        const lesson = plan?.customLessons?.id(lessonCovered);
        if (lesson?.defaultHomework) finalHomework = lesson.defaultHomework;
        if (!finalQuranHomework && lesson?.defaultQuranHomework?.surahName) finalQuranHomework = lesson.defaultQuranHomework;
      } catch (_) {}
    }

    const session = await LiveSession.create({
      group: groupId,
      teacher: req.user._id,
      title,
      scheduledAt,
      sessionType: sessionType || 'lesson',
      lessonCovered: lessonCovered || undefined,
      lessonTitle: lessonTitle || title,
      notes,
      homework: finalHomework,
      homeworkDeadline: homeworkDeadline || undefined,
      quranHomework: finalQuranHomework,
    });

    // Notify group students
    const group = await Group.findById(groupId).populate('students', 'pushSubscription firstName');
    const io = req.app.get('io');

    const notifications = group.students.map(student =>
      Notification.create({
        recipient: student._id,
        type: 'live_starting',
        title: `📅 جلسة مجدولة: ${title}`,
        body: `تم تحديد جلسة بتاريخ ${new Date(scheduledAt).toLocaleDateString('ar')}`,
        data: { sessionId: session._id },
      })
    );
    await Promise.all(notifications);

    group.students.forEach(student => {
      if (io) io.emitToUser(student._id, 'session-scheduled', { sessionId: session._id });
    });

    const sessionObj = session.toObject ? session.toObject() : { ...session };
    sessionObj.liveRoomName = getSecureLiveRoomName(session._id);

    res.status(201).json({ message: 'تم إنشاء الجلسة', session: sessionObj });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إنشاء الجلسة' });
  }
};

// GET /api/live/active/me (get currently live session)
export const getActiveSession = async (req, res) => {
  try {
    const user = req.user;
    const subStatus = await evaluateUserSubscription(user);

    if (user.role === 'student') {
      // 1. Look for individual 1-on-1 live session with admin
      const indSession = await LiveSession.findOne({ status: 'live', student: user._id })
        .populate('teacher', 'firstName lastName avatar')
        .sort({ startedAt: -1 });

      if (indSession) {
        const sessionObj = indSession.toObject ? indSession.toObject() : { ...indSession };
        sessionObj.liveRoomName = getSecureLiveRoomName(indSession._id);
        subStatus.canAccessLiveSession = true;
        return res.json({ session: sessionObj, subscription: subStatus });
      }

      // 2. Legacy fallback to group live session
      let groupId = user.group?._id || user.group;
      if (!groupId) {
        const foundGroup = await Group.findOne({ students: user._id }).select('_id');
        if (foundGroup) {
          groupId = foundGroup._id;
          User.findByIdAndUpdate(user._id, { group: groupId }).catch(() => {});
        }
      }

      if (!groupId) {
        return res.json({ session: null, subscription: subStatus });
      }

      const groupSession = await LiveSession.findOne({ status: 'live', group: groupId })
        .populate('teacher', 'firstName lastName avatar')
        .populate('group', 'name level students')
        .sort({ startedAt: -1 });

      if (groupSession) {
        const sessionObj = groupSession.toObject ? groupSession.toObject() : { ...groupSession };
        sessionObj.liveRoomName = getSecureLiveRoomName(groupSession._id);
        const alreadyAttended = groupSession.attendees?.some(
          a => (a.student?._id || a.student)?.toString() === user._id.toString()
        );
        if (alreadyAttended) {
          subStatus.canAccessLiveSession = true;
        }
        return res.json({ session: sessionObj, subscription: subStatus });
      }

      return res.json({ session: null, subscription: subStatus });
    }

    // Teacher / Admin: check if hosting any active live session
    const hostSession = await LiveSession.findOne({ status: 'live', teacher: user._id })
      .populate('student', 'firstName lastName avatar')
      .populate('group', 'name level students')
      .sort({ startedAt: -1 });

    if (hostSession) {
      const sessionObj = hostSession.toObject ? hostSession.toObject() : { ...hostSession };
      sessionObj.liveRoomName = getSecureLiveRoomName(hostSession._id);
      return res.json({ session: sessionObj, subscription: subStatus });
    }

    res.json({ session: null, subscription: subStatus });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/live/:id
export const getSessionById = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id)
      .populate('teacher', 'firstName lastName avatar')
      .populate('group', 'name level students liveRoomId')
      .populate('attendees.student', 'firstName lastName avatar');
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    // Verify student belongs to this group OR is this session's student
    if (req.user.role === 'student') {
      const isIndStudent = session.student && session.student.toString() === req.user._id.toString();
      const isMember = session.group?.students?.some(
        s => (s._id?.toString() || s.toString()) === req.user._id.toString()
      );
      if (!isIndStudent && !isMember) {
        return res.status(403).json({ message: 'غير مصرح لك بالوصول لبيانات هذه الجلسة' });
      }
    }

    const subStatus = await evaluateUserSubscription(req.user);
    if (req.user.role === 'student' && session.status === 'live') {
      const alreadyAttended = session.attendees?.some(
        a => (a.student?._id || a.student)?.toString() === req.user._id.toString()
      );
      if (alreadyAttended) {
        subStatus.canAccessLiveSession = true;
      }
    }

    const sessionObj = session.toObject ? session.toObject() : { ...session };
    sessionObj.liveRoomName = getSecureLiveRoomName(session._id);

    res.json({ session: sessionObj, subscription: subStatus });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// PUT /api/live/:id/start
export const startSession = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id).populate('group', 'students name teacher');
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    // Verify teacher authorization
    if (req.user.role === 'teacher') {
      const isTeacher = session.teacher?.toString() === req.user._id.toString() ||
                        session.group?.teacher?.toString() === req.user._id.toString();
      if (!isTeacher) {
        return res.status(403).json({ message: 'غير مصرح لك ببدء هذه الجلسة' });
      }
    }

    session.status = 'live';
    session.startedAt = new Date();
    session.teacherSocketId = req.body.teacherSocketId || '';
    await session.save();

    const io = req.app.get('io');
    if (io && session.group?._id) {
      io.to(`group:${session.group._id}`).emit('broadcast-started', {
        sessionId: session._id,
        teacherSocketId: req.body.teacherSocketId,
        teacherId: req.user._id,
        title: session.title,
      });
    }

    // Send live notifications (group sessions only; individual notifies at creation)
    if (session.group?._id) {
      const group = await Group.findById(session.group._id).populate('students', 'pushSubscription');
      await Promise.allSettled(
        (group?.students || []).map((student) =>
          student.pushSubscription
            ? sendWebPush(student.pushSubscription, `🔴 ${session.title} يبدأ الآن!`, 'انضم للجلسة المباشرة')
            : Promise.resolve()
        )
      );
    }

    const sessionObj = session.toObject ? session.toObject() : { ...session };
    sessionObj.liveRoomName = getSecureLiveRoomName(session._id);

    res.json({ message: 'تم بدء البث', session: sessionObj });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في بدء البث' });
  }
};

// PUT /api/live/:id/end
export const endSession = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id).populate('group', 'teacher');
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    // Verify teacher authorization
    if (req.user.role === 'teacher') {
      const isTeacher = session.teacher?.toString() === req.user._id.toString() ||
                        session.group?.teacher?.toString() === req.user._id.toString();
      if (!isTeacher) {
        return res.status(403).json({ message: 'غير مصرح لك بإنهاء هذه الجلسة' });
      }
    }

    session.status = 'ended';
    session.endedAt = new Date();
    if (req.body.recordingUrl) session.recordingUrl = req.body.recordingUrl;
    await session.save();

    const targetGroupId = session.group?._id || session.group;
    const io = req.app.get('io');
    if (io) {
      if (targetGroupId) {
        io.to(`group:${targetGroupId}`).emit('broadcast-ended', { sessionId: session._id });
      }
      if (session.student) {
        io.emitToUser(session.student.toString(), 'broadcast-ended', { sessionId: session._id });
      }
    }

    // Update group total sessions if group session
    if (targetGroupId) {
      await Group.findByIdAndUpdate(targetGroupId, { $inc: { totalSessions: 1 } });
    }

    // Auto-mark linked lesson as completed in individual student's plan
    if (session.student && session.lessonCovered) {
      try {
        const StudyPlan = (await import('../models/StudyPlan.js')).default;
        const plan = await StudyPlan.findOne({ student: session.student, type: 'individual' });
        if (plan) {
          const lesson = plan.customLessons.id(session.lessonCovered);
          if (lesson && lesson.status !== 'completed') {
            lesson.status = 'completed';
            lesson.completedAt = new Date();
            lesson.completedBySessionId = session._id;
            await plan.save();
          }
        }
      } catch (err) {
        console.error('Error completing individual lesson on endSession:', err);
      }
    }

    // Auto-mark linked lesson as completed in the group's study plan
    if (session.lessonCovered && targetGroupId) {
      try {
        const StudyPlan = (await import('../models/StudyPlan.js')).default;
        const User = (await import('../models/User.js')).default;
        const Notification = (await import('../models/Notification.js')).default;
        const plan = await StudyPlan.findOne({ group: targetGroupId, type: 'group' });
        if (plan) {
          const lesson = plan.customLessons.id(session.lessonCovered);
          if (lesson && lesson.status !== 'completed') {
            lesson.status = 'completed';
            lesson.completedAt = new Date();
            lesson.completedBySessionId = session._id;
            await plan.save();
          }

          // Auto-assign default homework if session didn't have one
          if (!session.homework && (lesson?.defaultHomework || lesson?.defaultQuranHomework?.surahName)) {
            session.homework = lesson.defaultHomework || `واجب درس: ${lesson.title}`;
            session.homeworkDeadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
            if (lesson.defaultQuranHomework?.surahName) {
              session.quranHomework = lesson.defaultQuranHomework;
            }
            await session.save();

            if (io) {
              io.to(`group:${targetGroupId}`).emit('homework-updated', {
                sessionId: session._id,
                homework: session.homework,
                quranHomework: session.quranHomework,
                homeworkDeadline: session.homeworkDeadline,
              });
            }
          }

          // Sync student completed lessons for group students
          const groupDoc = await Group.findById(targetGroupId).select('students');
          const studentIds = groupDoc?.students || [];
          if (studentIds.length > 0) {
            await User.updateMany(
              { _id: { $in: studentIds } },
              { $addToSet: { completedLessons: session.lessonCovered } }
            );

            // Check if all lessons in customLessons are now completed!
            const allCompleted = plan.customLessons?.length > 0 && plan.customLessons.every(l => l.status === 'completed');
            if (allCompleted) {
              const notifs = studentIds.map(stId => ({
                recipient: stId,
                type: 'plan_updated',
                title: 'مبارك إتمام المنهج الدراسي بنجاح! 🎓🎉',
                body: 'لقد أتمت مجموعتكم جميع دروس المنهج المقرر. استعد للاختبار الشامل النهائي والترقية للمستوى التالي!',
                data: { groupId: targetGroupId, planId: plan._id, completed: true }
              }));
              await Notification.insertMany(notifs).catch(() => {});
            }
          }
        }
      } catch (_) { /* non-critical: don't fail the end-session if lesson update fails */ }
    }

    res.json({ message: 'تم إنهاء البث', session });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إنهاء البث' });
  }
};

// PUT /api/live/:id/join
export const joinSession = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id).populate('group', 'students');
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    // Check subscription & session ownership for students (individual system: no groups)
    if (req.user.role === 'student') {
      const isOwner = session.student && session.student.toString() === req.user._id.toString();
      const isMember = session.group?.students?.some(
        s => (s._id?.toString() || s.toString()) === req.user._id.toString()
      );
      if (!isOwner && !isMember) {
        return res.status(403).json({ message: 'غير مصرح لك بحضور هذه الجلسة' });
      }

      // Check if student has ALREADY joined this ongoing session
      const alreadyJoined = session.attendees.some(
        a => (a.student?._id || a.student)?.toString() === req.user._id.toString()
      );

      // Only check subscription and mark trial if joining for the first time
      if (!alreadyJoined) {
        const user = await User.findById(req.user._id);
        const subStatus = await evaluateUserSubscription(user);

        if (!subStatus.canAccessLiveSession) {
          return res.status(403).json({
            accessDenied: true,
            reason: 'subscription_required',
            message: 'انتهت المحاضرة التجريبية المجانية أو انتهى اشتراكك الشهري. يرجى سداد الاشتراك لمتابعة حضور الحلقات.',
            subscription: subStatus,
          });
        }

        // استهلاك التجربة: من إعدادات اللوحة + ذري ضد الدخول المتزامن
        if (subStatus.isTrial) {
          const PaymentSetting = (await import('../models/PaymentSetting.js')).default;
          const settings = await PaymentSetting.getSettings();
          const trialAllowed = settings.freeTrialSessionsCount || 1;
          const consumed = await User.findOneAndUpdate(
            {
              _id: req.user._id,
              $expr: { $lt: [{ $ifNull: ['$subscription.trialSessionsAttended', 0] }, trialAllowed] },
            },
            {
              $inc: { 'subscription.trialSessionsAttended': 1 },
              $set: { 'subscription.status': 'trial', 'subscription.trialSessionsAllowed': trialAllowed },
            },
            { new: true }
          );
          if (!consumed) {
            // استُهلكت التجربة في طلب متزامن آخر — إعادة التقييم
            const fresh = await User.findById(req.user._id);
            const freshStatus = await evaluateUserSubscription(fresh);
            if (!freshStatus.canAccessLiveSession) {
              return res.status(403).json({
                accessDenied: true,
                reason: 'subscription_required',
                message: 'انتهت حصصك التجريبية المجانية. يرجى سداد الاشتراك لمتابعة حضور الحصص.',
                subscription: freshStatus,
              });
            }
          } else if ((consumed.subscription?.trialSessionsAttended || 0) === 1) {
            // أول استهلاك للتجربة: إشعار ترحيبي مرة واحدة
            await Notification.create({
              recipient: user._id,
              type: 'plan_updated',
              title: '🎉 حضرت جلستك التجريبية المجانية الأولى بنجاح!',
              body: 'أهلاً بك في منصتنا! للاستمرار في حضور الحصص القادمة مع معلمك، يرجى تفعيل اشتراكك الشهري عبر فودافون كاش أو انستاباي.',
              data: { link: '/student/subscription', trialCompleted: true },
            });
          }
        }

        session.attendees.push({ student: req.user._id, joinedAt: new Date() });
        await session.save();
      } else {
        // الطالب عاد مرة أخرى بعد مغادرته → نمسح leftAt ليظهر "متصل" مجدداً
        const attendee = session.attendees.find(
          a => (a.student?._id || a.student)?.toString() === req.user._id.toString()
        );
        if (attendee && attendee.leftAt) {
          attendee.leftAt = undefined;
          await session.save();
        }
      }
    } else {
      // Teacher or admin
      const alreadyJoined = session.attendees.some(
        a => (a.student?._id || a.student)?.toString() === req.user._id.toString()
      );
      if (!alreadyJoined) {
        session.attendees.push({ student: req.user._id, joinedAt: new Date() });
        await session.save();
      }
    }

    const sessionObj = session.toObject ? session.toObject() : { ...session };
    sessionObj.liveRoomName = getSecureLiveRoomName(session._id);

    res.json({ message: 'تم تسجيل الحضور', session: sessionObj });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// POST /api/live/:id/chat
export const sendChatMessage = async (req, res) => {
  try {
    const { message, type } = req.body;
    const session = await LiveSession.findByIdAndUpdate(
      req.params.id,
      {
        $push: {
          chatMessages: { sender: req.user._id, message, type: type || 'text', sentAt: new Date() },
        },
      },
      { new: true }
    );
    res.json({ message: 'تم إرسال الرسالة' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/live/:id/attendees
export const getAttendees = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id)
      .populate('attendees.student', 'firstName lastName avatar')
      .select('attendees title status');
    res.json({ attendees: session?.attendees || [] });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// POST /api/live/group/:groupId/start
export const startGroupLiveSession = async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId)
      .populate('students', 'pushSubscription firstName lastName');
    
    if (!group) return res.status(404).json({ message: 'المجموعة غير موجودة' });

    // Create a new live session
    const session = await LiveSession.create({
      group: group._id,
      teacher: req.user._id,
      title: `حصة مباشرة - ${group.name}`,
      sessionType: 'lesson',
      status: 'live',
      startedAt: new Date(),
      teacherSocketId: req.body.teacherSocketId || '',
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`group:${group._id}`).emit('broadcast-started', {
        sessionId: session._id,
        roomId: group.liveRoomId,
        teacherSocketId: req.body.teacherSocketId || '',
        teacherId: req.user._id,
        title: session.title,
        groupId: group._id,
      });
    }

    // Send notifications to group students
    const notifications = group.students.map(student =>
      Notification.create({
        recipient: student._id,
        type: 'live_starting',
        title: `🔴 حصة مباشرة الآن: ${group.name}`,
        body: 'انضم للحصة المباشرة مع المعلم',
        data: { sessionId: session._id, groupId: group._id, roomId: group.liveRoomId },
      })
    );
    await Promise.all(notifications);

    // Send push notifications
    await Promise.allSettled(
      group.students.map((student) =>
        student.pushSubscription
          ? sendWebPush(student.pushSubscription, `🔴 حصة مباشرة الآن!`, `انضم لحصة ${group.name} المباشرة`)
          : Promise.resolve()
      )
    );

    const sessionObj = session.toObject ? session.toObject() : { ...session };
    sessionObj.liveRoomName = getSecureLiveRoomName(session._id);

    res.status(201).json({ message: 'تم بدء البث المباشر مع المجموعة', session: sessionObj });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في بدء البث المباشر' });
  }
};

// ─── Live Attendance Sheet System ─────────────────────────────────────────

// GET /api/live/:id/attendance-sheet  (Admin / Teacher: get students & attendance status)
export const getAttendanceSheet = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id)
      .populate('group', 'name students')
      .populate({
        path: 'group',
        populate: {
          path: 'students',
          select: 'firstName lastName email avatar phone assignedLevel'
        }
      })
      .populate('student', 'firstName lastName email avatar phone assignedLevel')
      .populate('attendanceRecords.student', 'firstName lastName avatar email')
      .populate('attendanceRecords.markedBy', 'firstName lastName');

    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    // النظام فردي: الجلسة بلا مجموعة → الكشف هو الطالب صاحب الجلسة
    const students = (session.group?.students?.length)
      ? session.group.students
      : (session.student ? [session.student] : []);
    const attendeesMap = new Map();
    session.attendees?.forEach(att => {
      if (att.student) attendeesMap.set(att.student.toString(), att);
    });

    const recordsMap = new Map();
    session.attendanceRecords?.forEach(rec => {
      const sId = rec.student?._id?.toString() || rec.student?.toString();
      if (sId) recordsMap.set(sId, rec);
    });

    // Assemble comprehensive student attendance sheet
    const sheet = students.map(student => {
      const sId = student._id.toString();
      const rawAttendee = attendeesMap.get(sId);
      const existingRecord = recordsMap.get(sId);

      // الطالب متصل الآن إذا: لديه سجل حضور + لم يغادر (leftAt غير موجود)
      const isConnectedNow = !!rawAttendee && !rawAttendee.leftAt;

      // تحديد الحالة الافتراضية:
      // - إذا تم رصد حالته يدوياً → نستخدمها
      // - إذا متصل الآن → حاضر
      // - إذا انضم ثم غادر (leftAt موجود) → غائب
      // - إذا لم ينضم أبداً → غائب
      // تحديد الحالة:
      // - إذا انضم ثم غادر (leftAt موجود) → يظهر "غائب" عند إعادة تحميل الكشف
      // - إذا متصل الآن → حاضر (أو حالته المسجلة مسبقاً إذا وُجدت)
      // - إذا لم ينضم أبداً → غائب (أو حالته المسجلة مسبقاً)
      let finalStatus = 'absent';
      if (rawAttendee?.leftAt) {
        // غادر الجلسة → غائب مؤكد عند إعادة التحميل (إلا لو معذور يدوياً)
        finalStatus = existingRecord?.status === 'excused' ? 'excused' : 'absent';
      } else if (existingRecord) {
        finalStatus = existingRecord.status;
      } else if (rawAttendee) {
        finalStatus = 'present';
      }

      return {
        student: {
          _id: student._id,
          firstName: student.firstName,
          lastName: student.lastName,
          avatar: student.avatar,
          email: student.email,
          phone: student.phone,
          assignedLevel: student.assignedLevel
        },
        status: finalStatus,
        notes: existingRecord?.notes || '',
        markedBy: existingRecord?.markedBy || null,
        markedAt: existingRecord?.markedAt || null,
        joinedAt: rawAttendee?.joinedAt || existingRecord?.joinedAt || null,
        leftAt: rawAttendee?.leftAt || existingRecord?.leftAt || null,
        durationMinutes: rawAttendee?.duration || existingRecord?.durationMinutes || 0,
        isOnline: isConnectedNow
      };
    });

    res.json({
      sessionId: session._id,
      sessionTitle: session.title,
      sessionStatus: session.status,
      groupName: session.group?.name,
      totalStudents: students.length,
      sheet
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب كشف الحضور' });
  }
};

// PUT /api/live/:id/attendance-sheet  (Admin / Teacher: save attendance records + notify parents if requested)
export const saveAttendanceSheet = async (req, res) => {
  try {
    const { records = [], notifyParents = false } = req.body;
    const session = await LiveSession.findById(req.params.id).populate('group', 'name students');

    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    const updatedRecords = [];
    const absentStudentIds = [];

    records.forEach(item => {
      const studentId = item.studentId || item.student?._id || item.student;
      if (!studentId) return;

      const existingIndex = session.attendanceRecords.findIndex(
        r => r.student.toString() === studentId.toString()
      );
      const existing = existingIndex >= 0 ? session.attendanceRecords[existingIndex] : null;

      // دمج: الحقول غير المرسلة تُحفظ من السجل السابق ولا تُصفّر
      const recordObj = {
        student: studentId,
        status: item.status || existing?.status || 'absent',
        notes: item.notes !== undefined ? item.notes : (existing?.notes || ''),
        markedBy: req.user._id,
        markedAt: new Date(),
        durationMinutes: item.durationMinutes !== undefined ? item.durationMinutes : (existing?.durationMinutes || 0)
      };

      if (existingIndex >= 0) {
        session.attendanceRecords[existingIndex] = {
          ...session.attendanceRecords[existingIndex].toObject(),
          ...recordObj
        };
      } else {
        session.attendanceRecords.push(recordObj);
      }

      updatedRecords.push(recordObj);

      if (item.status === 'absent') {
        absentStudentIds.push(studentId);
      }
    });

    await session.save();

    const io = req.app.get('io');
    if (io && session.group?._id) {
      io.to(`group:${session.group._id}`).emit('attendance-updated', {
        sessionId: session._id,
        records: updatedRecords,
        updatedBy: { _id: req.user._id, name: `${req.user.firstName} ${req.user.lastName}` }
      });
    }

    // If notifyParents is true, notify linked parents of absent students
    let parentsNotifiedCount = 0;
    if (notifyParents && absentStudentIds.length > 0) {
      const absentStudents = await User.find({ _id: { $in: absentStudentIds } }).select('firstName lastName');
      const studentNameMap = new Map(absentStudents.map(s => [s._id.toString(), `${s.firstName} ${s.lastName}`]));

      const parents = await User.find({
        role: 'parent',
        children: { $in: absentStudentIds }
      });

      for (const parent of parents) {
        const matchingChildId = parent.children.find(cId => absentStudentIds.includes(cId.toString()));
        if (matchingChildId) {
          const childName = studentNameMap.get(matchingChildId.toString()) || 'ابنكم';
          
          await Notification.create({
            recipient: parent._id,
            type: 'progress_update',
            title: `⚠️ تنبيه غياب: ${childName}`,
            body: `نحيطكم علماً بأن الطالب ${childName} تم تسجيله غائباً عن الحصة المباشرة (${session.title}) اليوم.`,
            data: { sessionId: session._id, childId: matchingChildId }
          });

          if (parent.pushSubscription) {
            sendWebPush(
              parent.pushSubscription,
              `⚠️ تنبيه غياب: ${childName}`,
              `تم تسجيل غياب ${childName} عن حصة اليوم (${session.title})`
            ).catch(() => {});
          }
          parentsNotifiedCount++;
        }
      }
    }

    res.json({
      message: 'تم حفظ وتثبيت كشف الحضور بنجاح',
      savedCount: updatedRecords.length,
      parentsNotifiedCount,
      attendanceRecords: session.attendanceRecords
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حفظ كشف الحضور' });
  }
};

// POST /api/live/:id/attendance-ping  (Admin / Teacher: Roll-Call trigger)
export const sendAttendancePing = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    const pingId = Date.now().toString();
    const io = req.app.get('io');
    if (io) {
      io.to(`group:${session.group}`).emit('attendance-ping', {
        sessionId: session._id,
        pingId,
        message: '✋ نداء التحقق من التواجد! يرجى تأكيد حضورك الآن',
        timeoutSeconds: 60
      });
    }

    res.json({ message: 'تم إرسال نداء التحقق للطلاب بنجاح 🔔', pingId });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إرسال نداء التحقق' });
  }
};

// POST /api/live/:id/attendance-pong  (Student: responds to Roll-Call ping)
export const respondAttendancePong = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    const studentId = req.user._id;
    const existingIndex = session.attendanceRecords.findIndex(
      r => r.student.toString() === studentId.toString()
    );

    if (existingIndex >= 0) {
      session.attendanceRecords[existingIndex].status = 'present';
      session.attendanceRecords[existingIndex].markedAt = new Date();
    } else {
      session.attendanceRecords.push({
        student: studentId,
        status: 'present',
        markedAt: new Date()
      });
    }

    await session.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`group:${session.group}`).emit('attendance-pong-received', {
        sessionId: session._id,
        studentId,
        studentName: `${req.user.firstName} ${req.user.lastName}`
      });
    }

    res.json({ message: 'تم تأكيد حضورك بنجاح ✅' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تأكيد الحضور' });
  }
};

// ─── Shared mushaf (HTTP polling — no sockets) ─────────────────────

// GET /api/live/:id/mushaf — read shared mushaf state (owner student or staff)
export const getSharedMushaf = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id).select('student sharedMushaf status');
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });
    const me = req.user._id.toString();
    const isOwner = session.student && session.student.toString() === me;
    const isStaff = ['admin', 'teacher'].includes(req.user.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ message: 'غير مصرح' });
    }
    res.json({ sharedMushaf: session.sharedMushaf || { sharing: false } });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب المصحف المشترك' });
  }
};

// PUT /api/live/:id/mushaf — teacher/admin sets shared mushaf state
export const updateSharedMushaf = async (req, res) => {
  try {
    const { sharing, surah, fromVerse, toVerse } = req.body;
    const session = await LiveSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    const next = {
      sharing: sharing === true,
      updatedAt: new Date(),
    };
    if (surah !== undefined) {
      const s = Number(surah);
      if (!Number.isInteger(s) || s < 1 || s > 114) {
        return res.status(400).json({ message: 'رقم السورة غير صالح' });
      }
      next.surah = s;
    }
    if (fromVerse !== undefined) {
      const f = Number(fromVerse);
      if (!Number.isInteger(f) || f < 1) {
        return res.status(400).json({ message: 'رقم الآية غير صالح' });
      }
      next.fromVerse = f;
    }
    if (toVerse !== undefined) {
      const t = Number(toVerse);
      if (!Number.isInteger(t) || t < 1) {
        return res.status(400).json({ message: 'رقم الآية غير صالح' });
      }
      next.toVerse = t;
    }
    if (next.fromVerse !== undefined && next.toVerse !== undefined && next.toVerse < next.fromVerse) {
      return res.status(400).json({ message: 'نهاية النطاق قبل بدايته' });
    }

    session.sharedMushaf = { ...(session.sharedMushaf?.toObject?.() || {}), ...next };
    await session.save();
    res.json({ sharedMushaf: session.sharedMushaf });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حفظ المصحف المشترك' });
  }
};

// POST /api/live/student/:studentId/start — start 1-on-1 live session with student
export const startStudentLiveSession = async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await User.findById(studentId);
    if (!student) return res.status(404).json({ message: 'الطالب غير موجود' });

    const StudyPlan = (await import('../models/StudyPlan.js')).default;

    // Find or create individual study plan for this student
    let plan = await StudyPlan.findOne({ student: studentId, type: 'individual' });
    if (!plan) {
      plan = await StudyPlan.create({
        student: studentId,
        type: 'individual',
        customLessons: [],
      });
    }

    const lessonCount = (plan.customLessons?.length || 0) + 1;
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
    const defaultTitle = `جلسة تلاوة وبث مباشر (${lessonCount}) - ${dateStr}`;
    // Custom title/resources are optional — fall back to auto-generated title
    const lessonTitle = (req.body?.title || '').toString().trim() || defaultTitle;
    const lessonResources = (req.body?.resources || '').toString().trim();
    const lessonDescription = (req.body?.description || '').toString().trim();

    // Add new custom lesson
    plan.customLessons.push({
      lessonNumber: lessonCount,
      title: lessonTitle,
      description: lessonDescription || undefined,
      resources: lessonResources || undefined,
      type: 'recitation',
      status: 'in_progress',
      isLiveRequired: true,
      order: lessonCount,
    });
    await plan.save();

    const createdLesson = plan.customLessons[plan.customLessons.length - 1];

    // Create LiveSession
    const session = await LiveSession.create({
      student: studentId,
      teacher: req.user._id,
      title: lessonTitle,
      status: 'live',
      startedAt: now,
      sessionType: 'recitation',
      lessonCovered: createdLesson._id,
      lessonTitle: lessonTitle,
    });

    createdLesson.completedBySessionId = session._id;
    await plan.save();

    // Notify student via socket & push
    const io = req.app.get('io');
    const notification = await Notification.create({
      recipient: studentId,
      type: 'live_starting',
      title: 'بدأ البث المباشر معك الآن 🎙️',
      body: `المشرف في انتظارك داخل غرفة البث المباشر: ${lessonTitle}`,
      data: { sessionId: session._id, link: '/student/live' },
    });

    if (io) {
      // حدث واحد فقط للفردي (live-started) — منع الجلب المكرر عند الطالب
      io.emitToUser(studentId.toString(), 'live-started', {
        sessionId: session._id,
        roomId: session.roomId,
        lessonId: createdLesson._id,
        title: lessonTitle,
      });
      io.emitToUser(studentId.toString(), 'notification', notification);
    }

    if (student.pushSubscription) {
      sendWebPush(student.pushSubscription, notification.title, notification.body).catch(() => {});
    }

    const sessionObj = session.toObject ? session.toObject() : { ...session };
    sessionObj.liveRoomName = getSecureLiveRoomName(session._id);

    res.status(201).json({
      message: 'تم بدء البث المباشر مع الطالب وإنشاء الدرس بنجاح',
      session: sessionObj,
      lessonId: createdLesson._id,
      planId: plan._id,
    });
  } catch (error) {
    console.error('Error starting student live session:', error);
    res.status(500).json({ message: 'خطأ في بدء البث المباشر' });
  }
};


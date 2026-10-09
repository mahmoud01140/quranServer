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

// ─── Due-session staff alerts ─────────────────────────────────────
// GET /api/live/due (admin/teacher, polled ~every 60s)
// Notifies ONCE per scheduled session when its time arrives (or is within
// the upcoming window): DB notification + Web Push to the teacher + admins,
// guarded by dueNotifiedAt with atomic claim so concurrent polls never duplicate.
export const getDueSessions = async (req, res) => {
  try {
    if (!['admin', 'teacher'].includes(req.user.role)) {
      return res.status(403).json({ message: 'غير مصرح' });
    }

    const now = new Date();
    const windowEnd = new Date(now.getTime() + 15 * 60 * 1000);
    const candidates = await LiveSession.find({
      status: 'scheduled',
      scheduledAt: { $lte: windowEnd },
      $or: [{ dueNotifiedAt: null }, { dueNotifiedAt: { $exists: false } }],
    })
      .select('title scheduledAt teacher student group')
      .populate('teacher', 'firstName lastName')
      .populate('student', 'firstName lastName')
      .populate('group', 'name teacher')
      .limit(20)
      .lean();

    const sessions = [];
    const notifiedIds = [];

    for (const s of candidates) {
      // Atomic claim: only the first concurrent poll notifies
      const claimed = await LiveSession.findOneAndUpdate(
        {
          _id: s._id,
          $or: [{ dueNotifiedAt: null }, { dueNotifiedAt: { $exists: false } }],
        },
        { $set: { dueNotifiedAt: new Date() } },
        { new: false }
      ).select('_id');
      if (!claimed) continue;

      const teacherId = (s.teacher?._id || s.teacher)?.toString?.();
      const groupTeacherId = (s.group?.teacher?._id || s.group?.teacher)?.toString?.();
      const ownerName = s.student
        ? `${s.student.firstName || ''} ${s.student.lastName || ''}`.trim()
        : s.group?.name || '';
      const title = `⏰ حان موعد حصة: ${s.title || 'جلسة مباشرة'}`;
      const when = s.scheduledAt ? new Date(s.scheduledAt) : null;
      const body = when && when <= now
        ? `موعد حصة "${s.title || ''}" ${ownerName ? `مع ${ownerName} ` : ''}قد حان الآن — ابدأ البث.`
        : `حصة "${s.title || ''}" ${ownerName ? `مع ${ownerName} ` : ''}تبدأ خلال دقائق — استعد للبث.`;

      try {
        const recipients = new Set();
        if (teacherId) recipients.add(teacherId);
        if (groupTeacherId) recipients.add(groupTeacherId);
        const admins = await User.find({ role: 'admin' }).select('_id pushSubscription');
        const staffPush = new Map();
        for (const a of admins) {
          recipients.add(a._id.toString());
          if (a.pushSubscription) staffPush.set(a._id.toString(), a.pushSubscription);
        }
        if (teacherId && !staffPush.has(teacherId)) {
          const t = await User.findById(teacherId).select('pushSubscription');
          if (t?.pushSubscription) staffPush.set(teacherId, t.pushSubscription);
        }

        const created = await Promise.all(
          [...recipients].map((rid) =>
            Notification.create({
              recipient: rid,
              type: 'session_due',
              title,
              body,
              data: { sessionId: s._id.toString(), link: '/admin/live' },
            })
          )
        );
        await Promise.allSettled(
          [...staffPush.values()].map((sub) =>
            sendWebPush(sub, title, body, { sessionId: s._id.toString(), link: '/admin/live' })
          )
        );
        created.forEach((n) => notifiedIds.push(n._id.toString()));
      } catch (_) {}

      sessions.push({
        sessionId: s._id.toString(),
        title: s.title || 'جلسة مباشرة',
        scheduledAt: s.scheduledAt,
        ownerName,
      });
    }

    res.json({ sessions, notifiedIds });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في فحص مواعيد الحصص' });
  }
};

// Vercel-safe polling helper: hide expired roll-call pings instead of pushing via socket.io.
// Expired pings are nulled in the response (lazy cleanup; no extra DB write on hot read paths).
const sanitizeActivePing = (sessionObj) => {
  if (sessionObj?.activePing?.expiresAt) {
    if (new Date(sessionObj.activePing.expiresAt) < new Date()) {
      sessionObj.activePing = null;
    }
  } else if (sessionObj) {
    sessionObj.activePing = sessionObj.activePing || null;
  }
  return sessionObj;
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

    // Notify group students (DB + Web Push; frontend picks up via HTTP polling — Vercel-safe)
    const group = await Group.findById(groupId).populate('students', 'pushSubscription firstName');

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
        sanitizeActivePing(sessionObj);
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
        sanitizeActivePing(sessionObj);
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
      sanitizeActivePing(sessionObj);
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
    sanitizeActivePing(sessionObj);

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
    // Clear any stale roll-call ping when (re)starting — Vercel-safe polling replaces socket.io
    session.activePing = undefined;
    await session.save();

    // Send live notifications (group sessions only; individual notifies at creation)
    // Students discover the live session via GET /api/live/active/me polling (no socket.io).
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
    // Clear roll-call ping on end — students see ended status via polling GET /active/me
    session.activePing = undefined;
    await session.save();

    const targetGroupId = session.group?._id || session.group;

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
            // Students see homework via GET /api/live/:id polling — no socket.io needed.
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

// POST /api/live/:id/chat — Vercel-safe replacement for socket.io live-message.
// Frontend polls GET /:id/chat?since= to receive new messages.
export const sendChatMessage = async (req, res) => {
  try {
    const { message, type } = req.body;
    const text = String(message || '').trim().substring(0, 2000);
    if (!text) return res.status(400).json({ message: 'نص الرسالة مطلوب' });
    const safeType = ['text', 'audio', 'question'].includes(type) ? type : 'text';
    const chatMsg = { sender: req.user._id, message: text, type: safeType, sentAt: new Date() };
    await LiveSession.findByIdAndUpdate(req.params.id, {
      $push: { chatMessages: { $each: [chatMsg], $slice: -500 } },
    });
    res.json({ message: 'تم إرسال الرسالة', chatMessage: chatMsg });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/live/:id/chat?since=ISO-date — incremental fetch for polling clients.
export const getChatMessages = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id)
      .select('chatMessages student group status')
      .populate('chatMessages.sender', 'firstName lastName avatar');
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });
    let messages = session.chatMessages || [];
    // Keep payload small: last 100 by default, or only newer than `since`
    if (req.query.since) {
      const since = new Date(req.query.since);
      if (!Number.isNaN(since.getTime())) {
        messages = messages.filter((m) => new Date(m.sentAt) > since);
      }
    } else {
      messages = messages.slice(-100);
    }
    res.json({ messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب الرسائل' });
  }
};

// POST /api/live/:id/leave — HTTP replacement for socket.io leave-session/disconnect.
// Marks attendees.leftAt for the caller (attendance duration tracking).
export const leaveSession = async (req, res) => {
  try {
    const updated = await LiveSession.findOneAndUpdate(
      {
        _id: req.params.id,
        attendees: {
          $elemMatch: {
            student: req.user._id,
            $or: [{ leftAt: { $exists: false } }, { leftAt: null }],
          },
        },
      },
      { $set: { 'attendees.$.leftAt': new Date() } },
      { new: true }
    ).select('_id attendees');
    res.json({ message: 'تم تسجيل المغادرة', left: Boolean(updated) });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تسجيل المغادرة' });
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
    // Students discover it via GET /api/live/active/me polling (Vercel-safe, no socket.io).
    const session = await LiveSession.create({
      group: group._id,
      teacher: req.user._id,
      title: `حصة مباشرة - ${group.name}`,
      sessionType: 'lesson',
      status: 'live',
      startedAt: new Date(),
    });

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

    // Attendance sheet is read via GET /:id/attendance-sheet polling — no socket.io needed.

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
// Vercel-safe: persists ping in DB; students poll GET /:id or /active/me (activePing) every ~5s.
export const sendAttendancePing = async (req, res) => {
  try {
    const session = await LiveSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    const pingId = Date.now().toString();
    const now = new Date();
    session.activePing = {
      pingId,
      message: '✋ نداء التحقق من التواجد! يرجى تأكيد حضورك الآن',
      sentAt: now,
      expiresAt: new Date(now.getTime() + 60 * 1000),
      sentBy: req.user._id,
    };
    await session.save();

    res.json({
      message: 'تم إرسال نداء التحقق للطلاب بنجاح 🔔',
      pingId,
      activePing: session.activePing,
    });
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

// ─── Subscription warning (advisory, non-blocking) ───────────────
// Shared by the pre-start check endpoint and the start endpoint below.
// Returns null when the student's subscription is fine.
export const buildSubscriptionWarning = async (student) => {
  try {
    const subStatus = await evaluateUserSubscription(student);
    const studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'الطالب';
    if (subStatus.isExpired) {
      const endDate = student.subscription?.endDate ? new Date(student.subscription.endDate) : null;
      const daysOverdue = endDate
        ? Math.max(1, Math.ceil((Date.now() - endDate.getTime()) / (1000 * 60 * 60 * 24)))
        : null;
      return {
        type: 'expired',
        title: '⚠️ تنبيه: اشتراك الطالب منتهٍ',
        message: daysOverdue
          ? `انتهى اشتراك ${studentName} منذ ${daysOverdue} ${daysOverdue === 1 ? 'يوم' : daysOverdue === 2 ? 'يومين' : 'أيام'} ولم يجدده — هل تريد الاستمرار في البث معه؟`
          : `اشتراك ${studentName} منتهٍ ولم يجدده — هل تريد الاستمرار في البث معه؟`,
        daysOverdue,
      };
    }
    if (subStatus.status !== 'active') {
      return {
        type: 'not_subscribed',
        title: '⚠️ تنبيه: الطالب غير مشترك',
        message: subStatus.isTrial
          ? `${studentName} غير مشترك بعد — يحضر ضمن الفترة التجريبية (${subStatus.trialSessionsAttended || 0} من ${subStatus.trialSessionsAllowed || 1}). هل تريد الاستمرار في البث معه؟`
          : `${studentName} ليس لديه اشتراك مدفوع — هل تريد الاستمرار في البث معه؟`,
        trialSessionsAttended: subStatus.trialSessionsAttended,
        trialSessionsAllowed: subStatus.trialSessionsAllowed,
      };
    }
    if (subStatus.isExpiringSoon) {
      return {
        type: 'expiring_soon',
        title: '⏳ تنبيه: اشتراك الطالب يقترب من الانتهاء',
        message: `ينتهي اشتراك ${studentName} خلال ${subStatus.daysRemaining} ${subStatus.daysRemaining === 1 ? 'يوم' : subStatus.daysRemaining === 2 ? 'يومين' : 'أيام'} — ذكّره بالتجديد.`,
        daysRemaining: subStatus.daysRemaining,
      };
    }
    return null;
  } catch (_) {
    // Warning is advisory only — never fail the caller because of it
    return null;
  }
};

// GET /api/live/student/:studentId/subscription-check (admin/teacher)
// Pre-start check: lets the starter confirm before creating the session.
export const checkStudentSubscription = async (req, res) => {
  try {
    const student = await User.findById(req.params.studentId);
    if (!student) return res.status(404).json({ message: 'الطالب غير موجود' });
    const subscriptionWarning = await buildSubscriptionWarning(student);
    res.json({ subscriptionWarning });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في فحص الاشتراك' });
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

    // Notify student via DB + Web Push (student polls GET /api/live/active/me — no socket.io)
    const notification = await Notification.create({
      recipient: studentId,
      type: 'live_starting',
      title: 'بدأ البث المباشر معك الآن 🎙️',
      body: `المشرف في انتظارك داخل غرفة البث المباشر: ${lessonTitle}`,
      data: { sessionId: session._id, link: '/student/live' },
    });

    if (student.pushSubscription) {
      sendWebPush(student.pushSubscription, notification.title, notification.body).catch(() => {});
    }

    const sessionObj = session.toObject ? session.toObject() : { ...session };
    sessionObj.liveRoomName = getSecureLiveRoomName(session._id);

    // Advisory only — never fails session creation
    const subscriptionWarning = await buildSubscriptionWarning(student);

    res.status(201).json({
      message: 'تم بدء البث المباشر مع الطالب وإنشاء الدرس بنجاح',
      session: sessionObj,
      lessonId: createdLesson._id,
      planId: plan._id,
      subscriptionWarning,
    });
  } catch (error) {
    console.error('Error starting student live session:', error);
    res.status(500).json({ message: 'خطأ في بدء البث المباشر' });
  }
};


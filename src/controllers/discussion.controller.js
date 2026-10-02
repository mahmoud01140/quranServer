import mongoose from 'mongoose';
import Discussion from '../models/Discussion.js';
import Group from '../models/Group.js';
import StudyPlan from '../models/StudyPlan.js';

// ─── Resolve the lesson's group + access ────────────────────────────
// A lesson lives in a study plan (group plan or individual plan).
// Group lessons are visible to that group's students + teacher + admins.
const resolveLessonRoom = async (lessonId, user) => {
  if (!lessonId) return { error: { status: 400, message: 'معرّف الدرس مطلوب' } };
  // معرّف غير صالح → 404 بدل انفجار CastError (500)
  if (!mongoose.Types.ObjectId.isValid(lessonId)) {
    return { error: { status: 404, message: 'الدرس غير موجود' } };
  }

  const plan = await StudyPlan.findOne({ 'customLessons._id': lessonId })
    .populate('group', 'name teacher students');
  if (!plan) {
    return { error: { status: 404, message: 'الدرس غير موجود' } };
  }

  const userId = user._id.toString();
  const isAdmin = user.role === 'admin';
  const isStaff = isAdmin || user.role === 'teacher';
  let group = plan.group;
  let lesson = (plan.customLessons || []).id(lessonId);

  if (plan.type === 'individual' || !group) {
    // Individual plan: the owner student + staff (admin/teacher) + owner's parent may discuss
    const ownerId = (plan.student?._id || plan.student)?.toString?.();
    const isParent = user.role === 'parent' && (user.children || []).some(c => c.toString() === ownerId);
    if (!isStaff && !isParent && ownerId !== userId) {
      return { error: { status: 403, message: 'ليس لديك صلاحية الوصول لهذه الغرفة' } };
    }
    group = group || null;
  } else {
    const isTeacher = group.teacher?.toString?.() === userId || group.teacher?._id?.toString?.() === userId;
    const students = group.students || [];
    const isStudent = students.some(s => (s?._id || s)?.toString() === userId);
    if (!isTeacher && !isStudent && !isAdmin) {
      return { error: { status: 403, message: 'ليس لديك صلاحية الوصول لهذه الغرفة' } };
    }
  }

  return {
    group,
    groupId: group?._id || null,
    groupName: group?.name || (plan.type === 'individual' ? 'جلسة خاصة' : 'درسي'),
    studentId: (plan.student?._id || plan.student) || null,
    lesson: lesson ? { _id: lesson._id, title: lesson.title } : { _id: lessonId, title: '' },
  };
};

const shapeRoom = (discussion, { groupId, groupName, lesson }) => {
  const all = (discussion.messages || []).map(m =>
    typeof m.toObject === 'function' ? m.toObject() : { ...m }
  );
  // حل يدوي للردود: replyTo يشير لرسالة داخل نفس الغرفة (لا ref لها، فلا populate).
  const byId = new Map(all.map(m => [m._id?.toString?.(), m]));
  const withReply = all.map(m => {
    const refId = m.replyTo?._id?.toString?.() || m.replyTo?.toString?.();
    if (!refId) return m;
    const target = byId.get(refId);
    if (!target || target.isDeleted) return m;
    const sender = target.sender;
    const senderName = sender
      ? `${sender.firstName || ''} ${sender.lastName || ''}`.trim()
      : '';
    return {
      ...m,
      replyToMessage: {
        _id: target._id,
        content: (target.content || '').substring(0, 120),
        senderName,
      },
    };
  });
  const visible = withReply.filter(m => !m.isDeleted);
  const page = 1;
  const limit = 100;
  const totalMessages = visible.length;
  const messages = visible.slice(-limit);
  const pinnedMessages = (discussion.messages || []).filter(m => m.isPinned && !m.isDeleted);
  return {
    _id: discussion._id,
    group: groupId,
    groupName,
    lessonId: discussion.lessonId,
    lessonTitle: discussion.lessonTitle || lesson?.title || '',
    isActive: discussion.isActive,
    messages,
    pinnedMessages,
    totalMessages,
    hasMore: totalMessages > messages.length,
    page,
  };
};

// ─── Get or create the discussion room for a lesson (HTTP polling) ──
export const getLessonDiscussion = async (req, res) => {
  try {
    const { lessonId } = req.params;
    const resolved = await resolveLessonRoom(lessonId, req.user);
    if (resolved.error) {
      return res.status(resolved.error.status).json({ message: resolved.error.message });
    }

    let discussion = await Discussion.findOne({ lessonId })
      .populate('messages.sender', 'firstName lastName role avatar');

    if (!discussion) {
      discussion = await Discussion.create({
        group: resolved.groupId || undefined,
        student: resolved.studentId || undefined,
        lessonId,
        lessonTitle: resolved.lesson?.title || '',
        messages: [],
      });
      discussion = await Discussion.findById(discussion._id)
        .populate('messages.sender', 'firstName lastName role avatar');
    }

    res.json({ discussion: shapeRoom(discussion, resolved) });
  } catch (error) {
    console.error('getLessonDiscussion error:', error);
    res.status(500).json({ message: 'خطأ في جلب غرفة نقاش الدرس' });
  }
};

// ─── Send a message (pure HTTP — no socket) ──────────────────────────
export const sendLessonMessage = async (req, res) => {
  try {
    const { lessonId } = req.params;
    const { content, type = 'text', replyTo } = req.body;
    const userId = req.user._id;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'محتوى الرسالة مطلوب' });
    }

    const resolved = await resolveLessonRoom(lessonId, req.user);
    if (resolved.error) {
      return res.status(resolved.error.status).json({ message: resolved.error.message });
    }

    let discussion = await Discussion.findOne({ lessonId });
    if (!discussion) {
      if (!resolved.groupId && !resolved.studentId) {
        return res.status(404).json({ message: 'غرفة النقاش غير متاحة لهذا الدرس' });
      }
      discussion = await Discussion.create({
        group: resolved.groupId || undefined,
        student: resolved.studentId || undefined,
        lessonId,
        lessonTitle: resolved.lesson?.title || '',
        messages: [],
      });
    }

    const newMessage = {
      sender: userId,
      content: content.trim().substring(0, 2000),
      type,
      replyTo: replyTo || null,
      readBy: [userId],
    };

    discussion.messages.push(newMessage);
    discussion.lastMessageAt = new Date();
    await discussion.save();

    const savedMsg = discussion.messages[discussion.messages.length - 1];
    await discussion.populate('messages.sender', 'firstName lastName role avatar');
    const populatedDoc = discussion.messages.find(
      m => m._id.toString() === savedMsg._id.toString()
    );
    const populatedMsg = typeof populatedDoc.toObject === 'function'
      ? populatedDoc.toObject()
      : { ...populatedDoc };
    // إرفاق معاينة الرسالة المردّ عليها (حل يدوي — لا populate)
    const refId = populatedMsg.replyTo?._id?.toString?.() || populatedMsg.replyTo?.toString?.();
    if (refId) {
      const target = discussion.messages.find(m => m._id.toString() === refId);
      if (target && !target.isDeleted) {
        const sender = target.sender;
        populatedMsg.replyToMessage = {
          _id: target._id,
          content: (target.content || '').substring(0, 120),
          senderName: sender
            ? `${sender.firstName || ''} ${sender.lastName || ''}`.trim()
            : '',
        };
      }
    }

    res.status(201).json({ message: populatedMsg });
  } catch (error) {
    console.error('sendLessonMessage error:', error);
    res.status(500).json({ message: 'خطأ في إرسال الرسالة' });
  }
};

// ─── Pin / Unpin a message (teacher/admin only) ──────────────────────
export const toggleLessonPinMessage = async (req, res) => {
  try {
    const { lessonId, messageId } = req.params;
    const userId = req.user._id.toString();

    const resolved = await resolveLessonRoom(lessonId, req.user);
    if (resolved.error) {
      return res.status(resolved.error.status).json({ message: resolved.error.message });
    }

    const group = resolved.group;
    // التثبيت: الأدمن دائماً، ومعلم المجموعة في غرف المجموعات، وأي معلم في الفردي (لا معلم مرتبط)
    const isGroupTeacher = group && (group.teacher?.toString?.() === userId || group.teacher?._id?.toString?.() === userId);
    const isTeacher = req.user.role === 'teacher' && (!group || isGroupTeacher);
    const isAdmin = req.user.role === 'admin';
    if (!isTeacher && !isAdmin) {
      return res.status(403).json({ message: 'فقط المعلم أو المشرف يمكنه تثبيت الرسائل' });
    }

    const discussion = await Discussion.findOne({ lessonId });
    if (!discussion) return res.status(404).json({ message: 'غرفة النقاش غير موجودة' });

    const msg = discussion.messages.id(messageId);
    if (!msg || msg.isDeleted) {
      return res.status(404).json({ message: 'الرسالة غير موجودة' });
    }

    msg.isPinned = !msg.isPinned;
    await discussion.save();

    res.json({ message: msg.isPinned ? 'تم تثبيت الرسالة' : 'تم إلغاء تثبيت الرسالة', isPinned: msg.isPinned });
  } catch (error) {
    console.error('toggleLessonPinMessage error:', error);
    res.status(500).json({ message: 'خطأ في تثبيت الرسالة' });
  }
};

// ─── Delete a message (teacher/admin or message owner) ───────────────
export const deleteLessonMessage = async (req, res) => {
  try {
    const { lessonId, messageId } = req.params;
    const userId = req.user._id.toString();

    const resolved = await resolveLessonRoom(lessonId, req.user);
    if (resolved.error) {
      return res.status(resolved.error.status).json({ message: resolved.error.message });
    }

    const discussion = await Discussion.findOne({ lessonId });
    if (!discussion) return res.status(404).json({ message: 'غرفة النقاش غير موجودة' });

    const msg = discussion.messages.id(messageId);
    if (!msg || msg.isDeleted) {
      return res.status(404).json({ message: 'الرسالة غير موجودة' });
    }

    const group = resolved.group;
    const isGroupTeacher = group && (group.teacher?.toString?.() === userId || group.teacher?._id?.toString?.() === userId);
    const isTeacher = req.user.role === 'teacher' && (!group || isGroupTeacher);
    const isAdmin = req.user.role === 'admin';
    const isOwner = msg.sender.toString() === userId;

    if (!isTeacher && !isAdmin && !isOwner) {
      return res.status(403).json({ message: 'ليس لديك صلاحية حذف هذه الرسالة' });
    }

    msg.isDeleted = true;
    msg.content = 'تم حذف هذه الرسالة';
    await discussion.save();

    res.json({ message: 'تم حذف الرسالة بنجاح' });
  } catch (error) {
    console.error('deleteLessonMessage error:', error);
    res.status(500).json({ message: 'خطأ في حذف الرسالة' });
  }
};

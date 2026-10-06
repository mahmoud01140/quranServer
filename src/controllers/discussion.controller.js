import mongoose from 'mongoose';
import Discussion from '../models/Discussion.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';

// ─── Student: Get My Conversation Thread with Admin ──────────────────
export const getMyThread = async (req, res) => {
  try {
    const studentId = req.user._id;

    // Use findOneAndUpdate+upsert to avoid E11000 duplicate-key on the unique student index
    await Discussion.findOneAndUpdate(
      { student: studentId },
      { $setOnInsert: { student: studentId, messages: [], lastMessage: '', unreadByAdminCount: 0, unreadByStudentCount: 0 } },
      { upsert: true, new: true }
    );

    let thread = await Discussion.findOne({ student: studentId })
      .populate('messages.sender', 'firstName lastName role avatar');

    // Reset unread count for student
    if (thread.unreadByStudentCount > 0) {
      thread.unreadByStudentCount = 0;
      await thread.save();
    }

    const visibleMessages = (thread.messages || []).filter(m => !m.isDeleted);

    res.json({
      thread: {
        _id: thread._id,
        student: thread.student,
        lastMessage: thread.lastMessage,
        lastMessageAt: thread.lastMessageAt,
        unreadByStudentCount: 0,
      },
      messages: visibleMessages,
    });
  } catch (error) {
    console.error('Error in getMyThread:', error);
    res.status(500).json({ message: 'خطأ في جلب محادثة الدعم والمناقشة' });
  }
};

// ─── Student: Send Message to Admin ──────────────────────────────────
export const sendStudentMessage = async (req, res) => {
  try {
    const studentId = req.user._id;
    const { content, type = 'text', fileUrl = '' } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'محتوى الرسالة مطلوب' });
    }

    let thread = await Discussion.findOneAndUpdate(
      { student: studentId },
      { $setOnInsert: { student: studentId, messages: [] } },
      { upsert: true, new: true }
    );

    const newMessage = {
      sender: studentId,
      senderRole: req.user.role || 'student',
      content: content.trim().substring(0, 3000),
      type,
      fileUrl,
      readBy: [studentId],
    };

    thread.messages.push(newMessage);
    thread.lastMessage = content.trim().substring(0, 150);
    thread.lastMessageAt = new Date();
    thread.lastSender = studentId;
    thread.unreadByAdminCount = (thread.unreadByAdminCount || 0) + 1;

    // Keep message array capped to avoid document bloating
    if (thread.messages.length > 2000) {
      thread.messages = thread.messages.slice(-2000);
    }

    await thread.save();

    // Notify admins
    try {
      const admins = await User.find({ role: 'admin' }).select('_id');
      const studentName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
      const notifs = admins.map(admin => ({
        recipient: admin._id,
        type: 'discussion_reply',
        title: `رسالة جديدة من الطالب: ${studentName}`,
        body: content.trim().substring(0, 120),
        data: { studentId: studentId.toString() },
      }));
      if (notifs.length > 0) {
        await Notification.insertMany(notifs);
      }
    } catch (notifErr) {
      console.warn('Could not dispatch admin notification:', notifErr.message);
    }

    const savedMessage = thread.messages[thread.messages.length - 1];
    res.status(201).json({
      message: 'تم إرسال الرسالة بنجاح',
      data: {
        ...savedMessage.toObject(),
        sender: {
          _id: req.user._id,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          role: req.user.role,
          avatar: req.user.avatar,
        }
      }
    });
  } catch (error) {
    console.error('Error in sendStudentMessage:', error);
    res.status(500).json({ message: 'خطأ في إرسال الرسالة للإدارة' });
  }
};

// ─── Admin: Get All Student Conversations ────────────────────────────
export const getAdminConversations = async (req, res) => {
  try {
    const { q } = req.query;

    let query = {};
    const discussions = await Discussion.find(query)
      .populate('student', 'firstName lastName email phone avatar assignedLevel scheduleDays sessionTime')
      .populate('lastSender', 'firstName lastName role')
      .sort({ lastMessageAt: -1 })
      .lean();

    // Filter out threads with deleted student or search query
    let filtered = discussions.filter(d => d.student);

    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      filtered = filtered.filter(d => {
        const fullName = `${d.student.firstName || ''} ${d.student.lastName || ''}`.toLowerCase();
        const email = (d.student.email || '').toLowerCase();
        const phone = (d.student.phone || '');
        return fullName.includes(term) || email.includes(term) || phone.includes(term);
      });
    }

    const conversations = filtered.map(d => ({
      _id: d._id,
      student: d.student,
      lastMessage: d.lastMessage,
      lastMessageAt: d.lastMessageAt,
      lastSender: d.lastSender,
      unreadByAdminCount: d.unreadByAdminCount || 0,
      totalMessages: d.messages?.length || 0,
    }));

    res.json({ conversations });
  } catch (error) {
    console.error('Error in getAdminConversations:', error);
    res.status(500).json({ message: 'خطأ في جلب محادثات الطلاب' });
  }
};

// ─── Admin: Get Specific Student Conversation Thread ─────────────────
export const getAdminStudentThread = async (req, res) => {
  try {
    const { studentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ message: 'معرّف الطالب غير صالح' });
    }

    const student = await User.findById(studentId)
      .select('firstName lastName email phone avatar assignedLevel scheduleDays sessionTime');
    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود' });
    }

    await Discussion.findOneAndUpdate(
      { student: studentId },
      { $setOnInsert: { student: studentId, messages: [], unreadByAdminCount: 0, unreadByStudentCount: 0 } },
      { upsert: true, new: true }
    );

    let thread = await Discussion.findOne({ student: studentId })
      .populate('messages.sender', 'firstName lastName role avatar');

    // Mark as read by admin
    if (thread.unreadByAdminCount > 0) {
      thread.unreadByAdminCount = 0;
      await thread.save();
    }

    const visibleMessages = (thread.messages || []).filter(m => !m.isDeleted);

    res.json({
      student,
      thread: {
        _id: thread._id,
        unreadByAdminCount: 0,
        lastMessage: thread.lastMessage,
        lastMessageAt: thread.lastMessageAt,
      },
      messages: visibleMessages,
    });
  } catch (error) {
    console.error('Error in getAdminStudentThread:', error);
    res.status(500).json({ message: 'خطأ في جلب تفاصيل محادثة الطالب' });
  }
};

// ─── Admin: Send Reply to Student ────────────────────────────────────
export const sendAdminReply = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { content, type = 'text', fileUrl = '' } = req.body;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ message: 'معرّف الطالب غير صالح' });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'محتوى الرسالة مطلوب' });
    }

    let thread = await Discussion.findOneAndUpdate(
      { student: studentId },
      { $setOnInsert: { student: studentId, messages: [] } },
      { upsert: true, new: true }
    );

    const adminId = req.user._id;
    const newMessage = {
      sender: adminId,
      senderRole: 'admin',
      content: content.trim().substring(0, 3000),
      type,
      fileUrl,
      readBy: [adminId],
    };

    thread.messages.push(newMessage);
    thread.lastMessage = content.trim().substring(0, 150);
    thread.lastMessageAt = new Date();
    thread.lastSender = adminId;
    thread.unreadByStudentCount = (thread.unreadByStudentCount || 0) + 1;

    if (thread.messages.length > 2000) {
      thread.messages = thread.messages.slice(-2000);
    }

    await thread.save();

    // Create Notification for Student
    try {
      await Notification.create({
        recipient: studentId,
        type: 'discussion_reply',
        title: 'رد جديد من إدارة المنصة 💬',
        body: content.trim().substring(0, 120),
        data: { discussionId: thread._id.toString() },
      });
    } catch (notifErr) {
      console.warn('Could not dispatch student notification:', notifErr.message);
    }

    const savedMessage = thread.messages[thread.messages.length - 1];
    res.status(201).json({
      message: 'تم إرسال الرد للطالب بنجاح',
      data: {
        ...savedMessage.toObject(),
        sender: {
          _id: req.user._id,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          role: 'admin',
          avatar: req.user.avatar,
        }
      }
    });
  } catch (error) {
    console.error('Error in sendAdminReply:', error);
    res.status(500).json({ message: 'خطأ في إرسال الرد للطالب' });
  }
};

// ─── Legacy Fallbacks (Prevents 500 crashes if old lesson URLs are pinged) ──
export const getLessonDiscussion = async (req, res) => {
  return getMyThread(req, res);
};

export const sendLessonMessage = async (req, res) => {
  return sendStudentMessage(req, res);
};

export const pinLessonMessage = async (req, res) => {
  return res.json({ message: 'تم تحديث الرسالة' });
};

export const deleteLessonMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    await Discussion.updateOne(
      { 'messages._id': messageId },
      { $set: { 'messages.$.isDeleted': true } }
    );
    res.json({ message: 'تم حذف الرسالة بنجاح' });
  } catch (err) {
    res.status(500).json({ message: 'خطأ في حذف الرسالة' });
  }
};

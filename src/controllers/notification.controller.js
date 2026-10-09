import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
import { sendWebPush } from '../utils/webpush.js';

export const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id })
      .sort({ sentAt: -1 })
      .limit(50);
    const unreadCount = notifications.filter(n => !n.isRead).length;
    res.json({ notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { isRead: true, readAt: new Date() }
    );
    if (!notif) return res.status(404).json({ message: 'الإشعار غير موجود' });
    res.json({ message: 'تم التعليم كمقروء' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    res.json({ message: 'تم تعليم الكل كمقروء' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const notif = await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.user._id });
    if (!notif) return res.status(404).json({ message: 'الإشعار غير موجود' });
    res.json({ message: 'تم الحذف' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

const ALLOWED_TYPES = ['live_starting', 'exam_scheduled', 'exam', 'result_ready', 'grade_posted', 'group_assigned', 'plan_updated', 'progress_update', 'attendance', 'feedback', 'message', 'general'];

export const sendNotification = async (req, res) => {
  try {
    const { recipientId, type, title, body, data } = req.body;
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ message: 'نوع الإشعار غير صالح' });
    }
    // Central dispatcher honors the admin on/off switch (DB + push).
    // Frontend polls GET /notifications (Vercel-safe, no socket.io).
    const { notifyUser } = await import('../utils/notify.js');
    const notification = await notifyUser({ recipient: recipientId, type, title, body, data, push: true });

    res.json({ message: 'تم الإرسال', notification });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

export const sendGroupNotification = async (req, res) => {
  try {
    const { type, title, body, data } = req.body;
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ message: 'نوع الإشعار غير صالح' });
    }
    const group = await Group.findById(req.params.groupId).populate('students', 'pushSubscription');

    const { notifyMany } = await import('../utils/notify.js');
    const notifs = await notifyMany(
      group.students.map((student) => ({
        recipient: student._id,
        type,
        title,
        body,
        data,
        push: true,
        pushSubscription: student.pushSubscription || undefined,
      }))
    );

    res.json({ message: `تم الإرسال لـ ${notifs.length} طالب`, count: notifs.length });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// ─── Admin notification switch ────────────────────────────────────
// GET /api/notifications/settings (admin) — master + per-category toggles
export const getNotificationSettings = async (req, res) => {
  try {
    const { default: NotificationSetting } = await import('../models/NotificationSetting.js');
    const settings = await NotificationSetting.getSettings();
    res.json({ settings });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب إعدادات التنبيهات' });
  }
};

// PUT /api/notifications/settings (admin)
export const updateNotificationSettings = async (req, res) => {
  try {
    const { default: NotificationSetting } = await import('../models/NotificationSetting.js');
    const { invalidateNotificationSettingsCache } = await import('../utils/notify.js');
    const settings = await NotificationSetting.getSettings();

    if (req.body.enabled !== undefined) {
      settings.enabled = Boolean(req.body.enabled);
    }
    if (req.body.categories && typeof req.body.categories === 'object') {
      const allowed = ['live', 'exams', 'payments', 'discussion', 'general'];
      for (const key of allowed) {
        if (req.body.categories[key] !== undefined) {
          settings.categories[key] = Boolean(req.body.categories[key]);
        }
      }
    }
    await settings.save();
    invalidateNotificationSettingsCache();
    res.json({ message: 'تم حفظ إعدادات التنبيهات', settings });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حفظ إعدادات التنبيهات' });
  }
};

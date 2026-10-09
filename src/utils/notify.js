import Notification from '../models/Notification.js';
import User from '../models/User.js';
import NotificationSetting from '../models/NotificationSetting.js';
import { sendWebPush } from './webpush.js';

// ─── Central notification dispatcher ────────────────────────────
// Every user-facing alert should flow through notifyUser/notifyMany so the
// admin on/off switch (master + per-category) is enforced in ONE place.
// Behavior contract: when a type is disabled, NOTHING is created or sent
// (callers treat the result exactly like a normal success).
// Fail-open: if settings can't be read, notifications flow normally.

// Notification type -> admin-toggleable category
export const TYPE_CATEGORY = {
  live_starting: 'live',
  session_due: 'live',
  exam: 'exams',
  exam_scheduled: 'exams',
  result_ready: 'exams',
  grade_posted: 'exams',
  payment_submitted: 'payments',
  payment_approved: 'payments',
  payment_rejected: 'payments',
  discussion_reply: 'discussion',
  message: 'discussion',
  general: 'general',
  group_assigned: 'general',
  plan_updated: 'general',
  progress_update: 'general',
  attendance: 'general',
  feedback: 'general',
};

let cachedSettings = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30 * 1000;

export const invalidateNotificationSettingsCache = () => {
  cachedSettings = null;
  cachedAt = 0;
};

const getSettingsCached = async () => {
  if (cachedSettings && Date.now() - cachedAt < CACHE_TTL_MS) return cachedSettings;
  const s = await NotificationSetting.getSettings();
  cachedSettings = s;
  cachedAt = Date.now();
  return s;
};

/** True when this notification type may be created AND pushed right now. */
export const isNotificationAllowed = async (type) => {
  try {
    const s = await getSettingsCached();
    if (!s) return true;
    if (s.enabled === false) return false;
    const cat = TYPE_CATEGORY[type] || 'general';
    return s.categories?.[cat] !== false;
  } catch (_) {
    return true; // fail-open: never block alerts on infra errors
  }
};

const resolveSubscription = async (recipientId, provided) => {
  if (provided) return provided;
  try {
    const user = await User.findById(recipientId).select('pushSubscription');
    return user?.pushSubscription || null;
  } catch (_) {
    return null;
  }
};

/**
 * Create one notification (+ optional Web Push), honoring the admin switch.
 * @returns the created Notification, or null when suppressed by settings.
 */
export const notifyUser = async ({ recipient, type, title, body, data, push = true, pushSubscription }) => {
  if (!(await isNotificationAllowed(type))) return null;
  const notif = await Notification.create({ recipient, type, title, body, data });
  if (push) {
    try {
      const sub = await resolveSubscription(recipient, pushSubscription);
      if (sub) await sendWebPush(sub, title, body, data);
    } catch (_) {}
  }
  return notif;
};

/**
 * Bulk version: one insertMany for allowed items + push fan-out.
 * Push subscriptions are resolved with a single $in query for items
 * that didn't provide one inline.
 */
export const notifyMany = async (items) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const allowed = [];
  for (const item of items) {
    if (await isNotificationAllowed(item.type)) allowed.push(item);
  }
  if (allowed.length === 0) return [];

  const created = await Notification.insertMany(
    allowed.map(({ recipient, type, title, body, data }) => ({ recipient, type, title, body, data }))
  );

  const missingIds = [
    ...new Set(
      allowed.filter((i) => i.push && !i.pushSubscription).map((i) => i.recipient?.toString?.() || i.recipient)
    ),
  ];
  let subMap = new Map();
  if (missingIds.length > 0) {
    try {
      const users = await User.find({ _id: { $in: missingIds } }).select('_id pushSubscription');
      subMap = new Map(users.map((u) => [u._id.toString(), u.pushSubscription || null]));
    } catch (_) {}
  }

  await Promise.allSettled(
    allowed
      .filter((i) => i.push)
      .map((i) => {
        const sub = i.pushSubscription || subMap.get(i.recipient?.toString?.() || i.recipient) || null;
        if (!sub) return Promise.resolve();
        return sendWebPush(sub, i.title, i.body, i.data);
      })
  );

  return created;
};

import webpush from 'web-push';
import NotificationSetting from '../models/NotificationSetting.js';

// Scaffolded — configure VAPID keys in production
const isConfigured = process.env.VAPID_PUBLIC_KEY && 
  process.env.VAPID_PRIVATE_KEY && 
  process.env.VAPID_PUBLIC_KEY !== 'placeholder_public_key';

if (isConfigured) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@quran-platform.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export const sendWebPush = async (subscription, title, body, data = {}) => {
  if (!isConfigured || !subscription) {
    console.log(`[WebPush SCAFFOLD] Would send: ${title} - ${body}`);
    return;
  }

  // Global backstop: when the admin pauses ALL notifications, no push
  // leaves the server — even from call sites that predate the dispatcher.
  // (Per-category gating lives in utils/notify.js; DB reads are untouched.)
  try {
    const settings = await NotificationSetting.findOne().select('enabled').lean();
    if (settings && settings.enabled === false) return false;
  } catch (_) {
    // fail-open: send normally if settings can't be read
  }

  const payload = JSON.stringify({
    title,
    body,
    icon: '/logo.png',
    badge: '/badge.png',
    data: { url: '/', ...data },
  });

  try {
    await webpush.sendNotification(subscription, payload);
  } catch (error) {
    console.error('WebPush error:', error.statusCode, error.body);
    // If subscription expired, return false so caller can clean it up
    if (error.statusCode === 410) return false;
  }
  return true;
};

export const getVapidPublicKey = () => {
  return process.env.VAPID_PUBLIC_KEY || '';
};

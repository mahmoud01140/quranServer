import webpush from 'web-push';
import NotificationSetting from '../models/NotificationSetting.js';

const cleanStr = (val) => (val || '').trim().replace(/^["']|["']$/g, '');

let isVapidConfigured = false;

export const ensureVapidConfigured = () => {
  const publicKey = cleanStr(process.env.VAPID_PUBLIC_KEY);
  const privateKey = cleanStr(process.env.VAPID_PRIVATE_KEY);
  const email = cleanStr(process.env.VAPID_EMAIL) || 'mailto:admin@quran-platform.com';

  if (!publicKey || !privateKey || publicKey === 'placeholder_public_key') {
    return false;
  }

  try {
    webpush.setVapidDetails(email, publicKey, privateKey);
    isVapidConfigured = true;
    return true;
  } catch (error) {
    console.error('❌ Failed to configure WebPush VAPID details:', error.message);
    isVapidConfigured = false;
    return false;
  }
};

// Auto-run on module load
ensureVapidConfigured();

export const sendWebPush = async (subscription, title, body, data = {}) => {
  if (!isVapidConfigured && !ensureVapidConfigured()) {
    console.log(`[WebPush SCAFFOLD] Would send: ${title} - ${body}`);
    return false;
  }

  if (!subscription || !subscription.endpoint) {
    return false;
  }

  // Global backstop: when the admin pauses ALL notifications, no push leaves the server
  try {
    const settings = await NotificationSetting.findOne().select('enabled').lean();
    if (settings && settings.enabled === false) return false;
  } catch (_) {
    // fail-open: send normally if settings can't be read
  }

  const payload = JSON.stringify({
    title,
    body,
    icon: '/quran-icon.svg',
    badge: '/quran-icon.svg',
    data: { url: '/', ...data },
  });

  try {
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (error) {
    console.error('WebPush error:', error.statusCode, error.body || error.message);
    // If subscription expired or not found, return false so caller can clean it up
    if (error.statusCode === 410 || error.statusCode === 404) return false;
    return false;
  }
};

export const getVapidPublicKey = () => {
  return cleanStr(process.env.VAPID_PUBLIC_KEY);
};


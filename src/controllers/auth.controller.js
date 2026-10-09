import User, { normalizePhone } from '../models/User.js';
import ExamResult from '../models/ExamResult.js';
import Notification from '../models/Notification.js';
import { generateToken, setTokenCookie, clearTokenCookie } from '../utils/jwt.js';
import { sendPasswordResetEmail } from '../utils/email.js';
import { getVapidPublicKey, sendWebPush } from '../utils/webpush.js';
import crypto from 'crypto';

// POST /api/auth/register
export const register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone, country, dateOfBirth, gender, role } = req.body;

    // Input validation
    if (!firstName?.trim() || !lastName?.trim()) {
      return res.status(400).json({ message: 'الاسم الأول واسم العائلة مطلوبان' });
    }
    // الهاتف هو معرّف الدخول الأساسي — مطلوب وفريد
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ message: 'رقم الهاتف مطلوب — أدخل رقماً مصرياً صالحاً (01xxxxxxxxx)' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    // البريد اختياري (للاستعادة فقط) — يُقبل فارغاً
    const normalizedEmail = email?.trim() ? email.trim().toLowerCase() : undefined;

    const existingUser = await User.findOne({
      $or: [{ phone: normalizedPhone }, ...(normalizedEmail ? [{ email: normalizedEmail }] : [])],
    });
    if (existingUser) {
      return res.status(400).json({
        message: existingUser.phone === normalizedPhone
          ? 'رقم الهاتف مسجل مسبقاً — سجل الدخول مباشرة'
          : 'البريد الإلكتروني مسجل مسبقاً',
      });
    }

    const user = await User.create({
      firstName: firstName.trim(), lastName: lastName.trim(),
      email: normalizedEmail, password,
      phone: normalizedPhone, country, dateOfBirth, gender,
      role: role === 'parent' ? 'parent' : 'student',
      isApproved: role === 'parent' ? true : false,
      // Email verification removed permanently: accounts are active immediately.
      isVerified: true,
    });

    // تنبيه الإدارة بمستخدم جديد (DB + Web Push — لا يفشل التسجيل أبداً)
    try {
      const admins = await User.find({ role: 'admin' }).select('_id pushSubscription');
      const userLabel = `${user.firstName} ${user.lastName}`.trim() || 'مستخدم جديد';
      const roleLabel = user.role === 'parent' ? 'ولي أمر' : user.role === 'teacher' ? 'معلم' : 'طالب';
      await Promise.allSettled(
        admins.map(async (admin) => {
          const notif = await Notification.create({
            recipient: admin._id,
            type: 'general',
            title: `👤 مستخدم جديد: ${userLabel}`,
            body: `سجّل ${roleLabel} جديد (${user.phone || user.email || 'بدون بيانات تواصل'}) — بانتظار المراجعة والاعتماد.`,
            data: { userId: user._id.toString(), link: '/admin/users' },
          });
          if (admin.pushSubscription) {
            await sendWebPush(admin.pushSubscription, notif.title, notif.body, notif.data);
          }
        })
      );
    } catch (_) {}

    const token = generateToken(user._id, user.role);
    setTokenCookie(res, token);

    res.status(201).json({
      message: 'تم إنشاء الحساب بنجاح.',
      user: user.toJSON(),
      token,
    });
  } catch (error) {
    console.error('Register error:', error);
    // Handle duplicate key error specifically
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(400).json({
        message: field === 'phone' ? 'رقم الهاتف مسجل مسبقاً — سجل الدخول مباشرة' : 'البريد الإلكتروني مسجل مسبقاً',
      });
    }
    res.status(500).json({ message: 'خطأ في التسجيل' });
  }
};

// POST /api/auth/login — الدخول برقم الهاتف أو البريد الإلكتروني
export const login = async (req, res) => {
  try {
    // identifier جديد يقبل الهاتف أو البريد — وemail القديمة ما زالت مدعومة للتوافق
    const identifier = (req.body.identifier ?? req.body.email)?.trim?.() ?? req.body.identifier ?? req.body.email;
    const { password } = req.body;

    if (!identifier || typeof identifier !== 'string' || !identifier.trim() || !password) {
      return res.status(400).json({ message: 'رقم الهاتف أو البريد الإلكتروني وكلمة المرور مطلوبان' });
    }

    const idTrimmed = identifier.trim();
    let user = null;
    if (idTrimmed.includes('@')) {
      user = await User.findOne({ email: idTrimmed.toLowerCase() }).select('+password');
    } else {
      const normalizedPhone = normalizePhone(idTrimmed);
      if (normalizedPhone) {
        user = await User.findOne({ phone: normalizedPhone }).select('+password');
      }
      // توافق: جرّب المطابقة الخام للهواتف القديمة غير الموحدة قبل رفض الدخول
      if (!user) {
        const rawDigits = idTrimmed.replace(/[^\d]/g, '');
        user = await User.findOne({
          $or: [{ phone: idTrimmed }, { phone: rawDigits }],
        }).select('+password');
      }
    }
    if (!user) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'الحساب معطل. تواصل مع الإدارة.' });
    }

    const token = generateToken(user._id, user.role);
    setTokenCookie(res, token);

    res.json({
      message: 'تم تسجيل الدخول بنجاح',
      user: user.toJSON(),
      token,
    });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تسجيل الدخول' });
  }
};

// POST /api/auth/logout
export const logout = (req, res) => {
  clearTokenCookie(res);
  res.json({ message: 'تم تسجيل الخروج بنجاح' });
};

// GET /api/auth/me
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('group', 'name level liveRoomId schedule teacher')
      .select('-password -otp -otpExpires -resetToken');
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب البيانات' });
  }
};

// POST /api/auth/forgot-password
export const forgotPassword = async (req, res) => {
  try {
    // يقبل البريد (إرسال رابط) أو رقم الهاتف (توجيه للإدارة — لا SMS مدفوع)
    const identifier = (req.body.identifier ?? req.body.email)?.trim?.() ?? '';
    if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
      return res.status(400).json({ message: 'أدخل رقم الهاتف أو البريد الإلكتروني' });
    }
    const idTrimmed = identifier.trim();
    if (!idTrimmed.includes('@')) {
      return res.json({ message: 'لاستعادة الحساب برقم الهاتف تواصل مع الإدارة لتعيين كلمة مرور جديدة لك' });
    }
    const normalizedEmail = idTrimmed.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ message: 'إذا كان البريد مسجلاً، ستتلقى رابط إعادة التعيين' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
    await sendPasswordResetEmail(normalizedEmail, resetUrl, user.firstName);

    res.json({ message: 'تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// POST /api/auth/reset-password
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: 'الرابط وكلمة المرور الجديدة مطلوبان' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetToken: hashedToken,
      resetTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: 'الرابط غير صالح أو منتهي الصلاحية' });
    }

    user.password = password;
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    await user.save();

    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إعادة التعيين' });
  }
};

// GET /api/auth/vapid-key (public — the VAPID public key is public by design)
export const getVapidKey = async (req, res) => {
  try {
    res.json({ key: getVapidPublicKey() || null });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// PUT /api/auth/push-subscription
export const updatePushSubscription = async (req, res) => {
  try {
    const { subscription } = req.body;
    await User.findByIdAndUpdate(req.user._id, { pushSubscription: subscription });
    res.json({ message: 'تم تسجيل اشتراك الإشعارات' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// PUT /api/auth/change-password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    // إذا تم تقديم كلمة المرور الحالية نتحقق منها، وإن كان غير أدمن فلابد من تقديمها
    if (currentPassword) {
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });
      }
    } else if (user.role !== 'admin') {
      return res.status(400).json({ message: 'يرجى إدخال كلمة المرور الحالية' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء تغيير كلمة المرور' });
  }
};


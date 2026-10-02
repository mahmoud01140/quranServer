import Payment from '../models/Payment.js';
import PaymentSetting from '../models/PaymentSetting.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { getFileUrl } from '../middleware/upload.middleware.js';

// ─── Helper: Check and update user subscription status ─────────
export const evaluateUserSubscription = async (user) => {
  if (!user || user.role !== 'student') {
    return {
      canAccessLiveSession: true,
      isTrial: false,
      trialSessionsAttended: 0,
      trialSessionsAllowed: 1,
      isExpiringSoon: false,
      daysRemaining: 999,
      isExpired: false,
      status: 'active',
    };
  }

  const settings = await PaymentSetting.getSettings();
  const reminderDays = settings.reminderDaysBeforeExpiry || 3;
  const trialAllowed = settings.freeTrialSessionsCount || 1;

  let sub = user.subscription || {
    plan: 'monthly',
    status: 'trial',
    trialSessionsAttended: 0,
    trialSessionsAllowed: trialAllowed,
  };

  const now = new Date();
  let daysRemaining = 0;
  let isExpired = false;
  let isExpiringSoon = false;
  let isModified = false;

  if (sub.endDate) {
    const end = new Date(sub.endDate);
    const diffTime = end - now;
    daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    if (diffTime <= 0) {
      isExpired = true;
      if (sub.status === 'active') {
        sub.status = 'expired';
        isModified = true;
      }
    } else if (daysRemaining <= reminderDays && sub.status === 'active') {
      isExpiringSoon = true;

      // Send reminder notification if not sent today
      const lastSent = sub.lastReminderSentAt ? new Date(sub.lastReminderSentAt) : null;
      const hoursSinceLast = lastSent ? (now - lastSent) / (1000 * 60 * 60) : 999;
      if (hoursSinceLast > 24) {
        await Notification.create({
          recipient: user._id,
          type: 'plan_updated',
          title: 'تنبيه باقتراب موعد سداد الاشتراك الشهري ⚠️',
          body: `يتبقى ${daysRemaining} ${daysRemaining === 1 ? 'يوم' : daysRemaining === 2 ? 'يومان' : 'أيام'} على انتهاء اشتراكك في الحلقات. يرجى التجديد عبر فودافون كاش أو انستاباي لضمان استمرار حضورك دون انقطاع.`,
          data: { link: '/student/subscription', daysRemaining },
        });
        sub.lastReminderSentAt = now;
        isModified = true;
      }
    }
  }

  if (isModified) {
    user.subscription = sub;
    await user.save();
  }

  // النظام فردي: لا مجموعات — الوصول يعتمد على السداد أو التجربة فقط
  const trialAttended = sub.trialSessionsAttended || 0;
  const hasTrialRemaining = trialAttended < trialAllowed;
  const isPaidActive = sub.status === 'active' && !isExpired;
  const canAccessLiveSession = isPaidActive || hasTrialRemaining;

  return {
    ...sub.toObject ? sub.toObject() : sub,
    daysRemaining,
    isExpired,
    isExpiringSoon,
    canAccessLiveSession,
    isTrial: !isPaidActive && hasTrialRemaining,
    trialSessionsAttended: trialAttended,
    trialSessionsAllowed: trialAllowed,
    hasGroup: Boolean(user.group),
    canSubscribe: true,
  };
};

// ─── GET /api/payments/public-config ─────────────────────────────
// Returns single unified plan info and active payment instructions
export const getPaymentConfig = async (req, res) => {
  try {
    const settings = await PaymentSetting.getSettings();

    const plan = {
      id: 'monthly',
      name: settings.plan?.name || 'الاشتراك الشهري في الحلقات',
      description: settings.plan?.description || 'اشتراك شهري شامل لحضور كافة الحلقات المباشرة، خطة الحفظ والختم، وتصحيح التلاوات مع المعلم',
      priceEGP: settings.plan?.priceEGP || 250,
      priceSAR: settings.plan?.priceSAR || 49,
      quarterlyDiscountPercent: settings.plan?.quarterlyDiscountPercent || 10,
      annualDiscountPercent: settings.plan?.annualDiscountPercent || 20,
      period: 'شهري',
      features: [
        'حضور جميع الجلسات المباشرة الفردية التفاعلية مع المعلم',
        'خطة متابعة الحفظ والختم ومراجعة المتشابهات والتجويد',
        'مراجعة وتصحيح التلاوات والتسميع الصوتي المباشر',
        'الوصول للتسجيلات ومكتبة الشروحات والمصادر التعليمية',
        'بنك الاختبارات والتقييمات المستمرة',
        'شهادة إتمام معتمدة وموثقة عند إنهاء المنهج الدراسي',
      ],
    };

    res.json({
      success: true,
      plan,
      freeTrialSessionsCount: settings.freeTrialSessionsCount || 1,
      reminderDaysBeforeExpiry: settings.reminderDaysBeforeExpiry || 3,
      methods: {
        vodafoneCash: {
          enabled: settings.vodafoneEnabled,
          numbers: settings.vodafoneCashNumbers || ['01012345678'],
          instructions: settings.vodafoneInstructions,
          ussdCodeTemplate: '*9*7*{phone}*{amount}#',
        },
        instaPay: {
          enabled: settings.instaPayEnabled,
          address: settings.instaPayAddress || 'quran-academy@instapay',
          phone: settings.instaPayPhone || '01012345678',
          accountName: settings.instaPayAccountName || 'أكاديمية تحفيظ القرآن الكريم',
          instructions: settings.instaPayInstructions,
        },
      },
      support: {
        phone: settings.supportPhone,
        whatsapp: settings.supportWhatsapp,
      },
    });
  } catch (error) {
    console.error('Error fetching payment config:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء تحميل بيانات الدفع والاشتراك' });
  }
};

// ─── POST /api/payments/submit ──────────────────────────────────
// Student submits a payment request with receipt screenshot
export const submitPaymentRequest = async (req, res) => {
  try {
    const { billingCycle = 'monthly', amount, currency = 'EGP', method, senderPhone, senderName, referenceNumber, notes } = req.body;

    if (!method || !['vodafone_cash', 'instapay'].includes(method)) {
      return res.status(400).json({ message: 'طريقة الدفع غير صالحة. يرجى اختيار فودافون كاش أو انستاباي' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'يرجى إرفاق صورة إيصال التحويل أو لقطة الشاشة للعملية' });
    }

    // النظام فردي: السداد متاح لكل طالب دون شرط مجموعة
    const studentUser = await User.findById(req.user._id);
    if (!studentUser) {
      return res.status(400).json({ message: 'تعذر التحقق من حسابك.' });
    }

    // Check if user already has a pending payment request
    const existingPending = await Payment.findOne({ user: req.user._id, status: 'pending' });
    if (existingPending) {
      return res.status(400).json({ message: 'لديك طلب سداد قيد المراجعة بالفعل حالياً. يرجى الانتظار حتى يتم تدقيقه من الإدارة.' });
    }

    // Check duplicate reference number (if provided)
    const trimmedRef = (referenceNumber || '').trim();
    if (trimmedRef) {
      const duplicateRef = await Payment.findOne({
        referenceNumber: trimmedRef,
        status: { $in: ['pending', 'approved'] },
      });
      if (duplicateRef) {
        return res.status(400).json({ message: 'رقم العملية أو الحوالة مسجل مسبقاً في النظام. يرجى التأكد من بيانات الإيصال.' });
      }
    }

    const receiptUrl = getFileUrl(req, req.file.path);

    // Calculate server-enforced pricing & duration based on settings
    const settings = await PaymentSetting.getSettings();
    const basePrice = currency === 'SAR' ? (settings.plan?.priceSAR || 49) : (settings.plan?.priceEGP || 250);

    let activationDurationDays = 30;
    let calculatedAmount = basePrice;

    if (billingCycle === 'quarterly') {
      activationDurationDays = 90;
      const discount = settings.plan?.quarterlyDiscountPercent || 10;
      calculatedAmount = Math.round(basePrice * 3 * (1 - discount / 100));
    } else if (billingCycle === 'annual') {
      activationDurationDays = 365;
      const discount = settings.plan?.annualDiscountPercent || 20;
      calculatedAmount = Math.round(basePrice * 12 * (1 - discount / 100));
    } else {
      activationDurationDays = 30;
      calculatedAmount = basePrice;
    }

    const payment = await Payment.create({
      user: req.user._id,
      plan: 'monthly',
      billingCycle,
      amount: calculatedAmount,
      currency,
      method,
      senderPhone: senderPhone || '',
      senderName: senderName || '',
      referenceNumber: trimmedRef,
      receiptUrl,
      activationDurationDays,
      notes: notes || '',
      status: 'pending',
    });

    // Notify all admins about new payment request
    const admins = await User.find({ role: 'admin' }).select('_id');
    const notificationPromises = admins.map(admin =>
      Notification.create({
        recipient: admin._id,
        type: 'payment_submitted',
        title: 'طلب سداد واشتراك جديد 💳',
        body: `قام الطالب ${req.user.firstName} ${req.user.lastName} بتقديم إيصال تحويل بقيمة ${payment.amount} ${currency} عبر ${method === 'vodafone_cash' ? 'فودافون كاش' : 'انستاباي'}.`,
        data: { paymentId: payment._id, userId: req.user._id, method, amount: payment.amount },
      })
    );
    await Promise.all(notificationPromises);

    // Emit socket event to admins
    const io = req.app.get('io');
    if (io) {
      io.emit('admin-payment-received', {
        paymentId: payment._id,
        user: { _id: req.user._id, name: `${req.user.firstName} ${req.user.lastName}`, email: req.user.email },
        method,
        amount: payment.amount,
        createdAt: payment.createdAt,
      });
    }

    res.status(201).json({
      success: true,
      message: 'تم إرسال إيصال التحويل بنجاح! سيقوم المشرف بمراجعته وتفعيل اشتراكك في أقرب وقت.',
      payment,
    });
  } catch (error) {
    console.error('Error submitting payment:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء معالجة طلب الدفع', error: error.message });
  }
};

// ─── GET /api/payments/my-history ───────────────────────────────
// Student gets their payment history & dynamic subscription access status
export const getMyPayments = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const subscriptionStatus = await evaluateUserSubscription(user);

    const payments = await Payment.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      subscription: subscriptionStatus,
      payments,
    });
  } catch (error) {
    console.error('Error fetching my payments:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء جلب سجل المدفوعات' });
  }
};

// ─── GET /api/payments/admin/all ────────────────────────────────
// Admin gets all payment requests with filter and stats
export const getAllPaymentsAdmin = async (req, res) => {
  try {
    const { status, method, search, page = 1, limit = 30 } = req.query;

    const query = {};
    if (status && status !== 'all') {
      query.status = status;
    }
    if (method && method !== 'all') {
      query.method = method;
    }

    if (search && search.trim()) {
      const sRegex = new RegExp(search.trim(), 'i');
      const matchingUsers = await User.find({
        $or: [
          { firstName: sRegex },
          { lastName: sRegex },
          { email: sRegex },
          { phone: sRegex },
        ]
      }).select('_id');
      const userIds = matchingUsers.map(u => u._id);

      query.$or = [
        { user: { $in: userIds } },
        { referenceNumber: sRegex },
        { senderPhone: sRegex },
        { senderName: sRegex },
      ];
    }

    const total = await Payment.countDocuments(query);

    const skip = (Number(page) - 1) * Number(limit);

    const payments = await Payment.find(query)
      .populate('user', 'firstName lastName email phone avatar assignedLevel subscription')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    // Summary statistics
    const [totalRevenueResult, pendingCount, approvedCount, rejectedCount] = await Promise.all([
      Payment.aggregate([
        { $match: { status: 'approved' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Payment.countDocuments({ status: 'pending' }),
      Payment.countDocuments({ status: 'approved' }),
      Payment.countDocuments({ status: 'rejected' }),
    ]);

    const totalRevenue = totalRevenueResult[0]?.total || 0;

    res.json({
      success: true,
      payments,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
      stats: {
        totalRevenue,
        pendingCount,
        approvedCount,
        rejectedCount,
      },
    });
  } catch (error) {
    console.error('Error fetching admin payments:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء جلب طلبات الدفع' });
  }
};

// ─── POST /api/payments/admin/:id/approve ───────────────────────
// Admin approves payment and activates student's subscription & restores group access
export const approvePaymentAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { customDurationDays, notes } = req.body;

    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({ message: 'طلب الدفع غير موجود' });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({
        message: `لا يمكن اعتماد هذا الطلب لأنه تمت مراجعته مسبقاً وهو بحالة "${payment.status === 'approved' ? 'معتمد' : 'مرفوض'}"`
      });
    }

    const durationDays = Number(customDurationDays) || payment.activationDurationDays || 30;
    const now = new Date();

    // Fetch user to check current subscription and allow stacking
    const user = await User.findById(payment.user);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم صاحب الطلب غير موجود' });
    }

    let startDate = now;
    let endDate;

    // Subscription Stacking: If user already has an active subscription with remaining time, extend it
    if (user.subscription?.status === 'active' && user.subscription.endDate && new Date(user.subscription.endDate) > now) {
      startDate = new Date(user.subscription.startDate || now);
      const currentEnd = new Date(user.subscription.endDate);
      endDate = new Date(currentEnd.getTime() + durationDays * 24 * 60 * 60 * 1000);
    } else {
      endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    }

    // Update payment record
    payment.status = 'approved';
    payment.activationDurationDays = durationDays;
    payment.reviewedBy = req.user._id;
    payment.reviewedAt = now;
    if (notes) payment.notes = notes;
    await payment.save();

    // Update User subscription
    user.subscription = {
      plan: 'monthly',
      status: 'active',
      startDate,
      endDate,
      paymentMethod: payment.method,
      lastPaymentId: payment._id,
      trialSessionsAttended: 1, // mark trial as converted
      trialSessionsAllowed: 1,
    };
    await user.save();

    // Create notification for student
    await Notification.create({
      recipient: user._id,
      type: 'payment_approved',
      title: 'تم اعتماد اشتراكك وتفعيل صلاحياتك بنجاح! 🎉',
      body: `تمت الموافقة على سداد الاشتراك وتفعيل حسابك لمدة ${durationDays} يوماً حتى ${endDate.toLocaleDateString('ar-EG')}. يمكنك الآن حضور حصصك المباشرة بحرية.`,
      data: { paymentId: payment._id, endDate },
    });

    // Socket notification to user
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${user._id}`).emit('subscription-updated', {
        status: 'active',
        startDate,
        endDate,
        canAccessLiveSession: true,
      });
    }

    res.json({
      success: true,
      message: `تم اعتماد السداد وتفعيل الاشتراك للمستخدم بنجاح حتى ${endDate.toLocaleDateString('ar-EG')}`,
      payment,
    });
  } catch (error) {
    console.error('Error approving payment:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء اعتماد طلب الدفع' });
  }
};

// ─── POST /api/payments/admin/:id/reject ────────────────────────
// Admin rejects payment with a reason
export const rejectPaymentAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, notes } = req.body;

    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({ message: 'طلب الدفع غير موجود' });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({
        message: `لا يمكن رفض هذا الطلب لأنه تمت مراجعته مسبقاً وهو بحالة "${payment.status === 'approved' ? 'معتمد' : 'مرفوض'}"`
      });
    }

    payment.status = 'rejected';
    payment.rejectionReason = reason || 'لم نتمكن من التحقق من صحة التحويل المرفق.';
    payment.reviewedBy = req.user._id;
    payment.reviewedAt = new Date();
    if (notes) payment.notes = notes;
    await payment.save();

    // Create notification for student
    await Notification.create({
      recipient: payment.user,
      type: 'payment_rejected',
      title: 'تنبيه بخصوص إيصال التحويل ⚠️',
      body: `تعذر اعتماد إيصال التحويل للسبب التالي: "${payment.rejectionReason}". يمكنك تقديم إيصال صحيح أو التواصل مع الدعم الفني.`,
      data: { paymentId: payment._id, reason: payment.rejectionReason },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${payment.user}`).emit('payment-rejected', {
        paymentId: payment._id,
        reason: payment.rejectionReason,
      });
    }

    res.json({
      success: true,
      message: 'تم رفض طلب الدفع وإشعار الطالب بالسبب',
      payment,
    });
  } catch (error) {
    console.error('Error rejecting payment:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء رفض طلب الدفع' });
  }
};

// ─── GET /api/payments/admin/settings ───────────────────────────
export const getPaymentSettingsAdmin = async (req, res) => {
  try {
    const settings = await PaymentSetting.getSettings();
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error getting payment settings:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء جلب إعدادات الدفع' });
  }
};

// ─── PUT /api/payments/admin/settings ───────────────────────────
export const updatePaymentSettingsAdmin = async (req, res) => {
  try {
    const {
      vodafoneCashNumbers,
      vodafoneInstructions,
      vodafoneEnabled,
      instaPayAddress,
      instaPayPhone,
      instaPayAccountName,
      instaPayInstructions,
      instaPayEnabled,
      plan,
      freeTrialSessionsCount,
      reminderDaysBeforeExpiry,
      supportPhone,
      supportWhatsapp,
    } = req.body;

    let settings = await PaymentSetting.getSettings();

    if (vodafoneCashNumbers !== undefined) {
      settings.vodafoneCashNumbers = Array.isArray(vodafoneCashNumbers)
        ? vodafoneCashNumbers
        : String(vodafoneCashNumbers).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (vodafoneInstructions !== undefined) settings.vodafoneInstructions = vodafoneInstructions;
    if (vodafoneEnabled !== undefined) settings.vodafoneEnabled = Boolean(vodafoneEnabled);

    if (instaPayAddress !== undefined) settings.instaPayAddress = instaPayAddress;
    if (instaPayPhone !== undefined) settings.instaPayPhone = instaPayPhone;
    if (instaPayAccountName !== undefined) settings.instaPayAccountName = instaPayAccountName;
    if (instaPayInstructions !== undefined) settings.instaPayInstructions = instaPayInstructions;
    if (instaPayEnabled !== undefined) settings.instaPayEnabled = Boolean(instaPayEnabled);

    if (plan) {
      if (plan.name !== undefined) settings.plan.name = plan.name;
      if (plan.description !== undefined) settings.plan.description = plan.description;
      if (plan.priceEGP !== undefined) settings.plan.priceEGP = Number(plan.priceEGP) || settings.plan.priceEGP;
      if (plan.priceSAR !== undefined) settings.plan.priceSAR = Number(plan.priceSAR) || settings.plan.priceSAR;
      // الخصومات تُحفظ فعلياً (0% مسموح) بدل تجاهلها
      if (plan.quarterlyDiscountPercent !== undefined && plan.quarterlyDiscountPercent !== '') {
        const v = Number(plan.quarterlyDiscountPercent);
        if (!Number.isNaN(v)) settings.plan.quarterlyDiscountPercent = Math.min(100, Math.max(0, v));
      }
      if (plan.annualDiscountPercent !== undefined && plan.annualDiscountPercent !== '') {
        const v = Number(plan.annualDiscountPercent);
        if (!Number.isNaN(v)) settings.plan.annualDiscountPercent = Math.min(100, Math.max(0, v));
      }
    }

    if (freeTrialSessionsCount !== undefined) {
      settings.freeTrialSessionsCount = Number(freeTrialSessionsCount) || 1;
    }
    if (reminderDaysBeforeExpiry !== undefined) {
      settings.reminderDaysBeforeExpiry = Number(reminderDaysBeforeExpiry) || 3;
    }

    if (supportPhone !== undefined) settings.supportPhone = supportPhone;
    if (supportWhatsapp !== undefined) settings.supportWhatsapp = supportWhatsapp;

    await settings.save();

    res.json({
      success: true,
      message: 'تم حفظ وتحديث إعدادات الاشتراك وطرق الدفع بنجاح!',
      settings,
    });
  } catch (error) {
    console.error('Error updating payment settings:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء تحديث إعدادات الدفع' });
  }
};

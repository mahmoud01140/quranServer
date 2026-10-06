import { verifyToken } from '../utils/jwt.js';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  try {
    let token;

    // Check cookie first, then Authorization header
    if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'غير مصرح — يرجى تسجيل الدخول' });
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id).select('-password -otp -otpExpires -resetToken');

    if (!user) {
      return res.status(401).json({ message: 'المستخدم غير موجود' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'الحساب معطل، تواصل مع الإدارة' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'انتهت الجلسة، يرجى تسجيل الدخول مجدداً' });
    }
    return res.status(401).json({ message: 'رمز المصادقة غير صالح' });
  }
};

export const optionalAuth = async (req, res, next) => {
  try {
    let token = req.cookies?.token || 
      (req.headers.authorization?.startsWith('Bearer ') 
        ? req.headers.authorization.split(' ')[1] 
        : null);

    if (token) {
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.id).select('-password');
      if (user && user.isActive) req.user = user;
    }
  } catch (_) {
    // ignore auth errors for optional routes
  }
  next();
};

export { requireRole as authorize } from './role.middleware.js';

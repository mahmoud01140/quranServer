export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'غير مصرح' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `هذا الإجراء يتطلب صلاحية: ${roles.join(' أو ')}`,
      });
    }
    next();
  };
};

export const adminOnly = requireRole('admin');
export const teacherOnly = requireRole('teacher', 'admin');
export const studentOnly = requireRole('student', 'admin');
export const authorize = requireRole;

export const requireApproved = (req, res, next) => {
  if (!req.user.isApproved && req.user.role === 'student') {
    return res.status(403).json({
      message: 'لم يتم الموافقة على حسابك بعد. انتظر مراجعة الإدارة.',
    });
  }
  next();
};

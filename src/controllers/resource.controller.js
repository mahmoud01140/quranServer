import Resource from '../models/Resource.js';
import Group from '../models/Group.js';
import { getFileUrl } from '../middleware/upload.middleware.js';
import path from 'path';

const getFileType = (mimetype) => {
  if (mimetype === 'application/pdf') return 'pdf';
  if (mimetype?.startsWith('video/')) return 'video';
  if (mimetype?.startsWith('audio/')) return 'audio';
  if (mimetype?.startsWith('image/')) return 'image';
  return 'other';
};

// ─── Upload resource (general when no groupId) ─────────────────────
export const uploadResource = async (req, res) => {
  try {
    const { title, description, groupId, category } = req.body;

    if (!title) {
      return res.status(400).json({ message: 'العنوان مطلوب' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'يرجى رفع ملف' });
    }

    // موارد المجموعات: تحقق الملكية — الموارد العامة: معلم/أدمن فقط (المسار محمي)
    let group = null;
    if (groupId) {
      group = await Group.findById(groupId).select('teacher');
      if (!group) return res.status(404).json({ message: 'المجموعة غير موجودة' });

      const isTeacher = group.teacher?.toString() === req.user._id.toString();
      const isAdmin = req.user.role === 'admin';
      if (!isTeacher && !isAdmin) {
        return res.status(403).json({ message: 'غير مصرح' });
      }
    }

    const resource = await Resource.create({
      title: title.trim().substring(0, 200),
      description: description?.trim()?.substring(0, 500) || '',
      group: groupId || undefined,
      uploadedBy: req.user._id,
      fileUrl: getFileUrl(req, req.file.path),
      fileName: req.file.originalname,
      fileType: getFileType(req.file.mimetype),
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      category: category || 'other',
    });

    const populated = await Resource.findById(resource._id)
      .populate('uploadedBy', 'firstName lastName');

    res.status(201).json({ resource: populated });
  } catch (error) {
    console.error('uploadResource error:', error);
    res.status(500).json({ message: 'خطأ في رفع الملف' });
  }
};

// ─── Get group resources ─────────────────────────────────────────────
export const getGroupResources = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { category } = req.query;

    const group = await Group.findById(groupId).select('teacher students');
    if (!group) return res.status(404).json({ message: 'المجموعة غير موجودة' });

    // Verify membership
    const isTeacher = group.teacher?.toString() === req.user._id.toString();
    const isStudent = group.students.some(s => s.toString() === req.user._id.toString());
    const isAdmin = req.user.role === 'admin';
    if (!isTeacher && !isStudent && !isAdmin) {
      return res.status(403).json({ message: 'غير مصرح' });
    }

    const filter = { group: groupId, isActive: true };
    if (category && category !== 'all') filter.category = category;

    const resources = await Resource.find(filter)
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'firstName lastName');

    res.json({ resources });
  } catch (error) {
    console.error('getGroupResources error:', error);
    res.status(500).json({ message: 'خطأ في جلب الموارد' });
  }
};

// ─── Get general library (no group) ─────────────────────────────────
// متاحة للمعلم/الأدمن دائماً، وللطالب المحدد مستواه والمسدد اشتراكه فقط
export const getGeneralResources = async (req, res) => {
  try {
    const { category } = req.query;

    if (req.user.role === 'student') {
      if (!req.user.assignedLevel) {
        return res.status(403).json({ message: 'المكتبة متاحة بعد تحديد مستواك' });
      }
      const sub = req.user.subscription || {};
      const isPaidActive = sub.status === 'active' && (!sub.endDate || new Date(sub.endDate) > new Date());
      if (!isPaidActive) {
        return res.status(403).json({ message: 'المكتبة متاحة للمسددين اشتراكهم — سدد اشتراكك للوصول' });
      }
    }

    const filter = { group: null, isActive: true };
    if (category && category !== 'all') filter.category = category;

    const resources = await Resource.find(filter)
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'firstName lastName');

    res.json({ resources });
  } catch (error) {
    console.error('getGeneralResources error:', error);
    res.status(500).json({ message: 'خطأ في جلب المكتبة' });
  }
};

// ─── Track download ──────────────────────────────────────────────────
export const trackDownload = async (req, res) => {
  try {
    await Resource.findByIdAndUpdate(req.params.id, { $inc: { downloadCount: 1 } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// ─── Delete resource (teacher/admin only) ────────────────────────────
export const deleteResource = async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ message: 'المورد غير موجود' });

    // الموارد العامة يديرها أي معلم/أدمن (المسار محمي)، وموارد المجموعات لمعلمها أو الأدمن
    if (resource.group) {
      const group = await Group.findById(resource.group).select('teacher');
      const isTeacher = group?.teacher?.toString() === req.user._id.toString();
      const isAdmin = req.user.role === 'admin';
      if (!isTeacher && !isAdmin) {
        return res.status(403).json({ message: 'غير مصرح' });
      }
    }

    resource.isActive = false;
    await resource.save();
    res.json({ message: 'تم حذف المورد' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حذف المورد' });
  }
};

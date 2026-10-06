import StudyPlan from '../models/StudyPlan.js';
import Group from '../models/Group.js';
import Curriculum from '../models/Curriculum.js';
import User from '../models/User.js';

// ─── Helper: get or create group plan ────────────────────────────────────────
const getOrCreateGroupPlan = async (groupId) => {
  let plan = await StudyPlan.findOne({ group: groupId, type: 'group' });
  if (!plan) plan = await StudyPlan.create({ group: groupId, type: 'group' });
  return plan;
};

// GET /api/study-plans/group/:groupId
export const getGroupPlan = async (req, res) => {
  try {
    const plan = await StudyPlan.findOne({ group: req.params.groupId, type: 'group' })
      .populate('curriculum', 'title level description units estimatedWeeks');
    res.json({ plan });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// POST /api/study-plans/group/:groupId  (create or update the plan)
export const createGroupPlan = async (req, res) => {
  try {
    const existing = await StudyPlan.findOne({ group: req.params.groupId, type: 'group' });
    if (existing) {
      const plan = await StudyPlan.findByIdAndUpdate(existing._id, req.body, { new: true })
        .populate('curriculum', 'title level description units estimatedWeeks');
      return res.json({ plan });
    }
    const plan = await StudyPlan.create({ ...req.body, group: req.params.groupId, type: 'group' });
    res.status(201).json({ plan });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إنشاء الخطة' });
  }
};

// PUT /api/study-plans/group/:groupId/curriculum  — assign a base curriculum to the group plan
export const assignCurriculumToGroup = async (req, res) => {
  try {
    const { curriculumId } = req.body;
    const plan = await getOrCreateGroupPlan(req.params.groupId);

    // Update the plan's curriculum ref
    plan.curriculum = curriculumId || null;
    await plan.save();

    // Also update the Group.curriculum ref for quick access
    await Group.findByIdAndUpdate(req.params.groupId, { curriculum: curriculumId || null, studyPlan: plan._id });

    const updated = await StudyPlan.findById(plan._id)
      .populate('curriculum', 'title level description units estimatedWeeks');

    res.json({ message: 'تم تعيين المنهج للمجموعة', plan: updated });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تعيين المنهج' });
  }
};

// POST /api/study-plans/group/:groupId/lessons  — add a custom lesson
export const addCustomLesson = async (req, res) => {
  try {
    const plan = await getOrCreateGroupPlan(req.params.groupId);
    const { title, description, type, duration, isLiveRequired, resources, defaultHomework, defaultQuranHomework } = req.body;

    const lessonNumber = (plan.customLessons.length || 0) + 1;
    const lesson = {
      title,
      description,
      type,
      duration,
      isLiveRequired,
      resources,
      defaultHomework,
      defaultQuranHomework,
      lessonNumber,
      order: lessonNumber,
      status: 'pending',
    };

    plan.customLessons.push(lesson);
    await plan.save();

    // Link study plan to group
    await Group.findByIdAndUpdate(req.params.groupId, { studyPlan: plan._id });

    const updated = await StudyPlan.findById(plan._id)
      .populate('curriculum', 'title level description units estimatedWeeks');
    res.status(201).json({ message: 'تم إضافة الدرس', plan: updated });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إضافة الدرس' });
  }
};

// PUT /api/study-plans/group/:groupId/lessons/:lessonId  — edit a custom lesson
export const updateCustomLesson = async (req, res) => {
  try {
    const plan = await StudyPlan.findOne({ group: req.params.groupId, type: 'group' });
    if (!plan) return res.status(404).json({ message: 'الخطة غير موجودة' });

    const lesson = plan.customLessons.id(req.params.lessonId);
    if (!lesson) return res.status(404).json({ message: 'الدرس غير موجود' });

    Object.assign(lesson, req.body);
    await plan.save();

    const updated = await StudyPlan.findById(plan._id)
      .populate('curriculum', 'title level description units estimatedWeeks');
    res.json({ message: 'تم تعديل الدرس', plan: updated });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تعديل الدرس' });
  }
};

// PUT /api/study-plans/group/:groupId/lessons/:lessonId/toggle-complete — toggle lesson completion status
export const toggleLessonComplete = async (req, res) => {
  try {
    const plan = await StudyPlan.findOne({ group: req.params.groupId, type: 'group' });
    if (!plan) return res.status(404).json({ message: 'الخطة غير موجودة' });

    const lesson = plan.customLessons.id(req.params.lessonId);
    if (!lesson) return res.status(404).json({ message: 'الدرس غير موجود' });

    const isNowCompleted = lesson.status !== 'completed';
    lesson.status = isNowCompleted ? 'completed' : 'pending';
    lesson.completedAt = isNowCompleted ? new Date() : null;
    await plan.save();

    // Sync with group students
    const groupDoc = await Group.findById(req.params.groupId).select('students');
    const studentIds = groupDoc?.students || [];
    if (studentIds.length > 0) {
      const User = (await import('../models/User.js')).default;
      if (isNowCompleted) {
        await User.updateMany(
          { _id: { $in: studentIds } },
          { $addToSet: { completedLessons: lesson._id } }
        );
      } else {
        await User.updateMany(
          { _id: { $in: studentIds } },
          { $pull: { completedLessons: lesson._id } }
        );
      }
    }

    const updated = await StudyPlan.findById(plan._id)
      .populate('curriculum', 'title level description units estimatedWeeks');
    res.json({ message: isNowCompleted ? 'تم تحديد الدرس كمكتمل ✅' : 'تم إلغاء إكمال الدرس', plan: updated });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تحديث حالة الدرس' });
  }
};

// DELETE /api/study-plans/group/:groupId/lessons/:lessonId
export const deleteCustomLesson = async (req, res) => {
  try {
    const plan = await StudyPlan.findOne({ group: req.params.groupId, type: 'group' });
    if (!plan) return res.status(404).json({ message: 'الخطة غير موجودة' });

    plan.customLessons = plan.customLessons.filter(l => l._id.toString() !== req.params.lessonId);
    // Re-number
    plan.customLessons.forEach((l, i) => { l.lessonNumber = i + 1; l.order = i + 1; });
    await plan.save();

    const updated = await StudyPlan.findById(plan._id)
      .populate('curriculum', 'title level description units estimatedWeeks');
    res.json({ message: 'تم حذف الدرس', plan: updated });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حذف الدرس' });
  }
};

// GET /api/study-plans/group/:groupId/full  — curriculum + custom lessons (for student page)
export const getGroupFullPlan = async (req, res) => {
  try {
    const plan = await StudyPlan.findOne({ group: req.params.groupId, type: 'group' })
      .populate('curriculum', 'title level description units estimatedWeeks');
    res.json({ plan: plan || null });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// ─── Student individual plan handlers ─────────────────────────────
export const getStudentPlan = async (req, res) => {
  try {
    const isSelf = req.user._id.toString() === req.params.studentId;
    const isStaff = ['admin', 'teacher'].includes(req.user.role);
    const isParent = req.user.role === 'parent' && (req.user.children || []).some(c => c.toString() === req.params.studentId);
    if (!isSelf && !isStaff && !isParent) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض خطة هذا الطالب' });
    }

    const plan = await StudyPlan.findOne({ student: req.params.studentId, type: 'individual' });
    res.json({ plan });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

export const createStudentPlan = async (req, res) => {
  try {
    const isSelf = req.user._id.toString() === req.params.studentId;
    const isStaff = ['admin', 'teacher'].includes(req.user.role);
    if (!isSelf && !isStaff) {
      return res.status(403).json({ message: 'غير مصرح لك بإنشاء خطة لهذا الطالب' });
    }

    const existing = await StudyPlan.findOne({ student: req.params.studentId, type: 'individual' });
    if (existing) {
      const plan = await StudyPlan.findByIdAndUpdate(existing._id, req.body, { new: true });
      return res.json({ plan });
    }
    const plan = await StudyPlan.create({ ...req.body, student: req.params.studentId, type: 'individual' });
    res.status(201).json({ plan });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إنشاء الخطة' });
  }
};

export const updateQuranProgress = async (req, res) => {
  try {
    const isSelf = req.user._id.toString() === req.params.studentId;
    const isStaff = ['admin', 'teacher'].includes(req.user.role);
    if (!isSelf && !isStaff) {
      return res.status(403).json({ message: 'غير مصرح لك بتحديث تقدم هذا الطالب' });
    }

    const { currentJuz, completedJuz, dailyPages, dailyVerses } = req.body;
    const plan = await StudyPlan.findOneAndUpdate(
      { student: req.params.studentId },
      {
        'quranCompletionPlan.currentJuz': currentJuz,
        'quranCompletionPlan.completedJuz': completedJuz,
        'quranCompletionPlan.dailyPages': dailyPages,
        'quranCompletionPlan.dailyVerses': dailyVerses,
      },
      { new: true }
    );
    await User.findByIdAndUpdate(req.params.studentId, { memorizedVerses: (currentJuz - 1) * 604 + 20 });
    res.json({ plan });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

export const updateParentApproval = async (req, res) => {
  try {
    const isParent = req.user.role === 'parent' && (req.user.children || []).some(c => c.toString() === req.params.studentId);
    const isAdmin = req.user.role === 'admin';
    if (!isParent && !isAdmin) {
      return res.status(403).json({ message: 'غير مصرح لك بتسجيل موافقة ولي الأمر لهذا الطالب' });
    }

    const { parentName, parentContact, notes } = req.body;
    const plan = await StudyPlan.findOneAndUpdate(
      { student: req.params.studentId },
      { parentApproval: { parentName, parentContact, approvedAt: new Date(), notes } },
      { new: true }
    );
    res.json({ message: 'تم تسجيل موافقة ولي الأمر', plan });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/study-plans/student/:studentId/full
export const getStudentPlanFull = async (req, res) => {
  try {
    const isSelf = req.user._id.toString() === req.params.studentId;
    const isStaff = ['admin', 'teacher'].includes(req.user.role);
    const isParent = req.user.role === 'parent' && (req.user.children || []).some(c => c.toString() === req.params.studentId);
    if (!isSelf && !isStaff && !isParent) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض خطة هذا الطالب' });
    }

    let plan = await StudyPlan.findOne({ student: req.params.studentId, type: 'individual' })
      .populate('customLessons.exam', 'title type questions totalPoints passingScore duration');

    if (!plan) {
      plan = await StudyPlan.create({
        student: req.params.studentId,
        type: 'individual',
        customLessons: [],
      });
    }

    res.json({ plan });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب خطة ومنهج الطالب' });
  }
};

// PUT /api/study-plans/student/:studentId/lessons/:lessonId
export const updateStudentCustomLesson = async (req, res) => {
  try {
    const { studentId, lessonId } = req.params;
    const plan = await StudyPlan.findOne({ student: studentId, type: 'individual' });
    if (!plan) return res.status(404).json({ message: 'خطة الطالب غير موجودة' });

    const lesson = plan.customLessons.id(lessonId);
    if (!lesson) return res.status(404).json({ message: 'الدرس غير موجود' });

    const {
      title,
      description,
      type,
      duration,
      resources,
      videoUrl,
      exam,
      defaultHomework,
      status,
    } = req.body;

    if (title !== undefined) lesson.title = title;
    if (description !== undefined) lesson.description = description;
    if (type !== undefined) lesson.type = type;
    if (duration !== undefined) lesson.duration = duration;
    if (resources !== undefined) lesson.resources = resources;
    if (videoUrl !== undefined) lesson.videoUrl = videoUrl;
    if (exam !== undefined) lesson.exam = exam || null;
    if (defaultHomework !== undefined) lesson.defaultHomework = defaultHomework;
    if (status !== undefined) lesson.status = status;

    await plan.save();

    const updatedPlan = await StudyPlan.findById(plan._id)
      .populate('customLessons.exam', 'title type questions totalPoints passingScore duration');

    res.json({ message: 'تم تحديث بيانات الدرس بنجاح', lesson, plan: updatedPlan });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تحديث الدرس' });
  }
};

// DELETE /api/study-plans/student/:studentId/lessons/:lessonId — admin/teacher deletes a student's lesson
export const deleteStudentCustomLesson = async (req, res) => {
  try {
    const { studentId, lessonId } = req.params;
    const plan = await StudyPlan.findOne({ student: studentId, type: 'individual' });
    if (!plan) return res.status(404).json({ message: 'خطة الطالب غير موجودة' });

    const lesson = plan.customLessons.id(lessonId);
    if (!lesson) return res.status(404).json({ message: 'الدرس غير موجود' });

    const lessonTitle = lesson.title;
    plan.customLessons = plan.customLessons.filter(l => l._id.toString() !== lessonId);
    // Re-number remaining lessons
    plan.customLessons.forEach((l, i) => { l.lessonNumber = i + 1; l.order = i + 1; });
    await plan.save();

    // Cleanup dangling references (best-effort, never fail the delete)
    try {
      const User = (await import('../models/User.js')).default;
      await User.updateOne(
        { _id: studentId },
        { $pull: { completedLessons: lesson._id } }
      );
    } catch (_) {}
    try {
      const Discussion = (await import('../models/Discussion.js')).default;
      await Discussion.deleteOne({ lessonId: lessonId.toString() });
    } catch (_) {}

    res.json({ message: `تم حذف الدرس "${lessonTitle || ''}" بنجاح`, plan });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حذف الدرس' });
  }
};


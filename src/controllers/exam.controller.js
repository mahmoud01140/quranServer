import mongoose from 'mongoose';
import Exam from '../models/Exam.js';
import ExamResult from '../models/ExamResult.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
import StudyPlan from '../models/StudyPlan.js';
import WeakPoint from '../models/WeakPoint.js';
import Notification from '../models/Notification.js';
import { getFileUrl, buildDirectRecordings } from '../middleware/upload.middleware.js';
import { sendWebPush } from '../utils/webpush.js';

// Helper: Strip answer keys from questions before sending to students
const sanitizeExamForStudent = (examDoc) => {
  if (!examDoc) return null;
  const exam = examDoc.toObject ? examDoc.toObject() : JSON.parse(JSON.stringify(examDoc));
  if (Array.isArray(exam.questions)) {
    exam.questions = exam.questions.map(q => {
      const { correctAnswer, correctAnswerBool, correctAnswerText, explanation, ...safeQuestion } = q;
      return safeQuestion;
    });
  }
  return exam;
};

// GET /api/exams/placement/:type  (student | teacher | senior)
export const getPlacementExam = async (req, res) => {
  try {
    const { type } = req.params;
    const exam = await Exam.findOne({ type: 'placement', registrationType: type, isActive: true });
    if (!exam) return res.status(404).json({ message: 'لم يتم العثور على امتحان التحديد' });

    // Check if user already completed this placement exam
    const existingResult = await ExamResult.findOne({ exam: exam._id, student: req.user._id });
    if (existingResult) {
      const oralCompleted = Boolean(existingResult.oralRecordings?.length > 0 || existingResult.status === 'reviewed');
      return res.json({
        exam: sanitizeExamForStudent(exam),
        alreadyCompleted: oralCompleted,
        writtenCompleted: true,
        result: existingResult,
        message: oralCompleted ? 'لقد أجريت امتحان التحديد مسبقاً' : 'تم تسليم الامتحان التحريري وبانتظار التسميع الشفهي',
      });
    }

    const safeExam = req.user.role === 'student' ? sanitizeExamForStudent(exam) : exam;
    res.json({ exam: safeExam, alreadyCompleted: false });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/exams/group/:groupId
export const getGroupExams = async (req, res) => {
  try {
    // حارس: معرف غير صالح (مثل 'none' للطلاب بلا مجموعة) → قائمة فارغة بدل انفجار 500
    if (!mongoose.Types.ObjectId.isValid(req.params.groupId)) {
      return res.json({ exams: [] });
    }
    const exams = await Exam.find({ group: req.params.groupId, isActive: true })
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    const safeExams = req.user.role === 'student'
      ? exams.map(sanitizeExamForStudent)
      : exams;

    res.json({ exams: safeExams });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/exams/student/assigned (All exams assigned to current student: individual, group, or level)
export const getStudentAssignedExams = async (req, res) => {
  try {
    const studentId = req.user._id;
    const user = await User.findById(studentId);
    let groupId = user?.group?._id || user?.group;

    if (!groupId) {
      const foundGroup = await Group.findOne({ students: studentId }).select('_id level');
      if (foundGroup) {
        groupId = foundGroup._id;
        User.findByIdAndUpdate(studentId, { group: groupId }).catch(() => {});
      }
    }

    const queryOr = [
      { targetType: 'individual', targetStudent: studentId, isActive: true },
    ];

    if (groupId) {
      queryOr.push(
        { targetType: 'group', group: groupId, isActive: true },
        { targetType: { $exists: false }, group: groupId, isActive: true } // backward compatibility
      );
    }

    let studentLevel = user?.assignedLevel;
    if (!studentLevel && groupId) {
      const g = await Group.findById(groupId).select('level');
      if (g?.level) studentLevel = g.level;
    }

    if (studentLevel) {
      queryOr.push(
        { targetType: 'level', level: { $in: [studentLevel, 'all'] }, isActive: true }
      );
    } else {
      queryOr.push(
        { targetType: 'level', level: 'all', isActive: true }
      );
    }

    const exams = await Exam.find({ $or: queryOr })
      .populate('group', 'name level')
      .populate('targetStudent', 'firstName lastName avatar email')
      .populate('createdBy', 'firstName lastName avatar')
      .sort({ createdAt: -1 });

    // Fetch existing results for this student
    const examIds = exams.map(e => e._id);
    const results = await ExamResult.find({
      exam: { $in: examIds },
      student: studentId,
    }).select('exam totalPercentage isPassed status submittedAt');

    const resultsMap = {};
    results.forEach(r => {
      resultsMap[r.exam.toString()] = r;
    });

    const enrichedExams = exams.map(examDoc => {
      const safe = sanitizeExamForStudent(examDoc);
      const r = resultsMap[examDoc._id.toString()];
      return {
        ...safe,
        isCompleted: !!r,
        result: r || null,
      };
    });

    res.json({ exams: enrichedExams });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب الامتحانات المستحقة' });
  }
};

// GET /api/exams/admin/all (Admin / Teacher lists all created exams with submission stats)
export const getAdminAllExams = async (req, res) => {
  try {
    const { targetType, groupId, level, search } = req.query;
    let query = {};

    if (targetType) query.targetType = targetType;
    if (groupId) query.group = groupId;
    if (level) query.level = level;
    if (search) query.title = { $regex: search, $options: 'i' };

    // If teacher (and not admin), only show their created exams or their group's exams
    if (req.user.role === 'teacher') {
      const myGroups = await Group.find({ teacher: req.user._id }).select('_id');
      const groupIds = myGroups.map(g => g._id);
      query.$or = [
        { createdBy: req.user._id },
        { group: { $in: groupIds } }
      ];
    }

    const exams = await Exam.find(query)
      .populate('group', 'name level')
      .populate('targetStudent', 'firstName lastName avatar email')
      .populate('createdBy', 'firstName lastName avatar role')
      .sort({ createdAt: -1 });

    // Count submissions per exam
    const examIds = exams.map(e => e._id);
    const resultsCounts = await ExamResult.aggregate([
      { $match: { exam: { $in: examIds } } },
      { $group: { _id: '$exam', count: { $sum: 1 }, avgScore: { $avg: '$totalPercentage' } } },
    ]);

    const statsMap = {};
    resultsCounts.forEach(stat => {
      statsMap[stat._id.toString()] = {
        submissionsCount: stat.count,
        averageScore: Math.round(stat.avgScore || 0),
      };
    });

    const enrichedExams = exams.map(e => {
      const obj = e.toObject();
      const stats = statsMap[e._id.toString()] || { submissionsCount: 0, averageScore: 0 };
      return {
        ...obj,
        ...stats,
      };
    });

    res.json({ exams: enrichedExams });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب الامتحانات' });
  }
};

// POST /api/exams
export const createExam = async (req, res) => {
  try {
    const { targetType = 'group', targetStudent, group, level, title, type } = req.body;

    let examType = type;
    if (!examType) {
      examType = targetType === 'level' ? 'placement' : 'lesson';
    }

    const isBank = targetType === 'bank';
    const examData = {
      ...req.body,
      targetType: targetType || 'group',
      // امتحان البنك: مستقل تماماً — بلا طالب ولا مجموعة ولا مستوى، ومخفي عن الطلاب حتى يُسند
      targetStudent: targetType === 'individual' ? targetStudent : undefined,
      group: (targetType === 'group' || targetType === 'individual') ? group : undefined,
      level: targetType === 'level' ? (level || 'all') : undefined,
      type: examType,
      createdBy: req.user._id,
    };
    if (isBank) {
      examData.targetStudent = undefined;
      examData.group = undefined;
      examData.level = undefined;
      examData.lessonId = undefined;
      examData.lessonTitle = '';
    }

    // Calculate total points
    examData.totalPoints = (examData.questions || []).reduce((sum, q) => sum + (q.points || 1), 0);
    const exam = await Exam.create(examData);

    // Send notifications to students (DB only — same as before; frontend polls).
    // Routed via dispatcher so the admin on/off switch applies.
    const { notifyMany } = await import('../utils/notify.js');
    const examNotifs = [];
    if (targetType === 'individual' && targetStudent) {
      examNotifs.push({
        recipient: targetStudent,
        type: 'exam',
        title: `🎯 تم إسناد امتحان فردي خاص بك: ${exam.title}`,
        body: 'أعد لك المعلم امتحاناً فردياً للمتابعة وتثبيت المحفوظ. تفضل بأدائه في قسم المطلوب منك.',
        data: { examId: exam._id, link: `/student/exams/${exam._id}/take` },
        push: false,
      });
    } else if (targetType === 'group' && group) {
      const groupDoc = await Group.findById(group).select('students');
      if (groupDoc && groupDoc.students?.length) {
        groupDoc.students.forEach(sId =>
          examNotifs.push({
            recipient: sId,
            type: 'exam',
            title: `📝 امتحان جديد للمجموعة: ${exam.title}`,
            body: 'تم نشر امتحان جديد لمجموعتك، يرجى الدخول وأدائه.',
            data: { examId: exam._id, link: `/student/exams/${exam._id}/take` },
            push: false,
          })
        );
      }
    } else if (targetType === 'level') {
      const studentFilter = { role: 'student' };
      if (level && level !== 'all') {
        studentFilter.assignedLevel = level;
      }
      const students = await User.find(studentFilter).select('_id');
      if (students?.length) {
        students.forEach(s =>
          examNotifs.push({
            recipient: s._id,
            type: 'exam',
            title: `🏷️ امتحان مستوى جديد: ${exam.title}`,
            body: 'تم إدراج امتحان مستوى جديد في حسابك، يرجى أداء التقييم.',
            data: { examId: exam._id, link: `/student/exams/${exam._id}/take` },
            push: false,
          })
        );
      }
    }
    if (examNotifs.length > 0) {
      await notifyMany(examNotifs).catch(() => {});
    }

    res.status(201).json({ message: 'تم إنشاء الامتحان بنجاح', exam });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إنشاء الامتحان' });
  }
};

// POST /api/exams/:id/assign-lesson — إسناد امتحان (بنك غالباً) لطالب: على حصة من خطته الفردية أو إسناد مباشر
// body: { studentId, lessonId? } — بدون lessonId يتحول الامتحان لفردي مباشر للطالب
export const assignExamToLesson = async (req, res) => {
  try {
    const { studentId, lessonId } = req.body;
    if (!studentId) return res.status(400).json({ message: 'حدد الطالب أولاً' });

    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: 'الامتحان غير موجود' });

    const student = await User.findById(studentId).select('firstName lastName role');
    if (!student || student.role !== 'student') {
      return res.status(404).json({ message: 'الطالب غير موجود' });
    }

    let lessonTitle = '';
    if (lessonId) {
      const plan = await StudyPlan.findOne({ student: studentId, type: 'individual' });
      if (!plan) return res.status(404).json({ message: 'الخطة الفردية للطالب غير موجودة' });
      const lesson = plan.customLessons.id(lessonId);
      if (!lesson) return res.status(404).json({ message: 'الحصة غير موجودة في الخطة الفردية' });
      lesson.exam = exam._id;
      await plan.save();
      lessonTitle = lesson.title || '';
    }

    // الامتحان يخرج من البنك: إسناد فردي للطالب فيظهر في «المطلوب منك»
    exam.targetType = 'individual';
    exam.targetStudent = studentId;
    exam.group = undefined;
    exam.level = undefined;
    if (lessonId) {
      exam.lessonId = lessonId;
      exam.lessonTitle = lessonTitle;
      exam.type = 'lesson';
    }
    await exam.save();

    const { notifyUser } = await import('../utils/notify.js');
    await notifyUser({
      recipient: studentId,
      type: 'exam',
      title: `تم إسناد امتحان لك: ${exam.title}`,
      body: lessonTitle
        ? `أُضيف الامتحان على حصة «${lessonTitle}» في خطتك. تجده في قسم المطلوب منك.`
        : 'أُسند لك امتحان جديد. تجده في قسم المطلوب منك.',
      data: { examId: exam._id, link: `/student/exams/${exam._id}/take` },
      push: false,
    }).catch(() => {});
    // Student discovers via GET /notifications + exams polling (Vercel-safe, no socket.io).

    const populated = await Exam.findById(exam._id)
      .populate('targetStudent', 'firstName lastName avatar email');
    res.json({ message: 'تم وضع الامتحان للطالب بنجاح', exam: populated });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إسناد الامتحان' });
  }
};

// PUT /api/exams/:id
export const updateExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: 'الامتحان غير موجود' });

    // Verify teacher owns the exam if not admin
    if (req.user.role === 'teacher' && exam.createdBy?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'غير مصرح لك بتعديل هذا الامتحان' });
    }

    if (req.body.questions) {
      req.body.totalPoints = req.body.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    }
    const updated = await Exam.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ message: 'تم التحديث', exam: updated });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// DELETE /api/exams/:id
export const deleteExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: 'الامتحان غير موجود' });

    // Verify teacher owns the exam if not admin
    if (req.user.role === 'teacher' && exam.createdBy?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'غير مصرح لك بحذف هذا الامتحان' });
    }

    await Exam.findByIdAndDelete(req.params.id);
    res.json({ message: 'تم حذف الامتحان' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حذف الامتحان' });
  }
};

// POST /api/exams/:id/submit
export const submitExam = async (req, res) => {
  try {
    const { answers, writtenAnswers: rawWrittenAnswers, surveyAnswers, examType } = req.body;
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: 'الامتحان غير موجود' });

    // Check if student already submitted this exam
    const existing = await ExamResult.findOne({ exam: exam._id, student: req.user._id });
    if (existing) return res.status(400).json({ message: 'لقد أجريت هذا الامتحان من قبل' });

    // Calculate written score — supports MCQ and true_false auto-graded questions
    const writtenAnswers = [];
    let writtenScore = 0;
    let autoGradedTotal = 0;

    exam.questions.forEach((q, idx) => {
      let isCorrect = false;
      let points = 0;
      let selectedAnswer = undefined;
      let writtenAnswer = undefined;

      if (q.type === 'mcq') {
        selectedAnswer = answers?.[idx];
        isCorrect = selectedAnswer === q.correctAnswer;
        points = isCorrect ? (q.points || 1) : 0;
        autoGradedTotal += (q.points || 1);
      } else if (q.type === 'true_false') {
        // answers[idx] is boolean (true/false)
        const studentBool = answers?.[idx];
        isCorrect = studentBool === q.correctAnswerBool;
        points = isCorrect ? (q.points || 1) : 0;
        selectedAnswer = studentBool;
        autoGradedTotal += (q.points || 1);
      } else if (q.type === 'written') {
        writtenAnswer = (rawWrittenAnswers?.[idx] || '').trim();
        const correct = (q.correctAnswerText || '').trim();
        isCorrect = writtenAnswer.toLowerCase() === correct.toLowerCase();
        points = isCorrect ? (q.points || 1) : 0;
        autoGradedTotal += (q.points || 1);
      } else if (q.type === 'recitation') {
        // Recitation is oral question — reviewed and graded by teacher/admin
        isCorrect = false;
        points = 0;
      }

      writtenScore += points;
      writtenAnswers.push({
        questionId: q._id,
        selectedAnswer,
        writtenAnswer,
        isCorrect,
        points,
      });
    });

    // Check if any recitation questions exist → status pending_oral_review
    const hasRecitation = exam.questions.some(q => q.type === 'recitation');

    const writtenPercentage = autoGradedTotal > 0
      ? Math.round((writtenScore / autoGradedTotal) * 100)
      : (exam.totalPoints > 0 ? Math.round((writtenScore / exam.totalPoints) * 100) : 0);

    // Determine assigned level based on score and registration type
    let assignedLevel = 'foundation';
    const regType = req.user.registrationType;
    if (regType === 'teacher') assignedLevel = 'teacher_prep';
    else if (regType === 'senior') assignedLevel = 'senior';
    else if (writtenPercentage >= 70) assignedLevel = 'memorization';

    // Normalize surveyAnswers — enriched objects keep their texts (sanitized),
    // bare indices stay index-only (old clients) and resolve at display time.
    const normalizedSurveyAnswers = Array.isArray(surveyAnswers)
      ? surveyAnswers.map((item, idx) => {
          if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            const clean = {
              questionIndex: Number.isInteger(item.questionIndex) ? item.questionIndex : idx,
              selectedOption: Number.isInteger(item.selectedOption) ? item.selectedOption : -1,
            };
            if (typeof item.questionText === 'string' && item.questionText.trim()) {
              clean.questionText = item.questionText.trim().slice(0, 500);
            }
            if (typeof item.answerText === 'string' && item.answerText.trim()) {
              clean.answerText = item.answerText.trim().slice(0, 500);
            }
            return clean;
          }
          return {
            questionIndex: idx,
            selectedOption: typeof item === 'number' ? item : -1,
          };
        })
      : [];

    const isPassed = !hasRecitation && writtenPercentage >= (exam.passingScore || 60);

    // Gamification & Streak calculation
    const xpEarned = isPassed || hasRecitation ? Math.max(30, Math.round(writtenPercentage * 0.5) + 30) : 10;

    const result = await ExamResult.create({
      exam: exam._id,
      student: req.user._id,
      examType: examType || exam.type,
      writtenAnswers,
      writtenScore,
      writtenPercentage,
      surveyAnswers: normalizedSurveyAnswers,
      totalScore: writtenScore,
      totalPercentage: writtenPercentage,
      xpEarned,
      isPassed,
      status: hasRecitation ? 'pending_oral_review' : 'submitted',
      assignedLevel,
      submittedAt: new Date(),
    });

    // Update user stats: points, streak, lastActiveDate
    const userObj = await User.findById(req.user._id);
    if (userObj) {
      const now = new Date();
      let newStreak = userObj.streak || 0;
      if (userObj.lastActiveDate) {
        const diffHours = (now - new Date(userObj.lastActiveDate)) / (1000 * 60 * 60);
        if (diffHours >= 20 && diffHours <= 48) {
          newStreak += 1;
        } else if (diffHours > 48) {
          newStreak = 1;
        }
      } else {
        newStreak = 1;
      }
      userObj.points = (userObj.points || 0) + xpEarned;
      userObj.streak = newStreak;
      userObj.lastActiveDate = now;
      if (exam.type === 'placement') {
        userObj.placementExamScore = writtenPercentage;
        userObj.assignedLevel = assignedLevel;
        userObj.placementExamTaken = true;
      }
      await userObj.save();
    }

    res.json({ message: 'تم تسليم التقييم بنجاح', result, xpEarned });
  } catch (error) {
    // Handle race condition: if unique index catches a duplicate
    if (error.code === 11000) {
      return res.status(400).json({ message: 'لقد أجريت هذا الامتحان من قبل' });
    }
    res.status(500).json({ message: 'خطأ في تسليم الامتحان' });
  }
};

// Helper: notify the student's teacher + admins that audio recordings are
// awaiting review — without this the 24h review promise is silently unmet.
const notifyStaffOfPendingReview = async (req, { studentId, examId, examTitle, isPlacement }) => {
  try {
    const student = await User.findById(studentId).select('firstName lastName group');
    let teacherId = null;
    if (student?.group) {
      const g = await Group.findById(student.group).select('teacher');
      teacherId = g?.teacher;
    }
    // النظام فردي: معلم آخر جلسة مباشرة للطالب
    if (!teacherId) {
      try {
        const LiveSession = (await import('../models/LiveSession.js')).default;
        const lastSession = await LiveSession.findOne({ student: studentId })
          .sort({ startedAt: -1, createdAt: -1 })
          .select('teacher');
        teacherId = lastSession?.teacher || null;
      } catch (_) {}
    }
    const admins = await User.find({ role: 'admin' }).select('_id');
    const title = isPlacement
      ? '🎙️ تسجيلات تحديد شفهي بانتظار المراجعة'
      : '🎙️ تسجيلات تسميع بانتظار المراجعة';
    const body = `رفع الطالب ${student?.firstName || ''} ${student?.lastName || ''} تسجيلات صوتية لامتحان "${examTitle}". يرجى المراجعة خلال 24 ساعة.`;
    const targets = [...(teacherId ? [teacherId] : []), ...admins.map(a => a._id)];
    const { notifyMany } = await import('../utils/notify.js');
    await notifyMany(
      targets.map(t => ({
        recipient: t,
        type: 'exam_scheduled',
        title,
        body,
        data: { examId, studentId: studentId?.toString?.() || studentId },
        push: false,
      }))
    ).catch(() => {});
    // Teachers/admins poll GET /notifications (no socket.io).
  } catch (_) {}
};

// POST /api/exams/:id/submit-oral
export const submitOralExam = async (req, res) => {
  try {
    const { resultId } = req.body;
    const files = req.files || [];

    // Direct browser uploads (preferred on Vercel) arrive as verified URLs;
    // legacy multipart files fall back to the server-relay path.
    let oralRecordings = buildDirectRecordings(req.body?.recordings, 'taskId');
    if (!oralRecordings.length) {
      oralRecordings = files.map((file, idx) => ({
        taskId: req.body[`taskId_${idx}`] || null,
        audioUrl: getFileUrl(req, file.path),
        audioPublicId: file.cloudinaryPublicId || undefined,
        audioResourceType: file.cloudinaryResourceType || undefined,
      }));
    }

    let result = null;
    if (resultId) {
      result = await ExamResult.findById(resultId);
    }
    if (!result) {
      result = await ExamResult.findOne({
        exam: req.params.id,
        student: req.user._id,
      });
    }

    // منع التسليم الفارغ: لا ملفات جديدة ولا تسجيلات سابقة
    if (!oralRecordings.length && !(result?.oralRecordings?.length)) {
      return res.status(400).json({ message: 'سجل مقطعاً صوتياً واحداً على الأقل قبل التسليم' });
    }

    if (result) {
      result.oralRecordings = oralRecordings;
      result.status = 'pending_oral_review';
      result.submittedAt = new Date();
      await result.save();
    } else {
      result = await ExamResult.create({
        exam: req.params.id,
        student: req.user._id,
        examType: 'placement',
        oralRecordings,
        status: 'pending_oral_review',
        submittedAt: new Date(),
      });
    }

    // Update user recordings & set placementExamTaken
    await User.findByIdAndUpdate(req.user._id, {
      oralExamRecordings: oralRecordings.map(r => r.audioUrl),
      placementExamTaken: true,
    });

    // Placement oral if it extends a placement result, else a standalone oral
    const isPlacement = result?.examType === 'placement' || result?.examType === 'oral';
    let examTitle = 'امتحان تحديد المستوى الشفهي';
    try {
      const examDoc = await Exam.findById(result?.exam || req.params.id).select('title');
      if (examDoc?.title) examTitle = examDoc.title;
    } catch (_) {}
    notifyStaffOfPendingReview(req, {
      studentId: req.user._id,
      examId: result?.exam?.toString?.() || req.params.id,
      examTitle,
      isPlacement,
    }).catch(() => {});

    res.json({ message: 'تم رفع التسجيلات الشفهية بنجاح إلى الإدارة للمراجعة', result });
  } catch (error) {
    console.error('Error in submitOralExam:', error);
    res.status(500).json({ message: 'خطأ في رفع التسجيلات' });
  }
};

// POST /api/exams/:id/submit-recitation  (student uploads audio recordings for recitation questions)
export const submitRecitationAnswers = async (req, res) => {
  try {
    const { examResultId } = req.body;
    const files = req.files || [];
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ message: 'الامتحان غير موجود' });

    // Direct browser uploads (preferred on Vercel) arrive as verified URLs;
    // legacy multipart files fall back to the server-relay path.
    let oralRecordings = buildDirectRecordings(req.body?.recordings, 'taskId');
    if (!oralRecordings.length) {
      oralRecordings = files.map((file, idx) => ({
        taskId: req.body[`questionId_${idx}`] || null,
        audioUrl: getFileUrl(req, file.path),
        audioPublicId: file.cloudinaryPublicId || undefined,
        audioResourceType: file.cloudinaryResourceType || undefined,
      }));
    }

    let result;
    if (examResultId) {
      result = await ExamResult.findById(examResultId);
      // منع التسليم الفارغ
      if (!oralRecordings.length && !(result?.oralRecordings?.length)) {
        return res.status(400).json({ message: 'سجل مقطعاً صوتياً واحداً على الأقل قبل التسليم' });
      }
      result = await ExamResult.findByIdAndUpdate(
        examResultId,
        {
          oralRecordings,
          status: 'pending_oral_review',
        },
        { new: true }
      );
    } else {
      // Create a new result if it doesn't exist yet
      if (!oralRecordings.length) {
        return res.status(400).json({ message: 'سجل مقطعاً صوتياً واحداً على الأقل قبل التسليم' });
      }
      result = await ExamResult.create({
        exam: exam._id,
        student: req.user._id,
        examType: exam.type,
        oralRecordings,
        status: 'pending_oral_review',
        submittedAt: new Date(),
      });
    }

    notifyStaffOfPendingReview(req, {
      studentId: req.user._id,
      examId: exam._id.toString(),
      examTitle: exam.title || 'امتحان',
      isPlacement: exam.type === 'placement',
    }).catch(() => {});

    res.json({ message: 'تم رفع التسجيلات', result });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في رفع التسجيلات' });
  }
};

// GET /api/exams/results/student/:id
export const getStudentResults = async (req, res) => {
  try {
    const targetId = req.params.id;
    const me = req.user._id.toString();
    const isStaff = ['admin', 'teacher'].includes(req.user.role);
    const isSelf = me === targetId;
    const isParent = req.user.role === 'parent' && (req.user.children || []).some(c => c.toString() === targetId);
    if (!isSelf && !isStaff && !isParent) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض نتائج هذا الطالب' });
    }
    const results = await ExamResult.find({ student: req.params.id })
      .populate('exam', 'title type level lessonTitle lessonId group')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ submittedAt: -1 });
    res.json({ results });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/exams/results/:resultId
export const getResultById = async (req, res) => {
  try {
    const result = await ExamResult.findById(req.params.resultId)
      .populate('exam', 'title type questions oralTasks totalPoints passingScore lessonTitle')
      .populate('student', 'firstName lastName')
      .populate('reviewedBy', 'firstName lastName');
    if (!result) return res.status(404).json({ message: 'النتيجة غير موجودة' });
    const ownerId = (result.student?._id || result.student)?.toString();
    const me = req.user._id.toString();
    const isStaff = ['admin', 'teacher'].includes(req.user.role);
    const isSelf = me === ownerId;
    const isParent = req.user.role === 'parent' && (req.user.children || []).some(c => c.toString() === ownerId);
    if (!isSelf && !isStaff && !isParent) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض هذه النتيجة' });
    }
    res.json({ result });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/exams/group/:groupId/results  (admin sees all results for a group's exams)
export const getGroupResults = async (req, res) => {
  try {
    const { groupId } = req.params;
    // Get all exam IDs for this group
    const exams = await Exam.find({ group: groupId }).select('_id title lessonTitle type');
    const examIds = exams.map(e => e._id);

    const results = await ExamResult.find({ exam: { $in: examIds } })
      .populate('exam', 'title type lessonTitle lessonId')
      .populate('student', 'firstName lastName avatar')
      .sort({ submittedAt: -1 });

    res.json({ results, exams });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// GET /api/exams/:examId/results  (admin sees results for a specific exam)
export const getExamResults = async (req, res) => {
  try {
    const results = await ExamResult.find({ exam: req.params.examId })
      .populate('student', 'firstName lastName avatar')
      .populate('exam', 'title type lessonTitle totalPoints passingScore questions')
      .sort({ submittedAt: -1 });
    res.json({ results });
  } catch (error) {
    res.status(500).json({ message: 'خطأ' });
  }
};

// PUT /api/exams/results/:resultId/review  (teacher / admin reviews oral)
export const reviewOralResult = async (req, res) => {
  try {
    const { teacherNotes, oralScore, teacherAudioUrl, flaggedVerses, assignedLevel, isApproved, scheduleDays, sessionTime } = req.body;

    // Fetch existing result first to get writtenScore
    const existing = await ExamResult.findById(req.params.resultId).populate('exam', 'passingScore totalPoints type');
    if (!existing) return res.status(404).json({ message: 'النتيجة غير موجودة' });

    const numOralScore = parseInt(oralScore) || 0;
    const totalScore = (existing.writtenScore || 0) + numOralScore;
    const totalPercentage = existing.writtenPercentage
      ? Math.round((existing.writtenPercentage + numOralScore) / 2)
      : numOralScore;

    const updateData = {
      oralScore: numOralScore,
      teacherNotes,
      teacherAudioUrl,
      flaggedVerses: Array.isArray(flaggedVerses) ? flaggedVerses : [],
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
      totalScore,
      totalPercentage,
      status: 'reviewed',
      isPassed: totalPercentage >= (existing.exam?.passingScore || 60),
    };

    const result = await ExamResult.findByIdAndUpdate(
      req.params.resultId,
      updateData,
      { new: true }
    ).populate('student', 'firstName lastName pushSubscription _id assignedLevel isApproved');

    // Placement level override & approval
    const LEVEL_ENUM = ['foundation', 'memorization', 'teacher_prep', 'senior'];
    let levelChanged = false;
    const userUpdates = {};

    if (
      assignedLevel &&
      LEVEL_ENUM.includes(assignedLevel) &&
      (result.examType === 'placement' || existing.exam?.type === 'placement')
    ) {
      userUpdates.assignedLevel = assignedLevel;
      result.student.assignedLevel = assignedLevel;
      levelChanged = true;
    }

    if (Array.isArray(scheduleDays)) {
      userUpdates.scheduleDays = scheduleDays;
    }
    if (sessionTime) {
      userUpdates.sessionTime = sessionTime;
    }

    if (isApproved === true || (assignedLevel && scheduleDays?.length)) {
      userUpdates.isApproved = true;
      result.student.isApproved = true;
    }

    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(result.student._id, userUpdates);
    }

    // Create WeakPoint items for flagged verses if provided
    if (Array.isArray(flaggedVerses) && flaggedVerses.length > 0) {
      for (const item of flaggedVerses) {
        if (item.surahNumber && item.verseNumber) {
          await WeakPoint.create({
            student: result.student._id,
            examResult: result._id,
            surahNumber: item.surahNumber,
            surahName: item.surahName || `سورة ${item.surahNumber}`,
            fromVerse: item.verseNumber,
            toVerse: item.verseNumber,
            errorType: item.errorType || 'hifz',
            notes: item.notes || '',
            status: 'needs_review',
          });
        }
      }
    }

    // Notify student via DB + Web Push (frontend polls GET /notifications — no socket.io)
    const { notifyUser } = await import('../utils/notify.js');
    await notifyUser({
      recipient: result.student._id,
      type: 'result_ready',
      title: '📋 نتيجة تقييمك الشفهي جاهزة',
      body: levelChanged
        ? 'قام المشرف بمراجعة تلاوتك الشفهية وحدّث مستواك النهائي. اطلع على التوجيهات والنتيجة الآن.'
        : 'تمت مراجعة تقييمك الشفهي من قِبل المشرف. اطلع على الملاحظات والنتيجة الآن.',
      data: { resultId: result._id },
      push: true,
      pushSubscription: result.student.pushSubscription || undefined,
    }).catch(() => {});

    res.json({ message: 'تم حفظ المراجعة وتحديث النتيجة وإرسال الإشعار للطالب', result });
  } catch (error) {
    console.error('Error in reviewOralResult:', error);
    res.status(500).json({ message: 'خطأ في المراجعة' });
  }
};

// GET /api/exams/weak-points/my
export const getMyWeakPoints = async (req, res) => {
  try {
    const studentId = req.params.studentId || req.user._id;

    // Check authorization: if requesting someone else's weak points, user must be admin or teacher
    if (studentId.toString() !== req.user._id.toString() && !['admin', 'teacher'].includes(req.user.role)) {
      return res.status(403).json({ message: 'غير مصرح لك باستعراض نقاط ضعف هذا الطالب' });
    }

    const weakPoints = await WeakPoint.find({ student: studentId })
      .sort({ createdAt: -1 });
    res.json({ weakPoints });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب نقاط الضعف' });
  }
};

// PUT /api/exams/weak-points/:id
export const updateWeakPointStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const weakPoint = await WeakPoint.findById(req.params.id);
    if (!weakPoint) return res.status(404).json({ message: 'نقطة الضعف غير موجودة' });

    // Authorization: only student owner, teacher, or admin can update
    const isOwner = weakPoint.student?.toString() === req.user._id.toString();
    const isStaff = ['admin', 'teacher'].includes(req.user.role);
    if (!isOwner && !isStaff) {
      return res.status(403).json({ message: 'غير مصرح لك بتحديث حالة نقطة الضعف هذه' });
    }

    weakPoint.status = status || weakPoint.status;
    weakPoint.lastReviewedAt = new Date();
    weakPoint.reviewCount = (weakPoint.reviewCount || 0) + 1;
    await weakPoint.save();

    res.json({ message: 'تم تحديث حالة نقطة الضعف', weakPoint });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في التحديث' });
  }
};

// GET /api/exams/results/pending-review  (teacher / admin sees pending oral reviews)
export const getPendingReviews = async (req, res) => {
  try {
    const filter = {
      status: { $in: ['pending_oral_review', 'submitted'] },
      $or: [
        { reviewedAt: { $exists: false } },
        { reviewedAt: null },
      ],
    };
    // Teachers only see their own groups' students; admins see everything.
    // In the individual system teachers have no groups → see all pending.
    if (req.user.role === 'teacher') {
      const teacherId = req.query.teacherId || req.user._id;
      const myGroups = await Group.find({ teacher: teacherId }).select('_id');
      if (myGroups.length) {
        const myStudentIds = await User.find({ group: { $in: myGroups.map(g => g._id) } }).select('_id');
        filter.student = { $in: myStudentIds.map(s => s._id) };
      }
    }
    const results = await ExamResult.find(filter)
      .populate('student', 'firstName lastName avatar group assignedLevel isApproved email phone registrationType')
      .populate('exam', 'title type registrationType lessonTitle oralTasks questions')
      .sort({ submittedAt: 1 });
    res.json({ results });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب الاختبارات الشفهية' });
  }
};

// ── ADMIN: Placement Exam Management ─────────────────────────────────────────

// GET /api/exams/admin/placement — get all placement exams for admin editing
export const getAdminPlacementExams = async (req, res) => {
  try {
    const exams = await Exam.find({ type: 'placement' }).sort({ registrationType: 1 });
    res.json({ exams });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب امتحانات تحديد المستوى' });
  }
};

// PUT /api/exams/admin/placement/:registrationType — update a placement exam
export const updatePlacementExam = async (req, res) => {
  try {
    const { registrationType } = req.params;
    const { title, questions, oralTasks, passingScore, duration } = req.body;

    const totalPoints = (questions || []).reduce((sum, q) => sum + (q.points || 1), 0);

    const exam = await Exam.findOneAndUpdate(
      { type: 'placement', registrationType },
      { title, questions, oralTasks, passingScore, duration, totalPoints },
      { new: true, upsert: true, runValidators: false }
    );

    res.json({ message: 'تم حفظ امتحان تحديد المستوى بنجاح', exam });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في حفظ امتحان تحديد المستوى' });
  }
};

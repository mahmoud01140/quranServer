import DailyTask from '../models/DailyTask.js';
import User from '../models/User.js';
import Group from '../models/Group.js';

// Quran surah helper
const SURAH_NAMES = [
  'الفاتحة', 'البقرة', 'آل عمران', 'النساء', 'المائدة', 'الأنعام', 'الأعراف', 'الأنفال', 'التوبة', 'يونس',
  'هود', 'يوسف', 'الرعد', 'إبراهيم', 'الحجر', 'النحل', 'الإسراء', 'الكهف', 'مريم', 'طه',
  'الأنبياء', 'الحج', 'المؤمنون', 'النور', 'الفرقان', 'الشعراء', 'النمل', 'القصص', 'العنكبوت', 'الروم',
  'لقمان', 'السجدة', 'الأحزاب', 'سبأ', 'فاطر', 'يس', 'الصافات', 'ص', 'الزمر', 'غافر',
  'فصلت', 'الشورى', 'الزخرف', 'الدخان', 'الجاثية', 'الأحقاف', 'محمد', 'الفتح', 'الحجرات', 'ق',
  'الذاريات', 'الطور', 'النجم', 'القمر', 'الرحمن', 'الواقعة', 'الحديد', 'المجادلة', 'الحشر', 'الممتحنة',
  'الصف', 'الجمعة', 'المنافقون', 'التغابن', 'الطلاق', 'التحريم', 'الملك', 'القلم', 'الحاقة', 'المعارج',
  'نوح', 'الجن', 'المزمل', 'المدثر', 'القيامة', 'الإنسان', 'المرسلات', 'النبأ', 'النازعات', 'عبس',
  'التكوير', 'الانفطار', 'المطففين', 'الانشقاق', 'البروج', 'الطارق', 'الأعلى', 'الغاشية', 'الفجر', 'البلد',
  'الشمس', 'الليل', 'الضحى', 'الشرح', 'التين', 'العلق', 'القدر', 'البينة', 'الزلزلة', 'العاديات',
  'القارعة', 'التكاثر', 'العصر', 'الهمزة', 'الفيل', 'قريش', 'الماعون', 'الكوثر', 'الكافرون', 'النصر',
  'المسد', 'الإخلاص', 'الفلق', 'الناس'
];

// GET /api/daily-tasks/today  (Get or auto-generate today's 3-pillar task)
export const getTodayTask = async (req, res) => {
  try {
    const studentId = req.user._id;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    let task = await DailyTask.findOne({
      student: studentId,
      date: { $gte: startOfToday, $lte: endOfToday }
    });

    if (!task) {
      return res.json({
        task: null,
        message: 'لم يتم تحديد الورد اليومي بعد. سيقوم المعلم بتحديده لك أثناء جلسة التسميع المباشرة.'
      });
    }

    res.json({ task });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب الورد اليومي' });
  }
};

// PUT /api/daily-tasks/:id/portion  (Student updates task status)
export const updatePortionStatus = async (req, res) => {
  try {
    const { portion, status } = req.body; // portion: 'newHifz' | 'nearRevision' | 'cumulativeRevision'
    const task = await DailyTask.findById(req.params.id);

    if (!task) return res.status(404).json({ message: 'الورد غير موجود' });
    if (task.student.toString() !== req.user._id.toString() && !['teacher', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'غير مصرح لك بتعديل هذا الورد' });
    }

    if (task[portion]) {
      task[portion].status = status || 'completed';
    }

    const allCompleted = ['newHifz', 'nearRevision', 'cumulativeRevision'].every(
      p => task[p]?.status === 'completed' || task[p]?.status === 'reviewed'
    );

    task.overallStatus = allCompleted ? 'completed' : 'in_progress';
    // NOTE: Points are NOT self-awarded by student clicking; points are only awarded
    // by teacher/admin during live recitation evaluation or passing exams.

    await task.save();
    res.json({ message: 'تم تحديث حالة الورد بنجاح', task });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تحديث الورد' });
  }
};

// PUT /api/daily-tasks/:id/review  (Teacher reviews and scores all 3 pillars)
export const reviewDailyTask = async (req, res) => {
  try {
    const {
      newHifzScore,
      nearRevisionScore,
      cumulativeRevisionScore,
      teacherNotes,
    } = req.body;

    const task = await DailyTask.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'الورد غير موجود' });

    if (newHifzScore !== undefined) {
      task.newHifz.score = newHifzScore;
      task.newHifz.status = 'reviewed';
    }
    if (nearRevisionScore !== undefined) {
      task.nearRevision.score = nearRevisionScore;
      task.nearRevision.status = 'reviewed';
    }
    if (cumulativeRevisionScore !== undefined) {
      task.cumulativeRevision.score = cumulativeRevisionScore;
      task.cumulativeRevision.status = 'reviewed';
    }

    task.teacherNotes = teacherNotes || task.teacherNotes;
    task.reviewedBy = req.user._id;
    task.reviewedAt = new Date();
    task.overallStatus = 'reviewed';

    await task.save();

    res.json({ message: 'تم حفظ تقييم الورد القرآني بنجاح ⭐', task });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في مراجعة الورد' });
  }
};

// GET /api/daily-tasks/group/:groupId/today  (Teacher gets all group tasks for today)
export const getGroupTodayTasks = async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const group = await Group.findById(req.params.groupId).populate('students', 'firstName lastName avatar email');
    if (!group) return res.status(404).json({ message: 'المجموعة غير موجودة' });

    const tasks = await DailyTask.find({
      group: req.params.groupId,
      date: { $gte: startOfToday, $lte: endOfToday }
    }).populate('student', 'firstName lastName avatar email');

    res.json({ group, tasks });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب أوراد المجموعة' });
  }
};

// PUT /api/daily-tasks/student/:studentId/assign (Teacher/Admin assigns or modifies a specific student's daily task)
export const assignStudentDailyTask = async (req, res) => {
  try {
    const { studentId } = req.params;
    const {
      newHifz,
      nearRevision,
      cumulativeRevision,
      additionalExercise,
      teacherNotes,
      date,
    } = req.body;

    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const student = await User.findById(studentId).populate('group');
    if (!student) return res.status(404).json({ message: 'الطالب غير موجود' });

    let task = await DailyTask.findOne({
      student: studentId,
      date: { $gte: startOfDay, $lte: endOfDay },
    });

    if (!task) {
      let studentGroupId = student.group?._id || student.group;
      if (!studentGroupId) {
        const foundGroup = await Group.findOne({ students: studentId }).select('_id');
        if (foundGroup) {
          studentGroupId = foundGroup._id;
          User.findByIdAndUpdate(studentId, { group: studentGroupId }).catch(() => {});
        }
      }

      task = new DailyTask({
        student: studentId,
        group: studentGroupId,
        date: targetDate,
      });
    }

    if (newHifz) {
      const prev = task.newHifz?.toObject?.() || {};
      // ورد جديد مختلف = يُعاد للمعلق حتى لو أُنجز القديم
      const changed = ['surahNumber', 'surahName', 'fromVerse', 'toVerse']
        .some(k => newHifz[k] !== undefined && newHifz[k] !== prev[k]);
      task.newHifz = {
        ...prev,
        ...newHifz,
        versesCount: (newHifz.toVerse && newHifz.fromVerse)
          ? (newHifz.toVerse - newHifz.fromVerse + 1)
          : (newHifz.versesCount || 0),
        status: newHifz.status || (changed ? 'pending' : (task.newHifz?.status || 'pending')),
      };
    }

    if (nearRevision) {
      const prev = task.nearRevision?.toObject?.() || {};
      const changed = ['surahNumber', 'surahName', 'fromVerse', 'toVerse']
        .some(k => nearRevision[k] !== undefined && nearRevision[k] !== prev[k]);
      task.nearRevision = {
        ...prev,
        ...nearRevision,
        versesCount: (nearRevision.toVerse && nearRevision.fromVerse)
          ? (nearRevision.toVerse - nearRevision.fromVerse + 1)
          : (nearRevision.versesCount || 0),
        status: nearRevision.status || (changed ? 'pending' : (task.nearRevision?.status || 'pending')),
      };
    }

    if (cumulativeRevision) {
      task.cumulativeRevision = {
        ...(task.cumulativeRevision?.toObject?.() || {}),
        ...cumulativeRevision,
        status: cumulativeRevision.status || task.cumulativeRevision?.status || 'pending',
      };
    }

    if (additionalExercise !== undefined) {
      task.additionalExercise = additionalExercise;
    }

    if (teacherNotes !== undefined) {
      task.teacherNotes = teacherNotes;
    }

    task.reviewedBy = req.user._id;
    await task.save();

    res.json({ message: 'تم حفظ وتخصيص الورد اليومي للطالب بنجاح ✨', task });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تخصيص الورد اليومي' });
  }
};

// POST /api/daily-tasks/student/:studentId/weekly-plan (Teacher sets weekly plan for student)
export const assignWeeklyPlan = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { days, pacing } = req.body;

    const student = await User.findById(studentId).populate('group');
    if (!student) return res.status(404).json({ message: 'الطالب غير موجود' });

    let studentGroupId = student.group?._id || student.group;
    if (!studentGroupId) {
      const foundGroup = await Group.findOne({ students: studentId }).select('_id');
      if (foundGroup) {
        studentGroupId = foundGroup._id;
        User.findByIdAndUpdate(studentId, { group: studentGroupId }).catch(() => {});
      }
    }

    const createdTasks = [];

    // Mode A: Explicit days array provided
    if (Array.isArray(days) && days.length > 0) {
      for (const dayPlan of days) {
        const targetDate = new Date(dayPlan.date);
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        let task = await DailyTask.findOne({
          student: studentId,
          date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (!task) {
          task = new DailyTask({
            student: studentId,
            group: studentGroupId,
            date: targetDate,
          });
        }

        if (dayPlan.newHifz) {
          task.newHifz = {
            surahNumber: dayPlan.newHifz.surahNumber || 114,
            surahName: dayPlan.newHifz.surahName || (SURAH_NAMES[(dayPlan.newHifz.surahNumber || 114) - 1] || ''),
            fromVerse: dayPlan.newHifz.fromVerse || 1,
            toVerse: dayPlan.newHifz.toVerse || 5,
            versesCount: (dayPlan.newHifz.toVerse && dayPlan.newHifz.fromVerse)
              ? (dayPlan.newHifz.toVerse - dayPlan.newHifz.fromVerse + 1)
              : 5,
            status: task.newHifz?.status || 'pending',
          };
        }

        if (dayPlan.nearRevision) {
          task.nearRevision = {
            surahNumber: dayPlan.nearRevision.surahNumber || 113,
            surahName: dayPlan.nearRevision.surahName || (SURAH_NAMES[(dayPlan.nearRevision.surahNumber || 113) - 1] || ''),
            fromVerse: dayPlan.nearRevision.fromVerse || 1,
            toVerse: dayPlan.nearRevision.toVerse || 10,
            versesCount: (dayPlan.nearRevision.toVerse && dayPlan.nearRevision.fromVerse)
              ? (dayPlan.nearRevision.toVerse - dayPlan.nearRevision.fromVerse + 1)
              : 10,
            status: task.nearRevision?.status || 'pending',
          };
        }

        if (dayPlan.cumulativeRevision) {
          task.cumulativeRevision = {
            juzNumber: dayPlan.cumulativeRevision.juzNumber || 30,
            surahName: dayPlan.cumulativeRevision.surahName || `الجزء ${dayPlan.cumulativeRevision.juzNumber || 30}`,
            fromVerse: 1,
            toVerse: 1,
            status: task.cumulativeRevision?.status || 'pending',
          };
        }

        if (dayPlan.teacherNotes) {
          task.teacherNotes = dayPlan.teacherNotes;
        }

        task.reviewedBy = req.user._id;
        await task.save();
        createdTasks.push(task);
      }
    } else if (pacing) {
      // Mode B: Generate automated progression for next N days
      const daysCount = pacing.daysCount || 7;
      const startDate = pacing.startDate ? new Date(pacing.startDate) : new Date();
      let curFrom = Number(pacing.startVerse) || 1;
      const vPerDay = Number(pacing.versesPerDay) || 5;
      const surahNum = Number(pacing.surahNumber) || 114;
      const surahName = pacing.surahName || (SURAH_NAMES[surahNum - 1] || '');

      for (let i = 0; i < daysCount; i++) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);

        const startOfDay = new Date(d);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(d);
        endOfDay.setHours(23, 59, 59, 999);

        let task = await DailyTask.findOne({
          student: studentId,
          date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (!task) {
          task = new DailyTask({
            student: studentId,
            group: studentGroupId,
            date: d,
          });
        }

        const curTo = curFrom + vPerDay - 1;

        task.newHifz = {
          surahNumber: surahNum,
          surahName,
          fromVerse: curFrom,
          toVerse: curTo,
          versesCount: vPerDay,
          status: task.newHifz?.status || 'pending',
        };

        if (pacing.nearRevisionSurah) {
          const nearSNum = Number(pacing.nearRevisionSurah);
          task.nearRevision = {
            surahNumber: nearSNum,
            surahName: SURAH_NAMES[nearSNum - 1] || '',
            fromVerse: 1,
            toVerse: 20,
            versesCount: 20,
            status: task.nearRevision?.status || 'pending',
          };
        }

        if (pacing.cumulativeJuz) {
          const cJuz = Number(pacing.cumulativeJuz);
          task.cumulativeRevision = {
            juzNumber: cJuz,
            surahName: `الجزء ${cJuz}`,
            fromVerse: 1,
            toVerse: 1,
            status: task.cumulativeRevision?.status || 'pending',
          };
        }

        task.reviewedBy = req.user._id;
        await task.save();
        createdTasks.push(task);

        curFrom = curTo + 1;
      }
    }

    res.json({ message: `تم اعتماد خطة الورد الأسبوعية بنجاح (${createdTasks.length} أيام) 📅✨`, tasks: createdTasks });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في اعتماد خطة الورد الأسبوعية' });
  }
};


/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  Seed: 15-question placement exams (student / teacher / senior)     ║
 * ║  Safe for production — uses findOneAndUpdate with upsert.           ║
 * ║  Run:  node src/scripts/seedPlacementExams.js                       ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Force DNS servers to Google / Cloudflare to bypass local network ISP SRV lookup blocks
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {
  // Ignore if not permitted
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env') });

import Exam from '../models/Exam.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/quran_platform';

// Fallback: direct connection when SRV lookup fails (common on restricted networks)
const MONGODB_URI_DIRECT = MONGODB_URI.startsWith('mongodb+srv://')
  ? MONGODB_URI
      .replace('mongodb+srv://', 'mongodb://')
      .replace('cluster0.ldmfhgo.mongodb.net', 'ac-lzniqh6-shard-00-00.ldmfhgo.mongodb.net:27017,ac-lzniqh6-shard-00-01.ldmfhgo.mongodb.net:27017,ac-lzniqh6-shard-00-02.ldmfhgo.mongodb.net:27017')
    + '&ssl=true&replicaSet=atlas-9oav7k-shard-0&authSource=admin'
  : MONGODB_URI;


// ═══════════════════════════════════════════════════════════════════════
//  1) امتحان تحديد المستوى — الطلاب  (15 سؤال)
// ═══════════════════════════════════════════════════════════════════════
const placementExamStudent = {
  title: 'امتحان تحديد المستوى — طالب',
  type: 'placement',
  registrationType: 'student',
  level: 'all',
  duration: 30,
  passingScore: 50,
  isActive: true,
  questions: [
    // ── المجموعة 1: الحروف والحركات (مبتدئ) ──────────────────────────
    {
      questionNumber: 1,
      arabicText: 'ما الحرف الذي يُقرأ هكذا: "بَ"؟',
      text: 'ما الحرف الذي يُقرأ هكذا: "بَ"؟',
      type: 'mcq',
      options: ['ب مفتوحة', 'ت مفتوحة', 'ث مفتوحة', 'ن مفتوحة'],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 2,
      arabicText: 'ما نوع الحركة على حرف الكاف في كلمة "كِتَابٌ"؟',
      text: 'ما نوع الحركة على حرف الكاف في كلمة "كِتَابٌ"؟',
      type: 'mcq',
      options: ['كسرة', 'فتحة', 'ضمة', 'سكون'],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 3,
      arabicText: 'ما الفرق بين التنوين والنون الساكنة؟',
      text: 'ما الفرق بين التنوين والنون الساكنة؟',
      type: 'mcq',
      options: [
        'التنوين نون ساكنة زائدة تلحق آخر الاسم لفظاً لا خطاً',
        'التنوين والنون الساكنة متماثلان تماماً',
        'التنوين يكون في الأفعال فقط',
        'النون الساكنة لا تأتي في وسط الكلمة',
      ],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 4,
      arabicText: 'كم عدد حروف الهجاء العربية؟',
      text: 'كم عدد حروف الهجاء العربية؟',
      type: 'mcq',
      options: ['28 حرفاً', '26 حرفاً', '30 حرفاً', '29 حرفاً'],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 5,
      arabicText: 'هل العبارة صحيحة: "السكون هو غياب الحركة عن الحرف"؟',
      text: 'هل العبارة صحيحة: "السكون هو غياب الحركة عن الحرف"؟',
      type: 'true_false',
      options: ['صحيح', 'خطأ'],
      correctAnswerBool: true,
      points: 1,
    },

    // ── المجموعة 2: أحكام النون الساكنة والتنوين ──────────────────────
    {
      questionNumber: 6,
      arabicText: 'ما الحكم التجويدي في "مِنْ نَعِيمٍ"؟',
      text: 'ما الحكم التجويدي في "مِنْ نَعِيمٍ"؟',
      type: 'mcq',
      options: ['إدغام بغنة', 'إظهار حلقي', 'إخفاء حقيقي', 'إقلاب'],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 7,
      arabicText: 'كم عدد حروف الإظهار الحلقي؟',
      text: 'كم عدد حروف الإظهار الحلقي؟',
      type: 'mcq',
      options: ['6 أحرف', '4 أحرف', '15 حرفاً', 'حرفان'],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 8,
      arabicText: 'ما الحرف الذي إذا جاء بعد النون الساكنة أو التنوين وجب الإقلاب؟',
      text: 'ما الحرف الذي إذا جاء بعد النون الساكنة أو التنوين وجب الإقلاب؟',
      type: 'mcq',
      options: ['الباء', 'الميم', 'الواو', 'الراء'],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 9,
      arabicText: 'ما الحكم التجويدي في "مِنْ خَيْرٍ"؟',
      text: 'ما الحكم التجويدي في "مِنْ خَيْرٍ"؟',
      type: 'mcq',
      options: ['إظهار حلقي', 'إخفاء حقيقي', 'إدغام بلا غنة', 'إقلاب'],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 10,
      arabicText: 'حروف الإخفاء الحقيقي عددها:',
      text: 'حروف الإخفاء الحقيقي عددها:',
      type: 'mcq',
      options: ['15 حرفاً', '6 أحرف', '4 أحرف', '10 أحرف'],
      correctAnswer: 0,
      points: 1,
    },

    // ── المجموعة 3: المدود والتفخيم والترقيق (متقدم) ────────────────
    {
      questionNumber: 11,
      arabicText: 'ما مقدار المد الطبيعي؟',
      text: 'ما مقدار المد الطبيعي؟',
      type: 'mcq',
      options: ['حركتان', '4 حركات', '6 حركات', 'حركة واحدة'],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 12,
      arabicText: 'ما الفرق بين المد المتصل والمد المنفصل؟',
      text: 'ما الفرق بين المد المتصل والمد المنفصل؟',
      type: 'mcq',
      options: [
        'المتصل: حرف المد والهمزة في كلمة واحدة | المنفصل: في كلمتين',
        'لا فرق بينهما',
        'المتصل أقصر من المنفصل دائماً',
        'المنفصل واجب والمتصل جائز',
      ],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 13,
      arabicText: 'هل العبارة صحيحة: "حرف الراء يُفخَّم دائماً"؟',
      text: 'هل العبارة صحيحة: "حرف الراء يُفخَّم دائماً"؟',
      type: 'true_false',
      options: ['صحيح', 'خطأ'],
      correctAnswerBool: false,
      points: 1,
    },
    {
      questionNumber: 14,
      arabicText: 'ما حكم لام لفظ الجلالة في "بِسْمِ اللَّهِ"؟',
      text: 'ما حكم لام لفظ الجلالة في "بِسْمِ اللَّهِ"؟',
      type: 'mcq',
      options: ['تُرقَّق لأن ما قبلها مكسور', 'تُفخَّم دائماً', 'تُسكَّن', 'تُحذف'],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 15,
      arabicText: 'ما حكم الميم الساكنة إذا جاء بعدها حرف الباء؟',
      text: 'ما حكم الميم الساكنة إذا جاء بعدها حرف الباء؟',
      type: 'mcq',
      options: ['إخفاء شفوي', 'إدغام شفوي', 'إظهار شفوي', 'إقلاب'],
      correctAnswer: 0,
      points: 2,
    },
  ],
  oralTasks: [
    { taskNumber: 1, instruction: 'اقرأ سورة الفاتحة كاملة بصوت واضح', arabicText: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ﴿١﴾ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ﴿٢﴾', duration: 90 },
    { taskNumber: 2, instruction: 'تهجَّأ الكلمات التالية حرفاً حرفاً', arabicText: 'كِتَابٌ — رَحْمَةٌ — قُرْآنٌ — مُسْتَقِيمٌ', duration: 60 },
    { taskNumber: 3, instruction: 'اقرأ الآيات التالية مع تطبيق أحكام النون الساكنة', arabicText: 'وَمِنْ شَرِّ حَاسِدٍ إِذَا حَسَدَ — مِنْ بَعْدِ مَا جَاءَتْهُمُ', duration: 60 },
  ],
  totalPoints: 20,
};

// ═══════════════════════════════════════════════════════════════════════
//  2) امتحان تحديد المستوى — المعلمين  (15 سؤال)
// ═══════════════════════════════════════════════════════════════════════
const placementExamTeacher = {
  title: 'امتحان تحديد المستوى — معلم',
  type: 'placement',
  registrationType: 'teacher',
  level: 'all',
  duration: 40,
  passingScore: 60,
  isActive: true,
  questions: [
    // ── المجموعة 1: التعريفات والأصول ────────────────────────────────
    {
      questionNumber: 1,
      arabicText: 'ما تعريف التجويد اصطلاحاً؟',
      text: 'ما تعريف التجويد اصطلاحاً؟',
      type: 'mcq',
      options: [
        'إعطاء كل حرف حقه ومستحقه من الصفات والمخارج',
        'تحسين الصوت فقط',
        'القراءة السريعة بدون أخطاء',
        'حفظ القرآن عن ظهر قلب',
      ],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 2,
      arabicText: 'ما حكم تعلم التجويد؟',
      text: 'ما حكم تعلم التجويد؟',
      type: 'mcq',
      options: [
        'فرض كفاية علماً وفرض عين عملاً',
        'سنة مؤكدة',
        'مستحب فقط',
        'واجب على العلماء فقط',
      ],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 3,
      arabicText: 'كم عدد مخارج الحروف الرئيسية عند ابن الجزري؟',
      text: 'كم عدد مخارج الحروف الرئيسية عند ابن الجزري؟',
      type: 'mcq',
      options: ['17 مخرجاً', '14 مخرجاً', '10 مخارج', '20 مخرجاً'],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 4,
      arabicText: 'ما أقسام النون الساكنة والتنوين؟',
      text: 'ما أقسام النون الساكنة والتنوين؟',
      type: 'mcq',
      options: [
        'إظهار وإدغام وإقلاب وإخفاء',
        'إظهار وإدغام وإمالة',
        'إظهار وإخفاء فقط',
        'مد وقصر وتوسط',
      ],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 5,
      arabicText: 'هل العبارة صحيحة: "الإدغام نوعان: بغنة وبلا غنة"؟',
      text: 'هل العبارة صحيحة: "الإدغام نوعان: بغنة وبلا غنة"؟',
      type: 'true_false',
      options: ['صحيح', 'خطأ'],
      correctAnswerBool: true,
      points: 1,
    },

    // ── المجموعة 2: صفات الحروف والمخارج ────────────────────────────
    {
      questionNumber: 6,
      arabicText: 'ما الصفات التي لها ضد؟',
      text: 'ما الصفات التي لها ضد؟',
      type: 'mcq',
      options: [
        'الهمس والجهر، الشدة والرخاوة، الاستعلاء والاستفال، الإطباق والانفتاح، الإذلاق والإصمات',
        'القلقلة والصفير فقط',
        'التفخيم والترقيق فقط',
        'الغنة والمد فقط',
      ],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 7,
      arabicText: 'ما حروف القلقلة؟',
      text: 'ما حروف القلقلة؟',
      type: 'mcq',
      options: [
        'ق ط ب ج د (قطب جد)',
        'ص ض ط ظ',
        'ف ح ث هـ',
        'ب م و ن',
      ],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 8,
      arabicText: 'ما مخرج حرف الضاد؟',
      text: 'ما مخرج حرف الضاد؟',
      type: 'mcq',
      options: [
        'إحدى حافتي اللسان أو كلتاهما مع ما يحاذيها من الأضراس العليا',
        'طرف اللسان مع أصول الثنايا العليا',
        'وسط اللسان مع ما يحاذيه من الحنك الأعلى',
        'أقصى اللسان مع ما يحاذيه من الحنك الأعلى',
      ],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 9,
      arabicText: 'هل العبارة صحيحة: "حروف الاستعلاء مجموعة في: خُصَّ ضَغْطٍ قِظْ"؟',
      text: 'هل العبارة صحيحة: "حروف الاستعلاء مجموعة في: خُصَّ ضَغْطٍ قِظْ"؟',
      type: 'true_false',
      options: ['صحيح', 'خطأ'],
      correctAnswerBool: true,
      points: 1,
    },
    {
      questionNumber: 10,
      arabicText: 'ما الفرق بين الإدغام الكامل والناقص؟',
      text: 'ما الفرق بين الإدغام الكامل والناقص؟',
      type: 'mcq',
      options: [
        'الكامل: يذهب الحرف المدغم ذاتاً وصفة | الناقص: يذهب ذاتاً وتبقى صفة الغنة',
        'لا فرق بينهما',
        'الكامل أطول زمناً',
        'الناقص يختص بحرف الراء فقط',
      ],
      correctAnswer: 0,
      points: 2,
    },

    // ── المجموعة 3: المدود والأحكام المتقدمة ──────────────────────────
    {
      questionNumber: 11,
      arabicText: 'ما مقدار المد المتصل الواجب؟',
      text: 'ما مقدار المد المتصل الواجب؟',
      type: 'mcq',
      options: ['4 أو 5 حركات وجوباً', 'حركتان', '6 حركات', '2 أو 4 حركات'],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 12,
      arabicText: 'ما أنواع المد الفرعي؟',
      text: 'ما أنواع المد الفرعي؟',
      type: 'mcq',
      options: [
        'بسبب الهمز (متصل، منفصل، بدل) وبسبب السكون (عارض، لازم)',
        'طبيعي وفرعي فقط',
        'متصل ومنفصل فقط',
        'لازم وعارض فقط',
      ],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 13,
      arabicText: 'ما حكم المد اللازم الكلمي المثقَّل؟',
      text: 'ما حكم المد اللازم الكلمي المثقَّل؟',
      type: 'mcq',
      options: ['يُمد 6 حركات لزوماً', '4 حركات', 'حركتان', '2 أو 4 حركات'],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 14,
      arabicText: 'ما حكم لام لفظ الجلالة بعد الكسر في "بِسْمِ اللَّهِ"؟',
      text: 'ما حكم لام لفظ الجلالة بعد الكسر في "بِسْمِ اللَّهِ"؟',
      type: 'mcq',
      options: ['ترقيق اللام', 'تفخيم اللام', 'إسكان اللام', 'حذف اللام'],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 15,
      arabicText: 'ما مراتب التلاوة المعروفة؟',
      text: 'ما مراتب التلاوة المعروفة؟',
      type: 'mcq',
      options: [
        'التحقيق والحَدْر والتدوير',
        'السرعة والبطء فقط',
        'الحَدْر فقط',
        'القراءة الصامتة والجهرية',
      ],
      correctAnswer: 0,
      points: 2,
    },
  ],
  oralTasks: [
    { taskNumber: 1, instruction: 'اقرأ الآيات 1-5 من سورة الملك مع تطبيق جميع أحكام التجويد', arabicText: 'تَبَارَكَ الَّذِي بِيَدِهِ الْمُلْكُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ', duration: 120 },
    { taskNumber: 2, instruction: 'اشرح أحكام النون الساكنة الموجودة في الأمثلة التالية مع التطبيق', arabicText: 'مِنْ بَعْدِ — إِنْ يَقُولُ — أَنْبِئُونِي — مِنْ وَلِيٍّ — عَنْ هَوَى', duration: 90 },
    { taskNumber: 3, instruction: 'بيّن أنواع المدود في الآية التالية وطبّقها', arabicText: 'وَجَاءُوا أَبَاهُمْ عِشَاءً يَبْكُونَ ﴿يوسف: ١٦﴾', duration: 90 },
  ],
  totalPoints: 26,
};

// ═══════════════════════════════════════════════════════════════════════
//  3) امتحان تحديد المستوى — كبار السن  (15 سؤال)
// ═══════════════════════════════════════════════════════════════════════
const placementExamSenior = {
  title: 'امتحان تحديد المستوى — كبار السن',
  type: 'placement',
  registrationType: 'senior',
  level: 'all',
  duration: 25,
  passingScore: 40,
  isActive: true,
  questions: [
    // ── المجموعة 1: التعرف على المستوى الحالي ────────────────────────
    {
      questionNumber: 1,
      arabicText: 'هل تستطيع قراءة سورة الفاتحة كاملة؟',
      text: 'هل تستطيع قراءة سورة الفاتحة كاملة؟',
      type: 'mcq',
      options: ['نعم بسهولة', 'نعم ولكن ببطء', 'أحفظها ولكن لا أقرأها من المصحف', 'لا أستطيع قراءتها'],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 2,
      arabicText: 'ما السور القصيرة التي تحفظها؟',
      text: 'ما السور القصيرة التي تحفظها؟',
      type: 'mcq',
      options: [
        'الفاتحة والإخلاص والمعوذتين وسور أخرى',
        'الفاتحة والإخلاص فقط',
        'الفاتحة فقط',
        'لا أحفظ شيئاً',
      ],
      correctAnswer: 0,
      points: 2,
    },
    {
      questionNumber: 3,
      arabicText: 'هل تعرف الحروف الهجائية العربية؟',
      text: 'هل تعرف الحروف الهجائية العربية؟',
      type: 'mcq',
      options: [
        'نعم، أعرفها جميعاً وأميّز بينها',
        'أعرف معظمها',
        'أعرف بعضها فقط',
        'لا أعرف الحروف',
      ],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 4,
      arabicText: 'هل تستطيع التمييز بين الحركات الثلاث (فتحة - ضمة - كسرة)؟',
      text: 'هل تستطيع التمييز بين الحركات الثلاث (فتحة - ضمة - كسرة)؟',
      type: 'mcq',
      options: [
        'نعم، أميّز بينها جيداً',
        'أميّز بين بعضها',
        'سمعتُ عنها لكن لا أميّز',
        'لا أعرف ما الحركات',
      ],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 5,
      arabicText: 'هل العبارة صحيحة: "الفاتحة هي أول سورة في المصحف"؟',
      text: 'هل العبارة صحيحة: "الفاتحة هي أول سورة في المصحف"؟',
      type: 'true_false',
      options: ['صحيح', 'خطأ'],
      correctAnswerBool: true,
      points: 1,
    },

    // ── المجموعة 2: المعرفة القرآنية الأساسية ─────────────────────────
    {
      questionNumber: 6,
      arabicText: 'كم عدد أجزاء القرآن الكريم؟',
      text: 'كم عدد أجزاء القرآن الكريم؟',
      type: 'mcq',
      options: ['30 جزءاً', '20 جزءاً', '40 جزءاً', '25 جزءاً'],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 7,
      arabicText: 'ما اسم آخر سورة في المصحف الشريف؟',
      text: 'ما اسم آخر سورة في المصحف الشريف؟',
      type: 'mcq',
      options: ['سورة الناس', 'سورة الفلق', 'سورة الإخلاص', 'سورة الكوثر'],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 8,
      arabicText: 'هل تعرف بعض أحكام التجويد البسيطة؟',
      text: 'هل تعرف بعض أحكام التجويد البسيطة؟',
      type: 'mcq',
      options: [
        'نعم، أعرف بعض الأحكام كالمد والغنة',
        'سمعتُ عنها لكن لا أطبّقها',
        'لا أعرف شيئاً عنها',
        'أعرفها جيداً وأطبّقها',
      ],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 9,
      arabicText: 'ما معنى "المد" في التجويد؟',
      text: 'ما معنى "المد" في التجويد؟',
      type: 'mcq',
      options: [
        'إطالة الصوت عند حروف المد (ا، و، ي)',
        'الوقف عند نهاية الآية',
        'رفع الصوت عند القراءة',
        'السكوت بين الآيات',
      ],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 10,
      arabicText: 'هل العبارة صحيحة: "سورة الإخلاص فيها 4 آيات"؟',
      text: 'هل العبارة صحيحة: "سورة الإخلاص فيها 4 آيات"؟',
      type: 'true_false',
      options: ['صحيح', 'خطأ'],
      correctAnswerBool: true,
      points: 1,
    },

    // ── المجموعة 3: الأهداف والاحتياجات الشخصية ─────────────────────
    {
      questionNumber: 11,
      arabicText: 'ما هدفك الرئيسي من الانضمام للمنصة؟',
      text: 'ما هدفك الرئيسي من الانضمام للمنصة؟',
      type: 'mcq',
      options: [
        'تعلم قراءة القرآن بشكل صحيح',
        'حفظ بعض السور القصيرة',
        'تحسين تلاوتي في الصلاة',
        'كل ما سبق',
      ],
      correctAnswer: 3,
      points: 1,
    },
    {
      questionNumber: 12,
      arabicText: 'كم من الوقت يمكنك تخصيصه يومياً للتعلم؟',
      text: 'كم من الوقت يمكنك تخصيصه يومياً للتعلم؟',
      type: 'mcq',
      options: ['أقل من 15 دقيقة', '15-30 دقيقة', '30-60 دقيقة', 'أكثر من ساعة'],
      correctAnswer: 1,
      points: 1,
    },
    {
      questionNumber: 13,
      arabicText: 'هل تحتاج مساعدة في استخدام التطبيق والتكنولوجيا؟',
      text: 'هل تحتاج مساعدة في استخدام التطبيق والتكنولوجيا؟',
      type: 'mcq',
      options: [
        'لا، أستطيع استخدامه وحدي',
        'نعم، أحتاج بعض المساعدة',
        'نعم، أحتاج مساعدة كبيرة',
        'سيساعدني أحد أفراد الأسرة',
      ],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 14,
      arabicText: 'ما هي الفترة المفضلة لديك للدراسة؟',
      text: 'ما هي الفترة المفضلة لديك للدراسة؟',
      type: 'mcq',
      options: [
        'بعد صلاة الفجر',
        'فترة الصباح',
        'بعد صلاة العصر',
        'بعد صلاة العشاء',
      ],
      correctAnswer: 0,
      points: 1,
    },
    {
      questionNumber: 15,
      arabicText: 'هل لديك خبرة سابقة في حلقات تحفيظ القرآن؟',
      text: 'هل لديك خبرة سابقة في حلقات تحفيظ القرآن؟',
      type: 'mcq',
      options: [
        'نعم، التحقتُ بحلقات في المسجد',
        'نعم، تعلمتُ على يد شيخ خاص',
        'لا، هذه أول مرة',
        'حاولتُ ولكن لم أستمر',
      ],
      correctAnswer: 0,
      points: 1,
    },
  ],
  oralTasks: [
    { taskNumber: 1, instruction: 'اقرأ سورة الفاتحة بصوت واضح وهادئ', arabicText: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ﴿١﴾ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ﴿٢﴾', duration: 120 },
    { taskNumber: 2, instruction: 'اقرأ سورة الإخلاص', arabicText: 'قُلْ هُوَ اللَّهُ أَحَدٌ ﴿١﴾ اللَّهُ الصَّمَدُ ﴿٢﴾', duration: 60 },
    { taskNumber: 3, instruction: 'اقرأ ما تحفظ من سورة الناس أو الفلق', arabicText: 'قُلْ أَعُوذُ بِرَبِّ النَّاسِ ﴿١﴾', duration: 60 },
  ],
  totalPoints: 17,
};

// ═══════════════════════════════════════════════════════════════════════
//  Runner
// ═══════════════════════════════════════════════════════════════════════
async function seedPlacementExams() {
  try {
    // Try SRV first, fallback to direct connection on DNS failure
    try {
      await mongoose.connect(MONGODB_URI);
      console.log('✅ متصل بقاعدة البيانات (SRV)');
    } catch (srvErr) {
      if (srvErr.code === 'ECONNREFUSED' || srvErr.message?.includes('querySrv')) {
        console.log('⚠️  فشل SRV DNS — جارٍ المحاولة بالاتصال المباشر...');
        await mongoose.connect(MONGODB_URI_DIRECT);
        console.log('✅ متصل بقاعدة البيانات (اتصال مباشر)');
      } else {
        throw srvErr;
      }
    }

    const exams = [placementExamStudent, placementExamTeacher, placementExamSenior];

    for (const examData of exams) {
      const result = await Exam.findOneAndUpdate(
        { type: 'placement', registrationType: examData.registrationType },
        { $set: examData },
        { upsert: true, new: true, runValidators: false }
      );
      console.log(`✅ ${examData.title}  →  ${result.questions.length} سؤال + ${result.oralTasks.length} مهمة شفهية  (ID: ${result._id})`);
    }

    console.log('\n🎉 ═══════════════════════════════════════════════════════');
    console.log('   تم رفع 3 امتحانات تحديد مستوى (15 سؤال لكل نوع)');
    console.log('   student • teacher • senior');
    console.log('═══════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ فشل الرفع:', error);
    process.exit(1);
  }
}

seedPlacementExams();

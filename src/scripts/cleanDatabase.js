import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Force DNS servers to bypass SRV lookup blocks on Windows/local networks
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {
  // ignore
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set in .env');
  process.exit(1);
}

async function cleanDatabase() {
  try {
    console.log('🔄 جاري الاتصال بقاعدة البيانات...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ تم الاتصال بقاعدة البيانات بنجاح.');

    const db = mongoose.connection.db;

    // 1. فحص وحفظ حسابات الأدمن
    const adminCount = await db.collection('users').countDocuments({ role: 'admin' });
    console.log(`\n👑 عدد حسابات الأدمن الموجودة: ${adminCount}`);

    if (adminCount === 0) {
      console.warn('⚠️ تحذير: لم يتم العثور على أي حساب أدمن! سيتم إيقاف العملية للحفاظ على الأمان.');
      await mongoose.disconnect();
      return;
    }

    // حذف جميع المستخدمين غير الأدمن (الطلاب، أولياء الأمور، المعلمين)
    const deletedUsers = await db.collection('users').deleteMany({ role: { $ne: 'admin' } });
    console.log(`🗑️ تم حذف ${deletedUsers.deletedCount} مستخدم (الطلاب وأولياء الأمور والمعلمين غير الأدمن).`);

    // تنظيف حقول الحسابات للأدمن (مسح أي ارتباطات بمجموعات أو أطفال محذوفين)
    await db.collection('users').updateMany(
      { role: 'admin' },
      {
        $set: {
          children: [],
          group: null,
          points: 0,
          streak: 0,
          memorizedVerses: 0,
          totalStudyHours: 0,
          completedLessons: [],
        }
      }
    );
    console.log('✅ تم تنظيف حسابات الأدمن وتصفير الحقول المرتبطة بالمجموعات والطلاب.');

    // 2. فحص وحفظ امتحانات تحديد المستوى
    const placementExamsCount = await db.collection('exams').countDocuments({ type: 'placement' });
    console.log(`\n📝 عدد امتحانات تحديد المستوى المحفوظة: ${placementExamsCount}`);

    // حذف أي امتحانات غير امتحانات تحديد المستوى (مثل اختبارات الحصص، الشهرية، إلخ)
    const deletedExams = await db.collection('exams').deleteMany({ type: { $ne: 'placement' } });
    console.log(`🗑️ تم حذف ${deletedExams.deletedCount} امتحان غير خاص بتحديد المستوى.`);

    // 3. حذف كافة المجموعات والنتائج والجلسات والمهام
    const collectionsToClear = [
      'examresults',       // نتائج الامتحانات
      'livesessions',      // الجلسات المباشرة
      'dailytasks',        // المهام اليومية
      'studyplans',        // خطط الحفظ
      'discussions',       // الرسائل والمناقشات
      'notifications',     // الإشعارات
      'payments',          // المدفوعات والاشتراكات
      'groups',            // المجموعات والحلقات
      'recordings',        // التسجيلات
      'curriculums',       // المناهج والحصص
      'weakpoints',        // نقاط الضعف
      'sessionfeedbacks',  // تقييمات الحصص
      'dailyrecords',      // السجلات اليومية
      'studentrecitations',// التلاوات
      'ijazahrecords',     // الإجازات
    ];

    for (const colName of collectionsToClear) {
      try {
        const col = db.collection(colName);
        const count = await col.countDocuments();
        if (count > 0) {
          const res = await col.deleteMany({});
          console.log(`🗑️ [${colName}]: تم حذف ${res.deletedCount} سجل.`);
        } else {
          console.log(`⚪ [${colName}]: فارغ بالفعل.`);
        }
      } catch (err) {
        console.log(`ℹ️ [${colName}]: ${err.message}`);
      }
    }

    // الإبقاء على surveys و paymentsettings كإعدادات نظام عامة
    console.log('\n==================================================');
    console.log('🎉 اكتملت عملية تنظيف قاعدة البيانات بنجاح!');
    console.log('📌 تم الحفاظ على:');
    console.log(`   - حسابات الأدمن (${adminCount})`);
    console.log(`   - امتحانات تحديد المستوى (${placementExamsCount})`);
    console.log('   - إعدادات الدفع والاستبيانات النظامية');
    console.log('==================================================\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ حدث خطأ أثناء تنظيف قاعدة البيانات:', error);
    process.exit(1);
  }
}

cleanDatabase();

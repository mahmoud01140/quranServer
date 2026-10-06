import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Force DNS servers to bypass ISP blocks for Atlas SRV
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {
  // Ignore
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/quran_platform';

// Atlas M0 Free Tier limit: 512 MB
const MAX_FREE_TIER_BYTES = 512 * 1024 * 1024; // 536,870,912 Bytes

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderProgressBar(percentage, length = 30) {
  const filled = Math.min(length, Math.max(0, Math.round((percentage / 100) * length)));
  const empty = length - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

async function checkStorage() {
  console.log('\n⏳ جارٍ الاتصال بقاعدة البيانات وحساب المساحة...');
  try {
    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;

    const stats = await db.stats();

    // In Atlas / WiredTiger:
    // storageSize = disk size used by documents (compressed)
    // indexSize = disk size used by indexes
    // totalUsedBytes = storageSize + indexSize
    const storageSize = stats.storageSize || 0;
    const indexSize = stats.indexSize || 0;
    const dataSize = stats.dataSize || 0; // Uncompressed logical data size
    const totalUsedBytes = storageSize + indexSize;

    const remainingBytes = Math.max(0, MAX_FREE_TIER_BYTES - totalUsedBytes);
    const usedPercentage = parseFloat(((totalUsedBytes / MAX_FREE_TIER_BYTES) * 100).toFixed(2));
    const remainingPercentage = parseFloat((100 - usedPercentage).toFixed(2));

    // Get collection counts
    const collections = await db.listCollections().toArray();
    const counts = {};
    for (const col of collections) {
      try {
        counts[col.name] = await db.collection(col.name).estimatedDocumentCount();
      } catch {
        counts[col.name] = 0;
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('       📊 تقرير مساحة قاعدة البيانات المجانية (MongoDB M0)       ');
    console.log('═══════════════════════════════════════════════════════════════');

    console.log(`\n🔹 السعة الإجمالية المتاحة : 512.00 MB`);
    console.log(`🔹 المساحة المستخدمة حالياً : ${formatBytes(totalUsedBytes)} (${usedPercentage}%)`);
    console.log(`🔹 المساحة المتبقية الفارغة  : ${formatBytes(remainingBytes)} (${remainingPercentage}% فارغة)`);

    console.log(`\nمؤشر الاستهلاك:`);
    console.log(`${renderProgressBar(usedPercentage, 35)} ${usedPercentage}%\n`);

    console.log('───────────────────────────────────────────────────────────────');
    console.log('📁 تفاصيل الاستهلاك الداخلي:');
    console.log(`  • حجم البيانات المخزنة على القرص : ${formatBytes(storageSize)}`);
    console.log(`  • حجم فهارس البحث والتسريع (Index) : ${formatBytes(indexSize)}`);
    console.log(`  • حجم البيانات قبل الضغط (Logical) : ${formatBytes(dataSize)}`);
    console.log('───────────────────────────────────────────────────────────────');

    console.log('👥 إحصائيات السجلات في النظام:');
    console.log(`  • عدد المستخدمين (users)          : ${counts['users'] || 0}`);
    console.log(`  • نتائج الامتحانات (examresults)   : ${counts['examresults'] || 0}`);
    console.log(`  • بنك الامتحانات (exams)          : ${counts['exams'] || 0}`);
    console.log(`  • طلبات واشتراكات الدفع (payments) : ${counts['payments'] || 0}`);
    console.log(`  • المهام اليومية (dailytasks)     : ${counts['dailytasks'] || 0}`);
    console.log(`  • الإشعارات (notifications)       : ${counts['notifications'] || 0}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ حدث خطأ أثناء فحص المساحة:', error.message || error);
    process.exit(1);
  }
}

checkStorage();

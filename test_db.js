import mongoose from 'mongoose';

async function test() {
  const uri = "mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/tenant_sbi?appName=Cluster0";
  const c = await mongoose.connect(uri);
  const AccessibilityReport = c.model('AccessibilityReport', new mongoose.Schema({}, { strict: false, collection: 'accessibility_reports' }));

  const reports = await AccessibilityReport.find({ jobId: 'accessibility-14-1780744217307' }).lean();
  console.log(`Found ${reports.length} reports`);

  for (const r of reports) {
    const ids = r.issues.map(i => i.id);
    const uniqueIds = new Set(ids);
    console.log(`Report ${r.url}: ${ids.length} total issues, ${uniqueIds.size} unique issues`);
    if (ids.length !== uniqueIds.size) {
      const counts = {};
      for (const id of ids) {
        counts[id] = (counts[id] || 0) + 1;
      }
      for (const id in counts) {
        if (counts[id] > 1) {
          console.log(`  Duplicate: ${id} appears ${counts[id]} times`);
        }
      }
    }
  }
  process.exit(0);
}

test().catch(console.error);

import mongoose from 'mongoose';
import { DomainReportSchema } from '../src/models/DomainReport.js';

const DB_URL = "mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/?appName=Cluster0";
const CLIENT_DB = "tenant_sbi";
const DOMAIN = "omunim.com";

async function run() {
  try {
    console.log("Connecting to Database...");
    const conn = await mongoose.createConnection(DB_URL, { dbName: CLIENT_DB }).asPromise();
    const DomainReport = conn.model('DomainReport', DomainReportSchema, 'domain_reports');
    
    // We want to delete any report for this domain with jobId "3" that was scanned BEFORE May 30, 2026
    const cutoffDate = new Date("2026-05-30T00:00:00Z");
    console.log(`Deleting all reports for ${DOMAIN} with jobId "3" scanned before ${cutoffDate.toISOString()}...`);
    
    const delResult = await DomainReport.deleteMany({
      domain: DOMAIN,
      jobId: "3",
      scanDate: { $lt: cutoffDate }
    });
    
    console.log(`Successfully deleted ${delResult.deletedCount} old historical reports!`);
    
    // Let's verify how many reports with jobId: "3" are left
    const remaining = await DomainReport.find({ domain: DOMAIN, jobId: "3" });
    console.log(`Remaining reports with jobId "3": ${remaining.length}`);
    for (const r of remaining) {
      console.log(`  - URL: ${r.url}, ScanDate: ${r.scanDate}`);
    }
    
    await conn.close();
    console.log("Database connection closed.");
  } catch (err) {
    console.error("Cleanup failed:", err);
  }
}

run();

import mongoose from 'mongoose';
import { QaReportSchema } from '../src/models/QaReport.js';

const DB_URL = "mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/?appName=Cluster0";
const CLIENT_DB = "tenant_sbi";

async function run() {
  try {
    const conn = await mongoose.createConnection(DB_URL, { dbName: CLIENT_DB }).asPromise();
    const QaReport = conn.model('QaReport', QaReportSchema, 'qa_reports');

    const reports = await QaReport.find({ "potentialMisspellings.0": { $exists: true } }).lean();
    console.log(`Found ${reports.length} reports containing potential misspellings.`);
    
    for (const r of reports) {
      console.log(`\nURL: ${r.url}`);
      console.log("Potential misspellings:", JSON.stringify(r.potentialMisspellings, null, 2));
    }

    await conn.close();
  } catch (err) {
    console.error(err);
  }
}

run();


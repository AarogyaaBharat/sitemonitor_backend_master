import mongoose from 'mongoose';
import { DomainSummarySchema } from '../src/models/DomainSummary.js';
import { DomainReportSchema } from '../src/models/DomainReport.js';

const DB_URL = "mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/?appName=Cluster0";
const CLIENT_DB = "tenant_sbi";
const DOMAIN = "omunim.com";

async function run() {
  try {
    const conn = await mongoose.createConnection(DB_URL, { dbName: CLIENT_DB }).asPromise();
    
    const DomainSummary = conn.model('DomainSummary', DomainSummarySchema, 'domain_summaries');
    const DomainReport = conn.model('DomainReport', DomainReportSchema, 'domain_reports');
    
    const summary = await DomainSummary.findOne({ domain: DOMAIN }).sort({ lastScanDate: -1 });
    console.log("--- Latest Summary ---");
    if (summary) {
      console.log(`Final SEO Score: ${summary.finalSeoScore}`);
      console.log(`Total Pages: ${summary.totalPages}`);
      console.log("Top Issues:", JSON.stringify(summary.topIssues, null, 2));
    } else {
      console.log("No summary found.");
    }
    
    const reports = await DomainReport.find({ domain: DOMAIN }).limit(3);
    console.log("--- Sample Reports ---");
    for (const r of reports) {
      console.log(`Page URL: ${r.url}`);
      console.log("Improvements:", JSON.stringify(r.seoImprovements, null, 2));
    }
    
    await conn.close();
  } catch (err) {
    console.error(err);
  }
}

run();

import mongoose from 'mongoose';
import { DomainReportSchema } from '../src/models/DomainReport.js';

const DB_URL = "mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/?appName=Cluster0";
const CLIENT_DB = "tenant_sbi";

async function run() {
  try {
    console.log("Connecting to Database:", CLIENT_DB);
    const conn = await mongoose.createConnection(DB_URL, {
      dbName: CLIENT_DB
    }).asPromise();
    
    const DomainReport = conn.model('DomainReport', DomainReportSchema, 'domain_reports');
    
    // Find any latest reports
    const reports = await DomainReport.find({}).sort({ scanDate: -1 }).limit(10);

    console.log(`Found ${reports.length} reports in the database:\n`);
    
    reports.forEach((r, idx) => {
      const imgImps = (r.seoImprovements || []).filter(i => 
        (i.message || "").toLowerCase().includes("large image") ||
        (i.message || "").toLowerCase().includes("kb") ||
        i.type === 'images'
      );
      
      if (imgImps.length > 0) {
        console.log(`=== REPORT ${idx + 1} (URL: ${r.url}) ===`);
        console.log("seoImprovements (Large Images / Images):");
        console.log(JSON.stringify(imgImps, null, 2));
        
        console.log("\nimageAnalysis Summary:");
        if (r.imageAnalysis) {
          console.log(`Total: ${r.imageAnalysis.total}, Total Size: ${r.imageAnalysis.totalSize}`);
          console.log("Sample imageLoadDetails (up to 3):");
          console.log(JSON.stringify((r.imageAnalysis.imageLoadDetails || []).slice(0, 3), null, 2));
        } else {
          console.log("No imageAnalysis block found.");
        }
        console.log("=========================================\n");
      }
    });
    
    await conn.close();
  } catch (err) {
    console.error("Error executing script:", err);
  }
}

run();

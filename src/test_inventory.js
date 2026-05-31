import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { processInventoryScan } from './jobs/inventoryScan.processor.js';

// Mock BullMQ job
const mockJob = {
  id: 'test-crawler-job',
  data: {
    domainId: new mongoose.Types.ObjectId().toString(),
    domainUrl: 'https://example.com',
    scanId: new mongoose.Types.ObjectId().toString(),
    sourceDb: 'tenant_testing_inventory',
    sourceUri: process.env.DB_URL
  },
  updateProgress: async (p) => {
    console.log(`   [JOB PROGRESS] 📈 Crawling status: ${p}%`);
  }
};

async function main() {
  console.log("====================================================");
  console.log("🚀 STARTING INVENTORY CRAWLER TEST RUNNER");
  console.log("   Target: https://example.com");
  console.log("   Tenant DB: tenant_testing_inventory");
  console.log("====================================================");

  if (!process.env.DB_URL) {
    console.error("❌ Error: DB_URL is missing in master environment (.env)");
    process.exit(1);
  }

  try {
    // Setup mock DomainScanMaster record
    const clientConn = mongoose.createConnection(process.env.DB_URL, { dbName: mockJob.data.sourceDb });
    await new Promise((resolve, reject) => {
      clientConn.once('open', resolve);
      clientConn.once('error', reject);
    });

    const DomainScanMasterSchema = new mongoose.Schema({
      domain_id: { type: String, required: true },
      domain_url: { type: String, required: true },
      status: { type: String, enum: ['pending', 'scanning', 'completed', 'failed'], default: 'pending' },
      progress_percent: { type: Number, default: 0 },
      total_pages: { type: Number, default: 0 },
      total_images: { type: Number, default: 0 },
      total_css: { type: Number, default: 0 },
      total_js: { type: Number, default: 0 },
      total_documents: { type: Number, default: 0 },
      total_emails: { type: Number, default: 0 },
      total_headlinks: { type: Number, default: 0 },
      scan_started_at: Date,
      scan_completed_at: Date,
      error_message: String
    });
    const DomainScanMaster = clientConn.model('DomainScanMaster', DomainScanMasterSchema, 'domain_scan_master');
    await DomainScanMaster.create({
      _id: new mongoose.Types.ObjectId(mockJob.data.scanId),
      domain_id: mockJob.data.domainId,
      domain_url: mockJob.data.domainUrl,
      status: 'pending'
    });
    console.log("   [TEST SETUP] Created mock DomainScanMaster record successfully.");
    await clientConn.close();

    const result = await processInventoryScan(mockJob);
    console.log("\n====================================================");
    console.log("✅ CRAWLER INTEGRATION TEST PASSED SUCCESSFULLY!");
    console.log("   Total Crawled Pages:", result.totalPages);
    console.log("   Total Scanned Images:", result.totalImages);
    console.log("   Total JS files:", result.totalJs);
    console.log("   Total CSS stylesheets:", result.totalCss);
    console.log("====================================================");
  } catch (err) {
    console.error("\n❌ CRAWLER INTEGRATION TEST FAILED!");
    console.error(err);
  } finally {
    process.exit(0);
  }
}

main();

import mongoose from 'mongoose';
import { Schema } from 'mongoose';

const DB_URL = "mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/?appName=Cluster0";
const CLIENT_DB = "tenant_sbi";

// Replicate qaReportSchema and get_qa_page_detail_service mapping
const qaReportSchema = new Schema({}, { strict: false });

function mapMisspellingsForPage(list = []) {
  return list.map((m, idx) => ({
    id: idx + 1,
    word: m.word || "",
    suggestions: m.suggestions || [],
    contextSnippet: m.contextSnippet || "",
    language: m.language || "English",
  }));
}

async function run() {
  try {
    const conn = await mongoose.createConnection(DB_URL, { dbName: CLIENT_DB }).asPromise();
    const QaReport = conn.model('QaReport', qaReportSchema, 'qa_reports');
    const QaSummary = conn.model('QaSummary', new Schema({}, { strict: false }), 'qa_summaries');

    const host = "omunim.com";
    const urlNorm = "https://omunim.com/jewellery-billing-software";

    const summary = await QaSummary.findOne({ domain: host }).sort({ scanDate: -1 }).lean();
    const jobId = summary?.jobId || null;
    console.log("Latest JobId:", jobId);

    if (jobId) {
      const qaCandidates = await QaReport.find({ domain: host, jobId }).lean();
      const qaDoc = qaCandidates.find(r => r.url === urlNorm) || null;
      if (qaDoc) {
        console.log("Found QA Doc in DB!");
        const misspellings = mapMisspellingsForPage(qaDoc.misspellings || []);
        console.log("Mapped Misspellings returned to frontend:", JSON.stringify(misspellings, null, 2));
      } else {
        console.log("No QA Doc found for URL:", urlNorm);
      }
    } else {
      console.log("No job ID found.");
    }

    await conn.close();
  } catch (err) {
    console.error(err);
  }
}

run();

import mongoose from 'mongoose';

export const DarkPatternSummarySchema = new mongoose.Schema({
  domain: { type: String, required: true, index: true },
  jobId: { type: String, index: true },
  scanDate: { type: Date, default: Date.now, index: -1 },
  totalPagesScanned: { type: Number, default: 0 },
  totalDarkPatternsFound: { type: Number, default: 0 },
  issuesBySeverity: {
    high: { type: Number, default: 0 },
    medium: { type: Number, default: 0 },
    low: { type: Number, default: 0 }
  },
  distributions: [
    {
      type: { type: String },
      percentage: { type: Number }
    }
  ]
}, { timestamps: true });

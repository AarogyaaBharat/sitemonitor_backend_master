import mongoose from 'mongoose';

export const DarkPatternReportSchema = new mongoose.Schema({
  domain: { type: String, required: true, index: true },
  jobId: { type: String, index: true },
  scanDate: { type: Date, default: Date.now },
  url: { type: String, required: true, index: true },
  type: { type: String, required: true },
  severity: { type: String, required: true },
  severityClass: { type: String },
  description: { type: String },
  suggestion: { type: String },
  legalRisk: { type: String },
  htmlSnippet: { type: String }
}, { timestamps: true });

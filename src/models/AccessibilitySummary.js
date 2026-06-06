import mongoose from 'mongoose';

export const AccessibilitySummarySchema = new mongoose.Schema({
  domain: { type: String, required: true, index: true },
  jobId: { type: String, index: true },
  scanDate: { type: Date, default: Date.now, index: -1 },
  totalPagesScanned: { type: Number, default: 0 },
  averageScore: { type: Number, default: 0 },
  totalPassedChecks: { type: Number, default: 0 },
  totalFailedChecks: { type: Number, default: 0 },
  totalWarnings: { type: Number, default: 0 },
  criticalIssuesCount: { type: Number, default: 0 },
  seriousIssuesCount: { type: Number, default: 0 },
  moderateIssuesCount: { type: Number, default: 0 },
  minorIssuesCount: { type: Number, default: 0 },
  pagesWithIssues: { type: Number, default: 0 },
  mostCommonIssues: [{
    id: String,
    impact: String,
    description: String,
    count: Number
  }]
}, { timestamps: true, collection: 'accessibility_summaries', strict: false });

export const AccessibilitySummary = mongoose.model('AccessibilitySummary', AccessibilitySummarySchema, 'accessibility_summaries');

import mongoose from 'mongoose';

export const AccessibilityReportSchema = new mongoose.Schema({
  domain: { type: String, required: true, index: true },
  url: { type: String, required: true, index: true },
  title: { type: String, default: '' },
  jobId: { type: String, index: true },
  scanDate: { type: Date, default: Date.now, index: -1 },
  score: { type: Number, default: 0 },
  passedCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  warningCount: { type: Number, default: 0 },
  notApplicableCount: { type: Number, default: 0 },
  issues: [{
    id: String,
    impact: { type: String, enum: ['minor', 'moderate', 'serious', 'critical'] },
    description: String,
    help: String,
    helpUrl: String,
    nodes: [{
      html: String,
      failureSummary: String,
    }]
  }],
  passes: [{
    id: String,
    description: String,
    help: String,
    helpUrl: String,
    nodes: [{
      html: String,
    }]
  }]
}, { timestamps: true, collection: 'accessibility_reports', strict: false });

AccessibilityReportSchema.index({ domain: 1, jobId: 1 });
AccessibilityReportSchema.index({ domain: 1, url: 1, jobId: 1 });

export const AccessibilityReport = mongoose.model('AccessibilityReport', AccessibilityReportSchema, 'accessibility_reports');

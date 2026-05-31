import mongoose from 'mongoose';

export const QaReportSchema = new mongoose.Schema({
  domain: { type: String, required: true, index: true },
  url: { type: String, required: true, index: true },
  title: { type: String, default: '' },
  jobId: { type: String, index: true },
  scanDate: { type: Date, default: Date.now, index: -1 },
  httpStatus: { type: Number, default: 200 },
  readabilityScore: { type: Number, default: 0 },
  readabilityLevel: { type: String, default: '' },
  issueCount: { type: Number, default: 0 },
  hasQaErrors: { type: Boolean, default: false },
  brokenLinks: [{
    href: String,
    statusCode: Number,
    type: { type: String, enum: ['internal', 'external'] },
    anchorText: String,
    contextSnippet: String,
    isFixed: { type: Boolean, default: false },
    isIgnored: { type: Boolean, default: false },
  }],
  brokenImages: [{
    src: String,
    altText: String,
    size: String,
    isFixed: { type: Boolean, default: false },
    isIgnored: { type: Boolean, default: false },
  }],
  misspellings: [{
    word: String,
    suggestions: [String],
    contextSnippet: String,
    isPotential: { type: Boolean, default: false },
  }],
  potentialMisspellings: [{
    word: String,
    suggestions: [String],
    contextSnippet: String,
    isPotential: { type: Boolean, default: true },
  }],
}, { timestamps: true, collection: 'qa_reports', strict: false });

QaReportSchema.index({ domain: 1, jobId: 1 });
QaReportSchema.index({ domain: 1, url: 1, jobId: 1 });

export const QaReport = mongoose.model('QaReport', QaReportSchema, 'qa_reports');

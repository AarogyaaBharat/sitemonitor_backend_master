import mongoose from 'mongoose';

export const DomainSummarySchema = new mongoose.Schema({
  domain: { type: String, required: true, index: true },
  finalSeoScore: { type: Number, required: true },
  rootHttpStatus: { type: Number },
  totalPages: { type: Number, default: 0 },
  averageLoadTime: { type: String },
  totalNetworkWeight: { type: String },
  totalUniqueIssues: { type: Number, default: 0 },
  issueBreakdown: {
    high: { type: Number, default: 0 },
    medium: { type: Number, default: 0 },
    low: { type: Number, default: 0 },
    highPages: { type: Number, default: 0 },
    mediumPages: { type: Number, default: 0 },
    lowPages: { type: Number, default: 0 }
  },
  topIssues: [{
    type: { type: String },
    message: String,
    count: Number,
    priority: String
  }],
  securitySummary: {
    sslValid: Boolean,
    hasCustom404: Boolean
  },
  performanceMetrics: {
    avgPerformanceScore: Number,
    avgLCP: Number,
    avgCLS: Number,
    avgAccessibilityScore: Number
  },
  complianceSummary: {
    termsFound: { type: Boolean, default: false },
    termsUrl: { type: String },
    keywordsFound: [{ type: String }],
    keywordsMissing: [{ type: String }],
    scoreImpact: { type: Number, default: 0 }
  },
  policySummary: {
    totalPolicies: { type: Number, default: 0 },
    totalHits: { type: Number, default: 0 },
    hitBreakdown: {
      high: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      low: { type: Number, default: 0 }
    }
  },
  lastScanDate: { type: Date, default: Date.now },
  jobId: { type: String }
}, { timestamps: true, collection: 'domain_summaries' });

DomainSummarySchema.index({ domain: 1, lastScanDate: -1 });

export const DomainSummary = mongoose.model('DomainSummary', DomainSummarySchema, 'domain_summaries');

import mongoose from 'mongoose';

export const PolicySummarySchema = new mongoose.Schema({
  domainId: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', index: true },
  tenantId: { type: String, index: true },
  jobId: { type: String },
  scanDate: { type: Date, default: Date.now, index: -1 },
  
  totalPolicies: { type: Number, default: 0 },
  policiesWithViolations: { type: Number, default: 0 },
  contentWithViolations: { type: Number, default: 0 },
  compliancePercent: { type: Number, default: 100 },
  
  priorities: {
    high: { type: Number, default: 0 },
    medium: { type: Number, default: 0 },
    low: { type: Number, default: 0 }
  },
  distribution: {
    unwanted: { type: Number, default: 0 },
    required: { type: Number, default: 0 },
    matches: { type: Number, default: 0 }
  }
}, { timestamps: true, collection: 'policy_summaries' });

PolicySummarySchema.index({ domainId: 1, scanDate: -1 });

export const PolicySummary = mongoose.model('PolicySummary', PolicySummarySchema, 'policy_summaries');

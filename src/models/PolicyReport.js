import mongoose from 'mongoose';

export const PolicyReportSchema = new mongoose.Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "policies",
      required: true,
    },
    domainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Domain",
    },
    domainName: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    isHit: {
      type: Boolean,
      default: false,
    },
    matchCount: {
      type: Number,
      default: 0,
    },
    totalCount: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
      enum: ["unwanted", "required", "matches"],
    },
    priority: {
      type: String,
      enum: ["High", "Medium", "Low"],
    },
    matchedRules: [
      {
        ruleId: String,
        ruleName: String,
        isMatch: Boolean,
        matchCount: Number,
        totalCount: Number,
        matchedText: [String],
      },
    ],
    evaluationResults: [
      {
        ruleId: String,
        ruleName: String,
        isMatch: Boolean,
        matchCount: Number,
        totalCount: Number,
        matchedText: [String],
      },
    ],
    scanDate: {
      type: Date,
      default: Date.now,
    },
    jobId: {
      type: String,
    },
    tenantId: {
      type: String,
    }
  },
  {
    timestamps: true,
    collection: "policy_reports",
  }
);

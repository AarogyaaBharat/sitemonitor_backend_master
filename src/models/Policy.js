import mongoose from 'mongoose';

export const PolicySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    searchScope: {
      type: String,
      default: "Everything", // Everything, Only HTML pages, etc.
    },
    category: {
      type: String,
      enum: ["unwanted", "required", "matches"],
      default: "matches",
    },
    priority: {
      type: String,
      enum: ["High", "Medium", "Low"],
      default: "Medium",
    },
    status: {
      type: String,
      enum: ["hits", "compliant"],
      default: "compliant",
    },
    compliancePercent: {
      type: Number,
      default: 100,
    },
    policyHits: {
      type: Number,
      default: 0,
    },
    foundCount: {
      type: Number,
      default: 0,
    },
    totalCount: {
      type: Number,
      default: 0,
    },
    domainIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Domain",
    }],
    isGlobal: {
      type: Boolean,
      default: false,
    },
    tenantId: {
      type: String,
      required: true,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    is_deleted: {
      type: Boolean,
      default: false,
    },
    rules: {
      type: Array,
      default: [],
    },
    ruleOperator: {
      type: String,
      enum: ["or", "and"],
      default: "or",
    },
  },
  {
    timestamps: true,
    collection: "policies",
  }
);

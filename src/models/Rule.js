import mongoose from 'mongoose';

export const RuleSchema = new mongoose.Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "policies",
      required: true,
    },
    ruleName: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      default: "text", // page-html, text, page-title, etc.
    },
    searchType: {
      type: String,
      required: false,
    },
    searchValue: {
      type: String,
      required: false,
    },
    comparison: {
      type: String,
      required: false,
    },
    characterCount: {
      type: Number,
      required: false,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    unit: {
      type: String,
      required: false,
    },
    containing: {
      type: String,
      enum: ["containing", "not-containing"],
      default: "containing",
    },
    selectors: [
      {
        type: { type: String, enum: ["Limit search", "Exclude"], default: "Limit search" },
        value: { type: String, trim: true },
      },
    ],
    tenantId: {
      type: String,
      required: true,
    },
    is_deleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: "rules",
  }
);

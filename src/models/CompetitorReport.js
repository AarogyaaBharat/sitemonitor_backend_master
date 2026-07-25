import mongoose from 'mongoose';

export const CompetitorReportSchema = new mongoose.Schema({
  domain: { type: String, required: true, index: true },
  competitorUrl: { type: String, required: true },
  scanDate: { type: Date, default: Date.now },
  seoScore: { type: Number },
  accessibilityScore: { type: Number },
  darkPatternsFound: { type: Number },
  commonKeywords: [{ type: String }],
  gapKeywords: [{ type: String }]
}, { timestamps: true });

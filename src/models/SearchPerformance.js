import mongoose from "mongoose";

export const SearchPerformanceSchema = new mongoose.Schema(
  {
    domainId: { type: mongoose.Schema.Types.ObjectId, ref: "Domain", required: true },
    tenantId: { type: String, required: true },
    scanDate: { type: Date, default: Date.now },
    summaryMetrics: { type: mongoose.Schema.Types.Mixed },
    topKeywords: { type: mongoose.Schema.Types.Mixed },
    topPages: { type: mongoose.Schema.Types.Mixed },
    devicePerformance: { type: mongoose.Schema.Types.Mixed },
    countryPerformance: { type: mongoose.Schema.Types.Mixed },
    indexStatus: { type: mongoose.Schema.Types.Mixed },
    chartData: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: true }
);

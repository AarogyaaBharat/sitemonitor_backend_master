import mongoose from 'mongoose';

export const DomainScanMasterSchema = new mongoose.Schema(
  {
    domain_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    domain_url: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'scanning', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    total_pages: { type: Number, default: 0 },
    total_images: { type: Number, default: 0 },
    total_css: { type: Number, default: 0 },
    total_js: { type: Number, default: 0 },
    total_documents: { type: Number, default: 0 },
    total_emails: { type: Number, default: 0 },
    total_headlinks: { type: Number, default: 0 },
    error_message: { type: String },
    progress_percent: { type: Number, default: 0 },
    scan_started_at: { type: Date },
    scan_completed_at: { type: Date },
    duration_ms: { type: Number },
  },
  { timestamps: true, collection: 'domain_scan_master' }
);

export const DomainScanMaster = mongoose.model('DomainScanMaster', DomainScanMasterSchema, 'domain_scan_master');

import mongoose from 'mongoose';

export const DomainPageSchema = new mongoose.Schema(
  {
    scan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainScanMaster', required: true, index: true },
    domain_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    page_url: { type: String, required: true },
    status_code: { type: Number, required: true },
    page_title: { type: String },
  },
  { timestamps: true, collection: 'domain_pages' }
);

DomainPageSchema.index({ scan_id: 1, page_url: 1 }, { unique: true });

export const DomainPage = mongoose.model('DomainPage', DomainPageSchema, 'domain_pages');

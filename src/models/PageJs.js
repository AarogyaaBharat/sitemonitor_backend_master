import mongoose from 'mongoose';

export const PageJsSchema = new mongoose.Schema(
  {
    scan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainScanMaster', required: true, index: true },
    domain_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    page_url: { type: String, required: true },
    js_url: { type: String, required: true },
    status_code: { type: Number, default: 200 },
  },
  { timestamps: true, collection: 'page_js' }
);

PageJsSchema.index({ scan_id: 1, page_url: 1, js_url: 1 }, { unique: true });

export const PageJs = mongoose.model('PageJs', PageJsSchema, 'page_js');

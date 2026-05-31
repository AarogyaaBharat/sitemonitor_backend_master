import mongoose from 'mongoose';

export const PageCssSchema = new mongoose.Schema(
  {
    scan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainScanMaster', required: true, index: true },
    domain_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    page_url: { type: String, required: true },
    css_url: { type: String, required: true },
    status_code: { type: Number, default: 200 },
  },
  { timestamps: true, collection: 'page_css' }
);

PageCssSchema.index({ scan_id: 1, page_url: 1, css_url: 1 }, { unique: true });

export const PageCss = mongoose.model('PageCss', PageCssSchema, 'page_css');

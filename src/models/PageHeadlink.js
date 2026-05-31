import mongoose from 'mongoose';

export const PageHeadlinkSchema = new mongoose.Schema(
  {
    scan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainScanMaster', required: true, index: true },
    domain_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    page_url: { type: String, required: true },
    rel_type: { type: String, required: true },
    href: { type: String, required: true },
  },
  { timestamps: true, collection: 'page_headlinks' }
);

PageHeadlinkSchema.index({ scan_id: 1, page_url: 1, rel_type: 1, href: 1 }, { unique: true });

export const PageHeadlink = mongoose.model('PageHeadlink', PageHeadlinkSchema, 'page_headlinks');

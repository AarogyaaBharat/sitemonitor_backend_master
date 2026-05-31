import mongoose from 'mongoose';

export const PageLinkSchema = new mongoose.Schema(
  {
    scan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainScanMaster', required: true, index: true },
    domain_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    page_url: { type: String, required: true },
    link_url: { type: String, required: true },
    link_type: { type: String, enum: ['internal', 'external'], required: true },
    status_code: { type: Number, default: 200 },
    anchor_text: { type: String, default: '' },
  },
  { timestamps: true, collection: 'page_links' }
);

export const PageLink = mongoose.model('PageLink', PageLinkSchema, 'page_links');

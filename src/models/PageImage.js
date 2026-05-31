import mongoose from 'mongoose';

export const PageImageSchema = new mongoose.Schema(
  {
    scan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainScanMaster', required: true, index: true },
    domain_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    page_url: { type: String, required: true },
    image_url: { type: String, required: true },
    alt_text: { type: String, default: '' },
    image_type: { type: String, default: '' },
    image_size: { type: String, default: 'Unknown' },
    status_code: { type: Number, default: 200 },
  },
  { timestamps: true, collection: 'page_images' }
);

PageImageSchema.index({ scan_id: 1, page_url: 1, image_url: 1 }, { unique: true });

export const PageImage = mongoose.model('PageImage', PageImageSchema, 'page_images');

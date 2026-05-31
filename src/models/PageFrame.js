import mongoose from 'mongoose';

export const PageFrameSchema = new mongoose.Schema(
  {
    scan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainScanMaster', required: true, index: true },
    domain_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    page_url: { type: String, required: true },
    frame_src: { type: String, default: '' },
  },
  { timestamps: true, collection: 'page_frames' }
);

PageFrameSchema.index({ scan_id: 1, page_url: 1, frame_src: 1 }, { unique: true });

export const PageFrame = mongoose.model('PageFrame', PageFrameSchema, 'page_frames');

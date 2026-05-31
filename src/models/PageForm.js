import mongoose from 'mongoose';

export const PageFormSchema = new mongoose.Schema(
  {
    scan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainScanMaster', required: true, index: true },
    domain_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    page_url: { type: String, required: true },
    form_action: { type: String, default: '' },
    form_method: { type: String, default: 'GET' },
    input_count: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'page_forms' }
);

PageFormSchema.index({ scan_id: 1, page_url: 1, form_action: 1, form_method: 1 }, { unique: true });

export const PageForm = mongoose.model('PageForm', PageFormSchema, 'page_forms');

import mongoose from 'mongoose';

export const PageDocumentSchema = new mongoose.Schema(
  {
    scan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DomainScanMaster', required: true, index: true },
    domain_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', required: true, index: true },
    page_url: { type: String, required: true },
    document_url: { type: String, required: true },
    document_type: { type: String, required: true },
  },
  { timestamps: true, collection: 'page_documents' }
);

PageDocumentSchema.index({ scan_id: 1, page_url: 1, document_url: 1 }, { unique: true });

export const PageDocument = mongoose.model('PageDocument', PageDocumentSchema, 'page_documents');

import mongoose from 'mongoose';

export const DomainSchema = new mongoose.Schema({
  dm_id: { type: Number, index: true },
  dm_url: { type: String, required: true },
  dm_title: { type: String },
  dm_status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  dm_seo_status: {
    type: String,
    enum: ['pending', 'scanning', 'completed', 'failed'],
    default: 'pending'
  },
  dm_qa_status: {
    type: String,
    enum: ['pending', 'scanning', 'completed', 'failed'],
    default: 'pending'
  },
  dm_qa_last_scan_at: { type: Date },
  dm_accessibility_status: {
    type: String,
    enum: ['pending', 'scanning', 'completed', 'failed'],
    default: 'pending'
  },
  dm_accessibility_last_scan_at: { type: Date },
  dm_policy_status: {
    type: String,
    enum: ['pending', 'scanning', 'completed', 'failed'],
    default: 'pending'
  },
  dm_policy_last_scan_at: { type: Date },
  dm_ignored_spellings: [{ type: String }],
  dm_max_scanned_pages: { type: Number, default: 500 },
  dm_scan_subdomains: { type: Boolean, default: true },
  dm_render_pages_execute_js: { type: Boolean, default: false },
  dm_store_all_resources: { type: Boolean, default: true },
  dm_scan_frequency: { type: Number, default: 1 },
  dm_frequency_type: { type: String, enum: ['day', 'week', 'month', 'quarter'], default: 'day' },
  dm_scan_time: { type: String, default: '00:00' },
  dm_next_scan_at: { type: Date, index: true },
  dm_is_deleted: { type: Boolean, default: false },
  dm_is_archived: { type: Boolean, default: false, index: true },
  dm_last_scan_at: { type: Date },
  dm_updated_at: { type: Date, default: Date.now },
}, { timestamps: false, collection: 'domains' });

export const Domain = mongoose.model('Domain', DomainSchema, 'domains');


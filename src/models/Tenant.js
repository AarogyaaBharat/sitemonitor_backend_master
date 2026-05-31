import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema({
    tent_id: { type: Number, index: true },
    tent_name: { type: String, required: true, unique: true, lowercase: true },
    tent_domain: { type: String, required: true, default: "" },
    tent_status: { type: String, enum: ["active", "inactive", "suspended"], default: "active" },
    tent_is_deleted: { type: Boolean, default: false },
}, { collection: "tenants", timestamps: { createdAt: 'tent_created_at', updatedAt: 'tent_updated_at' } });

export const TenantSchema = tenantSchema;
// We don't export the model here yet because we need the connection from the orchestrator

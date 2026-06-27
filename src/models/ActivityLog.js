import mongoose from 'mongoose';

export const ActivityLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  userName: {
    type: String,
    required: false,
  },
  action: {
    type: String,
    required: true,
  },
  details: {
    type: String,
    required: true,
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
}, {
  collection: "activity_logs",
  timestamps: { createdAt: "createdAt", updatedAt: false },
});

export const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema, 'activity_logs');

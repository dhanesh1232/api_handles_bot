import mongoose, { type Document, type Model, type Schema } from "mongoose";

export interface ILeadActivity extends Document {
  clientCode: string;
  leadId: mongoose.Types.ObjectId;
  type: string;
  description: string;
  metadata?: any;
  createdAt: Date;
}

const activitySchema: Schema<ILeadActivity> = new mongoose.Schema({
  clientCode: {
    type: String,
    required: true,
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lead",
    required: true,
  },
  type: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  metadata: mongoose.Schema.Types.Mixed,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const LeadActivity: Model<ILeadActivity> =
  mongoose.models.LeadActivity ||
  mongoose.model<ILeadActivity>("LeadActivity", activitySchema);

export default LeadActivity;

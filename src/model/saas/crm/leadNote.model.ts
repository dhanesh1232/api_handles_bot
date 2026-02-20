import mongoose, { type Document, type Model, type Schema } from "mongoose";

export interface ILeadNote extends Document {
  leadId: mongoose.Types.ObjectId;
  content: string;
  createdBy: string;
  createdAt: Date;
}

const noteSchema: Schema<ILeadNote> = new mongoose.Schema({
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lead",
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  createdBy: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const LeadNote: Model<ILeadNote> =
  mongoose.models.LeadNote || mongoose.model<ILeadNote>("LeadNote", noteSchema);

export default LeadNote;

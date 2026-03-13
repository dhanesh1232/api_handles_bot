import { Schema } from "mongoose";

const segmentSchema = new Schema<ISegment>(
  {
    clientCode: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    color: { type: String, default: "#3b82f6" },
    rules: [
      {
        field: { type: String, required: true },
        operator: { type: String, required: true },
        value: { type: Schema.Types.Mixed },
      },
    ],
    logic: { type: String, enum: ["AND", "OR"], default: "AND" },
    memberCount: { type: Number, default: 0 },
    lastCalculatedAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

segmentSchema.index({ clientCode: 1, isActive: 1 });

export { segmentSchema as SegmentSchema };
export default segmentSchema;

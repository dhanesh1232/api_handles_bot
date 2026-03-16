import { Schema } from "mongoose";

export const CustomEventDefSchema = new Schema<ICustomEventDef>(
  {
    clientCode: { type: String, required: true, index: true },
    name: { type: String, required: true },
    displayName: { type: String, required: true },
    description: { type: String },
    payloadSchema: { type: Schema.Types.Mixed },
    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false },
    mapsTo: { type: String },
    pipelineId: { type: String },
    stageId: { type: String },
    defaultSource: { type: String },
  },
  { timestamps: true },
);

CustomEventDefSchema.index({ clientCode: 1, name: 1 }, { unique: true });

export default CustomEventDefSchema;

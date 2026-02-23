import mongoose from "mongoose";

const CorsOriginSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

export const CorsOrigin =
  mongoose.models.CorsOrigin || mongoose.model("CorsOrigin", CorsOriginSchema);

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
    allowedHeaders: {
      type: [String],
      default: [
        "Content-Type",
        "Authorization",
        "x-api-key",
        "x-client-code",
        "x-core-api-key",
        "x-socket-id",
        "x-socket-token",
        "x-socket-client-code",
        "x-ecodrix-signature",
      ],
    },
    allowedMethods: {
      type: [String],
      default: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    },
  },
  { timestamps: true },
);

export const CorsOrigin =
  mongoose.models.CorsOrigin || mongoose.model("CorsOrigin", CorsOriginSchema);

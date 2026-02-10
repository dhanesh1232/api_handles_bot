import mongoose from "mongoose";
import { encrypt, decrypt } from "../../lib/crypto.js";

const ClientDataSourceSchema = new mongoose.Schema(
  {
    clientCode: { type: String, required: true, unique: true, uppercase: true },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },

    dbType: {
      type: String,
      enum: ["mongodb", "mysql", "postgresql"],
      default: "mongodb",
    },
    dbUri: { type: String, required: true }, // Encrypted

    permissions: {
      canRead: { type: Boolean, default: true },
      canWrite: { type: Boolean, default: false },
      allowedCollections: [String],
    },

    isActive: { type: Boolean, default: false },
    lastSyncAt: Date,
  },
  { timestamps: true },
);

// Regex for 32-byte hex IV + : + hex content
const ENCRYPTED_PATTERN = /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;

// Middleware to encrypt DB URI
ClientDataSourceSchema.pre("save", function (next) {
  // Encrypt if modified AND (not already encrypted based on strict regex)
  if (
    this.isModified("dbUri") &&
    this.dbUri &&
    !ENCRYPTED_PATTERN.test(this.dbUri)
  ) {
    this.dbUri = encrypt(this.dbUri);
  }
  next();
});

// Helper for decryption
ClientDataSourceSchema.methods.getUri = function () {
  if (!this.dbUri) return null;

  // Only attempt decryption if it matches our custom encryption format
  if (ENCRYPTED_PATTERN.test(this.dbUri)) {
    try {
      // console.log("Decryption:", this.dbUri);
      return decrypt(this.dbUri);
    } catch (e) {
      console.warn(
        `⚠️ Decryption failed for client ${this.clientCode}, returning raw value.`,
      );
      return this.dbUri;
    }
  }

  // Otherwise return raw (legacy or plain text)
  return this.dbUri;
};

export const ClientDataSource =
  mongoose.models.ClientDataSource ||
  mongoose.model("ClientDataSource", ClientDataSourceSchema);

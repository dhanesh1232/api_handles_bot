import mongoose, { type Document, type Model } from "mongoose";
import { decrypt, encrypt } from "../../lib/crypto.ts";

export interface IClientDataSource extends Document {
  clientCode: string;
  clientId: mongoose.Types.ObjectId;
  dbType: "mongodb" | "mysql" | "postgresql";
  dbUri: string;
  permissions?: {
    canRead?: boolean;
    canWrite?: boolean;
    allowedCollections?: string[];
  };
  isActive?: boolean;
  lastSyncAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;

  // Methods
  getUri(): string | null;
}

const ClientDataSourceSchema = new mongoose.Schema<IClientDataSource>(
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
ClientDataSourceSchema.pre("save", function () {
  // Encrypt if modified AND (not already encrypted based on strict regex)
  if (
    this.isModified("dbUri") &&
    this.dbUri &&
    !ENCRYPTED_PATTERN.test(this.dbUri)
  ) {
    this.dbUri = encrypt(this.dbUri) as string;
  }
});

// Helper for decryption
ClientDataSourceSchema.methods.getUri = function (): string | null {
  if (!this.dbUri) return null;

  // Only attempt decryption if it matches our custom encryption format
  if (ENCRYPTED_PATTERN.test(this.dbUri)) {
    try {
      // console.log("Decryption:", this.dbUri);
      return decrypt(this.dbUri) as string;
    } catch (_e) {
      console.warn(
        `⚠️ Decryption failed for client ${this.clientCode}, returning raw value ${_e}.`,
      );
      return this.dbUri;
    }
  }

  // Otherwise return raw (legacy or plain text)
  return this.dbUri;
};

export const ClientDataSource: Model<IClientDataSource> =
  mongoose.models.ClientDataSource ||
  mongoose.model<IClientDataSource>("ClientDataSource", ClientDataSourceSchema);

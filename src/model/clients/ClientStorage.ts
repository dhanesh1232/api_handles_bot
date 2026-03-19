import mongoose, { type Document, type Model, Schema } from "mongoose";

export interface IFolder {
  name: string;
  prefix: string;
  isSystem: boolean;
  dateShard: boolean;
  fileCount: number;
  sizeBytes: number;
  createdAt: Date;
}

export interface IClientStorage extends Document {
  clientCode: string;
  bucket: string;
  rootPrefix: string;
  quotaBytes: number;
  usedBytes: number;
  lastSyncedAt?: Date;
  isProvisioned: boolean;
  provisionedAt?: Date;
  isSuspended: boolean;
  folders: IFolder[];
  usagePercent: number;
  isOverQuota(): boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FolderSchema = new Schema<IFolder>(
  {
    name: { type: String, required: true }, // 'whatsapp-media'
    prefix: { type: String, required: true }, // 'tenants/{clientId}/whatsapp-media/'
    isSystem: { type: Boolean, default: false }, // system folders cannot be deleted by client
    dateShard: { type: Boolean, default: false }, // whether this folder uses year/month sharding
    fileCount: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ClientStorageSchema = new Schema<IClientStorage>(
  {
    clientCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    bucket: {
      type: String,
      default: process.env.R2_BUCKET_NAME,
    },
    rootPrefix: { type: String, required: true }, // always 'tenants/${clientId}'
    quotaBytes: { type: Number, required: true }, // assigned from plan at provisioning time
    usedBytes: { type: Number, default: 0 }, // updated by nightly sync cron
    lastSyncedAt: Date, // last time cron ran syncUsage()
    isProvisioned: { type: Boolean, default: false },
    provisionedAt: Date,
    isSuspended: { type: Boolean, default: false }, // true when quota >= 100% or plan lapsed
    folders: { type: [FolderSchema], default: [] },
  },
  { timestamps: true },
);

// Virtual usagePercent
ClientStorageSchema.virtual("usagePercent").get(function (
  this: IClientStorage,
) {
  return this.quotaBytes > 0
    ? Math.round((this.usedBytes / this.quotaBytes) * 100)
    : 0;
});

// Instance method isOverQuota
ClientStorageSchema.methods.isOverQuota = function (this: IClientStorage) {
  return this.usedBytes >= this.quotaBytes;
};

// Ensure virtuals are included in toJSON and toObject
ClientStorageSchema.set("toJSON", { virtuals: true });
ClientStorageSchema.set("toObject", { virtuals: true });

export const ClientStorage: Model<IClientStorage> =
  mongoose.models.ClientStorage ||
  mongoose.model<IClientStorage>("ClientStorage", ClientStorageSchema);

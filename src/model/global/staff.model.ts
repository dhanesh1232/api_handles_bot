import mongoose, { type Document, type Model } from "mongoose";

export interface IStaff extends Document {
  email: string;
  name: string;
  agencyCode: string; // The agency this staff belongs to
  role: "admin" | "manager" | "analyst";
  assignedClients: string[]; // List of clientCodes this staff can manage
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const StaffSchema = new mongoose.Schema<IStaff>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    agencyCode: { type: String, required: true, uppercase: true, index: true },
    role: {
      type: String,
      enum: ["admin", "manager", "analyst"],
      default: "manager",
    },
    assignedClients: [{ type: String, uppercase: true }], // Empty means "All" if admin
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

// Index for fast lookup of clients managed by a specific staff
StaffSchema.index({ agencyCode: 1, email: 1 });

export const Staff: Model<IStaff> =
  mongoose.models.Staff || mongoose.model<IStaff>("Staff", StaffSchema);

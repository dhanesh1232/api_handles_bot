import mongoose from "mongoose";

const ClientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    clientCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    apiKey: { type: String, unique: true, sparse: true }, // Key for external API access (e.g. Inbox)
    status: {
      type: String,
      enum: ["active", "suspended", "pending", "terminated"],
      default: "pending",
    },
    business: {
      industry: String,
      website: String,
      email: String,
      phone: String,
    },
    plan: {
      name: { type: String, default: "Free" },
      billingCycle: {
        type: String,
        enum: ["monthly", "quarterly", "semi-annually", "yearly", "one-time"],
        default: "one-time",
      },
      startDate: Date,
      endDate: Date,
    },
    tags: [String],
    whatsapp: {
      enabled: { type: Boolean, default: false },
      phoneNumber: String,
      status: {
        type: String,
        enum: ["connected", "disconnected"],
        default: "disconnected",
      },
      connectedAt: Date,
      disconnectedAt: Date,
    },
  },
  { timestamps: true },
);

export const Client =
  mongoose.models.Client || mongoose.model("Client", ClientSchema);

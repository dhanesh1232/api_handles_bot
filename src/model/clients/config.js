import mongoose from "mongoose";

const ClientServiceConfigSchema = new mongoose.Schema(
  {
    clientCode: { type: String, required: true, unique: true, uppercase: true },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    services: {
      whatsapp: {
        enabled: { type: Boolean, default: false },
        features: [String],
      },
      email: {
        enabled: { type: Boolean, default: false },
        limitPerMonth: { type: Number, default: 1000 },
      },
      automation: {
        enabled: { type: Boolean, default: false },
        maxWorkflows: { type: Number, default: 5 },
      },
      crm: {
        enabled: { type: Boolean, default: false },
      },
    },
    cron: {
      followups: {
        enabled: { type: Boolean, default: false },
        schedule: { type: String, default: "0 9 * * *" }, // daily at 9am
      },
      reminders: {
        enabled: { type: Boolean, default: false },
        schedule: { type: String, default: "*/30 * * * *" }, // every 30 mins
        timingRules: [
          {
            minutesPrior: { type: Number, default: 60 },
            tag: { type: String },
            channel: {
              type: String,
              enum: ["whatsapp", "email", "both"],
              default: "whatsapp",
            },
            whatsappTemplateName: { type: String },
            emailTemplateId: { type: String }, // Reference to template in client's own DB
          },
        ],
      },
      sync: {
        enabled: { type: Boolean, default: false },
        schedule: { type: String, default: "0 * * * *" }, // hourly
      },
    },
    workers: {
      maxParallelTasks: { type: Number, default: 2 },
      priority: {
        type: String,
        enum: ["low", "normal", "high"],
        default: "normal",
      },
    },
  },
  { timestamps: true },
);

export const ClientServiceConfig =
  mongoose.models.ClientServiceConfig ||
  mongoose.model("ClientServiceConfig", ClientServiceConfigSchema);

import mongoose, { type Document, type Model } from "mongoose";

export interface IClientServiceConfig extends Document {
  clientCode: string;
  clientId: mongoose.Types.ObjectId;
  services?: {
    whatsapp?: {
      enabled?: boolean;
      features?: string[];
    };
    email?: {
      enabled?: boolean;
      limitPerMonth?: number;
    };
    automation?: {
      enabled?: boolean;
      maxWorkflows?: number;
    };
    crm?: {
      enabled?: boolean;
    };
  };
  cron?: {
    followups?: {
      enabled?: boolean;
      schedule?: string;
    };
    reminders?: {
      enabled?: boolean;
      schedule?: string;
      timingRules?: Array<{
        minutesPrior?: number;
        tag?: string;
        channel?: "whatsapp" | "email" | "both";
        whatsappTemplateName?: string;
        emailTemplateId?: string;
      }>;
    };
    sync?: {
      enabled?: boolean;
      schedule?: string;
    };
  };
  workers?: {
    maxParallelTasks?: number;
    priority?: "low" | "normal" | "high";
  };
  createdAt?: Date;
  updatedAt?: Date;
}

const ClientServiceConfigSchema = new mongoose.Schema<IClientServiceConfig>(
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

export const ClientServiceConfig: Model<IClientServiceConfig> =
  mongoose.models.ClientServiceConfig ||
  mongoose.model<IClientServiceConfig>(
    "ClientServiceConfig",
    ClientServiceConfigSchema,
  );

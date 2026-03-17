import mongoose, { type Document, type Model } from "mongoose";
import { decrypt, encrypt } from "../../lib/crypto.ts";

export interface IClientSecrets extends Document {
  clientCode: string;
  clientId: mongoose.Types.ObjectId;

  // Each key is stored as an encrypted string
  whatsappToken?: string;
  whatsappInstanceId?: string; // Legacy or alternate
  whatsappBusinessId?: string;
  whatsappPhoneNumberId?: string;
  whatsappWebhookToken?: string;

  // Google Meet Credentials
  googleClientId?: string;
  googleClientSecret?: string;
  googleRefreshToken?: string;

  // Cloudflare R2
  r2AccessKeyId?: string;
  r2SecretKey?: string;
  r2BucketName?: string;
  r2Endpoint?: string;
  r2PublicDomain?: string;

  // ── Email Configuration ──────────────────────────────────────────────────
  /** Which provider is active: 'ses' | 'smtp' | 'gmail_smtp' | 'zoho_smtp' | 'outlook_smtp' */
  emailProvider?: string;
  /** Sender display name used by all providers */
  emailFromName?: string;

  // AWS SES
  sesFromEmail?: string;
  sesReplyTo?: string;
  sesDomain?: string;
  sesVerified?: boolean;
  sesVerifiedAt?: Date;
  sesDnsRecords?: Array<{
    type: string;
    name: string;
    value: string;
    description?: string;
  }>;

  // Custom / Preset SMTP
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpFromEmail?: string;
  smtpFromName?: string;
  smtpSecure?: boolean;

  // Email health stats (not encrypted)
  emailStats?: {
    totalSent: number;
    totalFailed: number;
    lastSentAt?: Date;
    lastFailedAt?: Date;
    lastFailureReason?: string;
    consecutiveFailures: number;
    failureRate: number; // 0–100
    status: "healthy" | "degraded" | "failing" | "unconfigured";
  };

  // Advanced Marketing Config
  emailFooter?: string;
  emailCc?: string;
  emailBcc?: string;
  dailyLimit?: number;
  currentDayCount?: number;
  lastCountReset?: Date;

  automationWebhookSecret?: string;

  /** Free-form key-value store for any extra secrets */
  customSecrets?: Map<string, string>;

  createdAt?: Date;
  updatedAt?: Date;

  getDecrypted(field: string): string | null | undefined;
}

const ClientSecretsSchema = new mongoose.Schema<IClientSecrets>(
  {
    clientCode: { type: String, required: true, unique: true, uppercase: true },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },

    // Each key is stored as an encrypted string
    whatsappToken: { type: String, default: null },
    whatsappInstanceId: { type: String, default: null }, // Legacy or alternate
    whatsappBusinessId: { type: String, default: null },
    whatsappPhoneNumberId: { type: String, default: null },
    whatsappWebhookToken: { type: String, default: null },

    // Google Meet Credentials
    googleClientId: { type: String, default: null },
    googleClientSecret: { type: String, default: null },
    googleRefreshToken: { type: String, default: null },

    // Cloudflare R2
    r2AccessKeyId: { type: String, default: null },
    r2SecretKey: { type: String, default: null },
    r2BucketName: { type: String, default: null },
    r2Endpoint: { type: String, default: null },
    r2PublicDomain: { type: String, default: null },

    emailProvider: {
      type: String,
      default: "ses",
      enum: ["ses", "smtp", "gmail_smtp", "zoho_smtp", "outlook_smtp"],
    },
    emailFromName: { type: String, default: null },

    // AWS SES
    sesFromEmail: { type: String, default: null },
    sesReplyTo: { type: String, default: null },
    sesDomain: { type: String, default: null },
    sesVerified: { type: Boolean, default: false },
    sesVerifiedAt: { type: Date, default: null },
    sesDnsRecords: [
      {
        type: { type: String },
        name: { type: String },
        value: { type: String },
        description: { type: String, default: null },
        _id: false,
      },
    ],

    // Health tracking (not encrypted — just stats)
    emailStats: {
      totalSent: { type: Number, default: 0 },
      totalFailed: { type: Number, default: 0 },
      lastSentAt: { type: Date, default: null },
      lastFailedAt: { type: Date, default: null },
      lastFailureReason: { type: String, default: null },
      consecutiveFailures: { type: Number, default: 0 },
      failureRate: { type: Number, default: 0 },
      status: {
        type: String,
        default: "unconfigured",
        enum: ["healthy", "degraded", "failing", "unconfigured"],
      },
    },

    // Advanced Marketing Config
    emailFooter: { type: String, default: null },
    emailCc: { type: String, default: null },
    emailBcc: { type: String, default: null },
    dailyLimit: { type: Number, default: 0 }, // 0 = unlimited
    currentDayCount: { type: Number, default: 0 },
    lastCountReset: { type: Date, default: null },

    automationWebhookSecret: { type: String, default: null },

    // Custom / Preset SMTP
    smtpHost: { type: String, default: null },
    smtpPort: { type: String, default: null },
    smtpUser: { type: String, default: null },
    smtpPass: { type: String, default: null },
    smtpFromEmail: { type: String, default: null },
    smtpFromName: { type: String, default: null },
    smtpSecure: { type: Boolean, default: true },

    // General purpose secrets map
    customSecrets: {
      type: Map,
      of: String,
      default: {},
    },
  },
  { timestamps: true },
);

// Regex for 32-byte hex IV + : + hexContent (captured from other file)
const ENCRYPTED_PATTERN = /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;

// Middleware to encrypt before saving
ClientSecretsSchema.pre("save", function () {
  const secretFields = [
    "whatsappToken",
    "whatsappInstanceId",
    "whatsappBusinessId",
    "whatsappPhoneNumberId",
    "whatsappWebhookToken",
    "googleClientId",
    "googleClientSecret",
    "googleRefreshToken",
    "r2AccessKeyId",
    "r2SecretKey",
    "r2Endpoint",
    // Email
    "emailFromName",
    "automationWebhookSecret",
    "sesFromEmail",
    "sesReplyTo",
    "smtpHost",
    "smtpUser",
    "smtpPass",
    "smtpFromEmail",
    "smtpFromName",
    "emailFooter",
    "emailCc",
    "emailBcc",
  ] as Array<keyof IClientSecrets>;

  secretFields.forEach((field) => {
    // Only encrypt if it's modified, exists, AND does not strictly match the encrypted format
    if (
      this.isModified(field as string) &&
      this[field] &&
      typeof this[field] === "string" &&
      !ENCRYPTED_PATTERN.test(this[field] as string)
    ) {
      (this as any)[field] = encrypt(this[field] as string) as string;
    }
  });

  // Handle customSecrets map
  if (this.isModified("customSecrets") && this.customSecrets) {
    for (const [key, value] of Array.from(this.customSecrets.entries())) {
      if (value && !ENCRYPTED_PATTERN.test(value)) {
        this.customSecrets.set(key, encrypt(value) as string);
      }
    }
  }
});

// Helper method to get decrypted secrets
ClientSecretsSchema.methods.getDecrypted = function (
  field: string,
): string | null | undefined {
  let value: string | undefined | null;
  if (field.startsWith("customSecrets.")) {
    const key = field.split(".")[1];
    value = this.customSecrets?.get(key);
  } else {
    value = (this as any)[field];
  }

  if (!value) return null;

  // Only decrypt if it contains the ":" separator used by our encryption helper
  if (typeof value === "string" && ENCRYPTED_PATTERN.test(value)) {
    try {
      return decrypt(value) as string;
    } catch (e: any) {
      console.error(`❌ Decryption failed for field ${field}:`, e.message);
      return value; // Return raw value as fallback
    }
  }

  return value;
};

export const ClientSecrets: Model<IClientSecrets> =
  mongoose.models.ClientSecrets ||
  mongoose.model<IClientSecrets>("ClientSecrets", ClientSecretsSchema);

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

  emailApiKey?: string;
  emailProvider?: string;

  automationWebhookSecret?: string;

  // SMTP Configuration
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  smtpSecure?: boolean;

  // General purpose secrets map
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

    emailApiKey: { type: String, default: null },
    emailProvider: { type: String, default: "nodemailer" },

    automationWebhookSecret: { type: String, default: null },

    // SMTP Configuration
    smtpHost: { type: String, default: null },
    smtpPort: { type: String, default: null },
    smtpUser: { type: String, default: null },
    smtpPass: { type: String, default: null },
    smtpFrom: { type: String, default: null },
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
    "emailApiKey",
    "automationWebhookSecret",
    "smtpHost",
    "smtpUser",
    "smtpPass",
    "smtpFrom",
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

import mongoose from "mongoose";
import { encrypt, decrypt } from "../../lib/crypto.js";

const ClientSecretsSchema = new mongoose.Schema(
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

    // Cloudflare R2
    r2AccessKeyId: { type: String, default: null },
    r2SecretKey: { type: String, default: null },
    r2BucketName: { type: String, default: null },
    r2Endpoint: { type: String, default: null },
    r2PublicDomain: { type: String, default: null },

    emailApiKey: { type: String, default: null },
    emailProvider: { type: String, default: "sendgrid" },

    automationWebhookSecret: { type: String, default: null },

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
ClientSecretsSchema.pre("save", function (next) {
  const secretFields = [
    "whatsappToken",
    "whatsappInstanceId",
    "whatsappBusinessId",
    "whatsappPhoneNumberId",
    "whatsappWebhookToken",
    "r2AccessKeyId",
    "r2SecretKey",
    "r2Endpoint",
    "emailApiKey",
    "automationWebhookSecret",
  ];

  secretFields.forEach((field) => {
    // Only encrypt if it's modified, exists, AND does not strictly match the encrypted format
    if (
      this.isModified(field) &&
      this[field] &&
      !ENCRYPTED_PATTERN.test(this[field])
    ) {
      this[field] = encrypt(this[field]);
    }
  });

  // Handle customSecrets map
  if (this.isModified("customSecrets")) {
    for (let [key, value] of this.customSecrets) {
      if (value && !ENCRYPTED_PATTERN.test(value)) {
        this.customSecrets.set(key, encrypt(value));
      }
    }
  }

  next();
});

// Helper method to get decrypted secrets
ClientSecretsSchema.methods.getDecrypted = function (field) {
  let value;
  if (field.startsWith("customSecrets.")) {
    const key = field.split(".")[1];
    value = this.customSecrets.get(key);
  } else {
    value = this[field];
  }

  if (!value) return null;

  // Only decrypt if it contains the ":" separator used by our encryption helper
  if (typeof value === "string" && ENCRYPTED_PATTERN.test(value)) {
    try {
      return decrypt(value);
    } catch (e) {
      console.error(`❌ Decryption failed for field ${field}:`, e.message);
      return value; // Return raw value as fallback
    }
  }

  return value;
};

export const ClientSecrets =
  mongoose.models.ClientSecrets ||
  mongoose.model("ClientSecrets", ClientSecretsSchema);

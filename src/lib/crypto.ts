import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  "v6yB8?pX!z%C*F-JaNdRgUkXp2s5v8y/B?E(G+KbPeShVmYq3t6w9z$C&F)J@NcQ"; // 32 bytes fallback
const IV_LENGTH = 16;

/**
 * Encrypts a string using AES-256-CBC
 * @param text - The text to encrypt
 * @returns The encrypted string in format iv:encrypted
 */
export function encrypt(text: string | null): string | null {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY.slice(0, 32)),
    iv,
  );
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

/**
 * Decrypts a string using AES-256-CBC
 * @param text - The text to decrypt in format iv:encrypted
 * @returns The decrypted string
 */
export function decrypt(text: string | null): string | null {
  if (!text) return null;
  const textParts = text.split(":");
  const ivHex = textParts.shift();
  if (!ivHex) return null;

  const iv = Buffer.from(ivHex, "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY.slice(0, 32)),
    iv,
  );
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

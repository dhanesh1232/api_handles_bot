import crypto from "node:crypto";

const ALGORITHM = "aes-256-cbc";
const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  "v6yB8?pX!z%C*F-JaNdRgUkXp2s5v8y/B?E(G+KbPeShVmYq3t6w9z$C&F)J@NcQ"; // 32 bytes fallback
const IV_LENGTH = 16;

class CryptoClient {
  private readonly algorithm = ALGORITHM;
  private readonly key: Buffer;

  constructor(key: string = ENCRYPTION_KEY) {
    this.key = Buffer.from(key.slice(0, 32));
  }

  /**
   * Encrypts a sensitive string using AES-256-CBC with a unique Initialization Vector (IV).
   *
   * @param text - The plaintext to protect.
   * @returns A colon-separated string `iv:encryptedContent` or `null` if the input was empty.
   *
   * **DETAILED EXECUTION:**
   * 1. **Entropy Injection**: Generates a cryptographically strong 16-byte random IV.
   * 2. **Cipher Initialization**: Spawns an AES-256-CBC cipher using the system-wide `ENCRYPTION_KEY`.
   * 3. **Transformation**: Updates the cipher with the input text and flushes the final block.
   * 4. **Packaging**: Concatenates the IV and encrypted buffer as hex strings for storage.
   */
  encrypt(text: string | null): string | null {
    if (!text) return null;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
  }

  /**
   * Decrypts a protected string back to its original plaintext.
   *
   * @param text - The `iv:encryptedContent` hex string.
   *
   * **DETAILED EXECUTION:**
   * 1. **Structural Analysis**: Splits the string at the colon to extract the IV and the cipher text.
   * 2. **Decipher Initialization**: Reconstructs the original decryption state using the extracted IV and the global key.
   * 3. **Inverse Transformation**: Decodes the hex buffers and computes the original UTF-8 string.
   *
   * **EDGE CASE MANAGEMENT:**
   * - Integrity Check: Returning `null` if the string format is invalid or if the key has changed, preventing system crashes on stale secrets.
   */
  decrypt(text: string | null): string | null {
    if (!text) return null;
    const textParts = text.split(":");
    const ivHex = textParts.shift();
    if (!ivHex) return null;

    try {
      const iv = Buffer.from(ivHex, "hex");
      const encryptedText = Buffer.from(textParts.join(":"), "hex");
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      let decrypted = decipher.update(encryptedText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted.toString();
    } catch (_err) {
      return null;
    }
  }
}

/** Singleton instance */
export const cryptoClient = new CryptoClient();

/** Backward compatible functional wrappers */
export const encrypt = (text: string | null) => cryptoClient.encrypt(text);
export const decrypt = (text: string | null) => cryptoClient.decrypt(text);

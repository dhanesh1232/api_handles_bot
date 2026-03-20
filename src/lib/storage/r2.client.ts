/**
 * lib/storage/r2.client.ts
 *
 * StorageClient — A class-based S3-compatible client for Cloudflare R2.
 * Encapsulates AWS SDK v3 operations for Put, List, Delete, and Head.
 *
 * Each client instance is bound to a specific set of bucket credentials.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "@lib/logger";

export class StorageClient {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicDomain?: string;
  private readonly endpoint: string;
  private readonly log = logger.child({ module: "StorageClient" });

  constructor(options: StorageOptions) {
    this.bucket = options.bucketName;
    this.publicDomain = options.publicDomain;

    // Sanitize endpoint: remove trailing slashes and the bucket name if it was accidentally appended
    let sanitizedEndpoint = options.endpoint.replace(/\/+$/, "");
    if (sanitizedEndpoint.endsWith(`/${this.bucket}`)) {
      sanitizedEndpoint = sanitizedEndpoint.substring(
        0,
        sanitizedEndpoint.length - (this.bucket.length + 1),
      );
    }
    this.endpoint = sanitizedEndpoint;

    this.client = new S3Client({
      region: "auto",
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  /**
   * Factory to create a client from environment variables (Universal).
   */
  static fromUniversal(): StorageClient {
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const endpoint = process.env.R2_ENDPOINT;
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicDomain = process.env.R2_PUBLIC_URL || undefined;

    if (!accessKeyId || !secretAccessKey || !endpoint || !bucketName) {
      throw new Error(
        "R2 Universal Storage configuration missing in environment variables",
      );
    }

    return new StorageClient({
      accessKeyId,
      secretAccessKey,
      endpoint,
      bucketName,
      publicDomain,
    });
  }

  /**
   * Upload a buffer to a specific key.
   */
  async upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<UploadResult> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );

      return {
        url: await this.getUrl(key),
        key,
        bucket: this.bucket,
        size: body.length,
        mimeType: contentType,
      };
    } catch (err) {
      this.log.error(
        { err, key, bucket: this.bucket },
        "Failed to upload to R2",
      );
      throw err;
    }
  }

  /**
   * List objects with a specific prefix.
   */
  async list(prefix: string): Promise<ListResult[]> {
    try {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
        }),
      );

      return Promise.all(
        (response.Contents || []).map(async (item) => ({
          key: item.Key || "",
          url: await this.getUrl(item.Key || ""),
          size: item.Size || 0,
          lastModified: item.LastModified,
        })),
      );
    } catch (err) {
      this.log.error(
        { err, prefix, bucket: this.bucket },
        "Failed to list from R2",
      );
      throw err;
    }
  }

  /**
   * Delete an object by key.
   */
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (err) {
      this.log.error(
        { err, key, bucket: this.bucket },
        "Failed to delete from R2",
      );
      throw err;
    }
  }

  /**
   * Check if an object exists.
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (err: any) {
      if (err.name === "NotFound") return false;
      throw err;
    }
  }

  /**
   * Generates a URL for the given key.
   * If a custom public domain is configured, it returns a public URL.
   * Otherwise, it generates a pre-signed URL for private access.
   */
  public async getUrl(
    key: string,
    forcePrivate = false,
    expires = 3600,
  ): Promise<string> {
    if (this.publicDomain && !forcePrivate) {
      return this.getPublicUrl(key);
    }
    return this.getSignedUrl(key, expires);
  }

  /**
   * Generates a pre-signed URL for private access.
   */
  public async getSignedUrl(
    key: string,
    expires: number = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expires });
  }

  /**
   * Generate the public-facing URL for a key.
   */
  public getPublicUrl(key: string): string {
    if (this.publicDomain) {
      return `${this.publicDomain.replace(/\/$/, "")}/${key}`;
    }
    // Fallback to S3-style subdomain URL if no public domain is set
    return `${this.endpoint.replace(
      "https://",
      `https://${this.bucket}.`,
    )}/${key}`;
  }
}

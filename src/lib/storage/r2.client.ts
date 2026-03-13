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
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { logger } from "@lib/logger";

export interface StorageOptions {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucketName: string;
  publicDomain?: string;
}

export interface UploadResult {
  url: string;
  key: string;
  size: number;
}

export interface ListResult {
  key: string;
  url: string;
  size: number;
  lastModified?: Date;
  mimeType?: string;
}

export class StorageClient {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicDomain?: string;
  private readonly endpoint: string;
  private readonly log = logger.child({ module: "StorageClient" });

  constructor(options: StorageOptions) {
    this.bucket = options.bucketName;
    this.publicDomain = options.publicDomain;
    this.endpoint = options.endpoint;

    this.client = new S3Client({
      region: "auto",
      endpoint: options.endpoint,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  /**
   * Factory to create a client from a secrets object.
   */
  static fromSecrets(secrets: {
    getDecrypted: (key: string) => string | null | undefined;
  }): StorageClient {
    const accessKeyId = secrets.getDecrypted("r2AccessKeyId");
    const secretAccessKey = secrets.getDecrypted("r2SecretKey");
    const endpoint = secrets.getDecrypted("r2Endpoint");
    const bucketName = secrets.getDecrypted("r2BucketName");
    const publicDomain = secrets.getDecrypted("r2PublicDomain") || undefined;

    if (!accessKeyId || !secretAccessKey || !endpoint || !bucketName) {
      throw new Error("R2 Storage configuration missing in secrets");
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
        url: this.getPublicUrl(key),
        key,
        size: body.length,
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

      return (response.Contents || []).map((item) => ({
        key: item.Key || "",
        url: this.getPublicUrl(item.Key || ""),
        size: item.Size || 0,
        lastModified: item.LastModified,
      }));
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
   * Generate the public-facing URL for a key.
   */
  private getPublicUrl(key: string): string {
    if (this.publicDomain) {
      return `${this.publicDomain.replace(/\/$/, "")}/${key}`;
    }
    // Fallback to S3-style subdomain URL if no public domain is set
    return `${this.endpoint.replace("https://", `https://${this.bucket}.`)}/${key}`;
  }
}

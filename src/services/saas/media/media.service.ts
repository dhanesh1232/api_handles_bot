import {
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { IClientSecrets } from "../../../model/clients/secrets.ts";

// Set FFmpeg path
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);

export const compressMedia = async (
  buffer: Buffer,
  mimeType: string,
  id: string,
): Promise<Buffer> => {
  const tempDir = path.join(process.cwd(), "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const ext = mimeType.split("/")[1] || "bin";
  const inputPath = path.join(tempDir, `${id}_in.${ext}`);
  const outputPath = path.join(tempDir, `${id}_out.${ext}`);

  try {
    fs.writeFileSync(inputPath, buffer);

    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg(inputPath);

      if (mimeType.startsWith("video/")) {
        command
          .outputOptions([
            "-c:v libx264",
            "-crf 30",
            "-preset veryfast",
            "-c:a aac",
            "-b:a 64k",
          ])
          .save(outputPath)
          .on("end", () => resolve())
          .on("error", reject);
      } else if (mimeType.startsWith("audio/")) {
        command
          .outputOptions(["-c:a libmp3lame", "-b:a 64k"])
          .save(outputPath)
          .on("end", () => resolve())
          .on("error", reject);
      } else {
        resolve();
      }
    });

    if (fs.existsSync(outputPath)) {
      const compressedBuffer = fs.readFileSync(outputPath);
      return compressedBuffer;
    }
    return buffer;
  } catch (error) {
    console.error("FFmpeg compression failed:", error);
    return buffer;
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
};

export const getR2Client = (secrets: IClientSecrets): S3Client | null => {
  const r2AccessKeyId = secrets.getDecrypted("r2AccessKeyId");
  const r2SecretKey = secrets.getDecrypted("r2SecretKey");
  const r2Endpoint = secrets.getDecrypted("r2Endpoint");

  if (!r2AccessKeyId || !r2SecretKey || !r2Endpoint) return null;

  return new S3Client({
    region: "auto",
    endpoint: r2Endpoint,
    credentials: {
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretKey,
    },
  });
};

export interface OptimizedMediaResult {
  url: string;
  mimeType: string;
  fileName: string;
  r2Key: string;
}

export const optimizeAndUploadMedia = async (
  fileBuffer: Buffer,
  originalMimeType: string,
  originalFileName: string | undefined | null,
  mediaId: string,
  secrets: IClientSecrets, // Injected secrets
  folder: string = "whatsapp",
): Promise<OptimizedMediaResult> => {
  let mimeType = originalMimeType;
  let buffer = fileBuffer;

  // Optimize Image
  if (mimeType.startsWith("image/")) {
    try {
      buffer = await sharp(buffer)
        .resize({ width: 1280, withoutEnlargement: true }) // Balanced resolution
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      mimeType = "image/jpeg";
    } catch (sharpError: any) {
      console.warn("Sharp optimization failed:", sharpError.message);
    }
  }

  // Optimize Video/Audio
  if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
    const compressed = await compressMedia(buffer, mimeType, mediaId);
    if (compressed !== buffer) {
      buffer = compressed;
      if (mimeType.startsWith("video/")) mimeType = "video/mp4";
      if (mimeType.startsWith("audio/")) mimeType = "audio/mpeg";
    }
  }

  // Determine Filename (Logic copied from reference)
  const mimeToExt: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "jpg", // Convert webp to jpg for compatibility
    "application/pdf": "pdf",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "pptx",
    "application/msword": "doc",
    "application/vnd.ms-excel": "xls",
    "application/vnd.ms-powerpoint": "ppt",
  };

  const ext = mimeToExt[mimeType] || "bin";
  let fileName: string;

  if (originalFileName) {
    const safeName = originalFileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const nameWithoutExt = path.parse(safeName).name;
    fileName = `${nameWithoutExt}.${ext}`;
  } else {
    fileName = `${mediaId}.${ext}`;
  }

  const r2Key = `${folder}/${fileName}`;

  const s3Client = getR2Client(secrets);
  if (!s3Client) throw new Error("R2 Storage not configured");

  const r2BucketName = secrets.getDecrypted("r2BucketName");
  const r2PublicDomain = secrets.getDecrypted("r2PublicDomain");
  const r2Endpoint = secrets.getDecrypted("r2Endpoint");

  if (!r2BucketName || !r2Endpoint) {
    throw new Error("R2 Bucket Name or Endpoint missing in secrets.");
  }

  // Upload
  await s3Client.send(
    new PutObjectCommand({
      Bucket: r2BucketName,
      Key: r2Key,
      Body: buffer,
      ContentType: mimeType,
    }),
  );

  const publicUrl = r2PublicDomain
    ? `${r2PublicDomain}/${r2Key}`
    : `${r2Endpoint.replace("https://", `https://${r2BucketName}.`)}/${r2Key}`;

  return {
    url: publicUrl,
    mimeType,
    fileName,
    r2Key,
  };
};

export const uploadBufferToR2 = async (
  buffer: Buffer,
  mimeType: string,
  filename: string,
  secrets: IClientSecrets,
): Promise<string> => {
  const r2Key = `whatsapp/${filename}`;

  const s3Client = getR2Client(secrets);
  if (!s3Client) throw new Error("R2 Storage not configured");

  const r2BucketName = secrets.getDecrypted("r2BucketName");
  const r2PublicDomain = secrets.getDecrypted("r2PublicDomain");

  if (!r2BucketName) throw new Error("R2 Bucket Name missing in secrets.");

  try {
    // Check if file already exists
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: r2BucketName,
        Key: r2Key,
      }),
    );
    console.log("File already exists in R2, skipping upload:", filename);
  } catch (error: any) {
    if (error.name === "NotFound") {
      // File does not exist, upload it
      await s3Client.send(
        new PutObjectCommand({
          Bucket: r2BucketName,
          Key: r2Key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );
      console.log("Uploaded new file to R2:", filename);
    } else {
      throw error;
    }
  }

  return `${r2PublicDomain}/${r2Key}`;
};

export const listObjectsFromR2 = async (
  folder: string,
  secrets: IClientSecrets,
): Promise<any[]> => {
  const s3Client = getR2Client(secrets);
  if (!s3Client) throw new Error("R2 Storage not configured");

  const r2BucketName = secrets.getDecrypted("r2BucketName");
  const r2PublicDomain = secrets.getDecrypted("r2PublicDomain");
  const r2Endpoint = secrets.getDecrypted("r2Endpoint");

  if (!r2BucketName || !r2Endpoint) {
    throw new Error("R2 Bucket Name or Endpoint missing in secrets.");
  }

  const prefix = folder.endsWith("/") ? folder : `${folder}/`;

  const command = new ListObjectsV2Command({
    Bucket: r2BucketName,
    Prefix: prefix,
  });

  const response = await s3Client.send(command);

  return (response.Contents || [])
    .map((item) => {
      const publicUrl = r2PublicDomain
        ? `${r2PublicDomain}/${item.Key}`
        : `${r2Endpoint.replace("https://", `https://${r2BucketName}.`)}/${item.Key}`;

      return {
        url: publicUrl,
        name: path.basename(item.Key as string),
        fileName: path.basename(item.Key as string),
        key: item.Key,
        lastModified: item.LastModified,
        size: item.Size,
      };
    })
    .sort((a: any, b: any) => b.lastModified - a.lastModified);
};

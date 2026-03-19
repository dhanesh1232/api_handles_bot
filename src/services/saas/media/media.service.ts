/**
 * services/saas/media/media.service.ts
 *
 * Media Service — Handles media processing (compression, optimization)
 * and delegates storage operations to the StorageClient.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "@lib/logger";
import {
  type ListResult,
  StorageClient,
  type UploadResult,
} from "@lib/storage/r2.client";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";

// ─── FFmpeg Setup ─────────────────────────────────────────────────────────────

if (ffmpegPath && fs.existsSync(ffmpegPath as unknown as string)) {
  ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);
} else {
  // Fallback to system ffmpeg if static path is invalid or missing
  ffmpeg.setFfmpegPath("ffmpeg");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compresses video or audio buffer using FFmpeg.
 */
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

  let outputExt = ext;
  if (mimeType.startsWith("video/")) outputExt = "mp4";
  else if (mimeType.startsWith("audio/")) outputExt = "ogg";

  const outputPath = path.join(tempDir, `${id}_out.${outputExt}`);

  try {
    fs.writeFileSync(inputPath, buffer);

    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg(inputPath);

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
          .outputOptions(["-c:a libopus", "-b:a 64k", "-ac 1"])
          .save(outputPath)
          .on("end", () => resolve())
          .on("error", reject);
      } else {
        resolve();
      }
    });

    if (fs.existsSync(outputPath)) {
      return fs.readFileSync(outputPath);
    }
    return buffer;
  } catch (err) {
    logger.error({ err, id }, "FFmpeg compression failed");
    return buffer;
  } finally {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
};

// ─── Service API ──────────────────────────────────────────────────────────────

export interface OptimizedMediaResult extends UploadResult {
  mimeType: string;
  fileName: string;
}

/**
 * Processes (optimizes) and uploads media to R2.
 */
export const optimizeAndUploadMedia = async (
  fileBuffer: Buffer,
  originalMimeType: string,
  originalFileName: string | undefined | null,
  mediaId: string,
  storage: StorageClient, // Pass the pre-configured storage client
  folder: string = "whatsapp",
): Promise<OptimizedMediaResult> => {
  let mimeType = originalMimeType;
  let buffer = fileBuffer;

  // 1. Optimize Image
  if (mimeType.startsWith("image/")) {
    try {
      buffer = await sharp(buffer)
        .resize({ width: 1280, withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      mimeType = "image/jpeg";
    } catch (err: any) {
      logger.warn({ err: err.message, mediaId }, "Sharp optimization failed");
    }
  }

  // 2. Optimize Video/Audio
  if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
    const isSmallAudio =
      mimeType.startsWith("audio/") && buffer.length < 512 * 1024; // < 512KB

    if (isSmallAudio) {
      logger.info(
        { mediaId, size: buffer.length },
        "Skipping audio compression (file is small)",
      );
    } else {
      const startComp = Date.now();
      const compressed = await compressMedia(buffer, mimeType, mediaId);
      logger.info(
        {
          duration: Date.now() - startComp,
          mediaId,
          mimeType,
          before: fileBuffer.length,
          after: compressed.length,
        },
        "Media compression finished",
      );
      if (compressed !== buffer) {
        buffer = compressed;
        if (mimeType.startsWith("video/")) mimeType = "video/mp4";
        if (mimeType.startsWith("audio/")) mimeType = "audio/ogg";
      }
    }
  }

  // 3. Determine Filename
  const mimeToExt: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "jpg",
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
    fileName = `${nameWithoutExt}_${Date.now()}.${ext}`;
  } else {
    fileName = `${mediaId}.${ext}`;
  }

  const r2Key = `${folder}/${fileName}`;

  // 4. Upload
  const uploadResult = await storage.upload(r2Key, buffer, mimeType);

  const cleanName = originalFileName
    ? path.parse(originalFileName.replace(/[^a-zA-Z0-9.-]/g, "_")).name
    : mediaId;

  return {
    ...uploadResult,
    mimeType,
    fileName: cleanName,
    r2Key: uploadResult.key, // Backward compatibility alias
  } as any;
};

/**
 * Upload simple buffer if it doesn't exist.
 */
export const uploadBufferToR2 = async (
  buffer: Buffer,
  mimeType: string,
  filename: string,
  storage: StorageClient,
): Promise<string> => {
  const r2Key = `whatsapp/${filename}`;

  if (await storage.exists(r2Key)) {
    logger.debug({ filename }, "File already exists in R2, skipping upload");
    return await storage.getUrl(r2Key); // Now supports both public/signed
  }

  const result = await storage.upload(r2Key, buffer, mimeType);
  logger.info({ filename }, "Uploaded new file to R2");
  return result.url;
};

/**
 * Lists objects from a folder for a client.
 */
export const listObjectsFromR2 = async (
  folder: string,
  storage: StorageClient,
): Promise<ListResult[]> => {
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;

  const items = await storage.list(prefix);

  return items.map((item) => {
    const basename = path.basename(item.key);
    const parsed = path.parse(basename);
    const cleanName = parsed.name.replace(/_\d{13}$/, "");

    return {
      ...item,
      name: cleanName,
      fileName: cleanName,
      type: parsed.ext.substring(1),
    };
  }) as any;
};

/**
 * Deletes an object by key.
 */
export const deleteObjectFromR2 = async (
  key: string,
  storage: StorageClient,
): Promise<void> => {
  await storage.delete(key);
};

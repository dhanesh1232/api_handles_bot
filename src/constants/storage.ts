export const PLAN_QUOTA_BYTES: Record<string, number> = {
  basic: 2.5 * 1024 * 1024 * 1024, // 2.5 GB
  starter: 5 * 1024 * 1024 * 1024, //   5 GB
  growth: 20 * 1024 * 1024 * 1024, //  20 GB
  scale: 100 * 1024 * 1024 * 1024, // 100 GB
  default: 2.5 * 1024 * 1024 * 1024, //   2.5 GB fallback
};

export const DEFAULT_SYSTEM_FOLDERS = [
  { name: "whatsapp-media", dateShard: true },
  { name: "documents", dateShard: true },
  { name: "automation-assets", dateShard: false },
  { name: "exports", dateShard: false },
] as const;

export const R2_PRESIGN_EXPIRY = {
  upload: 5 * 60, // 5 minutes
  download: 60 * 60, // 1 hour
} as const;

export const STORAGE_SYNC_BATCH_SIZE = 10;
export const QUOTA_WARN_THRESHOLD = 90; // percent

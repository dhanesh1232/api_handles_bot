/**
 * lib/connectionManager.ts
 *
 * TenantConnectionManager — class-based singleton that maintains one
 * mongoose Connection per tenant (clientCode). Caches and reuses live
 * connections; evicts stale/closed entries automatically.
 *
 * Backward-compatible: getTenantConnection() and getTenantModel() are
 * exported free functions that delegate to the singleton, so all existing
 * callers work without changes.
 */

import { dbConnect } from "@lib/config";
import { logger } from "@lib/logger";
import { ClientDataSource } from "@models/clients/dataSource";
import mongoose, { type Connection, type Model, type Schema } from "mongoose";

// ─── Class ───────────────────────────────────────────────────────────────────

class TenantConnectionManager {
  private readonly cache = new Map<string, Connection>();
  private readonly log = logger.child({ module: "TenantConnectionManager" });

  /**
   * Return a live Connection for the given tenant.
   * Creates (and caches) a new connection if none exists or the cached one
   * has been closed/errored.
   */
  async get(clientCode: string): Promise<Connection> {
    await dbConnect("services");
    const code = clientCode?.toUpperCase();

    // Return cached connection if it's live
    const cached = this.cache.get(code);
    if (cached) {
      if (cached.readyState === 1 || cached.readyState === 2) {
        return cached;
      }
      // Stale — remove so we reconnect below
      this.cache.delete(code);
    }

    // Lookup the tenant's DB URI from the control-plane
    const dataSource = await ClientDataSource.findOne({ clientCode: code });
    if (!dataSource) {
      throw new Error(`Data source not configured for tenant: ${code}`);
    }

    const uri: string =
      typeof dataSource.getUri === "function"
        ? dataSource.getUri()
        : (dataSource as any).uri;

    if (!uri) {
      throw new Error(`Invalid DB URI for tenant: ${code}`);
    }

    this.log.debug(
      { clientCode: code },
      "Establishing new tenant DB connection",
    );

    const conn = mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 20000,
      maxPoolSize: 10,
      bufferCommands: false,
    });

    conn.on("error", (err) => {
      this.log.error({ err, clientCode: code }, "Tenant DB connection error");
      this.cache.delete(code);
    });

    conn.on("disconnected", () => {
      this.log.warn({ clientCode: code }, "Tenant DB disconnected");
      this.cache.delete(code);
    });

    await conn.asPromise();
    this.log.info({ clientCode: code }, "Tenant DB connected");

    this.cache.set(code, conn);
    return conn;
  }

  /**
   * Return (or compile) a Mongoose model on a tenant connection.
   * Safe to call repeatedly — returns the cached model if already compiled.
   */
  model<T>(
    conn: Connection,
    collectionName: string,
    schema?: Schema<T> | any,
  ): Model<T> {
    if (conn.models[collectionName]) {
      return conn.models[collectionName] as Model<T>;
    }
    const s =
      schema ??
      new mongoose.Schema({}, { strict: false, collection: collectionName });
    return conn.model<T>(collectionName, s);
  }

  /** Number of cached connections (for health/admin endpoints). */
  get size(): number {
    return this.cache.size;
  }

  /** Gracefully close all cached connections (e.g. during shutdown). */
  async closeAll(): Promise<void> {
    const entries = [...this.cache.entries()];
    await Promise.allSettled(
      entries.map(async ([code, conn]) => {
        try {
          await conn.close();
          this.log.info({ clientCode: code }, "Tenant DB connection closed");
        } catch (err) {
          this.log.warn(
            { err, clientCode: code },
            "Error closing tenant connection",
          );
        }
      }),
    );
    this.cache.clear();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const tenantManager = new TenantConnectionManager();

// ─── Backward-compatible free functions ──────────────────────────────────────
// All existing imports of getTenantConnection / getTenantModel / connectionCache
// continue to work without changes.

/** @deprecated Access tenantManager.cache directly or via tenantManager.size */
export const connectionCache = (tenantManager as any).cache as Map<
  string,
  Connection
>;

export async function getTenantConnection(
  clientCode: string,
): Promise<Connection> {
  return tenantManager.get(clientCode);
}

export function getTenantModel<T>(
  conn: Connection,
  collectionName: string,
  schema?: Schema<T> | any,
): Model<T> {
  return tenantManager.model<T>(conn, collectionName, schema);
}

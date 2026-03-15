import { dbConnect } from "@lib/config";
import { logger } from "@lib/logger";
import { ClientDataSource } from "@models/clients/dataSource";
import dotenv from "dotenv";
import mongoose, { type Connection } from "mongoose";

dotenv.config({ path: "./.env" });

const connectionMap = new Map<string, Connection>();

async function tenantDBConnect(URI: string): Promise<Connection> {
  if (connectionMap.has(URI)) {
    const conn = connectionMap.get(URI)!;
    try {
      if (conn.readyState === 1 || conn.readyState === 2) {
        return conn;
      }
    } catch (_e) {
      logger.warn({ err: _e }, "Cached connection check failed, reconnecting");
    }
  }

  logger.debug(
    { uri: `${URI.slice(0, 30)}...` },
    "Creating new tenant DB connection",
  );
  const conn = mongoose.createConnection(URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    bufferCommands: false,
    maxPoolSize: 5,
    retryWrites: true,
  });

  // Wait for connection to be usable
  await conn.asPromise();

  conn.on("connected", () => {
    logger.info({ uri: `${URI.slice(0, 30)}...` }, "Tenant DB connected");
  });

  conn.on("error", (err) => {
    logger.error({ err, uri: `${URI.slice(0, 30)}...` }, "Tenant DB error");
  });

  connectionMap.set(URI, conn);
  return conn;
}

async function GetURI(code: string): Promise<string> {
  await dbConnect("services"); // Ensure control plane connection
  const dataSource = await ClientDataSource.findOne({ clientCode: code });
  if (!dataSource) {
    throw new Error(`Data source not configured for tenant: ${code}`);
  }
  const uri =
    typeof dataSource.getUri === "function"
      ? dataSource.getUri()
      : (dataSource as any).uri;
  if (!uri) {
    throw new Error(`Invalid DB URI for tenant: ${code}`);
  }
  return uri;
}

export { GetURI, tenantDBConnect };

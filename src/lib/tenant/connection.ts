import dotenv from "dotenv";
import mongoose, { type Connection } from "mongoose";
import { ClientDataSource } from "../../model/clients/dataSource.js";
import { dbConnect } from "../config.js";

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
      console.warn(`Cached connection check failed, reconnecting... ${_e}`);
    }
  }

  console.log(`🔌 Creating new connection to: ${URI}`);
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
    console.log(`✅ Tenant DB Connected: ${URI}`);
  });

  conn.on("error", (err) => {
    console.error(`❌ Tenant DB Error (${URI}):`, err);
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

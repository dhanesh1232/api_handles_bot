/**
 * @file server.ts
 * @module BackendRoot
 * @responsibility Main entry point for the Ecodrix Backend. Handles HTTP/Socket initialization, CORS, and graceful shutdown.
 * @dependencies Express, Socket.io, Mongoose, Helmet, Pino
 *
 * **BOOTSTRAP PROCESS:**
 * 1. Loads environment variables and connects to global databases.
 * 2. Initializes Express app with security middlewares (Helmet, CSP, CORS).
 * 3. Mounts Socket.io and registers it globally for service-level access.
 * 4. Loads dynamic CORS origins from the database.
 * 5. Mounts SaaS-specific routes (WA, CRM, Jobs) and starts background workers.
 */

import "@lib/env";
import crypto from "node:crypto";
import { join } from "node:path";
import { logger } from "@lib/logger";
import { renderView } from "@lib/renderView";
import {
  getCachedOrigins,
  getDynamicOrigins,
  isOriginAllowed,
} from "@models/cors-origins";
import corsRouter from "@routes/saas/cors/cors.routes";
import { createCrmRouter } from "@routes/saas/crm/crm.router";
import eventLogRouter from "@routes/saas/eventLog.routes";
import eventRouter from "@routes/saas/events.routes";
import healthRouter from "@routes/saas/health.routes";
import { createMarketingRouter } from "@routes/saas/marketing.routes";
import { createMeetRouter } from "@routes/saas/meet/meet.routes";
import { createChatRouter } from "@routes/saas/whatsapp/chat.routes";
import { createTemplateRouter } from "@routes/saas/whatsapp/templates.routes";
import { createWebhookRouter } from "@routes/saas/whatsapp/webhook.routes";
import triggerRouter from "@routes/saas/workflows/trigger.routes";
import blogsRouter from "@routes/services/blogs";
import clientsRouter from "@routes/services/clients";
import leadsRouter from "@routes/services/leads";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import http from "http";
import mongoose from "mongoose";
import { Server, type Socket } from "socket.io";
import googleAuthRouter from "@/routes/auth/google.routes";
import { createImagesRouter } from "@/routes/saas/media.routes";
import { createStorageRouter } from "@/routes/saas/storage.routes";
import agencyRoutes from "./src/routes/agency/agency.router";
import emailConfigRoutes from "./src/routes/settings/emailConfig.routes";

/**
 * @Start MongoDB Workflow Processor (Free Alternative)
 * @borrows Workflow Processor for saas
 *
 * @param {registerGlobalIo} - Register global io
 * @param {cronJobs} - Cron jobs for leads
 */

import { cronJobs } from "@jobs/cron";
import { registerCrmIo, startCrmWorker } from "@jobs/saas/crmWorker";
import { errorHandler } from "@middleware/errorHandler";
import { requestLogger } from "@middleware/logger";
import { limiter, triggerLimiter } from "@middleware/rate-limit";
import { validateClientKey } from "@middleware/saasAuth";
import queueRouter from "@routes/saas/queue.routes";

const PORT = process.env.PORT || 4000;
const app = express();
app.set("trust proxy", 1); // Trust first proxy (Nginx)
const server = http.createServer(app);

const BASE_DEFAULTS_URLS = [
  // Local dev
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  // ECODrIx platform
  "https://admin.ecodrix.com",
  "https://services.ecodrix.com",
  "https://www.ecodrix.com",
  "https://app.ecodrix.com",
  "https://ecodrix.com",
  "https://portfolio.ecodrix.com",
  // Clients
  "https://nirvisham.com",
  "https://www.nirvisham.com",
  "https://www.thepathfinderr.com",
  "https://thepathfinderr.com",
];

const DEFAULT_HEADERS = [
  "Content-Type",
  "Authorization",
  "x-api-key",
  "x-client-code",
  "x-core-api-key",
  "x-socket-id",
  "x-socket-token",
  "x-socket-client-code",
  "x-ecodrix-signature",
];

const DEFAULT_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];

/**
 * @Start CORS Options
 * @borrows CORS options for saas
 *
 * @param {getDynamicOrigins} - Get dynamic origins
 */

/**
 * Dynamic CORS options delegate.
 *
 * **WORKING PROCESS:**
 * 1. Sanitizes the incoming `Origin` header (lowercase, trim, strip trailing slash).
 * 2. Checks if the origin is allowed via `isOriginAllowed` (using in-memory cache).
 * 3. Fetches service-specific CORS configuration (headers, methods) for that origin.
 * 4. Invokes the Express `callback` with the resolved security policy.
 *
 * @param {any} req - Express request object.
 * @param {any} callback - CORS library callback.
 * @returns {void}
 * @edge_case Blocks unknown origins and logs a warning for security auditing.
 */
const corsOptionsDelegate = (req: any, callback: any) => {
  const origin = req.header("Origin")?.toLowerCase().trim().replace(/\/$/, "");

  if (isOriginAllowed(origin)) {
    // Look up exact config for this origin from the in-memory cache
    const config = origin
      ? getCachedOrigins().find(
          (o) => o.url.toLowerCase().trim().replace(/\/$/, "") === origin,
        ) || getCachedOrigins().find((o) => o.url === "*")
      : null;

    callback(null, {
      origin: true,
      credentials: true,
      methods: config?.allowedMethods || DEFAULT_METHODS,
      allowedHeaders: config?.allowedHeaders || DEFAULT_HEADERS,
      maxAge: 86400,
    });
  } else {
    logger.warn({ origin }, "CORS blocked — Origin not whitelisted");
    callback(null, { origin: false });
  }
};

/**
 * @Start Security Middleware
 * @borrows Helmet and Rate Limiting
 */

// Generate a fresh nonce per request for CSP script-src
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
});

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          (_req, res) => `'nonce-${(res as any).locals.cspNonce}'`,
        ],
        // No inline event handlers anywhere — all onclick= removed in favour of addEventListener
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  }),
);

// Serve static assets from public/ folder (favicons, logos, etc.)
app.use(express.static(join(process.cwd(), "public")));

/**
 * @Start Rate Limiting
 * @borrows Rate limiting for saas
 *
 * @param {limiter} - Rate limiting for saas
 */
app.use("/api", limiter);

/**
 * @Start CORS
 * @borrows CORS for saas
 *
 * @param {corsOptionsDelegate} - CORS options delegate
 */
app.use(cors(corsOptionsDelegate));
app.options("/", cors(corsOptionsDelegate));

/**
 * @Start JSON Parser
 * @borrows JSON parser for saas
 *
 * @param {express.json} - JSON parser
 */

app.use((req: Request, res: Response, next: NextFunction) => {
  express.json()(req, res, (err: any) => {
    if (
      err instanceof SyntaxError &&
      (err as any).status === 400 &&
      "body" in err
    ) {
      logger.warn({ url: req.url }, `JSON parse error: ${err.message}`);
      return res.status(400).json({ error: "Invalid JSON format" });
    }
    next(err);
  });
});

/**
 * @Start Request Logger Middleware
 */
app.use(requestLogger);

/**
 * @Start URL Encoded Parser
 * @borrows URL encoded parser for saas
 *
 * @param {express.urlencoded} - URL encoded parser
 */
app.use(express.urlencoded({ extended: true }));

/**
 * @Start Socket.IO
 * @borrows Socket.IO for saas
 *
 * @param {Server} - Server for saas
 */

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"), false);
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
  },
});

// Register global io for convenience in services/workers
(global as any).io = io;

/**
 * @Start Socket Events
 * @borrows Socket events for saas
 *
 * @param {join-room} - Join room
 * @param {join} - Join room (legacy)
 * @param {send-message} - Send message
 * @param {disconnect} - Disconnect
 */

// Socket events
io.on("connection", (socket: Socket) => {
  logger.info({ socketId: socket.id }, "User connected");

  // Allow clients to join a room for their specific tenant
  socket.on("join-room", (clientCode: string) => {
    if (clientCode) {
      socket.join(clientCode);
      console.log(`📡 Socket ${socket.id} joined room: ${clientCode}`);
    }
  });

  socket.on("join", (clientCode: string) => {
    if (clientCode) {
      socket.join(clientCode);
      logger.info(
        { socketId: socket.id, clientCode },
        `📡 Socket joined room (legacy)`,
      );
    }
  });

  socket.on("send-message", async (msg: any) => {
    logger.debug({ msg }, "Received message");
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "User disconnected");
  });
});

/**
 * @Start Global Io
 * @borrows Global Io for saas
 * @param {registerGlobalIo} - Register global io
 *
 * @Start Cron Jobs
 * @borrows Cron jobs for leads
 * @param {cronJobs} - Cron jobs for leads
 *
 */

cronJobs();

// ─── CRM Worker — handles all async CRM jobs (WhatsApp, email, meeting, reminders)
registerCrmIo(io);
const crmWorker = startCrmWorker();

/**
 * @Start Middleware
 * @borrows Middleware for saas
 *
 * @param {req.io} - Middleware to attach io to req
 */
app.use((req: any, _res: Response, next: NextFunction) => {
  req.io = io;
  next();
});

/**
 * @Start Simple REST Route
 * @borrows Simple REST route for saas
 *
 * @param {req.io} - Middleware to attach io to req
 */

// ─── Root status page ────────────────────────────────────────────────────────
// Served from src/views/index.html — renderView caches the file at first call.
const SERVER_BOOT_TS = Date.now();

/**
 * @Start Root Route
 * @borrows Root route for saas
 *
 * @param {req.io} - Middleware to attach io to req
 */
app.get("/", (_req: Request, res: Response) => {
  const html = renderView("index.html", {
    VERSION: process.env.npm_package_version ?? "1.5.0",
    ENV: process.env.NODE_ENV ?? "development",
    BOOT_TS: String(SERVER_BOOT_TS),
    BASE_URL: process.env.BASE_URL ?? "https://api.ecodrix.com",
    NONCE: res.locals.cspNonce as string,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

/**
 * @Start Health Check
 * @borrows Health check for saass
 *
 * @param {req.io} - Middleware to attach io to req
 */
app.get("/health-check", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    message: "Server running",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

/**
 * @Start Routes
 * @borrows Routes for saas
 *
 * @param {blogsRouter} - Blogs router
 * @param {leadsRouter} - Leads router
 * @param {clientsRouter} - Clients router
 * @param {createWebhookRouter} - Webhook router
 * @param {createChatRouter} - Chat router
 * @param {createImagesRouter} - Images router
 * @param {createTemplateRouter} - Template router
 * @param {marketingRouter} - Marketing router
 * @param {crmRouter} - CRM router
 * @param {validateClientKey} - Validate client key
 * @param {createWorkflowRouter} - Workflow router
 * @param {corsRouter} - CORS router
 * @param {googleAuthRouter} - Google auth router
 */
app.use("/api", blogsRouter);
app.use("/api", leadsRouter);
app.use("/api", clientsRouter);

// Using top-level await pattern natively or wrap carefully.
// Express use doesn't support async correctly without wrapping if createWebhookRouter(io) returns a promise resolving to router
/**
 * Asynchronous route and service initializer.
 *
 * **WORKING PROCESS:**
 * 1. Mounts all API routers with their respective middlewares (Auth, Limiting).
 * 2. Initializes routers that require the `io` instance.
 * 3. Performs a final sync of dynamic origins from the DB.
 * 4. Starts the HTTP server listener.
 *
 * @async
 * @returns {Promise<void>}
 */
const initializeRoutes = async () => {
  app.use("/api/saas/whatsapp", await createWebhookRouter(io));
  app.use("/api/saas/chat", validateClientKey, createChatRouter(io));
  app.use("/api/saas/images", validateClientKey, createImagesRouter(io));
  app.use("/api/saas/storage", validateClientKey, createStorageRouter(io));
  app.use(
    "/api/saas/chat/templates",
    validateClientKey,
    createTemplateRouter(io),
  );
  app.use("/api/saas/meet", validateClientKey, createMeetRouter(io));
  app.use("/api/saas/marketing", validateClientKey, createMarketingRouter(io));
  app.use("/api/saas/cors", validateClientKey, corsRouter);
  app.use("/api/auth/google", googleAuthRouter);
  app.use("/api/agency", agencyRoutes);
  app.use("/api/crm", validateClientKey, createCrmRouter(io));
  app.use("/api/saas", healthRouter);
  app.use("/api/saas/events", validateClientKey, eventRouter);
  app.use("/api/saas", validateClientKey, eventLogRouter);

  app.use(
    "/api/saas/workflows",
    validateClientKey,
    triggerLimiter,
    triggerRouter,
  );

  // Queue admin (dead-letter visibility + retry)
  app.use("/api/saas/admin/queue", queueRouter);

  // Email Configuration
  app.use("/api/settings/email", emailConfigRoutes);

  // Global error handler — must be last, handles AppError + ZodError + unknown
  app.use(errorHandler);

  /**
   * @Start Server
   * @borrows Server for saas
   *
   * @param {PORT} - Port for server
   */
  await getDynamicOrigins();
  server.listen(PORT, () => {
    logger.info(`Server running at http://localhost:${PORT}`);
  });
};

initializeRoutes().catch(console.error);

/**
 * @Start Graceful Shutdown
 */
/**
 * Orchestrates a graceful application shutdown.
 *
 * **WORKING PROCESS:**
 * 1. Signals the CRM Worker to stop polling for new jobs.
 * 2. Closes the HTTP server to reject new incoming requests.
 * 3. Disconnects from MongoDB to ensure data integrity.
 * 4. Forces process exit after 15 seconds if hanging.
 *
 * @async
 * @param {string} signal - The termination signal (SIGTERM/SIGINT).
 */
const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutting down gracefully...");

  // 1. Stop processing new jobs
  crmWorker.stop();

  // 2. Close HTTP server (stops accepting new connections)
  server.close(async () => {
    logger.info("Closed HTTP server.");

    // 3. Close MongoDB Connection
    try {
      await mongoose.connection.close();
      logger.info("Closed MongoDB connection.");
    } catch (err) {
      logger.error({ err }, "Error closing MongoDB");
    }

    logger.info("Graceful shutdown complete. Exiting.");
    process.exit(0);
  });

  // Force close after 15 seconds
  setTimeout(() => {
    logger.error(
      "Could not close connections in time, forcefully shutting down",
    );
    process.exit(1);
  }, 15000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

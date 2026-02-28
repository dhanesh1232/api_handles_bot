import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import cors from "cors";
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import http from "http";
import { join } from "path";
import { Server, type Socket } from "socket.io";
import { renderView } from "./src/lib/renderView.ts";
import { getDynamicOrigins } from "./src/model/cors-origins.ts";
import googleAuthRouter from "./src/routes/auth/google.ts";
import corsRouter from "./src/routes/saas/cors/cors.routes.ts";
import crmRouter from "./src/routes/saas/crm/crm.router.ts";
import eventLogRouter from "./src/routes/saas/eventLog.routes.ts";
import healthRouter from "./src/routes/saas/health.routes.ts";
import { createImagesRouter } from "./src/routes/saas/images.ts";
import marketingRouter from "./src/routes/saas/marketing.ts";
import { createChatRouter } from "./src/routes/saas/whatsapp/chat.routes.ts";
import { createTemplateRouter } from "./src/routes/saas/whatsapp/templates.routes.ts";
import { createWebhookRouter } from "./src/routes/saas/whatsapp/webhook.routes.ts";
import triggerRouter from "./src/routes/saas/workflows/trigger.routes.ts";
import blogsRouter from "./src/routes/services/blogs.ts";
import clientsRouter from "./src/routes/services/clients.ts";
import leadsRouter from "./src/routes/services/leads.ts";

/**
 * @Start MongoDB Workflow Processor (Free Alternative)
 * @borrows Workflow Processor for saas
 *
 * @param {startWorkflowProcessor} - Start workflow processor
 * @param {registerGlobalIo} - Register global io
 * @param {cronJobs} - Cron jobs for leads
 */

import { cronJobs } from "./src/jobs/cron.ts";
import { registerCrmIo, startCrmWorker } from "./src/jobs/saas/crmWorker.ts";
import { registerGlobalIo } from "./src/jobs/saas/workflowWorker.ts";
import { requestLogger } from "./src/middleware/logger.ts";
import { limiter, triggerLimiter } from "./src/middleware/rate-limit.ts";
import { validateClientKey } from "./src/middleware/saasAuth.ts";

const PORT = process.env.PORT || 4000;
const app = express();
app.set("trust proxy", 1); // Trust first proxy (Nginx)
const server = http.createServer(app);

/**
 * @Start CORS Options
 * @borrows CORS options for saas
 *
 * @param {getDynamicOrigins} - Get dynamic origins
 */

const originsUrls = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173", // Vite
  "https://services.ecodrix.com",
  "https://www.ecodrix.com",
  "https://app.ecodrix.com",
  "https://ecodrix.com",
  "https://admin.ecodrix.com",
  "https://portfolio.ecodrix.com",
  "https://nirvisham.com",
  "https://www.nirvisham.com",
];

const corsOptions: cors.CorsOptions = {
  origin: async function (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) {
    const allowedOrigins = [...originsUrls, ...(await getDynamicOrigins())];
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-api-key",
    "x-client-code",
    "x-core-api-key",
    "x-socket-id",
    "x-socket-token",
    "x-socket-client-code",
    "x-ecodrix-signature",
  ],
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
 * @param {corsOptions} - CORS options
 */
app.use(cors(corsOptions));

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
      console.error(`⚠️ JSON Parse Error: ${err.message}`);
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
    origin: corsOptions.origin,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  },
});

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
  console.log("User connected:", socket.id);

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
      console.log(`📡 Socket ${socket.id} joined room (legacy): ${clientCode}`);
    }
  });

  socket.on("send-message", async (msg: any) => {
    console.log("Received:", msg);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

/**
 * @Start Global Io
 * @borrows Global Io for saas
 * @param {registerGlobalIo} - Register global io
 *
 * @Start Workflow Processor
 * @borrows Workflow Processor for saas
 * @param {startWorkflowProcessor} - Start workflow processor
 *
 * @Start Cron Jobs
 * @borrows Cron jobs for leads
 * @param {cronJobs} - Cron jobs for leads
 *
 */

registerGlobalIo(io);
cronJobs();

// ─── CRM Worker — handles all async CRM jobs (WhatsApp, email, meeting, reminders)
registerCrmIo(io);
startCrmWorker();

/**
 * @Start Middleware
 * @borrows Middleware for saas
 *
 * @param {req.io} - Middleware to attach io to req
 */
app.use((req: any, res: Response, next: NextFunction) => {
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
app.get("/health-check", (req: Request, res: Response) => {
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
const initializeRoutes = async () => {
  app.use("/api/saas/whatsapp", await createWebhookRouter(io));
  app.use("/api/saas/chat", validateClientKey, createChatRouter(io));
  app.use("/api/saas/images", validateClientKey, createImagesRouter(io));
  app.use(
    "/api/saas/chat/templates",
    validateClientKey,
    createTemplateRouter(io),
  );
  app.use("/api/saas/marketing", validateClientKey, marketingRouter);
  app.use("/api/saas/cors", validateClientKey, corsRouter);
  app.use("/api/auth/google", googleAuthRouter);
  app.use("/api/crm", validateClientKey, crmRouter);
  app.use("/api/saas", healthRouter);
  app.use("/api/saas", validateClientKey, eventLogRouter);

  // Override for trigger endpoint (stricter limit)
  app.use(
    "/api/saas/workflows",
    validateClientKey,
    triggerLimiter,
    triggerRouter,
  );

  /**
   * @Start Global Error Handler
   */
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(`❌ Global Error Handler: ${err.message}`, err.stack);
    res.status(err.status || 500).json({
      success: false,
      message:
        process.env.NODE_ENV === "production"
          ? "Internal Server Error"
          : err.message,
      code: err.code ?? "INTERNAL_ERROR",
    });
  });

  /**
   * @Start Server
   * @borrows Server for saas
   *
   * @param {PORT} - Port for server
   */

  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
};

initializeRoutes().catch(console.error);

/**
 * @Start Graceful Shutdown
 */
const shutdown = () => {
  console.log("Shutting down gracefully...");
  server.close(() => {
    console.log("Closed out remaining connections.");
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down",
    );
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

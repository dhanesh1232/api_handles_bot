import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import cors from "cors";
import express from "express";
import http from "http";
import cron from "node-cron";
import { Server } from "socket.io";
import {
  autoCloseJob,
  firstContactJob,
  followUpJob,
  followUpLimitJob,
  remindersJob,
  researchJob,
  tenantRemindersJob,
} from "./src/jobs/index.js";
import { getDynamicOrigins } from "./src/model/cors-origins.ts";
import googleAuthRouter from "./src/routes/auth/google.js";
import corsRouter from "./src/routes/saas/cors.ts";
import crmRouter from "./src/routes/saas/crm.ts";
import { createImagesRouter } from "./src/routes/saas/images.js";
import marketingRouter from "./src/routes/saas/marketing.js";
import { createChatRouter } from "./src/routes/saas/whatsapp/chat.ts";
import { createWorkflowRouter } from "./src/routes/saas/whatsapp/communication-workflow.ts";
import { createTemplateRouter } from "./src/routes/saas/whatsapp/templates.ts";
import { createWebhookRouter } from "./src/routes/saas/whatsapp/webhook.ts";
import blogsRouter from "./src/routes/services/blogs.js";
import clientsRouter from "./src/routes/services/clients.js";
import leadsRouter from "./src/routes/services/leads.js";

/**
 * @Start MongoDB Workflow Processor (Free Alternative)
 * @borrows Workflow Processor for saas
 * 
 * @param {startWorkflowProcessor} - Start workflow processor
 * @param {registerGlobalIo} - Register global io
 */

import { startWorkflowProcessor } from "./src/jobs/saas/workflowProcessor.ts";
import { registerGlobalIo } from "./src/jobs/saas/workflowWorker.ts";

const PORT = process.env.PORT || 4000;
const app = express();
app.set("trust proxy", 1); // Trust first proxy (Nginx)
const server = http.createServer(app);

const corsOptions = {
  origin: async function (origin, callback) {
    const allowedOrigins = await getDynamicOrigins();
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
  ],
};
app.use(cors(corsOptions));
app.use((req, res, next) => {
  express.json()(req, res, (err) => {
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
      console.error(`⚠️ JSON Parse Error: ${err.message}`);
      return res.status(400).json({ error: "Invalid JSON format" });
    }
    next(err);
  });
});
app.use(express.urlencoded({ extended: true }));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  },
});

// Socket events
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Allow clients to join a room for their specific tenant
  socket.on("join-room", (clientCode) => {
    if (clientCode) {
      socket.join(clientCode);
      console.log(`📡 Socket ${socket.id} joined room: ${clientCode}`);
    }
  });

  socket.on("join", (clientCode) => {
    if (clientCode) {
      socket.join(clientCode);
      console.log(`📡 Socket ${socket.id} joined room (legacy): ${clientCode}`);
    }
  });

  socket.on("send-message", async (msg) => {
    console.log("Received:", msg);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

registerGlobalIo(io);
startWorkflowProcessor();

// Middleware to attach io to req
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Simple REST route
app.get("/", (req, res) => {
  res.send("Hello from server");
});

app.use("/api", blogsRouter);
app.use("/api", leadsRouter);
app.use("/api", clientsRouter);
app.use("/api/saas/whatsapp", await createWebhookRouter(io));
app.use("/api/saas/chat", createChatRouter(io));
app.use("/api/saas/images", createImagesRouter(io));
app.use("/api/saas/chat/templates", createTemplateRouter(io));
app.use("/api/saas/marketing", marketingRouter);
app.use("/api/saas/crm", crmRouter);
app.use("/api/saas/workflows", createWorkflowRouter());
app.use("/api/saas/cors", corsRouter);
app.use("/api/auth/google", googleAuthRouter);

/**
 * @borrows Cron Jobs for leads
 *
 * @param {firstContactJob} - First contact job
 * @param {followUpJob} - Follow-up job
 * @param {researchJob} - Research job
 * @param {remindersJob} - Reminders job
 * @param {autoCloseJob} - Auto-close job
 * @param {followUpLimitJob} - Follow-up limit job
 * @param {tenantRemindersJob} - Tenant reminders job
 */

// Every 5 mins — small tasks
cron.schedule("*/5 * * * *", async () => {
  try {
    await firstContactJob();
    await followUpJob();
  } catch (err) {
    console.error("❌ 5-minute jobs failed:", err);
  }
});

// Every midnight — heavy tasks
cron.schedule("0 0 * * *", async () => {
  try {
    await researchJob();
    await remindersJob();
    await autoCloseJob();
    await followUpLimitJob();
  } catch (err) {
    console.error("❌ Midnight jobs failed:", err);
  }
});

// High-frequency task: Check all enabled tenants for upcoming reminders
// Use a controlled loop to prevent overlapping executions and excessive CPU usage
const runRemindersJob = async () => {
  try {
    await tenantRemindersJob();
  } catch (err) {
    console.error("❌ Reminders Job Loop Error:", err);
  } finally {
    // Wait 30 seconds before scheduling the next check
    // 30s is more than enough to catch a 1-minute reminder window
    setTimeout(runRemindersJob, 30000);
  }
};

// Start the loop
runRemindersJob();

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { predefinedReplies } from "./src/lib/pre-defined.js";
import blogsRouter from "./src/routes/services/blogs.js";
import leadsRouter from "./src/routes/services/leads.js";
import clientsRouter from "./src/routes/services/clients.js";
import { createWebhookRouter } from "./src/routes/saas/whatsapp/webhook.js";
import { createChatRouter } from "./src/routes/saas/whatsapp/chat.js";
import { createTemplateRouter } from "./src/routes/saas/whatsapp/templates.js";
import cron from "node-cron";
import {
  firstContactJob,
  followUpJob,
  researchJob,
  remindersJob,
  autoCloseJob,
  followUpLimitJob,
  tenantRemindersJob,
} from "./src/jobs/index.js";

const PORT = process.env.PORT || 4000;
const app = express();
const server = http.createServer(app);

// Middleware
const allowedOrigins = [
  "http://localhost:3000",
  "https://services.ecodrix.com",
  "https://www.ecodrix.com",
  "https://app.ecodrix.com",
  "https://ecodrix.com",
  "https://admin.ecodrix.com",
  "https://portfolio.ecodrix.com",
  // Add other client origins as needed
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};
app.use(express.json());
app.use(cors(corsOptions));
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
app.use("/api/saas/chat/templates", createTemplateRouter(io));

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

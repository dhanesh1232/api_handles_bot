import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { predefinedReplies } from "./src/lib/pre-defined.js";
import blogsRouter from "./src/routes/services/blogs.js";
import cron from "node-cron";
import {
  firstContactJob,
  followUpJob,
  researchJob,
  remindersJob,
  autoCloseJob,
  followUpLimitJob,
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

app.use(cors(corsOptions));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Socket events
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("send-message", async (msg) => {
    console.log("Received:", msg);

    // Emit the user's message to all clients including sender
    io.emit("receive-message", {
      id: Date.now(),
      from: "user",
      text: msg.text,
      timestamp: new Date(),
    });

    // Simple keyword matching to find a predefined reply
    const lowerText = msg.text.toLowerCase();
    const matchedReply = predefinedReplies.find(({ keywords }) =>
      keywords.some((kw) => lowerText.includes(kw))
    );

    if (matchedReply) {
      // Delay to simulate typing
      setTimeout(() => {
        io.emit("receive-message", {
          id: Date.now() + 1,
          from: "bot",
          text: matchedReply.reply,
          type: "quick_replies",
          options: matchedReply.quickReplies,
          timestamp: new Date(),
        });
      }, 1000);
    } else {
      // Default fallback reply
      setTimeout(() => {
        io.emit("receive-message", {
          id: Date.now() + 1,
          from: "bot",
          text: "Sorry, I didn't understand that. Can you please rephrase?",
          timestamp: new Date(),
        });
      }, 1000);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Simple REST route
app.get("/", (req, res) => {
  res.send("Hello from server");
});

app.use("/api", blogsRouter);

/**
 * @borrows Cron Jobs for leads
 */

// Every 5 mins — small tasks
cron.schedule("*/5 * * * *", () => {
  firstContactJob();
  followUpJob();
});

// Every midnight — heavy tasks
cron.schedule("0 0 * * *", () => {
  researchJob();
  remindersJob();
  autoCloseJob();
  followUpLimitJob();
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

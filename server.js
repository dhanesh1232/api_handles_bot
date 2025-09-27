import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

import { dbConnect } from "./lib/config.js";

const PORT = process.env.PORT || 4000;
const app = express();
const server = http.createServer(app);

// Middleware
app.use(
  cors({
    origin: "*",
  })
);

// Connect DB
dbConnect();

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Predefined replies dictionary
const predefinedReplies = [
  {
    keywords: ["hello", "hi", "hey"],
    reply: "Hello! How can I assist you today?",
    quickReplies: ["Help me", "Pricing", "Contact support"],
  },
  {
    keywords: ["help", "support"],
    reply: "Sure! What do you need help with?",
    quickReplies: ["Account", "Billing", "Technical issue"],
  },
  {
    keywords: ["pricing", "cost", "price"],
    reply:
      "Our pricing plans start at $10/month. Would you like to see details?",
    quickReplies: ["Yes, show me", "No, thanks"],
  },
];

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

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

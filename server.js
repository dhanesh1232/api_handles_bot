// backend-server/index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 4000;
const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: "*",
  })
);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || "https://app.ecodrix.com",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("send-message", (msg) => {
    console.log("Received:", msg);
    io.emit("receive-message", msg);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Socket server running at http://localhost:${PORT}`);
});

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");

// Security and rate limiting
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30;
const MAX_ROOM_SIZE = 10;
const ROOM_CLEANUP_INTERVAL = 300000; // 5 minutes

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 1e8, // 100MB buffer for large files
  pingTimeout: 60000, // 60 seconds ping timeout
  pingInterval: 25000, // 25 seconds ping interval
  transports: ["websocket", "polling"], // Allow both transports
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static("public"));

// Store active rooms and users
const rooms = new Map();

// Serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Security helper functions
function checkRateLimit(socketId) {
  const now = Date.now();
  const userRequests = rateLimit.get(socketId) || [];

  // Remove old requests outside the window
  const validRequests = userRequests.filter(
    (time) => now - time < RATE_LIMIT_WINDOW
  );

  if (validRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  validRequests.push(now);
  rateLimit.set(socketId, validRequests);
  return true;
}

function validateRoomId(roomId) {
  // Room ID should be 6 characters, alphanumeric
  return /^[A-Z0-9]{6}$/.test(roomId);
}

function sanitizeRoomId(roomId) {
  return roomId
    .replace(/[^A-Z0-9]/g, "")
    .substring(0, 6)
    .toUpperCase();
}

// Socket.io connection handling
io.on("connection", (socket) => {
  // User connected - no logging for performance

  // Join a room with security checks
  socket.on("join-room", (roomId) => {
    // Rate limiting check
    if (!checkRateLimit(socket.id)) {
      socket.emit("error", { message: "Too many requests. Please wait." });
      return;
    }

    // Validate and sanitize room ID
    if (!roomId || typeof roomId !== "string") {
      socket.emit("error", { message: "Invalid room code format." });
      return;
    }

    const sanitizedRoomId = sanitizeRoomId(roomId);
    if (!validateRoomId(sanitizedRoomId)) {
      socket.emit("error", {
        message: "Room code must be 6 alphanumeric characters.",
      });
      return;
    }

    // Check room size limit
    if (
      rooms.has(sanitizedRoomId) &&
      rooms.get(sanitizedRoomId).size >= MAX_ROOM_SIZE
    ) {
      socket.emit("error", {
        message: "Room is full. Maximum 10 users allowed.",
      });
      return;
    }

    socket.join(sanitizedRoomId);

    if (!rooms.has(sanitizedRoomId)) {
      rooms.set(sanitizedRoomId, new Set());
    }
    rooms.get(sanitizedRoomId).add(socket.id);

    // Get current users in room (excluding the new user)
    const usersInRoom = Array.from(rooms.get(sanitizedRoomId)).filter(
      (id) => id !== socket.id
    );

    // Send current users in room to the new user
    socket.emit("users-in-room", usersInRoom);

    // Notify others in the room about the new user
    socket.to(sanitizedRoomId).emit("user-joined", socket.id);

    // Send room status to all users
    const totalUsers = rooms.get(sanitizedRoomId).size;
    io.to(sanitizedRoomId).emit("room-status", {
      roomId: sanitizedRoomId,
      userCount: totalUsers,
      users: Array.from(rooms.get(sanitizedRoomId)),
    });
  });

  // WebRTC signaling
  socket.on("offer", (data) => {
    socket.to(data.target).emit("offer", {
      offer: data.offer,
      sender: socket.id,
    });
  });

  socket.on("answer", (data) => {
    socket.to(data.target).emit("answer", {
      answer: data.answer,
      sender: socket.id,
    });
  });

  socket.on("ice-candidate", (data) => {
    socket.to(data.target).emit("ice-candidate", {
      candidate: data.candidate,
      sender: socket.id,
    });
  });

  // ⚡ LIGHTNING-FAST WebSocket File Transfer
  socket.on("file-info", (data) => {
    // Skip rate limiting for file info - it's just metadata
    // Broadcast file info to all users in the room except sender
    socket.to(data.room).emit("file-info", {
      fileId: data.fileId,
      fileName: data.fileName,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      sender: socket.id,
    });
  });

  socket.on("file-chunk", (data) => {
    // Skip rate limiting for file chunks - they need to be fast
    // File chunks are the core functionality and shouldn't be rate limited

    // Forward chunk to all users in the room except sender
    socket.to(data.room).emit("file-chunk", {
      fileId: data.fileId,
      chunkIndex: data.chunkIndex,
      data: data.data,
      isLast: data.isLast,
      sender: socket.id,
    });
  });

  socket.on("file-complete", (data) => {
    // Notify all users in the room that file transfer is complete
    socket.to(data.room).emit("file-complete", {
      fileId: data.fileId,
      sender: socket.id,
    });
  });

  // Handle voluntary room leaving (back button)
  socket.on("leave-room", (roomId) => {
    if (rooms.has(roomId) && rooms.get(roomId).has(socket.id)) {
      // Remove user from room
      rooms.get(roomId).delete(socket.id);
      socket.leave(roomId);

      // Notify other users in the room
      socket.to(roomId).emit("user-left", socket.id);

      // Clean up empty rooms
      if (rooms.get(roomId).size === 0) {
        rooms.delete(roomId);
      }
    }
  });

  // Connection test ping handler
  socket.on("ping", (data) => {
    socket.emit("pong", {
      timestamp: data.timestamp,
      serverTime: Date.now(),
    });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    // Remove user from all rooms
    for (const [roomId, users] of rooms.entries()) {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        // Use io.to() instead of socket.to() since socket is disconnected
        io.to(roomId).emit("user-left", socket.id);

        // Clean up empty rooms
        if (users.size === 0) {
          rooms.delete(roomId);
        }
      }
    }
  });
});

// Room cleanup system
setInterval(() => {
  const now = Date.now();
  for (const [roomId, users] of rooms.entries()) {
    if (users.size === 0) {
      rooms.delete(roomId);
    }
  }

  // Clean up old rate limit entries
  for (const [socketId, requests] of rateLimit.entries()) {
    const validRequests = requests.filter(
      (time) => now - time < RATE_LIMIT_WINDOW
    );
    if (validRequests.length === 0) {
      rateLimit.delete(socketId);
    } else {
      rateLimit.set(socketId, validRequests);
    }
  }
}, ROOM_CLEANUP_INTERVAL);

server.listen(PORT, "0.0.0.0", () => {
  const localIP = getLocalIP();
  console.log("\n🚀 P2P File Transfer Server Started!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📱 Local:    http://localhost:${PORT}`);
  console.log(`🌐 Network:  http://${localIP}:${PORT}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});

function getLocalIP() {
  const { networkInterfaces } = require("os");
  const nets = networkInterfaces();

  // Prioritize WiFi and common network interfaces
  const preferredInterfaces = ["Wi-Fi", "wlan0", "eth0", "en0"];

  // First, try to find preferred interfaces
  for (const interfaceName of preferredInterfaces) {
    if (nets[interfaceName]) {
      for (const net of nets[interfaceName]) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
  }

  // Fallback: find any non-internal IPv4 address
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      // Also skip VirtualBox/VMware interfaces (192.168.56.x, 192.168.99.x)
      if (
        net.family === "IPv4" &&
        !net.internal &&
        !net.address.startsWith("192.168.56.") &&
        !net.address.startsWith("192.168.99.") &&
        !net.address.startsWith("169.254.")
      ) {
        return net.address;
      }
    }
  }

  return "localhost";
}

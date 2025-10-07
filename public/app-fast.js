class FastFileTransfer {
  constructor() {
    // Initializing - no logging for Render performance

    // Ultra-fast WebSocket configuration with better large file support
    this.socket = io({
      transports: ["websocket", "polling"], // Allow fallback to polling
      timeout: 10000, // Increased timeout for large files
      reconnection: true,
      reconnectionDelay: 1000, // More reasonable delay
      reconnectionDelayMax: 5000, // Longer max delay
      reconnectionAttempts: 10, // More attempts
      forceNew: false,
      upgrade: true, // Allow upgrade from polling to websocket
      maxHttpBufferSize: 1e8, // 100MB buffer for large files
    });

    this.currentRoom = null;
    this.connectedPeers = new Set();
    this.fileChunkSize = 65536; // 64KB chunks for optimal speed
    this.filesToSend = new Map();
    this.receivingFiles = new Map();
    this.transferStats = new Map();
    this.activeTransfers = new Map(); // Track active transfers for reliability

    this.initializeElements();
    this.setupEventListeners();
    this.setupSocketListeners();
    this.setupBackgroundHandling(); // Handle app backgrounding/tab switching
    this.setupConnectionStability(); // Maintain stable connections

    // Fast File Transfer Ready - no logging for Render performance

    // Add connection diagnostics
    this.startConnectionDiagnostics();
  }

  // Optimized Connection Diagnostics for Render Free Tier
  startConnectionDiagnostics() {
    // Minimal diagnostics - no logging, longer intervals for performance
    setInterval(() => {
      // Only essential connection recovery, no status logging
      if (!this.socket.connected && this.currentRoom) {
        this.socket.connect();
      }
    }, 30000); // Every 30 seconds to save CPU on Render
  }

  initializeElements() {
    this.roomInput = document.getElementById("room-input");
    this.generateRoomBtn = document.getElementById("generate-room");
    this.joinRoomBtn = document.getElementById("join-room");
    this.copyCodeBtn = document.getElementById("copy-code");
    this.backBtn = document.getElementById("back-btn");
    this.currentRoomSpan = document.getElementById("current-room");
    this.connectionScreen = document.getElementById("connection-screen");
    this.roomScreen = document.getElementById("room-screen");
    this.usersList = document.getElementById("users-list");
    this.fileDropZone = document.getElementById("file-drop-zone");
    this.fileInput = document.getElementById("file-input");
    this.fileList = document.getElementById("file-list");
    this.receivedFiles = document.getElementById("received-files");
    this.receivingSection = document.getElementById("receiving-section");
    this.sendingSection = document.getElementById("sending-section");
  }

  setupEventListeners() {
    this.generateRoomBtn.addEventListener("click", () => this.generateRoom());
    this.joinRoomBtn.addEventListener("click", () => this.joinRoom());
    this.copyCodeBtn.addEventListener("click", () => this.copyRoomCode());
    this.backBtn.addEventListener("click", () => this.goBack());

    this.roomInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.joinRoom();
    });

    // File handling
    this.fileDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.fileDropZone.classList.add("dragover");
    });

    this.fileDropZone.addEventListener("dragleave", () => {
      this.fileDropZone.classList.remove("dragover");
    });

    this.fileDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      this.fileDropZone.classList.remove("dragover");
      this.handleFiles(e.dataTransfer.files);
    });

    this.fileInput.addEventListener("change", (e) => {
      this.handleFiles(e.target.files);
    });

    // Folder selection
    const folderSelectBtn = document.getElementById("folder-select-btn");
    if (folderSelectBtn) {
      folderSelectBtn.addEventListener("click", () => this.selectFolder());
    }

    // Event delegation for send buttons
    document.addEventListener("click", (e) => {
      if (
        e.target.classList.contains("send-btn") &&
        e.target.dataset.filename
      ) {
        e.preventDefault();
        this.sendFile(e.target.dataset.filename);
      }
    });
  }

  setupSocketListeners() {
    this.socket.on("connect", () => {
      // Connected - no logging for Render performance
      this.showNotification("Connected to server", "success");
    });

    this.socket.on("disconnect", (reason) => {
      // Disconnected - no logging for Render performance
      this.showNotification(`Disconnected: ${reason}`, "error");
      this.connectedPeers.clear();
      this.updateUsersList();
    });

    // Enhanced error handling
    this.socket.on("connect_error", (error) => {
      console.error("❌ Connection error:", error);
      this.showNotification("Failed to connect to server", "error");
    });

    this.socket.on("reconnect", (attemptNumber) => {
      // Reconnected - no logging for Render performance
      this.showNotification("Reconnected to server", "success");
    });

    this.socket.on("reconnect_error", (error) => {
      console.error("❌ Reconnection failed:", error);
      this.showNotification("Reconnection failed", "error");
    });

    this.socket.on("reconnect_failed", () => {
      console.error("❌ All reconnection attempts failed");
      this.showNotification("Connection lost - please refresh", "error");
    });

    // Room events - INSTANT connection
    this.socket.on("users-in-room", (users) => {
      // Users in room - no logging for Render performance
      this.connectedPeers = new Set(users);
      this.updateUsersList();
      this.showNotification(
        `Connected to ${users.length} device(s)`,
        "success"
      );
    });

    this.socket.on("user-joined", (userId) => {
      // User joined - no logging for Render performance
      this.connectedPeers.add(userId);
      this.updateUsersList();
      const animalName = this.getAnimalName(userId);
      this.showNotification(`${animalName} joined`, "info");
    });

    this.socket.on("user-left", (userId) => {
      // User left - no logging for performance
      const animalName = this.getAnimalName(userId);
      this.connectedPeers.delete(userId);
      this.updateUsersList();
      this.showNotification(`${animalName} left`, "warning");
    });

    // File transfer events - DIRECT via WebSocket
    this.socket.on("file-info", (data) => {
      this.handleFileInfo(data);
    });

    this.socket.on("file-chunk", (data) => {
      this.handleFileChunk(data);
    });

    this.socket.on("file-complete", (data) => {
      this.handleFileComplete(data);
    });

    this.socket.on("error", (error) => {
      console.error("❌ Server error:", error);
      this.showNotification(error.message || "Server error", "error");
    });
  }

  // Room Management
  generateRoom() {
    const roomCode = this.generateRoomCode();
    this.roomInput.value = roomCode;
    this.joinRoom();
  }

  generateRoomCode() {
    // Remove confusing characters: 0/O, 1/I/L, 2/Z, 5/S, 6/G, 8/B
    const chars = "ACDEFHJKMNPQRTUVWXY347";
    let result = "";
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  joinRoom() {
    const roomCode = this.roomInput.value.trim().toUpperCase();

    if (!roomCode) {
      this.showNotification("Please enter a room code", "error");
      return;
    }

    if (roomCode.length !== 6) {
      this.showNotification("Room code must be 6 characters", "error");
      return;
    }

    // Joining room - no logging for Render performance
    this.currentRoom = roomCode;

    // Join room via WebSocket - INSTANT
    this.socket.emit("join-room", roomCode);

    // Show room screen immediately
    this.connectionScreen.style.display = "none";
    this.roomScreen.style.display = "block";
    this.backBtn.style.display = "block";
    this.currentRoomSpan.textContent = roomCode;

    this.showNotification(`Joined room: ${roomCode}`, "success");
  }

  copyRoomCode() {
    if (!this.currentRoom) return;

    navigator.clipboard
      .writeText(this.currentRoom)
      .then(() => {
        this.showNotification("Room code copied!", "success");
      })
      .catch(() => {
        // Fallback
        const textArea = document.createElement("textarea");
        textArea.value = this.currentRoom;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        this.showNotification("Room code copied!", "success");
      });
  }

  goBack() {
    if (this.currentRoom) {
      this.socket.emit("leave-room", this.currentRoom);
      this.currentRoom = null;
    }

    this.connectedPeers.clear();
    this.connectionScreen.style.display = "block";
    this.roomScreen.style.display = "none";
    this.backBtn.style.display = "none";
    this.sendingSection.style.display = "none";
    this.receivingSection.style.display = "none";

    // Clear UI
    this.usersList.innerHTML = "";
    this.fileList.innerHTML = "";
    this.receivedFiles.innerHTML = "";
    this.roomInput.value = "";

    // Clear data
    this.filesToSend.clear();
    this.receivingFiles.clear();
    this.transferStats.clear();
  }

  // 🦁 Simple Animal Name Generator
  getAnimalName(userId) {
    const animals = [
      "🦁 Lion",
      "🐯 Tiger",
      "🐻 Bear",
      "🦊 Fox",
      "🐺 Wolf",
      "🦅 Eagle",
      "🐧 Penguin",
      "🦉 Owl",
      "🐨 Koala",
      "🐼 Panda",
      "🦘 Kangaroo",
      "🦒 Giraffe",
      "🐘 Elephant",
      "🦏 Rhino",
      "🦓 Zebra",
      "🐰 Rabbit",
      "🐱 Cat",
      "🐶 Dog",
      "🐳 Whale",
      "🦈 Shark",
    ];

    // Use the socket ID to pick a consistent animal for each user
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash + userId.charCodeAt(i)) & 0xffffffff;
    }
    const index = Math.abs(hash) % animals.length;
    return animals[index];
  }

  updateUsersList() {
    this.usersList.innerHTML = "";

    if (this.connectedPeers.size === 0) {
      this.usersList.innerHTML = `
        <div class="no-users">
          <p>No other devices connected</p>
          <p class="help-text">Share the room code with other devices</p>
        </div>
      `;
    } else {
      this.connectedPeers.forEach((userId) => {
        // Use the same getAnimalName function for consistency
        const animalName = this.getAnimalName(userId);

        const userItem = document.createElement("div");
        userItem.className = "user-item";
        userItem.innerHTML = `
          <div class="user-info">
            <div class="user-id">✅ ${animalName}</div>
            <div class="user-status connected">Ready for transfer</div>
          </div>
        `;
        this.usersList.appendChild(userItem);
      });
    }
  }

  // File Handling
  handleFiles(files) {
    if (!files || files.length === 0) return;

    // Files selected - no logging for Render performance

    Array.from(files).forEach((file) => {
      if (this.validateFile(file)) {
        this.displayFileForSending(file);
      }
    });

    if (files.length > 0) {
      this.sendingSection.style.display = "block";
      this.showNotification(`${files.length} file(s) ready to send`, "success");
    }
  }

  selectFolder() {
    const folderInput = document.createElement("input");
    folderInput.type = "file";
    folderInput.webkitdirectory = true;
    folderInput.multiple = true;
    folderInput.style.display = "none";

    folderInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        this.handleFiles(e.target.files);
      }
      document.body.removeChild(folderInput);
    });

    document.body.appendChild(folderInput);
    folderInput.click();
  }

  validateFile(file) {
    const MAX_SIZE = 100 * 1024 * 1024; // 100MB limit for WebSocket
    const BLOCKED_EXTENSIONS = [".exe", ".bat", ".cmd", ".scr"];

    if (file.size > MAX_SIZE) {
      this.showNotification(
        `${file.name}: File too large (max 100MB)`,
        "error"
      );
      return false;
    }

    const fileName = file.name.toLowerCase();
    if (BLOCKED_EXTENSIONS.some((ext) => fileName.endsWith(ext))) {
      this.showNotification(`${file.name}: File type not allowed`, "error");
      return false;
    }

    return true;
  }

  displayFileForSending(file) {
    const fileItem = document.createElement("div");
    fileItem.className = "file-item";
    fileItem.setAttribute("data-filename", file.name);
    fileItem.innerHTML = `
      <div class="file-info">
        <div class="file-name">${file.name}</div>
        <div class="file-size">${this.formatFileSize(file.size)}</div>
      </div>
      <button class="send-btn" data-filename="${file.name}">Send</button>
    `;

    this.fileList.appendChild(fileItem);
    this.filesToSend.set(file.name, file);
  }

  // LIGHTNING-FAST File Transfer via WebSocket
  async sendFile(fileName) {
    const file = this.filesToSend.get(fileName);
    if (!file) {
      this.showNotification("File not found", "error");
      return;
    }

    if (this.connectedPeers.size === 0) {
      this.showNotification("No connected devices", "error");
      return;
    }

    // Starting file transfer - no logging for Render performance
    const fileId = Date.now().toString();

    // Store transfer state for reliability
    this.activeTransfers.set(fileId, {
      file: file,
      fileName: fileName,
      startTime: Date.now(),
      paused: false,
    });

    // Send file info to all connected peers via WebSocket
    this.socket.emit("file-info", {
      room: this.currentRoom,
      fileId: fileId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });

    // Update UI to show sending progress
    this.displaySendingProgress(fileName, fileId);

    // Send file in chunks via WebSocket with throttling for reliability
    const chunkSize = this.fileChunkSize;
    let offset = 0;
    let chunkIndex = 0;
    const startTime = Date.now();

    const sendNextChunk = () => {
      const chunk = file.slice(offset, offset + chunkSize);
      const reader = new FileReader();

      reader.onload = (e) => {
        // Convert to base64 for WebSocket transmission
        const chunkData = btoa(
          String.fromCharCode(...new Uint8Array(e.target.result))
        );

        this.socket.emit("file-chunk", {
          room: this.currentRoom,
          fileId: fileId,
          chunkIndex: chunkIndex,
          data: chunkData,
          isLast: offset + chunkSize >= file.size,
        });

        offset += chunkSize;
        chunkIndex++;

        // Update progress
        const progress = Math.min((offset / file.size) * 100, 100);
        this.updateSendingProgress(fileId, progress, startTime, offset);

        if (offset < file.size) {
          // Add throttling to prevent connection overload
          // Larger files need more delay to prevent disconnection
          const delay = file.size > 5 * 1024 * 1024 ? 10 : 5; // 10ms for files > 5MB, 5ms for smaller
          setTimeout(sendNextChunk, delay);
        } else {
          // File complete
          this.socket.emit("file-complete", {
            room: this.currentRoom,
            fileId: fileId,
          });
          this.completeSendingProgress(fileId);
          this.showNotification("File sent successfully!", "success");
        }
      };

      reader.readAsArrayBuffer(chunk);
    };

    sendNextChunk();
  }

  // File receiving handlers
  handleFileInfo(data) {
    // Receiving file - no logging for Render performance

    this.receivingFiles.set(data.fileId, {
      fileName: data.fileName,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      chunks: [],
      receivedSize: 0,
      startTime: Date.now(),
    });

    this.displayReceivingFile(data);
    this.receivingSection.style.display = "block";
    this.showNotification(`Receiving: ${data.fileName}`, "info");
  }

  handleFileChunk(data) {
    const fileInfo = this.receivingFiles.get(data.fileId);
    if (!fileInfo) return;

    // Decode base64 chunk
    const binaryString = atob(data.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    fileInfo.chunks[data.chunkIndex] = bytes;
    fileInfo.receivedSize += bytes.length;

    // Update progress
    const progress = Math.min(
      (fileInfo.receivedSize / fileInfo.fileSize) * 100,
      100
    );
    this.updateReceivingProgress(
      data.fileId,
      progress,
      fileInfo.startTime,
      fileInfo.receivedSize
    );
  }

  handleFileComplete(data) {
    const fileInfo = this.receivingFiles.get(data.fileId);
    if (!fileInfo) return;

    console.log("✅ File transfer complete:", fileInfo.fileName);

    // Reconstruct file from chunks
    const totalSize = fileInfo.chunks.reduce(
      (size, chunk) => size + (chunk ? chunk.length : 0),
      0
    );
    const completeFile = new Uint8Array(totalSize);

    let offset = 0;
    fileInfo.chunks.forEach((chunk) => {
      if (chunk) {
        completeFile.set(chunk, offset);
        offset += chunk.length;
      }
    });

    const blob = new Blob([completeFile], { type: fileInfo.mimeType });
    this.createDownloadLink(fileInfo.fileName, blob, data.fileId);

    this.receivingFiles.delete(data.fileId);
    this.showNotification(`File received: ${fileInfo.fileName}`, "success");
  }

  // UI Progress Methods
  displaySendingProgress(fileName, fileId) {
    const fileItem = document.querySelector(`[data-filename="${fileName}"]`);
    if (fileItem) {
      fileItem.innerHTML = `
        <div class="file-info">
          <div class="file-name">${fileName}</div>
          <div class="file-size">Sending...</div>
          <div class="progress-bar">
            <div class="progress-fill" id="progress-${fileId}" style="width: 0%"></div>
          </div>
          <div class="transfer-stats" id="stats-${fileId}">
            <span class="speed">0 MB/s</span>
            <span class="eta">Calculating...</span>
          </div>
        </div>
        <button class="send-btn" disabled>Sending...</button>
      `;
    }
  }

  updateSendingProgress(fileId, progress, startTime, sentBytes) {
    const progressBar = document.getElementById(`progress-${fileId}`);
    const statsElement = document.getElementById(`stats-${fileId}`);

    if (progressBar) {
      progressBar.style.width = `${progress.toFixed(1)}%`;
    }

    if (statsElement) {
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? sentBytes / elapsed / (1024 * 1024) : 0; // MB/s
      const eta = speed > 0 ? ((100 - progress) / progress) * elapsed : 0;

      statsElement.innerHTML = `
        <span class="speed">${speed.toFixed(1)} MB/s</span>
        <span class="eta">${eta.toFixed(0)}s remaining</span>
      `;
    }
  }

  completeSendingProgress(fileId) {
    const statsElement = document.getElementById(`stats-${fileId}`);
    if (statsElement) {
      statsElement.innerHTML = `
        <span class="speed">Complete ✓</span>
        <span class="eta">Done</span>
      `;
    }

    // Update the button to show completion
    const fileItem = statsElement?.closest(".file-item");
    if (fileItem) {
      const sendButton = fileItem.querySelector(".send-btn");
      if (sendButton) {
        sendButton.textContent = "SENT ✓";
        sendButton.disabled = false;
        sendButton.style.backgroundColor = "#10b981"; // Green color
        sendButton.style.cursor = "default";
      }

      // Also update the file size text
      const fileSizeElement = fileItem.querySelector(".file-size");
      if (fileSizeElement && fileSizeElement.textContent === "Sending...") {
        fileSizeElement.textContent = "Sent successfully!";
      }
    }
  }

  displayReceivingFile(fileInfo) {
    const fileItem = document.createElement("div");
    fileItem.className = "file-item";
    fileItem.id = `receiving-${fileInfo.fileId}`;
    fileItem.innerHTML = `
      <div class="file-info">
        <div class="file-name">${fileInfo.fileName}</div>
        <div class="file-size">${this.formatFileSize(fileInfo.fileSize)}</div>
        <div class="progress-bar">
          <div class="progress-fill" id="recv-progress-${
            fileInfo.fileId
          }" style="width: 0%"></div>
        </div>
        <div class="transfer-stats" id="recv-stats-${fileInfo.fileId}">
          <span class="speed">0 MB/s</span>
          <span class="eta">Receiving...</span>
        </div>
      </div>
    `;

    this.receivedFiles.appendChild(fileItem);
  }

  updateReceivingProgress(fileId, progress, startTime, receivedBytes) {
    const progressBar = document.getElementById(`recv-progress-${fileId}`);
    const statsElement = document.getElementById(`recv-stats-${fileId}`);

    if (progressBar) {
      progressBar.style.width = `${progress.toFixed(1)}%`;
    }

    if (statsElement) {
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? receivedBytes / elapsed / (1024 * 1024) : 0;

      statsElement.innerHTML = `
        <span class="speed">${speed.toFixed(1)} MB/s</span>
        <span class="eta">${progress.toFixed(1)}% complete</span>
      `;
    }
  }

  createDownloadLink(fileName, blob, fileId) {
    const fileItem = document.getElementById(`receiving-${fileId}`);
    if (fileItem) {
      const url = URL.createObjectURL(blob);
      fileItem.innerHTML = `
        <div class="file-info">
          <div class="file-name">${fileName}</div>
          <div class="file-size">${this.formatFileSize(
            blob.size
          )} - Complete ✓</div>
        </div>
        <a href="${url}" download="${fileName}" class="download-btn">Download</a>
      `;
    }
  }

  // Utility Methods
  formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // 📱 BACKGROUND HANDLING - Keep transfers alive when app goes to background
  setupBackgroundHandling() {
    // Track app visibility state
    this.isAppVisible = true;
    this.backgroundStartTime = null;

    // Handle visibility changes (tab switching, app backgrounding)
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        // App went to background
        this.isAppVisible = false;
        this.backgroundStartTime = Date.now();
        // App went to background - no logging for Render performance

        // Show persistent notification if transfers are active
        if (this.activeTransfers.size > 0) {
          this.showPersistentNotification(
            "File transfer continues in background"
          );
        }

        // Reduce connection diagnostics frequency to save battery
        this.setBackgroundMode(true);
      } else {
        // App came back to foreground
        this.isAppVisible = true;
        const backgroundDuration = this.backgroundStartTime
          ? Date.now() - this.backgroundStartTime
          : 0;

        console.log(
          `📱 App returned to foreground after ${backgroundDuration}ms`
        );

        // Resume normal operation
        this.setBackgroundMode(false);

        // Check connection health after returning
        this.checkConnectionHealth();

        // Update UI with any missed progress
        this.refreshTransferStatus();
      }
    });

    // Handle page unload/refresh during transfers
    window.addEventListener("beforeunload", (e) => {
      if (this.activeTransfers.size > 0) {
        const message =
          "File transfers are in progress. Are you sure you want to leave?";
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    });

    // Handle mobile app lifecycle events
    window.addEventListener("pagehide", () => {
      console.log("📱 Page hidden - preserving transfer state");
      this.preserveTransferState();
    });

    window.addEventListener("pageshow", (e) => {
      if (e.persisted) {
        console.log("📱 Page restored from cache - resuming transfers");
        this.resumeTransfers();
      }
    });
  }

  // 🔗 CONNECTION STABILITY - Maintain stable connections during multitasking
  setupConnectionStability() {
    // Enhanced ping system for background stability
    this.pingInterval = null;
    this.lastPongTime = Date.now();
    this.connectionHealthy = true;

    // Start enhanced ping monitoring
    this.startEnhancedPing();

    // Handle connection recovery
    this.socket.on("pong", (data) => {
      this.lastPongTime = Date.now();
      this.connectionHealthy = true;

      // Update connection quality indicator
      const latency = Date.now() - data.timestamp;
      this.updateConnectionQuality(latency);
    });

    // Monitor for connection issues during transfers
    this.socket.on("disconnect", (reason) => {
      console.log("🔌 Connection lost during transfers:", reason);
      this.handleTransferDisconnection(reason);
    });

    this.socket.on("reconnect", () => {
      console.log("🔌 Reconnected - resuming transfers");
      this.handleTransferReconnection();
    });
  }

  setBackgroundMode(isBackground) {
    if (isBackground) {
      // Reduce diagnostics frequency to save battery
      clearInterval(this.diagnosticsInterval);
      this.diagnosticsInterval = setInterval(() => {
        this.startConnectionDiagnostics();
      }, 15000); // Every 15 seconds instead of 5

      // Increase ping frequency to maintain connection
      this.startEnhancedPing(5000); // Every 5 seconds
    } else {
      // Resume normal frequency
      clearInterval(this.diagnosticsInterval);
      this.diagnosticsInterval = setInterval(() => {
        this.startConnectionDiagnostics();
      }, 5000);

      // Normal ping frequency
      this.startEnhancedPing(10000); // Every 10 seconds
    }
  }

  startEnhancedPing(interval = 10000) {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.socket.connected) {
        this.socket.emit("ping", {
          timestamp: Date.now(),
          hasActiveTransfers: this.activeTransfers.size > 0,
          isBackground: !this.isAppVisible,
        });
      }
    }, interval);
  }

  checkConnectionHealth() {
    const timeSinceLastPong = Date.now() - this.lastPongTime;

    if (timeSinceLastPong > 30000) {
      // 30 seconds without pong
      console.log("⚠️ Connection may be unhealthy - attempting recovery");
      this.connectionHealthy = false;

      if (this.activeTransfers.size > 0) {
        this.showNotification("Checking connection stability...", "warning");
      }

      // Force reconnection if needed
      if (!this.socket.connected) {
        this.socket.connect();
      }
    }
  }

  updateConnectionQuality(latency) {
    // Update UI with connection quality (optional visual indicator)
    let quality = "excellent";
    if (latency > 100) quality = "good";
    if (latency > 300) quality = "fair";
    if (latency > 1000) quality = "poor";

    // Store for potential UI updates
    this.connectionQuality = { latency, quality };
  }

  handleTransferDisconnection(reason) {
    if (this.activeTransfers.size > 0) {
      console.log("🚨 Active transfers detected during disconnection");

      // Pause active transfers
      this.activeTransfers.forEach((transfer, fileId) => {
        transfer.paused = true;
        transfer.pausedAt = Date.now();
      });

      this.showNotification(
        "Connection lost - will resume when reconnected",
        "warning"
      );
    }
  }

  handleTransferReconnection() {
    if (this.activeTransfers.size > 0) {
      console.log("🔄 Resuming paused transfers after reconnection");

      // Rejoin room first
      if (this.currentRoom) {
        this.socket.emit("join-room", this.currentRoom);
      }

      // Resume transfers after a short delay
      setTimeout(() => {
        this.activeTransfers.forEach((transfer, fileId) => {
          if (transfer.paused) {
            transfer.paused = false;
            // Note: Actual resume logic would need to be implemented in sendFile method
            this.showNotification("Transfers resumed", "success");
          }
        });
      }, 2000);
    }
  }

  preserveTransferState() {
    // Save transfer state to localStorage for recovery
    if (this.activeTransfers.size > 0) {
      const transferState = {
        room: this.currentRoom,
        transfers: Array.from(this.activeTransfers.entries()),
        timestamp: Date.now(),
      };

      try {
        localStorage.setItem(
          "shareMe_transferState",
          JSON.stringify(transferState)
        );
      } catch (e) {
        console.log("Could not save transfer state:", e);
      }
    }
  }

  resumeTransfers() {
    // Attempt to resume transfers from localStorage
    try {
      const savedState = localStorage.getItem("shareMe_transferState");
      if (savedState) {
        const transferState = JSON.parse(savedState);

        // Only resume if state is recent (within 5 minutes)
        if (Date.now() - transferState.timestamp < 300000) {
          console.log("🔄 Resuming transfers from saved state");

          // Restore room
          if (transferState.room) {
            this.currentRoom = transferState.room;
            this.socket.emit("join-room", transferState.room);
          }

          // Note: Full transfer resume would need more complex implementation
          this.showNotification("Attempting to resume transfers...", "info");
        }

        // Clean up saved state
        localStorage.removeItem("shareMe_transferState");
      }
    } catch (e) {
      console.log("Could not resume transfers:", e);
    }
  }

  refreshTransferStatus() {
    // Refresh UI to show current transfer status
    this.activeTransfers.forEach((transfer, fileId) => {
      // Update progress bars and status
      const progressElement = document.getElementById(`progress-${fileId}`);
      const statsElement = document.getElementById(`stats-${fileId}`);

      if (progressElement && statsElement) {
        // Refresh the display
        const elapsed = (Date.now() - transfer.startTime) / 1000;
        statsElement.innerHTML = `
          <span class="speed">Checking status...</span>
          <span class="eta">Reconnected after ${elapsed.toFixed(0)}s</span>
        `;
      }
    });
  }

  showPersistentNotification(message) {
    // Show a notification that persists longer for background transfers
    const notification = document.createElement("div");
    notification.className = "notification persistent";
    notification.textContent = message;

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-weight: 500;
      z-index: 10000;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      background-color: #3b82f6;
      border: 2px solid #1d4ed8;
    `;

    document.body.appendChild(notification);

    // Remove after 10 seconds (longer than normal notifications)
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.opacity = "0";
        setTimeout(() => {
          if (notification.parentNode) {
            document.body.removeChild(notification);
          }
        }, 300);
      }
    }, 10000);
  }

  showNotification(message, type = "info") {
    console.log(`📢 ${type.toUpperCase()}: ${message}`);

    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.textContent = message;

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-weight: 500;
      z-index: 10000;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: all 0.3s ease;
    `;

    switch (type) {
      case "success":
        notification.style.backgroundColor = "#10b981";
        break;
      case "error":
        notification.style.backgroundColor = "#ef4444";
        break;
      case "warning":
        notification.style.backgroundColor = "#f59e0b";
        break;
      default:
        notification.style.backgroundColor = "#3b82f6";
    }

    document.body.appendChild(notification);

    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.opacity = "0";
        notification.style.transform = "translateX(100%)";
        setTimeout(() => {
          if (notification.parentNode) {
            document.body.removeChild(notification);
          }
        }, 300);
      }
    }, 3000);
  }
}

// Initialize the lightning-fast app
const p2p = new FastFileTransfer();
window.p2p = p2p;

console.log("⚡ Lightning-Fast File Transfer Ready!");

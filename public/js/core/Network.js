export class Network {
  constructor(app) {
    this.app = app;
    this.socket = io({
      transports: ["websocket", "polling"],
      timeout: 10000,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      forceNew: false,
      upgrade: true,
      maxHttpBufferSize: 1e8,
    });
    this.setupSocketListeners();
    this.setupConnectionStability();
    this.startConnectionDiagnostics();
    this.checkUrlForRoom();
  }

  setupSocketListeners() {
    this.socket.on("connect", () => {
      this.app.ui.showNotification("Connected to server", "success");
    });

    this.socket.on("disconnect", (reason) => {
      this.app.ui.showNotification(`Disconnected: ${reason}`, "error");
      this.app.state.connectedPeers.clear();
      this.app.ui.updateUsersList();
      this.handleTransferDisconnection(reason);
    });

    this.socket.on("reconnect", (attemptNumber) => {
      this.app.ui.showNotification(`Reconnected after ${attemptNumber} attempts`, "success");
      if (this.app.state.currentRoom) {
        this.socket.emit("join-room", this.app.state.currentRoom);
      }
    });

    this.socket.on("users-in-room", (users) => {
      if (this.app.state.joinTimeout) { 
        clearTimeout(this.app.state.joinTimeout); 
        this.app.state.joinTimeout = null; 
      }

      if (this.app.state.pendingRoom) {
        this.app.state.currentRoom = this.app.state.pendingRoom;
        this.app.state.pendingRoom = null;
        
        this.app.ui.showRoomScreen(this.app.state.currentRoom);
        this.app.ui.showNotification(`Joined room: ${this.app.state.currentRoom}`, "success");
        this.app.qrScanner.generateQRCode(this.app.state.currentRoom);
      }

      this.app.state.connectedPeers = new Set(users);
      this.app.ui.updateUsersList();
      if (users.length > 0) {
        this.app.ui.showNotification(`Connected to ${users.length} device(s)`, "success");
      }
    });

    this.socket.on("user-joined", (userId) => {
      this.app.state.connectedPeers.add(userId);
      this.app.ui.updateUsersList();
      this.initiateWebRTCConnection(userId);
    });

    this.socket.on("user-left", (userId) => {
      this.app.state.connectedPeers.delete(userId);
      this.app.ui.updateUsersList();
      
      const pc = this.app.state.peerConnections?.get(userId);
      if (pc) {
        pc.close();
        this.app.state.peerConnections.delete(userId);
        this.app.state.dataChannels?.delete(userId);
      }
    });

    // 🚀 WebRTC Signaling Handlers
    this.socket.on("webrtc-offer", async (data) => {
      await this.handleWebRTCOffer(data.sender, data.offer);
    });

    this.socket.on("webrtc-answer", async (data) => {
      await this.handleWebRTCAnswer(data.sender, data.answer);
    });

    this.socket.on("webrtc-ice", (data) => {
      this.handleWebRTCICECandidate(data.sender, data.candidate);
    });

    this.socket.on("room-error", (msg) => {
      this.app.ui.showNotification(msg, "error");
      this.app.ui.joinRoomBtn.disabled = false;
      this.app.ui.joinRoomBtn.textContent = "Join Room";
    });

    this.socket.on("file-info", (data) => this.app.fileTransfer.handleFileInfo(data));
    this.socket.on("file-chunk", (data) => this.app.fileTransfer.handleFileChunk(data));
    this.socket.on("request-resume", (data) => this.app.fileTransfer.handleResumeRequest(data));
    this.socket.on("file-complete", (data) => {
      this.app.fileTransfer.handleFileComplete(data.fileId);
    });

    this.socket.on("pong-response", () => {
      const latency = Date.now() - this.app.state.lastPing;
      this.app.ui.updateConnectionQuality(latency);
    });
  }

  generateRoom() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let roomCode = "";
    for (let i = 0; i < 6; i++) {
      roomCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.app.ui.roomInput.value = roomCode;
    this.joinRoom();
  }

  joinRoom() {
    const room = this.app.ui.roomInput.value.trim().toUpperCase();
    if (!room) {
      this.app.ui.showNotification("Please enter a room code", "error");
      return;
    }

    this.app.ui.joinRoomBtn.disabled = true;
    this.app.ui.joinRoomBtn.textContent = "Connecting...";
    this.app.state.pendingRoom = room;

    if (this.app.state.joinTimeout) clearTimeout(this.app.state.joinTimeout);
    this.app.state.joinTimeout = setTimeout(() => {
      if (this.app.state.pendingRoom) {
        this.app.ui.showNotification("Server is starting up (Render free tier), retrying...", "warning");
        this.socket.emit("join-room", room);
      }
    }, 8000);

    this.socket.emit("join-room", room);
  }

  leaveRoom() {
    this.socket.emit("leave-room", this.app.state.currentRoom);
    this.app.state.currentRoom = null;
  }

  checkUrlForRoom() {
    const params = new URLSearchParams(window.location.search);
    const roomCode = (params.get("room") || "").trim().toUpperCase();
    if (roomCode.length === 6) {
      this.app.ui.roomInput.value = roomCode;
      setTimeout(() => this.joinRoom(), 600);
    }
  }

  setupConnectionStability() {
    setInterval(() => {
      if (this.socket.connected && this.app.state.currentRoom) {
        this.app.state.lastPing = Date.now();
        this.socket.emit("ping-request");
      }
    }, 5000);
  }

  startConnectionDiagnostics() {
    setInterval(() => {
      if (!this.socket.connected && this.app.state.currentRoom) {
        this.socket.connect();
      }
    }, 30000);
  }

  handleTransferDisconnection(reason) {
    if (this.app.state.activeTransfers.size > 0) {
      this.app.state.activeTransfers.forEach((transfer) => {
        transfer.paused = true;
      });
    }
  }

  // 🚀 WebRTC Implementation
  createPeerConnection(userId) {
    if (!this.app.state.peerConnections) {
      this.app.state.peerConnections = new Map();
      this.app.state.dataChannels = new Map();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit("webrtc-ice", { target: userId, candidate: event.candidate });
      }
    };

    pc.ondatachannel = (event) => {
      const receiveChannel = event.channel;
      receiveChannel.binaryType = "arraybuffer";
      
      receiveChannel.onopen = () => {
        console.log(`WebRTC Data Channel open with ${userId}`);
        this.app.state.dataChannels.set(userId, receiveChannel);
      };

      receiveChannel.onmessage = async (e) => {
        if (typeof e.data === "string") {
          try {
            const data = JSON.parse(e.data);
            if (data.type === "file-chunk") {
               this.app.fileTransfer.handleFileChunk(data);
            } else if (data.type === "file-info") {
               this.app.fileTransfer.handleFileInfo(data);
            } else if (data.type === "request-resume") {
               this.app.fileTransfer.handleResumeRequest(data);
            } else if (data.type === "file-complete") {
               this.app.fileTransfer.handleFileComplete(data.fileId);
            }
          } catch (err) {
            console.error("Failed to parse DataChannel JSON", err);
          }
        }
      };

      receiveChannel.onclose = () => {
        this.app.state.dataChannels.delete(userId);
      };
    };

    this.app.state.peerConnections.set(userId, pc);
    return pc;
  }

  async initiateWebRTCConnection(userId) {
    const pc = this.createPeerConnection(userId);
    
    // Create data channel
    const sendChannel = pc.createDataChannel("fileTransfer");
    sendChannel.onopen = () => {
      console.log(`WebRTC Data Channel open with ${userId} (initiator)`);
      this.app.state.dataChannels.set(userId, sendChannel);
    };
    sendChannel.onclose = () => this.app.state.dataChannels.delete(userId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socket.emit("webrtc-offer", { target: userId, offer });
  }

  async handleWebRTCOffer(userId, offer) {
    let pc = this.app.state.peerConnections?.get(userId);
    if (!pc) pc = this.createPeerConnection(userId);
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socket.emit("webrtc-answer", { target: userId, answer });
  }

  async handleWebRTCAnswer(userId, answer) {
    const pc = this.app.state.peerConnections?.get(userId);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  handleWebRTCICECandidate(userId, candidate) {
    const pc = this.app.state.peerConnections?.get(userId);
    if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
  }
}

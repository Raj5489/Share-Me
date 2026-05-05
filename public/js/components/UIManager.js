import { getAnimalName, formatFileSize } from '../utils.js';

export class UIManager {
  constructor(app) {
    this.app = app;
    this.wakeLock = null;
    this.initializeElements();
    this.setupEventListeners();
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
    this.generateRoomBtn.addEventListener("click", () => this.app.network.generateRoom());
    this.joinRoomBtn.addEventListener("click", () => this.app.network.joinRoom());
    this.copyCodeBtn.addEventListener("click", () => this.copyRoomCode());
    this.backBtn.addEventListener("click", () => this.goBack());

    this.roomInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.app.network.joinRoom();
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
      this.app.fileTransfer.handleFiles(e.dataTransfer.files);
    });

    this.fileInput.addEventListener("change", (e) => {
      this.app.fileTransfer.handleFiles(e.target.files);
    });

    const folderSelectBtn = document.getElementById("folder-select-btn");
    if (folderSelectBtn) {
      folderSelectBtn.addEventListener("click", () => this.app.fileTransfer.selectFolder());
    }

    // Event delegation: send btn + remove btn
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("send-btn") && e.target.dataset.filename) {
        e.preventDefault();
        this.app.fileTransfer.sendFile(e.target.dataset.filename);
      }
      if (e.target.classList.contains("remove-btn") && e.target.dataset.remove) {
        e.preventDefault();
        this.app.fileTransfer.removeFileFromQueue(e.target.dataset.remove);
      }
    });

    // 📋 Paste to Send
    document.addEventListener("paste", (e) => {
      // Only process paste if we are in a room
      if (!this.app.state.currentRoom) return;
      
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      const files = [];
      for (let index in items) {
        const item = items[index];
        if (item.kind === 'file') {
          const blob = item.getAsFile();
          // Give a unique name if it's an unnamed image (like a screenshot)
          let fileName = blob.name;
          if (fileName === "image.png") {
             fileName = `screenshot_${Date.now()}.png`;
             // Create a new File object with the proper name
             files.push(new File([blob], fileName, { type: blob.type }));
          } else {
             files.push(blob);
          }
        }
      }

      if (files.length > 0) {
        this.app.fileTransfer.handleFiles(files);
      }
    });
  }

  showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <div class="notification-icon">${
        type === "success" ? "✓" : type === "error" ? "❌" : "ℹ"
      }</div>
      <div class="notification-message">${message}</div>
    `;

    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add("show"), 10);
    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  showRoomScreen(roomCode) {
    this.connectionScreen.style.display = "none";
    this.roomScreen.style.display = "block";
    this.backBtn.style.display = "block";
    this.currentRoomSpan.textContent = roomCode;
    this.joinRoomBtn.disabled = false;
    this.joinRoomBtn.textContent = "Join Room";
  }

  goBack() {
    if (this.app.state.currentRoom) {
      this.app.network.leaveRoom();
    }

    this.app.state.connectedPeers.clear();
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
    this.app.state.filesToSend.clear();
    this.app.state.receivingFiles.clear();
    this.app.state.activeTransfers.clear();
    this.app.state.completedFiles.clear();

    // Reset QR code and quality dot
    const qrEl = document.getElementById("qr-code");
    if (qrEl) qrEl.innerHTML = "";
    const qrContainer = document.getElementById("qr-container");
    if (qrContainer) qrContainer.style.display = "none";
    const toggleQrBtn = document.getElementById("toggle-qr-btn");
    if (toggleQrBtn) toggleQrBtn.textContent = "📷 QR Code";
    const dot = document.getElementById("quality-dot");
    if (dot) dot.className = "quality-dot";
    const qualityText = document.getElementById("quality-text");
    if (qualityText) qualityText.textContent = "--";
 
    const sendAllBtn = document.getElementById("send-all-btn");
    if (sendAllBtn) sendAllBtn.remove();
    const downloadAllBtn = document.getElementById("download-all-btn");
    if (downloadAllBtn) downloadAllBtn.remove();
  }

  copyRoomCode() {
    const code = this.app.state.currentRoom;
    if (!code) return;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code)
        .then(() => this.showNotification("Room code copied!", "success"))
        .catch(() => this.fallbackCopyTextToClipboard(code));
    } else {
      this.fallbackCopyTextToClipboard(code);
    }
  }

  fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    this.showNotification("Room code copied!", "success");
  }

  updateUsersList() {
    this.usersList.innerHTML = "";
    if (this.app.state.connectedPeers.size === 0) {
      this.usersList.innerHTML = `
        <div class="no-users">
          <p>No other devices connected</p>
          <p class="help-text">Share the room code with other devices</p>
        </div>
      `;
    } else {
      this.app.state.connectedPeers.forEach((userId) => {
        const animalName = getAnimalName(userId);
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

  updateConnectionQuality(latency) {
    let quality = "excellent";
    if (latency > 100) quality = "good";
    if (latency > 300) quality = "fair";
    if (latency > 1000) quality = "poor";

    const dot = document.getElementById("quality-dot");
    const text = document.getElementById("quality-text");
    if (dot) dot.className = `quality-dot ${quality}`;
    if (text) {
      const labels = { excellent: "Excellent", good: "Good", fair: "Fair", poor: "Poor" };
      text.textContent = `${labels[quality]} (${latency}ms)`;
    }
  }

  // 🔋 Wake Lock Implementation
  async requestWakeLock() {
    if (this.wakeLock) return;
    
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('Screen Wake Lock is active 🔋');
        
        this.wakeLock.addEventListener('release', () => {
          console.log('Screen Wake Lock was released');
          this.wakeLock = null;
        });
      }
    } catch (err) {
      console.warn(`Wake Lock Error: ${err.name}, ${err.message}`);
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }
}

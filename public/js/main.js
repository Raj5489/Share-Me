import { UIManager } from './components/UIManager.js';
import { FileUI } from './components/FileUI.js';
import { Network } from './core/Network.js';
import { FileTransfer } from './core/FileTransfer.js';
import { QRScanner } from './core/QRScanner.js';
import { createRipple } from './utils.js';

class App {
  constructor() {
    this.state = {
      currentRoom: null,
      pendingRoom: null,
      joinTimeout: null,
      connectedPeers: new Set(),
      filesToSend: new Map(),
      receivingFiles: new Map(),
      activeTransfers: new Map(),
      completedFiles: new Map(),
      lastPing: Date.now()
    };

    // Initialize modules in correct dependency order
    this.ui = new UIManager(this);
    this.fileUI = new FileUI(this);
    this.fileTransfer = new FileTransfer(this);
    this.network = new Network(this);
    this.qrScanner = new QRScanner(this);

    this.setupRippleEffect();
    this.setupBackgroundHandling();
  }

  setupRippleEffect() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (btn && !btn.disabled && !btn.classList.contains("remove-btn")) {
        createRipple(e, btn);
      }
    });
  }

  setupBackgroundHandling() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (!this.network.socket.connected && this.state.currentRoom) {
          this.ui.showNotification("Reconnecting to room...", "info");
          this.network.socket.connect();
        }
      }
    });
  }
}

// Initialize App when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.shareApp = new App();

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('PWA Service Worker registered!', reg.scope))
      .catch(err => console.error('PWA Service Worker failed:', err));
  }
});

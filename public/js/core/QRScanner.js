export class QRScanner {
  constructor(app) {
    this.app = app;
    this.html5Qrcode = null;
    this.setupEventListeners();
  }

  setupEventListeners() {
    const toggleQrBtn = document.getElementById("toggle-qr-btn");
    if (toggleQrBtn) {
      toggleQrBtn.addEventListener("click", () => {
        const qrContainer = document.getElementById("qr-container");
        if (!qrContainer) return;
        const isHidden = qrContainer.style.display === "none";
        qrContainer.style.display = isHidden ? "flex" : "none";
        toggleQrBtn.textContent = isHidden ? "🙈 Hide QR" : "📷 QR Code";
      });
    }

    const scanQrBtn = document.getElementById("scan-qr-btn");
    if (scanQrBtn) {
      scanQrBtn.addEventListener("click", () => this.startQRScanner());
    }

    const closeScannerBtn = document.getElementById("close-scanner-btn");
    if (closeScannerBtn) {
      closeScannerBtn.addEventListener("click", () => this.stopQRScanner());
    }
  }

  generateQRCode(roomCode) {
    const qrEl = document.getElementById("qr-code");
    if (!qrEl || typeof QRCode === "undefined") return;

    qrEl.innerHTML = "";
    const roomUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;

    new QRCode(qrEl, {
      text: roomUrl,
      width: 160,
      height: 160,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  startQRScanner() {
    if (typeof Html5Qrcode === "undefined") {
      this.app.ui.showNotification("Scanner library loading...", "info");
      return;
    }

    const container = document.getElementById("reader-container");
    container.style.display = "block";

    this.html5Qrcode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    this.html5Qrcode.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        this.stopQRScanner();
        try {
          const url = new URL(decodedText);
          const roomCode = url.searchParams.get("room");
          if (roomCode) {
            this.app.ui.roomInput.value = roomCode;
            this.app.network.joinRoom();
          } else {
            this.app.ui.showNotification("Invalid QR Code (No room found)", "error");
          }
        } catch (e) {
          if (decodedText.length === 6) {
            this.app.ui.roomInput.value = decodedText;
            this.app.network.joinRoom();
          } else {
            this.app.ui.showNotification("Invalid QR format", "error");
          }
        }
      },
      (errorMessage) => { }
    ).catch((err) => {
      this.app.ui.showNotification("Live camera blocked. Use the fallback button to snap a photo.", "warning");
      
      const readerDiv = document.getElementById("reader");
      readerDiv.innerHTML = `
        <div style="padding: 20px; text-align: center; color: white;">
          <p style="margin-bottom: 15px; font-size: 0.9rem; color: #fbbf24;">Live camera requires HTTPS. Click below to snap a picture of the QR code instead.</p>
          <label class="primary-btn" style="display: inline-block; cursor: pointer;">
            📸 Take QR Photo
            <input type="file" id="qr-fallback-input" accept="image/*" capture="environment" style="display: none;" />
          </label>
        </div>
      `;

      const fallbackInput = document.getElementById("qr-fallback-input");
      if (fallbackInput) {
        fallbackInput.addEventListener("change", (e) => {
          if (e.target.files && e.target.files.length > 0) {
            this.app.ui.showNotification("Analyzing QR code...", "info");
            this.html5Qrcode.scanFile(e.target.files[0], true)
              .then(decodedText => {
                this.stopQRScanner();
                try {
                  const url = new URL(decodedText);
                  const roomCode = url.searchParams.get("room");
                  if (roomCode) {
                    this.app.ui.roomInput.value = roomCode;
                    this.app.network.joinRoom();
                  } else {
                    this.app.ui.showNotification("Invalid QR Code", "error");
                  }
                } catch (e) {
                  if (decodedText.length === 6) {
                    this.app.ui.roomInput.value = decodedText;
                    this.app.network.joinRoom();
                  } else {
                    this.app.ui.showNotification("Invalid QR format", "error");
                  }
                }
              })
              .catch(err => {
                this.app.ui.showNotification("Could not find a QR code in the image. Try again.", "error");
              });
          }
        });
      }
    });
  }

  stopQRScanner() {
    const container = document.getElementById("reader-container");
    if (container) container.style.display = "none";

    if (this.html5Qrcode) {
      this.html5Qrcode.stop().then(() => {
        this.html5Qrcode.clear();
        this.html5Qrcode = null;
      }).catch(err => console.error("Failed to stop scanner", err));
    }
  }
}

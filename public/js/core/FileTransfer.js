export class FileTransfer {
  constructor(app) {
    this.app = app;
    // 8KB chunks for maximum mobile compatibility (iOS Safari limit)
    this.fileChunkSize = 8192;
  }

  // ─── File Queue ───────────────────────────────────────────────────────────

  handleFiles(files) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      if (this.validateFile(file)) {
        this.app.fileUI.displayFileForSending(file);
      }
    });
    if (files.length > 0) {
      this.app.ui.sendingSection.style.display = "block";
      this.app.ui.showNotification(`${files.length} file(s) ready to send`, "success");
      this.app.fileUI.updateSendAllButton();
    }
  }

  selectFolder() {
    const folderInput = document.createElement("input");
    folderInput.type = "file";
    folderInput.webkitdirectory = true;
    folderInput.multiple = true;
    folderInput.style.display = "none";
    folderInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) this.handleFiles(e.target.files);
      document.body.removeChild(folderInput);
    });
    document.body.appendChild(folderInput);
    folderInput.click();
  }

  validateFile(file) {
    const BLOCKED = [".exe", ".bat", ".cmd", ".scr"];
    if (BLOCKED.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      this.app.ui.showNotification(`${file.name}: File type not allowed`, "error");
      return false;
    }
    return true;
  }

  removeFileFromQueue(fileName) {
    this.app.state.filesToSend.delete(fileName);
    const item = document.querySelector(`[data-filename="${fileName}"]`);
    if (item) item.remove();
    if (this.app.state.filesToSend.size === 0) {
      this.app.ui.sendingSection.style.display = "none";
      const btn = document.getElementById("send-all-btn");
      if (btn) btn.remove();
    } else {
      this.app.fileUI.updateSendAllButton();
    }
  }

  sendAllFiles() {
    if (this.app.state.connectedPeers.size === 0) {
      this.app.ui.showNotification("No connected devices", "error");
      return;
    }
    const fileNames = Array.from(this.app.state.filesToSend.keys());
    if (fileNames.length === 0) return;
    const btn = document.getElementById("send-all-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = `📤 Sending ${fileNames.length} file(s)...`;
    }
    this.app.ui.showNotification(`Sending ${fileNames.length} file(s)...`, "info");
    fileNames.forEach((fn) => this.sendFile(fn));
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = `✅ All Sent!`;
      }
    }, 2000);
  }

  // ─── Send ────────────────────────────────────────────────────────────────

  sendToPeers(messageType, data) {
    const jsonStr = JSON.stringify({ type: messageType, ...data });
    let sentViaWebRTC = false;

    // Metadata always goes through Socket.IO for guaranteed delivery
    const isMetadata = ["file-info", "file-complete", "request-resume"].includes(messageType);

    if (!isMetadata && this.app.state.dataChannels && this.app.state.dataChannels.size > 0) {
      this.app.state.dataChannels.forEach((channel) => {
        if (channel.readyState === "open") {
          try {
            channel.send(jsonStr);
            sentViaWebRTC = true;
          } catch (e) {
            console.warn("WebRTC send failed, using Socket.IO fallback", e);
            channel.close();
          }
        }
      });
    }

    if (!sentViaWebRTC || isMetadata) {
      this.app.network.socket.emit(messageType, data);
    }
  }

  async sendFile(fileName) {
    const file = this.app.state.filesToSend.get(fileName);
    if (!file) return;
    if (this.app.state.connectedPeers.size === 0) {
      this.app.ui.showNotification("No connected devices", "error");
      return;
    }

    const fileId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    const totalChunks = Math.ceil(file.size / this.fileChunkSize);

    const transfer = { file, fileName, startTime: Date.now(), paused: false, offset: 0, chunkIndex: 0 };
    this.app.state.activeTransfers.set(fileId, transfer);
    this.checkWakeLockStatus();

    // Send metadata first via Socket.IO
    this.sendToPeers("file-info", {
      room: this.app.state.currentRoom,
      fileId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      totalChunks,
    });

    this.app.fileUI.displaySendingProgress(fileName, fileId);

    transfer.sendNextChunk = () => {
      if (transfer.paused || !this.app.state.activeTransfers.has(fileId)) return;

      const chunk = file.slice(transfer.offset, transfer.offset + this.fileChunkSize);
      const reader = new FileReader();

      reader.onload = (e) => {
        const bytes = new Uint8Array(e.target.result);
        // Encode to base64 in batches to avoid call stack overflow
        let binary = "";
        const BATCH = 8192;
        for (let i = 0; i < bytes.length; i += BATCH) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BATCH));
        }

        this.sendToPeers("file-chunk", {
          room: this.app.state.currentRoom,
          fileId,
          chunkIndex: transfer.chunkIndex,
          data: btoa(binary),
        });

        transfer.offset += this.fileChunkSize;
        transfer.chunkIndex++;

        const progress = Math.min((transfer.offset / file.size) * 100, 100);
        this.app.fileUI.updateSendingProgress(fileId, progress, transfer.startTime, transfer.offset);

        if (transfer.offset < file.size) {
          // Backpressure: slow down if buffer is filling up
          let maxBuffered = 0;
          if (this.app.state.dataChannels) {
            this.app.state.dataChannels.forEach((c) => {
              if (c.readyState === "open" && c.bufferedAmount > maxBuffered) {
                maxBuffered = c.bufferedAmount;
              }
            });
          }
          const delay = maxBuffered > 1024 * 1024 ? 50 : 2;
          transfer.timer = setTimeout(transfer.sendNextChunk, delay);
        } else {
          // File fully sent — notify receiver
          this.sendToPeers("file-complete", {
            room: this.app.state.currentRoom,
            fileId,
          });
          this.app.fileUI.completeSendingProgress(fileId);
          this.app.ui.showNotification("File sent successfully!", "success");
          this.app.state.activeTransfers.delete(fileId);
          this.checkWakeLockStatus();
        }
      };

      reader.onerror = () => {
        this.app.ui.showNotification(`Failed to read ${file.name}`, "error");
        this.app.state.activeTransfers.delete(fileId);
        this.checkWakeLockStatus();
      };

      reader.readAsArrayBuffer(chunk);
    };

    // 200ms head start for metadata to arrive before chunks begin
    setTimeout(() => transfer.sendNextChunk(), 200);
  }

  handleResumeRequest(data) {
    const transfer = this.app.state.activeTransfers.get(data.fileId);
    if (!transfer) return;
    this.app.ui.showNotification(`Recovering transfer for ${transfer.fileName}...`, "info");
    if (transfer.timer) clearTimeout(transfer.timer);
    transfer.chunkIndex = data.nextExpectedChunkIndex;
    transfer.offset = transfer.chunkIndex * this.fileChunkSize;
    transfer.paused = false;
    transfer.sendNextChunk();
  }

  // ─── Receive ─────────────────────────────────────────────────────────────

  handleFileInfo(data) {
    // Simple, reliable memory-based receiver (works on ALL browsers)
    const fileInfo = {
      fileName: data.fileName,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      totalChunks: data.totalChunks || null,
      chunks: [],           // Indexed by chunkIndex for correct ordering
      receivedChunks: 0,
      receivedSize: 0,
      isComplete: false,
      startTime: Date.now(),
    };

    this.app.state.receivingFiles.set(data.fileId, fileInfo);
    this.app.fileUI.displayReceivingFile(data);
    this.app.ui.receivingSection.style.display = "block";
    this.app.ui.showNotification(`Receiving: ${data.fileName}`, "info");
    this.checkWakeLockStatus();
  }

  handleFileChunk(data) {
    const fileInfo = this.app.state.receivingFiles.get(data.fileId);
    if (!fileInfo) return;

    // Decode base64 chunk back to bytes
    let bytes;
    try {
      const binaryString = atob(data.data);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
    } catch (err) {
      console.error("Chunk decode failed:", err);
      return;
    }

    // Only store if we haven't seen this chunk before (prevents double-counting on retry)
    if (fileInfo.chunks[data.chunkIndex] === undefined) {
      fileInfo.chunks[data.chunkIndex] = bytes;
      fileInfo.receivedChunks++;
      fileInfo.receivedSize += bytes.length;
    }

    // Stall detection: if no chunk arrives for 5s, request recovery
    if (fileInfo.stallTimer) clearTimeout(fileInfo.stallTimer);
    fileInfo.stallTimer = setTimeout(() => {
      if (!this.app.state.receivingFiles.has(data.fileId)) return;
      this.app.ui.showNotification("Transfer stalled... auto-recovering!", "warning");
      // Find first missing chunk index
      let missing = 0;
      while (fileInfo.chunks[missing] !== undefined) missing++;
      this.sendToPeers("request-resume", {
        room: this.app.state.currentRoom,
        fileId: data.fileId,
        nextExpectedChunkIndex: missing,
      });
      // Hard timeout: give up after 10 more seconds
      fileInfo.stallTimer = setTimeout(() => {
        this.app.ui.showNotification("Transfer failed to recover", "error");
        this.app.state.receivingFiles.delete(data.fileId);
      }, 10000);
    }, 5000);

    // Update progress bar
    const progress = Math.min((fileInfo.receivedSize / fileInfo.fileSize) * 100, 100);
    this.app.fileUI.updateReceivingProgress(data.fileId, progress, fileInfo.startTime, fileInfo.receivedSize);

    // Check if we have all chunks AND the file-complete signal has arrived
    if (fileInfo.isComplete && fileInfo.totalChunks && fileInfo.receivedChunks >= fileInfo.totalChunks) {
      if (fileInfo.stallTimer) clearTimeout(fileInfo.stallTimer);
      this._finalizeFile(data.fileId, fileInfo);
    }
  }

  handleFileComplete(fileId) {
    const fileInfo = this.app.state.receivingFiles.get(fileId);
    if (!fileInfo) return;

    fileInfo.isComplete = true;

    // If all chunks already arrived, finalize immediately
    if (!fileInfo.totalChunks || fileInfo.receivedChunks >= fileInfo.totalChunks) {
      if (fileInfo.stallTimer) clearTimeout(fileInfo.stallTimer);
      this._finalizeFile(fileId, fileInfo);
    }
    // Otherwise, the last chunk's arrival (in handleFileChunk) will trigger _finalizeFile
  }

  _finalizeFile(fileId, fileInfo) {
    // Guard against being called twice
    if (fileInfo.isReconstructing) return;
    fileInfo.isReconstructing = true;

    // Assemble the file using chunk indices for perfect byte-order
    const completeFile = new Uint8Array(fileInfo.fileSize);
    fileInfo.chunks.forEach((chunk, index) => {
      if (chunk) {
        const offset = index * this.fileChunkSize;
        completeFile.set(chunk, offset);
      }
    });

    const blob = new Blob([completeFile], { type: fileInfo.mimeType || "application/octet-stream" });

    this.app.state.completedFiles.set(fileInfo.fileName, blob);
    this.app.fileUI.createDownloadLink(fileInfo.fileName, blob, fileId);
    this.app.state.receivingFiles.delete(fileId);
    this.app.ui.showNotification(`✅ ${fileInfo.fileName} received!`, "success");
    this.checkWakeLockStatus();
  }

  // ─── Wake Lock ────────────────────────────────────────────────────────────

  checkWakeLockStatus() {
    const busy = this.app.state.activeTransfers.size > 0 || this.app.state.receivingFiles.size > 0;
    if (busy) {
      this.app.ui.requestWakeLock();
    } else {
      this.app.ui.releaseWakeLock();
    }
  }
}

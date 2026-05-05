export class FileTransfer {
  constructor(app) {
    this.app = app;
    // Lowered to 8KB for maximum mobile compatibility.
    this.fileChunkSize = 8192; 
    // Check for OPFS support (modern Chrome/Android/Edge)
    this.useOPFS = 'storage' in navigator && 'getDirectory' in navigator.storage;
  }

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
      if (e.target.files.length > 0) {
        this.handleFiles(e.target.files);
      }
      document.body.removeChild(folderInput);
    });

    document.body.appendChild(folderInput);
    folderInput.click();
  }

  validateFile(file) {
    const BLOCKED_EXTENSIONS = [".exe", ".bat", ".cmd", ".scr"];

    const fileName = file.name.toLowerCase();
    if (BLOCKED_EXTENSIONS.some((ext) => fileName.endsWith(ext))) {
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

  sendToPeers(messageType, data) {
    const jsonStr = JSON.stringify({ type: messageType, ...data });
    let sentViaWebRTC = false;

    // Metadata MUST go through Socket.IO. It's tiny, requires 100% reliability, 
    // and guarantees the receiving UI pops up even if WebRTC is struggling.
    const isMetadata = ["file-info", "file-complete", "request-resume"].includes(messageType);

    if (!isMetadata && this.app.state.dataChannels && this.app.state.dataChannels.size > 0) {
      this.app.state.dataChannels.forEach((channel) => {
        if (channel.readyState === "open") {
          try {
            channel.send(jsonStr);
            sentViaWebRTC = true;
          } catch (e) {
            console.warn("WebRTC channel send failed, falling back to Socket.IO", e);
            // If the channel is broken (e.g. message too large), close it.
            channel.close();
          }
        }
      });
    }

    // Fallback to Socket.IO relay if WebRTC isn't connected yet, failed, or if it's metadata
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

    this.app.state.activeTransfers.set(fileId, { file, fileName, startTime: Date.now(), paused: false });
    this.checkWakeLockStatus();

    this.sendToPeers("file-info", {
      room: this.app.state.currentRoom,
      fileId: fileId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      totalChunks: totalChunks,
    });

    this.app.fileUI.displaySendingProgress(fileName, fileId);

    const transfer = { 
      file, 
      fileName, 
      startTime: Date.now(), 
      paused: false,
      offset: 0,
      chunkIndex: 0
    };
    
    this.app.state.activeTransfers.set(fileId, transfer);

    transfer.sendNextChunk = () => {
      if (transfer.paused || !this.app.state.activeTransfers.has(fileId)) return;

      const chunk = file.slice(transfer.offset, transfer.offset + this.fileChunkSize);
      const reader = new FileReader();

      reader.onload = (e) => {
        const bytes = new Uint8Array(e.target.result);
        let binary = "";
        const BATCH = 8192;
        for (let i = 0; i < bytes.length; i += BATCH) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BATCH));
        }
        const chunkData = btoa(binary);

        this.sendToPeers("file-chunk", {
          room: this.app.state.currentRoom,
          fileId: fileId,
          chunkIndex: transfer.chunkIndex,
          data: chunkData,
          isLast: transfer.offset + this.fileChunkSize >= file.size,
        });

        transfer.offset += this.fileChunkSize;
        transfer.chunkIndex++;

        const progress = Math.min((transfer.offset / file.size) * 100, 100);
        this.app.fileUI.updateSendingProgress(fileId, progress, transfer.startTime, transfer.offset);

        if (transfer.offset < file.size) {
          let maxBuffered = 0;
          if (this.app.state.dataChannels) {
            this.app.state.dataChannels.forEach(c => {
               if (c.readyState === "open" && c.bufferedAmount > maxBuffered) {
                 maxBuffered = c.bufferedAmount;
               }
            });
          }
          
          // Throttling: If the peer's buffer is filling up (> 1MB), we slow down 
          // to let it drain. Otherwise, we send as fast as possible.
          const delay = maxBuffered > 1024 * 1024 ? 50 : 2;
          transfer.timer = setTimeout(transfer.sendNextChunk, delay);
        } else {
          this.sendToPeers("file-complete", {
            room: this.app.state.currentRoom,
            fileId: fileId,
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

    // Give the Socket.IO metadata packet a 200ms head start so the receiver's UI
    // can initialize before we blast the blazing-fast WebRTC file chunks.
    setTimeout(() => {
      transfer.sendNextChunk();
    }, 200);
  }

  handleResumeRequest(data) {
    const transfer = this.app.state.activeTransfers.get(data.fileId);
    if (!transfer) return;

    this.app.ui.showNotification(`Recovering transfer for ${transfer.fileName}...`, "info");
    
    // Stop any currently running loop
    if (transfer.timer) clearTimeout(transfer.timer);
    
    // Fast-forward or rewind to the exact requested chunk
    transfer.chunkIndex = data.nextExpectedChunkIndex;
    transfer.offset = transfer.chunkIndex * this.fileChunkSize;
    transfer.paused = false;
    
    // Restart loop
    transfer.sendNextChunk();
  }

  async handleFileInfo(data) {
    const fileInfo = {
      fileId: data.fileId,
      fileName: data.fileName,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      chunks: [],
      totalChunks: data.totalChunks || null,
      receivedChunks: 0,
      receivedSize: 0,
      isComplete: false,
      startTime: Date.now(),
      opfsReady: false,
      chunkQueue: [] // For chunks that arrive while OPFS is initializing
    };

    this.app.state.receivingFiles.set(data.fileId, fileInfo);

    if (this.useOPFS) {
      try {
        const root = await navigator.storage.getDirectory();
        fileInfo.fileHandle = await root.getFileHandle(data.fileId, { create: true });
        // Try to create a writable stream (Chrome/Edge/Android)
        if ('createWritable' in FileSystemFileHandle.prototype) {
          fileInfo.writable = await fileInfo.fileHandle.createWritable();
          fileInfo.opfsReady = true;
          console.log(`🚀 OPFS Streaming active for ${data.fileName}`);
          
          // Process any chunks that arrived during initialization
          if (fileInfo.chunkQueue.length > 0) {
            for (const q of fileInfo.chunkQueue) {
              await fileInfo.writable.write({ type: 'write', data: q.bytes, position: q.index * this.fileChunkSize });
            }
            fileInfo.chunkQueue = [];
          }
        }
      } catch (err) {
        console.warn("OPFS initialization failed, falling back to memory:", err);
      }
    }

    this.app.fileUI.displayReceivingFile(data);
    this.app.ui.receivingSection.style.display = "block";
    this.app.ui.showNotification(`Receiving: ${data.fileName}`, "info");
    this.checkWakeLockStatus();
  }

  async handleFileChunk(data) {
    const fileInfo = this.app.state.receivingFiles.get(data.fileId);
    if (!fileInfo) return;

    let bytes;
    try {
      const binaryString = atob(data.data);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
    } catch (err) {
      console.error("Decode failed", err);
      return;
    }

    if (fileInfo.opfsReady) {
      // Stream directly to disk! Zero memory overhead for the chunk.
      try {
        await fileInfo.writable.write({ type: 'write', data: bytes, position: data.chunkIndex * this.fileChunkSize });
      } catch (e) {
        console.warn("OPFS Write failed, falling back to memory for this chunk", e);
        fileInfo.chunks[data.chunkIndex] = bytes;
      }
    } else if (fileInfo.fileHandle) {
      // OPFS is still initializing, queue this chunk
      fileInfo.chunkQueue.push({ index: data.chunkIndex, bytes: bytes });
    } else {
      // Browser doesn't support OPFS, use memory
      fileInfo.chunks[data.chunkIndex] = bytes;
    }

    fileInfo.receivedSize += bytes.length;
    fileInfo.receivedChunks++;

    if (fileInfo.stallTimer) clearTimeout(fileInfo.stallTimer);
    fileInfo.stallTimer = setTimeout(() => {
      if (this.app.state.receivingFiles.has(data.fileId)) {
        this.app.ui.showNotification(`Transfer stalled... auto-recovering!`, "warning");
        
        // Find exactly which chunk is missing
        let missingIndex = 0;
        while (fileInfo.chunks[missingIndex] !== undefined) {
           missingIndex++;
        }

        this.sendToPeers("request-resume", {
          room: this.app.state.currentRoom,
          fileId: data.fileId,
          nextExpectedChunkIndex: missingIndex
        });
        
        // Give it another 10s to recover, else delete
        fileInfo.stallTimer = setTimeout(() => {
           this.app.ui.showNotification(`Transfer failed to recover`, "error");
           this.app.state.receivingFiles.delete(data.fileId);
        }, 10000);
      }
    }, 5000);

    const progress = Math.min((fileInfo.receivedSize / fileInfo.fileSize) * 100, 100);
    this.app.fileUI.updateReceivingProgress(data.fileId, progress, fileInfo.startTime, fileInfo.receivedSize);

    if (fileInfo.isComplete && fileInfo.totalChunks && fileInfo.receivedChunks >= fileInfo.totalChunks) {
      if (fileInfo.stallTimer) clearTimeout(fileInfo.stallTimer);
      await this.reconstructFile(fileId, fileInfo);
    }
  }

  async reconstructFile(fileId, fileInfo) {
    let finalBlob;

    if (fileInfo.opfsReady) {
      try {
        await fileInfo.writable.close();
        // getFile() returns a File object which is a pointer to the data on disk.
        // This is the magic part: it doesn't load the 10GB file into RAM!
        finalBlob = await fileInfo.fileHandle.getFile();
      } catch (e) {
        console.error("Failed to finalize OPFS file", e);
        // Fallback: try to reconstruct from memory chunks if any
        finalBlob = new Blob(fileInfo.chunks.filter(c => c), { type: fileInfo.mimeType });
      }
    } else {
      const totalSize = fileInfo.chunks.reduce((size, chunk) => size + (chunk ? chunk.length : 0), 0);
      const completeFile = new Uint8Array(totalSize);
      let offset = 0;
      fileInfo.chunks.forEach((chunk) => {
        if (chunk) {
          completeFile.set(chunk, offset);
          offset += chunk.length;
        }
      });
      finalBlob = new Blob([completeFile], { type: fileInfo.mimeType });
    }

    this.app.state.completedFiles.set(fileInfo.fileName, finalBlob);
    this.app.fileUI.createDownloadLink(fileInfo.fileName, finalBlob, fileId);
    this.app.state.receivingFiles.delete(fileId);
    this.app.ui.showNotification(`✅ File received: ${fileInfo.fileName}`, "success");
    this.checkWakeLockStatus();
  }

  checkWakeLockStatus() {
    const activeSending = this.app.state.activeTransfers.size > 0;
    const activeReceiving = this.app.state.receivingFiles.size > 0;
    
    if (activeSending || activeReceiving) {
      this.app.ui.requestWakeLock();
    } else {
      this.app.ui.releaseWakeLock();
    }
  }
}

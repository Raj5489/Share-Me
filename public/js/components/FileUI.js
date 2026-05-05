import { formatFileSize } from '../utils.js';

export class FileUI {
  constructor(app) {
    this.app = app;
  }

  displayFileForSending(file) {
    const fileItem = document.createElement("div");
    fileItem.className = "file-item";
    fileItem.setAttribute("data-filename", file.name);
    
    let thumbHtml = '';
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
       const url = URL.createObjectURL(file);
       if (file.type.startsWith('image/')) {
          thumbHtml = `<img src="${url}" class="file-thumb" alt="preview" />`;
       } else {
          thumbHtml = `<video src="${url}" class="file-thumb" muted></video>`;
       }
    }

    fileItem.innerHTML = `
      <div class="file-info">
        ${thumbHtml}
        <div class="file-details">
          <div class="file-name">${file.name}</div>
          <div class="file-size">${formatFileSize(file.size)}</div>
        </div>
      </div>
      <div class="file-actions">
        <button class="send-btn" data-filename="${file.name}">Send</button>
        <button class="remove-btn" data-remove="${file.name}" title="Remove">✕</button>
      </div>
    `;

    this.app.ui.fileList.appendChild(fileItem);
    this.app.state.filesToSend.set(file.name, file);
  }

  updateSendAllButton() {
    let btn = document.getElementById("send-all-btn");

    if (this.app.state.filesToSend.size >= 2) {
      if (!btn) {
        btn = document.createElement("button");
        btn.id = "send-all-btn";
        btn.className = "send-all-btn";
        btn.addEventListener("click", () => this.app.fileTransfer.sendAllFiles());
        this.app.ui.sendingSection.insertBefore(btn, this.app.ui.fileList);
      }
      btn.textContent = `📤 Send All (${this.app.state.filesToSend.size} files)`;
    } else if (btn) {
      btn.remove();
    }
  }

  displaySendingProgress(fileName, fileId) {
    const fileItem = document.querySelector(`[data-filename="${fileName}"]`);
    if (fileItem) {
      // Keep existing thumb if present
      const thumb = fileItem.querySelector('.file-thumb');
      const thumbHtml = thumb ? thumb.outerHTML : '';

      fileItem.innerHTML = `
        <div class="file-info">
          ${thumbHtml}
          <div class="file-details" style="flex:1;">
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
        </div>
        <button class="send-btn" disabled>Sending...</button>
      `;
    }
  }

  updateSendingProgress(fileId, progress, startTime, sentBytes) {
    const progressBar = document.getElementById(`progress-${fileId}`);
    const statsElement = document.getElementById(`stats-${fileId}`);

    if (progressBar) progressBar.style.width = `${progress.toFixed(1)}%`;

    if (statsElement) {
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? sentBytes / elapsed / (1024 * 1024) : 0;
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

    const fileItem = statsElement?.closest(".file-item");
    if (fileItem) {
      const sendButton = fileItem.querySelector(".send-btn");
      if (sendButton) {
        sendButton.textContent = "SENT ✓";
        sendButton.disabled = false;
        sendButton.style.backgroundColor = "#10b981";
        sendButton.style.cursor = "default";
      }

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
        <div class="file-size">${formatFileSize(fileInfo.fileSize)}</div>
        <div class="progress-bar">
          <div class="progress-fill" id="recv-progress-${fileInfo.fileId}" style="width: 0%"></div>
        </div>
        <div class="transfer-stats" id="recv-stats-${fileInfo.fileId}">
          <span class="speed">0 MB/s</span>
          <span class="eta">Receiving...</span>
        </div>
      </div>
    `;

    this.app.ui.receivedFiles.appendChild(fileItem);
  }

  updateReceivingProgress(fileId, progress, startTime, receivedBytes) {
    const progressBar = document.getElementById(`recv-progress-${fileId}`);
    const statsElement = document.getElementById(`recv-stats-${fileId}`);

    if (progressBar) progressBar.style.width = `${progress.toFixed(1)}%`;

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
      let thumbHtml = '';
      if (blob.type.startsWith('image/') || blob.type.startsWith('video/')) {
         if (blob.type.startsWith('image/')) {
            thumbHtml = `<img src="${url}" class="file-thumb" alt="preview" />`;
         } else {
            thumbHtml = `<video src="${url}" class="file-thumb" muted></video>`;
         }
      }

      fileItem.innerHTML = `
        <div class="file-info">
          ${thumbHtml}
          <div class="file-details">
            <div class="file-name">${fileName}</div>
            <div class="file-size">${formatFileSize(blob.size)} - Complete ✓</div>
          </div>
        </div>
        <a href="${url}" download="${fileName}" class="download-btn">Download</a>
      `;
      
      this.updateDownloadAllButton();
    }
  }

  updateDownloadAllButton() {
    let btn = document.getElementById("download-all-btn");
    
    if (this.app.state.completedFiles.size >= 2) {
      if (!btn) {
        btn = document.createElement("button");
        btn.id = "download-all-btn";
        btn.className = "send-all-btn"; // Reuse styles
        btn.innerHTML = `📦 Download All as ZIP (${this.app.state.completedFiles.size} files)`;
        btn.style.marginBottom = "15px";
        btn.addEventListener("click", () => this.downloadAllAsZip());
        this.app.ui.receivedFiles.parentElement.insertBefore(btn, this.app.ui.receivedFiles);
      } else {
        btn.innerHTML = `📦 Download All as ZIP (${this.app.state.completedFiles.size} files)`;
      }
    }
  }

  async downloadAllAsZip() {
    if (typeof JSZip === 'undefined') {
      this.app.ui.showNotification("ZIP library is still loading, please wait...", "info");
      return;
    }

    const btn = document.getElementById("download-all-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Zipping files... please wait";
    }

    try {
      const zip = new JSZip();
      this.app.state.completedFiles.forEach((blob, fileName) => {
        zip.file(fileName, blob);
      });

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      
      const a = document.createElement("a");
      a.href = url;
      a.download = `ShareMe_Bundle_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      this.app.ui.showNotification("ZIP download started!", "success");
    } catch (err) {
      this.app.ui.showNotification("Failed to create ZIP", "error");
      console.error(err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `📦 Download All as ZIP (${this.app.state.completedFiles.size} files)`;
      }
    }
  }
}

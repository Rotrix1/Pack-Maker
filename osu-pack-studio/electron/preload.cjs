const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("packStudio", {
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  pickDirectory: (title) => ipcRenderer.invoke("dialog:directory", title),
  pickFfmpeg: () => ipcRenderer.invoke("dialog:ffmpeg"),
  pickBackground: () => ipcRenderer.invoke("dialog:background"),
  scanFolder: (folder) => ipcRenderer.invoke("library:scan", folder),
  generatePack: (request) => ipcRenderer.invoke("pack:generate", request),
  estimatePackSize: (items) => ipcRenderer.invoke("pack:estimate-size", items),
  createAudioPreview: (item) => ipcRenderer.invoke("audio:preview", item),
  fetchManiaTrackerPage: (url) => ipcRenderer.invoke("mania-tracker:fetch", url),
});

'use strict';

const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

contextBridge.exposeInMainWorld('inkwellNative', {
  platform: process.platform,
  getAppInfo: () => ipcRenderer.invoke('app-info'),
  onMenuCommand: (cb) => ipcRenderer.on('menu-command', (_e, id) => cb(id)),
  getUpdateState: () => ipcRenderer.invoke('update-get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.send('update-install'),
  onUpdateState: (cb) => ipcRenderer.on('update-state', (_e, state) => cb(state)),
  getInitialFile: () => ipcRenderer.invoke('initial-file'),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  writeFile: (path, content) => ipcRenderer.invoke('write-file', path, content),
  saveDialog: (suggestedName) => ipcRenderer.invoke('save-dialog', suggestedName),
  exportPdf: (suggestedName) => ipcRenderer.invoke('export-pdf', suggestedName),
  setDocState: (state) => ipcRenderer.send('doc-state', state),
  setTheme: (choice) => ipcRenderer.send('set-theme', choice),
  newWindow: (path) => ipcRenderer.send('new-window', path || null),
  closeWindow: () => ipcRenderer.send('close-window'),
  showInFolder: (path) => ipcRenderer.send('show-in-folder', path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  listDir: (dir) => ipcRenderer.invoke('list-dir', dir),
  saveAsset: (name, bytes) => ipcRenderer.invoke('save-asset', name, bytes),
  setZoom: (level) => webFrame.setZoomLevel(level),
  onSaveAndClose: (cb) => ipcRenderer.on('save-and-close', () => cb()),
  onFileChanged: (cb) => ipcRenderer.on('file-changed', (_e, data) => cb(data)),
});

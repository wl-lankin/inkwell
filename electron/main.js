'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { fileURLToPath } = require('node:url');

const DOC_EXT = /\.(md|markdown|mdown|mkd|mkdn|txt)$/i;
const FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All files', extensions: ['*'] },
];
const COLORS = {
  light: { color: '#f7f4ee', symbolColor: '#4a443b' },
  dark: { color: '#121318', symbolColor: '#c3bdb1' },
};
const TITLEBAR_HEIGHT = 52;

/* ---------- Settings (theme + window bounds) ---------- */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};
function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { settings = {}; }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) { /* not fatal */ }
}

/* ---------- Window registry ---------- */
const windows = new Map(); // webContents.id -> { win, filePath, name, dirty, forceClose, pendingFile, lastKnown, watcher }

const overlay = () => ({ ...(nativeTheme.shouldUseDarkColors ? COLORS.dark : COLORS.light), height: TITLEBAR_HEIGHT });

function docArgs(argv, cwd = process.cwd()) {
  return argv
    .filter((a) => a && !a.startsWith('-') && DOC_EXT.test(a))
    .map((a) => path.resolve(cwd, a))
    .filter((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
}

const samePath = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function openPath(filePath) {
  for (const st of windows.values()) {
    if (samePath(st.filePath, filePath)) {
      if (st.win.isMinimized()) st.win.restore();
      st.win.focus();
      return;
    }
  }
  createWindow(filePath);
}

function createWindow(filePath = null) {
  const focused = BrowserWindow.getFocusedWindow();
  const bounds = settings.bounds || { width: 1280, height: 840 };
  const opts = {
    width: bounds.width,
    height: bounds.height,
    minWidth: 520,
    minHeight: 400,
    show: false,
    title: 'Inkwell',
    backgroundColor: overlay().color,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay(),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  };
  if (focused) {
    const [x, y] = focused.getPosition();
    Object.assign(opts, { x: x + 28, y: y + 28 });
  } else if (bounds.x !== undefined) {
    Object.assign(opts, { x: bounds.x, y: bounds.y });
  }

  const win = new BrowserWindow(opts);
  const id = win.webContents.id;
  const st = { win, filePath: null, name: 'Untitled.md', dirty: false, forceClose: false, pendingFile: filePath, lastKnown: null, watcher: null };
  windows.set(id, st);

  if (!focused && settings.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    handleLink(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    handleLink(url);
  });

  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
      if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'r') win.webContents.reload();
    });
  }

  win.on('close', (e) => {
    if (st.dirty && !st.forceClose) {
      e.preventDefault();
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Save', "Don't save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: 'Inkwell',
        message: `Do you want to save the changes to ${st.name}?`,
        detail: "Your changes will be lost if you don't save them.",
      });
      if (choice === 0) win.webContents.send('save-and-close');
      else if (choice === 1) { st.forceClose = true; win.close(); }
      return;
    }
    settings.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized()) settings.bounds = win.getBounds();
    saveSettings();
  });

  win.on('closed', () => {
    if (st.watcher) st.watcher.close();
    windows.delete(id);
  });

  return win;
}

function handleLink(url) {
  if (url.startsWith('file:')) {
    let p;
    try { p = fileURLToPath(url.split('#')[0]); } catch (e) { return; }
    if (DOC_EXT.test(p) && fs.existsSync(p)) openPath(p);
    else shell.openPath(p);
  } else if (/^(https?|mailto):/i.test(url)) {
    shell.openExternal(url);
  }
}

/* ---------- File watching ---------- */
function watch(st, filePath) {
  if (st.watcher) { st.watcher.close(); st.watcher = null; }
  if (!filePath) return;
  let timer;
  try {
    st.watcher = fs.watch(filePath, () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const content = await fsp.readFile(filePath, 'utf8');
          if (content !== st.lastKnown && !st.win.isDestroyed()) {
            st.lastKnown = content;
            st.win.webContents.send('file-changed', { content });
          }
        } catch (e) { /* file temporarily unavailable during save by another app */ }
      }, 250);
    });
  } catch (e) { st.watcher = null; }
}

async function readDoc(st, filePath) {
  const content = await fsp.readFile(filePath, 'utf8');
  if (st) {
    st.filePath = filePath;
    st.lastKnown = content;
    watch(st, filePath);
  }
  app.addRecentDocument(filePath);
  return { path: filePath, name: path.basename(filePath), content };
}

const stateFor = (event) => windows.get(event.sender.id);

/* ---------- IPC ---------- */
ipcMain.handle('initial-file', async (event) => {
  const st = stateFor(event);
  if (!st || !st.pendingFile) return null;
  const p = st.pendingFile;
  st.pendingFile = null;
  try { return await readDoc(st, p); } catch (e) { return { error: e.message, path: p }; }
});

ipcMain.handle('open-dialog', async (event) => {
  const st = stateFor(event);
  const res = await dialog.showOpenDialog(st.win, {
    title: 'Open Markdown',
    defaultPath: st.filePath ? path.dirname(st.filePath) : undefined,
    properties: ['openFile', 'multiSelections'],
    filters: FILTERS,
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('read-file', async (event, filePath) => readDoc(stateFor(event), filePath));

ipcMain.handle('write-file', async (event, filePath, content) => {
  const st = stateFor(event);
  if (st) {
    st.lastKnown = content;
    if (!samePath(st.filePath, filePath)) { st.filePath = filePath; watch(st, filePath); }
  }
  await fsp.writeFile(filePath, content, 'utf8');
  app.addRecentDocument(filePath);
  return true;
});

ipcMain.handle('save-dialog', async (event, suggestedName) => {
  const st = stateFor(event);
  const dir = st.filePath ? path.dirname(st.filePath) : app.getPath('documents');
  const res = await dialog.showSaveDialog(st.win, {
    title: 'Save Markdown',
    defaultPath: path.join(dir, suggestedName || 'Untitled.md'),
    filters: FILTERS,
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('export-pdf', async (event, suggestedName) => {
  const st = stateFor(event);
  const dir = st.filePath ? path.dirname(st.filePath) : app.getPath('documents');
  const res = await dialog.showSaveDialog(st.win, {
    title: 'Export PDF',
    defaultPath: path.join(dir, suggestedName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled) return null;
  const pdf = await st.win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.8, bottom: 0.8, left: 0.8, right: 0.8 },
  });
  await fsp.writeFile(res.filePath, pdf);
  return res.filePath;
});

ipcMain.on('doc-state', (event, { dirty, name, path: filePath }) => {
  const st = stateFor(event);
  if (!st) return;
  st.dirty = !!dirty;
  st.name = name;
  if (!filePath && st.filePath) { st.filePath = null; watch(st, null); }
  st.win.setTitle(`${dirty ? '• ' : ''}${name} - Inkwell`);
});

ipcMain.on('set-theme', (_event, choice) => {
  nativeTheme.themeSource = ['light', 'dark'].includes(choice) ? choice : 'system';
  settings.theme = nativeTheme.themeSource;
  saveSettings();
});

ipcMain.on('new-window', (_event, filePath) => {
  if (filePath) openPath(filePath);
  else createWindow();
});

ipcMain.on('close-window', (event) => {
  const st = stateFor(event);
  if (!st) return;
  st.forceClose = true;
  st.win.close();
});

ipcMain.handle('app-info', () => ({
  version: require('../package.json').version,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: `${process.platform} ${process.arch}`,
}));

ipcMain.on('show-in-folder', (_event, filePath) => shell.showItemInFolder(filePath));

nativeTheme.on('updated', () => {
  for (const { win } of windows.values()) {
    if (win.isDestroyed()) continue;
    win.setTitleBarOverlay(overlay());
    win.setBackgroundColor(overlay().color);
  }
});

/* ---------- App lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, cwd) => {
    const files = docArgs(argv.slice(1), cwd);
    if (files.length) files.forEach(openPath);
    else createWindow();
  });

  app.whenReady().then(() => {
    loadSettings();
    if (settings.theme) nativeTheme.themeSource = settings.theme;
    Menu.setApplicationMenu(null);
    const files = docArgs(process.argv.slice(1));
    if (files.length) files.forEach(openPath);
    else createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}

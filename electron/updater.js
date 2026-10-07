'use strict';

// Keeps Inkwell up to date from GitHub releases.
// Windows uses electron-updater (NSIS). macOS uses a small custom updater, because Squirrel.Mac only
// accepts Developer ID signed apps: it downloads the universal .zip, and after Inkwell quits a
// detached script swaps the app bundle and relaunches it.

const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const REPO = 'wl-lankin/inkwell';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const FIRST_CHECK_DELAY = 15 * 1000;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000;
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
// Test hooks: INKWELL_UPDATE_DEV enables updates in an unpackaged build,
// INKWELL_UPDATE_SMOKE checks immediately and installs as soon as an update is ready.
const devMode = process.env.INKWELL_UPDATE_DEV === '1';
const smoke = process.env.INKWELL_UPDATE_SMOKE === '1';
const execFileP = promisify(execFile);

// status: idle | checking | none | downloading | ready | manual | error | unsupported
let state = { status: 'idle' };
let backend = null;
let busy = false;

function log(...args) {
  if (smoke || devMode) console.log('[updater]', ...args);
}

function setState(next) {
  state = { ...next, current: app.getVersion() };
  log(JSON.stringify(state));
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update-state', state);
  }
  if (smoke && state.status === 'ready') setTimeout(install, 1000);
}

function newer(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/* ---------- Windows: electron-updater ---------- */
function windowsBackend() {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = smoke || devMode ? console : null;
  if (devMode) autoUpdater.forceDevUpdateConfig = true;
  let version = null;
  autoUpdater.on('error', (err) => {
    log('error', err && err.message);
    // Check failures are reported by check(); only surface errors from the background download.
    if (state.status === 'downloading') setState({ status: 'error', message: 'The update couldn\'t be downloaded. Inkwell will try again later.' });
  });
  autoUpdater.on('update-available', (info) => { version = info.version; setState({ status: 'downloading', version, percent: 0 }); });
  autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version }));
  autoUpdater.on('update-not-available', () => setState({ status: 'none' }));
  return {
    async check() { await autoUpdater.checkForUpdates(); },
    install() { autoUpdater.quitAndInstall(true, true); },
  };
}

/* ---------- macOS: download, swap the bundle, relaunch ---------- */
function macBackend() {
  let pending = null; // { newApp, dir, version }
  const bundle = path.resolve(process.execPath, '..', '..', '..');

  function canSelfUpdate() {
    if (!bundle.endsWith('.app')) return 'Inkwell is not running from an app bundle.';
    if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) return 'Move Inkwell to your Applications folder to enable automatic updates.';
    try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); } catch (e) { return 'Inkwell can\'t write to its folder, so update it manually.'; }
    return null;
  }

  async function download(url, file, size, version) {
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || size || 0;
    const out = fs.createWriteStream(file);
    const reader = res.body.getReader();
    let received = 0, lastPercent = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      const percent = total ? Math.floor((received / total) * 100) : 0;
      if (percent !== lastPercent) { lastPercent = percent; setState({ status: 'downloading', version, percent }); }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  }

  return {
    async check() {
      if (pending) { setState({ status: 'ready', version: pending.version }); return; }
      const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Inkwell-Updater' },
      });
      if (!res.ok) throw new Error(`GitHub responded with ${res.status}`);
      const release = await res.json();
      const version = String(release.tag_name || '').replace(/^v/, '');
      if (!version || !newer(version, app.getVersion())) { setState({ status: 'none' }); return; }

      const asset = (release.assets || []).find((a) => /-mac-universal\.zip$/.test(a.name));
      const blocked = canSelfUpdate();
      if (!asset || blocked) {
        setState({ status: 'manual', version, url: release.html_url || RELEASES_URL, message: blocked || 'Download the new version from GitHub.' });
        return;
      }

      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'inkwell-update-'));
      const zip = path.join(dir, 'update.zip');
      setState({ status: 'downloading', version, percent: 0 });
      await download(asset.browser_download_url, zip, asset.size, version);
      await execFileP('/usr/bin/ditto', ['-x', '-k', zip, dir]);
      const newApp = path.join(dir, 'Inkwell.app');
      const { stdout } = await execFileP('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(newApp, 'Contents', 'Info.plist')]);
      if (stdout.trim() !== version) throw new Error(`Downloaded app reports version ${stdout.trim()}, expected ${version}`);
      await fsp.rm(zip, { force: true });
      pending = { newApp, dir, version };
      setState({ status: 'ready', version });
    },

    install() {
      if (!pending) return;
      const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
      const backup = `${bundle}.previous`;
      const script = path.join(pending.dir, 'install.sh');
      fs.writeFileSync(script, [
        '#!/bin/sh',
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
        `rm -rf ${q(backup)}`,
        `mv ${q(bundle)} ${q(backup)} || exit 1`,
        `if mv ${q(pending.newApp)} ${q(bundle)}; then`,
        `  rm -rf ${q(backup)}`,
        'else',
        `  mv ${q(backup)} ${q(bundle)}`,
        'fi',
        `xattr -dr com.apple.quarantine ${q(bundle)} 2>/dev/null`,
        `open ${q(bundle)}`,
        `rm -rf ${q(pending.dir)}`,
        '',
      ].join('\n'));
      spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
      app.quit();
    },
  };
}

/* ---------- Public API ---------- */
async function check(manual = false) {
  if (!backend) {
    setState({ status: 'unsupported', message: app.isPackaged ? 'Automatic updates aren\'t available on this platform.' : 'Updates work in the installed app.' });
    return;
  }
  if (busy || state.status === 'downloading') return;
  if (state.status === 'ready' || state.status === 'manual') { setState(state); return; }
  busy = true;
  if (manual) setState({ status: 'checking' });
  try {
    await backend.check();
  } catch (err) {
    log('error', err && err.stack ? err.stack : err);
    // Background checks fail quietly (offline, rate limits); manual checks report the problem.
    setState(manual ? { status: 'error', message: 'Couldn\'t check for updates. Are you online?' } : { status: 'idle' });
  } finally {
    busy = false;
  }
}

function install() {
  if (backend && state.status === 'ready') backend.install();
  else if (state.status === 'manual') shell.openExternal(state.url || RELEASES_URL);
}

function start() {
  ipcMain.handle('update-get-state', () => ({ ...state, current: app.getVersion() }));
  ipcMain.handle('update-check', () => check(true));
  ipcMain.on('update-install', () => install());

  if (!app.isPackaged && !devMode) return;
  if (isWin) backend = windowsBackend();
  else if (isMac) backend = macBackend();
  if (!backend) return;

  setTimeout(() => check(false), smoke ? 1000 : FIRST_CHECK_DELAY);
  setInterval(() => check(false), CHECK_INTERVAL).unref();
}

module.exports = { start, check, install };

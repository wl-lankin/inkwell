'use strict';

// Renders the SVG icons to PNG, multi-size ICO (Windows) and ICNS (macOS) using Electron's renderer.
// Run with: npm run icon

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'build');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
// ICNS chunk types, each holding a PNG of the given pixel size.
const ICNS_TYPES = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
];

let win;
async function render(svg, size) {
  if (!win) {
    win = new BrowserWindow({
      width: 1024, height: 1024, show: false, frame: false, transparent: true,
      useContentSize: true,
      webPreferences: { offscreen: true },
    });
    await win.loadURL('data:text/html,<html><body style="margin:0;background:transparent;overflow:hidden"><img id="i" style="display:block"></body></html>');
  }
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  await win.webContents.executeJavaScript(`new Promise((r) => { const i = document.getElementById('i'); i.onload = () => requestAnimationFrame(() => requestAnimationFrame(r)); i.style.width = i.style.height = '${size}px'; i.src = '${src}#' + ${size}; })`);
  await new Promise((r) => setTimeout(r, 100));
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  if (img.getSize().width !== size) img = img.resize({ width: size, height: size, quality: 'best' });
  return img.toPNG();
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

function icns(bySize) {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const data = bySize.get(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

async function renderSizes(svgPath, sizes) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const map = new Map();
  for (const size of sizes) map.set(size, await render(svg, size));
  return map;
}

async function buildIco(svgPath, name) {
  const map = await renderSizes(svgPath, ICO_SIZES);
  fs.writeFileSync(path.join(out, `${name}.ico`), ico(ICO_SIZES.map((size) => ({ size, data: map.get(size) }))));
  fs.writeFileSync(path.join(out, `${name}.png`), map.get(256));
  console.log(`built ${name}.ico / ${name}.png`);
}

async function buildIcns(svgPath, name) {
  const map = await renderSizes(svgPath, [...new Set(ICNS_TYPES.map(([, s]) => s))]);
  fs.writeFileSync(path.join(out, `${name}.icns`), icns(map));
  console.log(`built ${name}.icns`);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  await buildIco(path.join(root, 'icon.svg'), 'icon');
  await buildIco(path.join(out, 'file-icon.svg'), 'file-icon');
  await buildIcns(path.join(out, 'icon-mac.svg'), 'icon');
  await buildIcns(path.join(out, 'file-icon.svg'), 'file-icon');
  win.destroy();
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });

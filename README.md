<div align="center">

<img src="icon.svg" width="96" height="96" alt="Inkwell icon">

# Inkwell

**A calm place to read and write Markdown.**

A fast, good-looking Markdown editor and reader for Windows, with its own window, light and dark themes, and double-click to open your `.md` files.

[![Latest release](https://img.shields.io/github/v/release/wl-lankin/inkwell?style=flat-square&color=3346d3)](https://github.com/wl-lankin/inkwell/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-3346d3?style=flat-square)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-1f1c17?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-44-47848f?style=flat-square&logo=electron&logoColor=white)

[**Download for Windows**](https://github.com/wl-lankin/inkwell/releases/latest) · [Features](#-features) · [Shortcuts](#%EF%B8%8F-keyboard-shortcuts) · [Build from source](#%EF%B8%8F-build-from-source)

<br>

<img src="docs/screenshots/split-light.png" alt="Inkwell in split view, light theme" width="880">

</div>

<br>

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/read-dark.png" alt="Read view in the dark theme"></td>
    <td width="50%"><img src="docs/screenshots/palette-dark.png" alt="Command palette"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Read view</b>, dark theme</sub></td>
    <td align="center"><sub><b>Command palette</b> (<code>Ctrl Shift P</code>)</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/about-light.png" alt="About dialog"></td>
    <td width="50%"><img src="docs/screenshots/shortcuts-dark.png" alt="Keyboard shortcuts"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>About</b> (<code>F1</code>)</sub></td>
    <td align="center"><sub><b>Shortcuts</b> cheat sheet</sub></td>
  </tr>
</table>

## ✨ Features

**Three ways to work**
- **Write** for distraction-free drafting, **Split** for editor and live preview side by side, **Read** for typeset reading
- Split view scroll-syncs **by heading**, so both sides stay on the same section
- **Focus mode** hides everything but your words

**A real Windows app**
- Its own window with a themed title bar, not a browser tab
- Registers for `.md`, `.markdown`, `.mdown`, `.mkd` and `.mkdn`, so you can make it your default and double-click to open
- One window per document. Opening a file that's already open brings its window to the front.
- Asks before closing with unsaved changes
- Reloads automatically when another program changes the open file
- Relative images and links to other `.md` files just work

**Writing comfort**
- Formatting toolbar and shortcuts for bold, italic, links, code, headings, lists, tasks, tables and dividers
- Lists continue on Enter, Tab and Shift+Tab indent, and pasting a URL over selected text makes a link
- Tick task-list checkboxes **in the preview**, and the Markdown source updates
- Outline sidebar that tracks where you are, plus recent files

**Beautiful output**
- GitHub-flavored Markdown with syntax highlighting that adapts to the theme
- Carefully set typography: *Newsreader* for reading, *JetBrains Mono* for writing, *Geist* for the interface
- Export to **PDF** or **HTML**, copy as rich text, or print

**Light, dark and system themes**
- Switch instantly, and Inkwell remembers your choice. Even the window controls follow the theme.

**Private by design**
- Fully offline: fonts and libraries are bundled. No accounts, no telemetry, and your files stay on your disk.

## 📦 Install

1. Download **`Inkwell-Setup-x.y.z.exe`** from the [latest release](https://github.com/wl-lankin/inkwell/releases/latest).
2. Run it. Inkwell installs for your user only (no admin rights needed) and adds Start Menu and Desktop shortcuts.
3. **Make it your default Markdown app:** right-click any `.md` file, choose **Open with > Choose another app > Inkwell**, then click **Always**.

> [!NOTE]
> The installer isn't code-signed yet, so Windows SmartScreen may warn you the first time. Click **More info > Run anyway**.

Windows doesn't let apps make themselves the default, so step 3 is a one-time click. You can also set it under **Settings > Apps > Default apps** by searching for `.md`.

## ⌨️ Keyboard shortcuts

| Files | | View | | Formatting | |
| --- | --- | --- | --- | --- | --- |
| Open | `Ctrl O` | Write / Split / Read | `Ctrl 1` `2` `3` | Bold | `Ctrl B` |
| Save | `Ctrl S` | Focus mode | `Ctrl .` | Italic | `Ctrl I` |
| Save as | `Ctrl Shift S` | Sidebar | `Ctrl Shift B` | Link | `Ctrl K` |
| New window | `Ctrl N` | Command palette | `Ctrl Shift P` | Inline code | `Ctrl E` |
| Close window | `Ctrl W` | About & shortcuts | `F1` | Cycle heading | `Ctrl H` |
| New document | `Ctrl Alt N` | | | Strikethrough | `Ctrl Shift X` |

## 🛠️ Build from source

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/wl-lankin/inkwell.git
cd inkwell
npm install
npm start                    # run the app
npm start -- notes.md        # run the app with a file
npm run dist                 # build the installer into dist/
```

> [!TIP]
> If npm blocks Electron's install script, run `node node_modules/electron/install.js` once.

`npm run dist` renders the app and file icons from SVG (`scripts/build-icon.js`) and packages a per-user NSIS installer with `electron-builder`.

You can also open `index.html` in Chrome or Edge without Electron. In that mode Inkwell uses the File System Access API and autosaves drafts locally.

### Project layout

| Path | Purpose |
| --- | --- |
| `index.html` · `styles.css` · `app.js` | The UI: editor, preview, outline, palette, themes |
| `electron/main.js` | Windows, file associations, file I/O, close prompts, file watching, PDF export |
| `electron/preload.js` | The narrow, context-isolated bridge (`window.inkwellNative`) |
| `scripts/build-icon.js` | Renders `icon.svg` and `build/file-icon.svg` to multi-size `.ico` |
| `vendor/` | [marked](https://marked.js.org), [DOMPurify](https://github.com/cure53/DOMPurify), [highlight.js](https://highlightjs.org) |

### Security

Markdown is rendered with `marked` and sanitized with DOMPurify before it reaches the page. The renderer runs sandboxed with context isolation and a strict Content Security Policy, and links open in your default browser.

## 📄 License

[MIT](LICENSE) © 2026 [Wolfgang Linz](https://wolfgang-linz.de)

<div align="center">
<br>
<sub>Made with care by <a href="https://wolfgang-linz.de">Wolfgang Linz</a></sub>
</div>

<div align="center">

<img src="icon.svg" width="96" height="96" alt="Inkwell icon">

# Inkwell

**A calm place to read and write Markdown.**

A fast, good-looking Markdown editor and reader for **Windows and macOS**.

<p><a href="https://github.com/wl-lankin/inkwell/releases/latest"><img src="https://img.shields.io/github/v/release/wl-lankin/inkwell?style=flat-square&color=3346d3" alt="Latest release"></a>&nbsp;<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-3346d3?style=flat-square" alt="License: MIT"></a>&nbsp;<img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-1f1c17?style=flat-square" alt="Platform: Windows | macOS">&nbsp;<img src="https://img.shields.io/badge/Electron-44-47848f?style=flat-square&logo=electron&logoColor=white" alt="Electron 44"></p>

[**Download for Windows**](https://github.com/wl-lankin/inkwell/releases/latest) · [**Download for macOS**](https://github.com/wl-lankin/inkwell/releases/latest) · [Features](#-features) · [Shortcuts](#%EF%B8%8F-keyboard-shortcuts) · [Build from source](#%EF%B8%8F-build-from-source)

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
</table>

## ✨ Features

**Three ways to work**
- **Write** for distraction-free drafting, **Split** for editor and live preview side by side, **Read** for typeset reading
- Split view scroll-syncs **by heading**, so both sides stay on the same section
- **Focus mode** hides everything but your words

**A real desktop app**
- Its own window with a themed title bar, not a browser tab
- Feels native on both platforms: on macOS you get traffic-light window buttons, a full menu bar, `⌘` shortcuts, a Recent Documents menu, and it stays in the Dock when you close the last window
- Registers for `.md`, `.markdown`, `.mdown`, `.mkd` and `.mkdn`, so you can make it your default and double-click to open
- One window per document. Opening a file that's already open brings its window to the front.
- Asks before closing with unsaved changes
- Reloads automatically when another program changes the open file
- Relative images and links to other `.md` files just work

**Writing comfort**
- Formatting toolbar and shortcuts for bold, italic, highlight, links, code, headings, lists, tasks, math and dividers
- **Find and replace** (`Ctrl F`) with match case, whole word and regular expressions. Matches light up in the editor and the preview.
- Brackets and quotes close themselves, and typing `*`, `_` or `~` over selected text wraps it
- **Tables that format themselves**: a size picker to insert one, and `Tab` / `Shift Tab` jump between cells while the columns line up
- **Paste from the web as Markdown**: headings, lists, links and tables from browsers, Word, Google Docs or Excel. `Ctrl Shift V` pastes plain text.
- **Paste or drop images** and they're saved into an `assets` folder next to your document, with the link written for you
- Move lines with `Alt ↑` / `Alt ↓`, duplicate with `Shift Alt ↓`, and lists continue on Enter
- Spell check with suggestions on right-click
- Typewriter scrolling, autosave and adjustable text size in **Settings** (`Ctrl ,`)
- Tick task-list checkboxes **in the preview**, and the Markdown source updates

**Find your way around**
- **Files** panel with the Markdown files and folders next to your document, or any folder you open
- Outline that tracks where you are, plus recent files
- Reading progress bar, click-to-zoom images, and an adjustable reading width and typeface

**Beautiful output**
- GitHub-flavored Markdown with syntax highlighting that adapts to the theme
- **Math** with KaTeX: `$inline$`, `$$display$$` and ` ```math ` blocks
- **Diagrams** with Mermaid: flowcharts, sequence diagrams, Gantt charts and more, in light and dark
- **Callouts**: GitHub alerts (`> [!NOTE]`) and Obsidian callouts, including folding ones (`> [!tip]-`)
- Footnotes, `==highlights==`, `:emoji:` shortcodes, a `[TOC]` table of contents, and YAML front matter shown as a properties card
- Carefully set typography: *Newsreader* for reading, *JetBrains Mono* for writing, *Geist* for the interface
- Export to **PDF** or **HTML**, copy as rich text, or print

**Light, dark and system themes**
- Switch instantly, and Inkwell remembers your choice. Even the window controls follow the theme.

**Always up to date**
- Inkwell checks GitHub for new releases shortly after launch and every few hours, then downloads them in the background
- When an update is ready, a small card offers **Restart**. If you'd rather not restart now, Windows installs it the next time you quit.
- Check manually any time in **About** (`F1`), from the command palette, or on macOS via **Inkwell > Check for Updates…**

**Private by design**
- Fully offline for everything you write: fonts and libraries are bundled. No accounts, no telemetry, and your files stay on your disk. The only network request is the update check against GitHub.

## 📦 Install

Grab the latest version from the [**Releases page**](https://github.com/wl-lankin/inkwell/releases/latest).

### Windows 10 / 11

1. Download **`Inkwell-Setup-x.y.z.exe`** and run it. Inkwell installs for your user only (no admin rights needed) and adds Start Menu and Desktop shortcuts.
2. **Make it your default Markdown app:** right-click any `.md` file, choose **Open with > Choose another app > Inkwell**, then click **Always**.

> [!NOTE]
> The installer isn't code-signed yet, so Windows SmartScreen may warn you the first time. Click **More info > Run anyway**.

### macOS 12 or newer (Apple Silicon and Intel)

1. Download **`Inkwell-x.y.z-mac-universal.dmg`**, open it, and drag **Inkwell** into **Applications**.
2. **First launch:** Inkwell isn't notarized by Apple yet, so macOS blocks it the first time. Open it once, then go to **System Settings > Privacy & Security** and click **Open Anyway**. You can also run this once in Terminal:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Inkwell.app
   ```
3. **Make it your default Markdown app:** select any `.md` file in Finder, press **⌘ I** (Get Info), choose **Inkwell** under **Open with**, then click **Change All…**.

> [!TIP]
> Keep Inkwell in **Applications** so it can update itself. When it runs straight from the disk image, it can only point you to the download.

## ⌨️ Keyboard shortcuts

On macOS, use **⌘** wherever the tables say `Ctrl` and **⌥** for `Alt`. The one exception is **Cycle heading**, which is **⌃ H** on a Mac, because ⌘ H hides apps there. Zoom lives in the **View** menu.

| Files | | View | | Formatting | |
| --- | --- | --- | --- | --- | --- |
| Open | `Ctrl O` | Write / Split / Read | `Ctrl 1` `2` `3` | Bold | `Ctrl B` |
| Save | `Ctrl S` | Focus mode | `Ctrl .` | Italic | `Ctrl I` |
| Save as | `Ctrl Shift S` | Sidebar | `Ctrl Shift B` | Highlight | `Ctrl Shift H` |
| New window | `Ctrl N` | Command palette | `Ctrl Shift P` | Link | `Ctrl K` |
| Close window | `Ctrl W` | Settings | `Ctrl ,` | Inline code | `Ctrl E` |
| New document | `Ctrl Alt N` | About & shortcuts | `F1` | Math | `Ctrl Shift M` |
| | | Zoom (Windows) | `Ctrl =` `-` `0` | Cycle heading | `Ctrl H` |
| | | | | Strikethrough | `Ctrl Shift X` |

| Find | | Editing | |
| --- | --- | --- | --- |
| Find | `Ctrl F` | Next / previous table cell | `Tab` / `Shift Tab` |
| Find and replace | `Ctrl Alt F` | Move line up / down | `Alt ↑` / `Alt ↓` |
| Next / previous match | `Enter` / `Shift Enter` or `F3` | Duplicate line | `Shift Alt ↓` |
| Replace all | `Ctrl Enter` in the replace field | Paste as plain text | `Ctrl Shift V` |

## 🛠️ Build from source

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/wl-lankin/inkwell.git
cd inkwell
npm install
npm start                    # run the app
npm start -- notes.md        # run the app with a file
npm run dist                 # Windows installer into dist/ (re-renders icons first)
npm run dist:mac             # macOS universal .dmg + .zip (run this on a Mac)
```

### Releases

Pushing a version tag (for example `v1.2.0`) starts the [Release workflow](.github/workflows/release.yml). It builds the Windows installer and a universal macOS app on GitHub's runners, smoke-tests the Mac build, and attaches everything to the GitHub release, including the `latest.yml` update metadata. Installed copies pick up the release automatically.

Updates come from GitHub releases. Windows uses [electron-updater](https://www.electron.build/auto-update). macOS uses a small built-in updater (`electron/updater.js`), because Apple's Squirrel updater only accepts Developer ID signed apps: it downloads the universal `.zip`, verifies its version, and swaps the app bundle after Inkwell quits. The [Update E2E workflow](.github/workflows/update-e2e.yml) installs an old build on both platforms and checks that it updates itself to the latest release.

> [!TIP]
> If npm blocks Electron's install script, run `node node_modules/electron/install.js` once.

`npm run icon` renders the app and file icons from SVG into `.ico` (Windows) and `.icns` (macOS). The installers are packaged with `electron-builder`.

`npm run vendor` copies the browser builds of KaTeX, Mermaid and Turndown into `vendor/` and regenerates the emoji list, after you update those packages. `npm run welcome` rebuilds the first-launch guide (`welcome.js`) from [`docs/Welcome.md`](docs/Welcome.md).

You can also open `index.html` in Chrome or Edge without Electron. In that mode Inkwell uses the File System Access API and autosaves drafts locally.

### Code signing (macOS)

Without Apple credentials, the Mac build is ad-hoc signed and needs a one-time **Open Anyway**. With the following GitHub Actions secrets, the Release workflow signs it with a Developer ID, enables the hardened runtime, notarizes it with Apple and checks the result with Gatekeeper:

| Secret | What it is |
| --- | --- |
| `MAC_CERT_P12_BASE64` | Your **Developer ID Application** certificate with its private key, exported as `.p12` and base64-encoded |
| `MAC_CERT_PASSWORD` | The password you chose when exporting the `.p12` |
| `APPLE_API_KEY_P8` | Contents of the App Store Connect API key file (`AuthKey_XXXXXXXXXX.p8`) |
| `APPLE_API_KEY_ID` | The key's ID (10 characters) |
| `APPLE_API_ISSUER` | The Issuer ID shown above the keys list (a UUID) |

To check the setup without publishing anything, run the Release workflow manually from the Actions tab with **publish** turned off.

### Project layout

| Path | Purpose |
| --- | --- |
| `index.html` · `styles.css` · `app.js` | The UI: editor, preview, outline, palette, themes |
| `electron/main.js` | Windows, file associations, file I/O, close prompts, file watching, PDF export, macOS menu |
| `electron/updater.js` | Automatic updates from GitHub releases (Windows and macOS) |
| `electron/preload.js` | The narrow, context-isolated bridge (`window.inkwellNative`) |
| `scripts/build-icon.js` | Renders the SVG icons to `.ico` and `.icns` (`build/icon-mac.svg` follows the macOS icon grid) |
| `scripts/vendor.mjs` · `scripts/welcome.mjs` | Refresh the bundled libraries and the welcome guide |
| `vendor/` | [marked](https://marked.js.org), [DOMPurify](https://github.com/cure53/DOMPurify), [highlight.js](https://highlightjs.org), [KaTeX](https://katex.org), [Mermaid](https://mermaid.js.org), [Turndown](https://github.com/mixmark-io/turndown), [gemoji](https://github.com/wooorm/gemoji). KaTeX and Mermaid load only when a document uses them. |

### Security

Markdown is rendered with `marked` and sanitized with DOMPurify before it reaches the page. Mermaid runs in strict mode and its SVG output is sanitized too, and pasted HTML is sanitized before it's converted. The renderer runs sandboxed with context isolation and a strict Content Security Policy, and links open in your default browser. Pasted images can only be written into the `assets` folder next to the open document.

## 📄 License

[MIT](LICENSE) © 2026 [Wolfgang Linz](https://wolfgang-linz.de)

<div align="center">
<br>
<sub>Made with care by <a href="https://wolfgang-linz.de">Wolfgang Linz</a></sub>
</div>

window.INKWELL_WELCOME = `# Welcome to Inkwell

A calm place to **read** and **write** Markdown. Everything renders as you type, and the outline on the left follows along.

> Good writing tools get out of the way. Inkwell tries to be one of those.

[TOC]

## Three ways to work

- **Write** (\`Ctrl 1\`) - just you and the text
- **Split** (\`Ctrl 2\`) - editor and preview, scroll-synced by heading
- **Read** (\`Ctrl 3\`) - a distraction-free reading view

Press \`Ctrl .\` for **focus mode**, \`Ctrl Shift P\` for the **command palette**, and \`Ctrl ,\` for **settings** (text size, line width, typewriter scrolling, autosave and more).

## Files

- Double-click any \`.md\` file in Explorer to open it here, once Inkwell is your default app
- \`Ctrl O\` open, \`Ctrl S\` save, \`Ctrl Shift S\` save as, \`Ctrl N\` new window
- The **Files** panel in the sidebar lists the Markdown files next to your document. Use its folder button to open any folder.
- Drag & drop files onto the window, and if another program changes the open file, Inkwell reloads it
- **Paste or drop images** and Inkwell saves them into an \`assets\` folder next to your document

## Writing

| Action        | Shortcut         |
| ------------- | ---------------- |
| Bold          | \`Ctrl B\`         |
| Italic        | \`Ctrl I\`         |
| Highlight     | \`Ctrl Shift H\`   |
| Link          | \`Ctrl K\`         |
| Inline code   | \`Ctrl E\`         |
| Math          | \`Ctrl Shift M\`   |
| Cycle heading | \`Ctrl H\`         |
| Find, replace | \`Ctrl F\`         |

Lists continue automatically when you press Enter. Brackets and quotes close themselves, and typing \`*\` or \`_\` over selected text wraps it. Move lines with \`Alt ↑\` and \`Alt ↓\`.

Tables format themselves: put the cursor in one and press \`Tab\` to jump to the next cell. At the end of the last row, \`Tab\` adds a new one.

Copy something from a web page, Word or Google Docs and paste it: headings, lists, links and tables arrive as Markdown. \`Ctrl Shift V\` pastes plain text.

## Task lists

You can tick these in the preview, and the source updates:

- [x] Pick a name
- [x] Draw an ink drop
- [ ] Write something wonderful

## Callouts

> [!TIP]
> GitHub alerts and Obsidian callouts both work: \`NOTE\`, \`TIP\`, \`IMPORTANT\`, \`WARNING\` and \`CAUTION\`.

> [!note]- Click to unfold
> Add \`-\` after the type to fold a callout, or \`+\` to start it open.

## Math and diagrams

Inline math like $e^{i\\pi} + 1 = 0$, and display math:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

\`\`\`mermaid
flowchart LR
  A[Idea] --> B[Draft]
  B --> C{Happy?}
  C -- Yes --> D[Publish]
  C -- No --> B
\`\`\`

## Little extras

==Highlight== important words, add emoji like :sparkles: and :rocket:, and footnotes[^1] collect at the end of the document. Front matter at the top of a file is shown as a tidy properties card.

## Code

\`\`\`js
// Syntax highlighting adapts to the theme
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Themes

Use the switch in the top-right corner to pick **light**, **dark**, or **system**. Inkwell remembers your choice.

---

*Happy writing.*

[^1]: Like this one. Click the arrow to jump back.
`;

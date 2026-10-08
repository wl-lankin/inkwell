(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const app = $('#app');
  const editor = $('#editor');
  const preview = $('#preview');
  const previewPane = $('#pane-preview');
  const workspace = $('#workspace');
  const docName = $('#doc-name');
  const outlineEl = $('#outline');
  const recentEl = $('#recent');

  const native = window.inkwellNative || null;
  const isMac = !!native && native.platform === 'darwin';
  // Shortcut labels are written Windows-style ("Ctrl Shift S") and translated for macOS.
  const keyLabel = (s) => (isMac ? s.replace(/\bCtrl\b/g, '\u2318').replace(/\bAlt\b/g, '\u2325').replace(/\bShift\b/g, '\u21e7') : s);
  const welcomeText = () => (isMac
    ? window.INKWELL_WELCOME.replace(/`Ctrl (?!H`)/g, '`Cmd ').replace(/Ctrl ([0-9OSNPB.])/g, 'Cmd $1').replace(/`Alt /g, '`Option ').replace(/Explorer/g, 'Finder')
    : window.INKWELL_WELCOME);
  const hasFsAccess = 'showOpenFilePicker' in window;
  const MD_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'], 'text/plain': ['.txt'] } }];

  /* ---------- Storage ---------- */
  const ls = {
    get(key, fallback) {
      try { const v = localStorage.getItem('inkwell.' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('inkwell.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    },
  };

  /* ---------- Settings ---------- */
  const SETTING_DEFAULTS = {
    editorSize: 14.5,
    readSize: 19,
    readWidth: 'normal',
    readFont: 'serif',
    spellcheck: true,
    autoPair: true,
    smartPaste: true,
    typewriter: false,
    autosave: false,
  };
  const READ_WIDTHS = { narrow: '620px', normal: '720px', wide: '900px' };
  const settings = { ...SETTING_DEFAULTS, ...ls.get('settings', {}) };

  function applySettings() {
    const root = document.documentElement.style;
    root.setProperty('--editor-size', settings.editorSize + 'px');
    root.setProperty('--read-size', settings.readSize + 'px');
    root.setProperty('--read-width', READ_WIDTHS[settings.readWidth] || READ_WIDTHS.normal);
    app.classList.toggle('read-sans', settings.readFont === 'sans');
    app.classList.toggle('typewriter', !!settings.typewriter);
    editor.spellcheck = !!settings.spellcheck;
    syncMap = null;
  }

  function setSetting(key, value) {
    settings[key] = value;
    ls.set('settings', settings);
    applySettings();
    renderSettingsForm();
  }

  /* ---------- Lazy-loaded libraries ---------- */
  const loaded = new Map();
  function loadScript(src) {
    if (!loaded.has(src)) {
      loaded.set(src, new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { loaded.delete(src); reject(new Error('Could not load ' + src)); };
        document.head.appendChild(s);
      }));
    }
    return loaded.get(src);
  }
  function loadStyle(href) {
    if (!loaded.has(href)) {
      const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
      document.head.appendChild(l);
      loaded.set(href, Promise.resolve());
    }
  }
  const isDark = () => getComputedStyle(document.documentElement).colorScheme === 'dark';

  const idb = (() => {
    let dbPromise;
    const open = () => dbPromise || (dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('inkwell', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    const op = async (mode, fn) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      });
    };
    const safe = (p, fallback) => p.catch(() => fallback);
    return {
      get: (k) => safe(op('readonly', (s) => s.get(k)), undefined),
      set: (k, v) => safe(op('readwrite', (s) => s.put(v, k))),
      del: (k) => safe(op('readwrite', (s) => s.delete(k))),
    };
  })();

  /* ---------- Document state ---------- */
  const state = {
    handle: null,
    savedContent: '',
    get dirty() { return editor.value !== this.savedContent; },
  };

  function setDocument({ content, name, handle = null, savedContent = content }) {
    editor.value = content;
    docName.value = name || 'Untitled.md';
    state.handle = handle;
    state.savedContent = savedContent;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    previewPane.scrollTop = 0;
    if (!native) idb.set('current', handle || null);
    render();
    persistDraft();
    updateMeta();
    refreshFiles();
  }

  let draftTimer;
  function persistDraft() {
    if (native) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      ls.set('draft', { content: editor.value, name: docName.value, savedContent: state.savedContent });
    }, 250);
  }

  function updateMeta() {
    const dirty = state.dirty;
    app.classList.toggle('dirty', dirty);
    document.title = (dirty ? '\u2022 ' : '') + docName.value + ' - Inkwell';
    const where = state.handle ? (state.handle.path || state.handle.name) : (native ? 'Not saved yet' : 'Local draft');
    $('#st-file').textContent = where;
    $('#st-file').title = where;
    $('#st-saved').textContent = native
      ? (dirty ? 'Unsaved changes' : (state.handle ? 'Saved' : 'Empty'))
      : (dirty ? (state.handle ? 'Unsaved changes' : 'Draft (autosaved)') : (state.handle ? 'Saved' : 'Draft (autosaved)'));
    if (native) native.setDocState({ dirty, name: docName.value, path: state.handle ? state.handle.path : null });
  }

  function fileUrl(p) {
    const norm = p.replace(/\\/g, '/');
    const parts = norm.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)));
    return norm.startsWith('//') ? 'file:' + parts.join('/') : 'file:///' + parts.join('/');
  }
  const dirUrl = () => (native && state.handle && state.handle.path ? fileUrl(state.handle.path.replace(/[\\/][^\\/]*$/, '/')) : null);
  const isRelative = (u) => !!u && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);

  /* ---------- Markdown rendering ---------- */
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const slugCounts = new Map();
  function slugify(text) {
    const base = text.toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section';
    const n = slugCounts.get(base) || 0;
    slugCounts.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  }

  // Math ($inline$, $$display$$, ```math). KaTeX loads on first use; until then the TeX shows as code.
  const KATEX = 'vendor/katex/katex.min.js';
  function mathHtml(tex, display) {
    if (!window.katex) {
      loadStyle('vendor/katex/katex.min.css');
      loadScript(KATEX).then(scheduleRender, () => {});
      return display ? `<pre class="math-pending"><code>${escapeHtml(tex)}</code></pre>` : `<code class="math-pending">${escapeHtml(tex)}</code>`;
    }
    const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' });
    return display ? `<div class="math-block">${html}</div>\n` : `<span class="math-inline">${html}</span>`;
  }

  // Diagrams (```mermaid) render asynchronously into placeholders after each preview update.
  let diagramSources = [];

  // Footnotes ([^1] and [^1]: text) are collected while parsing and appended at the end.
  const footnotes = { defs: new Map(), order: [], refs: new Map() };
  const fnId = (id) => id.replace(/[^\p{L}\p{N}_-]/gu, '_');

  const CALLOUT_KINDS = {
    note: 'note', info: 'note', todo: 'note',
    tip: 'tip', hint: 'tip', success: 'tip', check: 'tip', done: 'tip',
    important: 'important', abstract: 'important', summary: 'important', tldr: 'important', example: 'important', question: 'important', help: 'important', faq: 'important',
    warning: 'warning', attention: 'warning', caution: 'caution', danger: 'caution', error: 'caution', bug: 'caution', failure: 'caution', fail: 'caution', missing: 'caution',
    quote: 'quote', cite: 'quote',
  };
  const EMOJI = window.INKWELL_EMOJI || {};

  marked.use({
    gfm: true,
    extensions: [
      {
        name: 'mathBlock',
        level: 'block',
        start(src) { const m = /(^|\n)\$\$/.exec(src); return m ? m.index + m[1].length : undefined; },
        tokenizer(src) {
          const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
          if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
        },
        renderer(t) { return mathHtml(t.text, true); },
      },
      {
        name: 'mathInline',
        level: 'inline',
        start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
        tokenizer(src) {
          let m = /^\$\$(?!\s)([^$]+?)\$\$/.exec(src);
          if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: true };
          m = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
          if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
        },
        renderer(t) { return mathHtml(t.text, t.display); },
      },
      {
        name: 'toc',
        level: 'block',
        start(src) { const m = /(^|\n)\[toc\]/i.exec(src); return m ? m.index + m[1].length : undefined; },
        tokenizer(src) {
          const m = /^\[toc\][ \t]*(?:\n|$)/i.exec(src);
          if (m) return { type: 'toc', raw: m[0] };
        },
        renderer() { return '<nav class="toc" data-toc="1"></nav>\n'; },
      },
      {
        name: 'footnoteDef',
        level: 'block',
        start(src) { const m = /(^|\n)\[\^[^\]\s]+\]:/.exec(src); return m ? m.index + m[1].length : undefined; },
        tokenizer(src) {
          const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?:[ \t]{2,}|\t)[^\n]*)*)(?:\n|$)/.exec(src);
          if (m) return { type: 'footnoteDef', raw: m[0], id: m[1], text: m[2].replace(/\n[ \t]+/g, ' ') };
        },
        renderer(t) { footnotes.defs.set(t.id, t.text); return ''; },
      },
      {
        name: 'footnoteRef',
        level: 'inline',
        start(src) { const i = src.indexOf('[^'); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
          if (m) return { type: 'footnoteRef', raw: m[0], id: m[1] };
        },
        renderer(t) {
          let n = footnotes.order.indexOf(t.id);
          if (n < 0) { footnotes.order.push(t.id); n = footnotes.order.length - 1; }
          const count = (footnotes.refs.get(t.id) || 0) + 1;
          footnotes.refs.set(t.id, count);
          const id = fnId(t.id);
          return `<sup class="fn-ref"><a href="#fn-${id}" id="fnref-${id}${count > 1 ? '-' + count : ''}">${n + 1}</a></sup>`;
        },
      },
      {
        name: 'mark',
        level: 'inline',
        start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = /^==(?=\S)([\s\S]*?\S)==(?!=)/.exec(src);
          if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
        },
        renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
      },
      {
        name: 'emoji',
        level: 'inline',
        start(src) { const m = /:[a-z0-9_+-]+:/.exec(src); return m ? m.index : undefined; },
        tokenizer(src) {
          const m = /^:([a-z0-9_+-]+):/.exec(src);
          if (m && Object.hasOwn(EMOJI, m[1])) return { type: 'emoji', raw: m[0], name: m[1] };
        },
        renderer(t) { return `<span class="emoji" title=":${t.name}:">${EMOJI[t.name]}</span>`; },
      },
    ],
    renderer: {
      heading(token) {
        const inner = this.parser.parseInline(token.tokens);
        const id = slugify(token.text);
        return `<h${token.depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${token.depth}>\n`;
      },
      code(token) {
        const lang = (token.lang || '').trim().split(/\s+/)[0].toLowerCase();
        if (lang === 'math' || lang === 'latex' || lang === 'tex') return mathHtml(token.text, true);
        if (lang === 'mermaid') {
          diagramSources.push(token.text);
          return `<div class="diagram" data-diagram="${diagramSources.length - 1}"></div>\n`;
        }
        const known = lang && hljs.getLanguage(lang);
        const body = known ? hljs.highlight(token.text, { language: lang, ignoreIllegals: true }).value : escapeHtml(token.text);
        const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
        return `<pre>${label}<code class="hljs${known ? ' language-' + lang : ''}">${body}</code></pre>\n`;
      },
      // GitHub alerts and Obsidian callouts: > [!NOTE], > [!tip] Custom title, > [!warning]- (folded)
      blockquote(token) {
        const body = this.parser.parse(token.tokens);
        const m = /^<p>\[!([A-Za-z]+)\]([+-]?)/.exec(body);
        if (!m) return `<blockquote>\n${body}</blockquote>\n`;
        const type = m[1].toLowerCase();
        const kind = CALLOUT_KINDS[type] || 'note';
        const after = body.slice(m[0].length);
        const stop = after.search(/\n|<\/p>/);
        const title = after.slice(0, stop).trim() || type.charAt(0).toUpperCase() + type.slice(1);
        const tail = after.slice(stop);
        const rest = tail.startsWith('\n') ? '<p>' + tail.slice(1) : tail.replace(/^<\/p>\n?/, '');
        if (m[2]) {
          return `<details class="callout" data-callout="${kind}"${m[2] === '+' ? ' open' : ''}><summary class="callout-title">${title}</summary><div class="callout-body">${rest}</div></details>\n`;
        }
        return `<div class="callout" data-callout="${kind}"><p class="callout-title">${title}</p><div class="callout-body">${rest}</div></div>\n`;
      },
    },
  });

  // YAML front matter at the very top is shown as a small properties card.
  const FRONT_MATTER = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/;
  function frontMatterHtml(yaml) {
    const rows = [];
    let current = null;
    for (const line of yaml.split('\n')) {
      const item = /^\s+-\s+(.*)$/.exec(line);
      const kv = /^([\w.-][\w .-]*?)\s*:\s*(.*)$/.exec(line);
      if (item && current) current.values.push(item[1]);
      else if (kv) {
        let v = kv[2].trim();
        const values = /^\[(.*)\]$/.test(v) ? v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean) : (v ? [v] : []);
        current = { key: kv[1], values, list: /^\[/.test(v) };
        rows.push(current);
      }
    }
    if (!rows.length) return '';
    const unquote = (s) => s.replace(/^(['"])(.*)\1$/, '$2');
    const cells = rows.map((r) => {
      const isList = r.list || r.values.length > 1 || /^(tags|aliases|keywords|categories)$/i.test(r.key);
      const val = isList
        ? r.values.map((v) => `<span class="fm-chip">${escapeHtml(unquote(v))}</span>`).join('')
        : escapeHtml(unquote(r.values.join(' ')));
      return `<dt>${escapeHtml(r.key)}</dt><dd>${val || '<span class="fm-empty">-</span>'}</dd>`;
    }).join('');
    return `<div class="frontmatter"><dl>${cells}</dl></div>\n`;
  }

  function footnotesHtml() {
    if (!footnotes.order.length && !footnotes.defs.size) return '';
    const ids = [...footnotes.order, ...[...footnotes.defs.keys()].filter((k) => !footnotes.order.includes(k))];
    const items = ids.map((key) => {
      const id = fnId(key);
      const text = footnotes.defs.has(key) ? marked.parseInline(footnotes.defs.get(key)) : `<em class="fn-missing">Missing footnote [^${escapeHtml(key)}]</em>`;
      const back = footnotes.refs.has(key) ? ` <a href="#fnref-${id}" class="fn-back" aria-label="Back to text">↩︎</a>` : '';
      return `<li id="fn-${id}"><p>${text}${back}</p></li>`;
    }).join('');
    return `<section class="footnotes"><ol>${items}</ol></section>\n`;
  }

  let headingOffsets = [];
  let syncMap = null;

  function render() {
    const src = editor.value;
    slugCounts.clear();
    diagramSources = [];
    footnotes.defs.clear();
    footnotes.order = [];
    footnotes.refs.clear();
    const fm = FRONT_MATTER.exec(src);
    const tokens = marked.lexer(fm ? src.slice(fm[0].length) : src);

    // Locate top-level headings in the source so editor and preview can be aligned.
    headingOffsets = [];
    let cursor = fm ? fm[0].length : 0;
    for (const t of tokens) {
      if (!t.raw) continue;
      const at = src.indexOf(t.raw, cursor);
      if (at === -1) continue;
      if (t.type === 'heading') headingOffsets.push(at);
      cursor = at + t.raw.length;
    }

    const body = marked.parser(tokens);
    const html = (fm ? frontMatterHtml(fm[1]) : '') + body + footnotesHtml();
    preview.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });

    for (const box of $$('input[type="checkbox"]', preview)) box.removeAttribute('disabled');
    const base = dirUrl();
    if (base) {
      for (const img of $$('img[src]', preview)) {
        const src = img.getAttribute('src');
        if (isRelative(src)) { try { img.src = new URL(src, base).href; } catch (e) { /* leave as is */ } }
      }
    }
    for (const a of $$('a[href]', preview)) {
      const href = a.getAttribute('href');
      if (base && isRelative(href) && !href.startsWith('/')) { try { a.href = new URL(href, base).href; } catch (e) { /* leave as is */ } }
      if (!href.startsWith('#')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    }
    for (const pre of $$('pre', preview)) {
      const btn = document.createElement('button');
      btn.className = 'copy-code';
      btn.title = 'Copy code';
      btn.innerHTML = '<svg><use href="#i-copy"/></svg>';
      pre.appendChild(btn);
    }

    fillToc();
    fillDiagrams();
    syncMap = null;
    buildOutline();
    updateStats();
    if (find.open) refreshFind(false);
  }

  function fillToc() {
    const tocs = $$('nav.toc', preview);
    if (!tocs.length) return;
    let heads = previewHeadings().filter((h) => Number(h.tagName[1]) <= 4);
    // A single H1 is the document title, so the contents start below it.
    const shift = heads.filter((h) => h.tagName === 'H1').length === 1 ? 1 : 0;
    if (shift) heads = heads.filter((h) => h.tagName !== 'H1');
    for (const nav of tocs) {
      const ul = document.createElement('ul');
      for (const h of heads) {
        const li = document.createElement('li');
        li.dataset.level = Number(h.tagName[1]) - shift;
        const a = document.createElement('a');
        a.href = '#' + h.id;
        a.textContent = h.textContent.replace(/^#/, '').trim();
        li.appendChild(a);
        ul.appendChild(li);
      }
      nav.replaceChildren(ul);
    }
  }

  const diagramCache = new Map();
  const diagramPending = new Set();
  let mermaidTheme = null;
  let diagramSeq = 0;

  function fillDiagrams() {
    const nodes = $$('.diagram[data-diagram]', preview);
    if (!nodes.length) return;
    const theme = isDark() ? 'dark' : 'neutral';
    const todo = [];
    for (const node of nodes) {
      const src = diagramSources[Number(node.dataset.diagram)];
      const key = theme + '\n' + src;
      const hit = diagramCache.get(key);
      if (hit) {
        node.classList.remove('diagram-loading');
        if (hit.svg) node.innerHTML = hit.svg;
        else { node.classList.add('diagram-error'); node.textContent = 'Diagram error: ' + hit.error; }
      } else {
        node.classList.add('diagram-loading');
        node.textContent = 'Rendering diagram…';
        if (!diagramPending.has(key)) { diagramPending.add(key); todo.push({ key, src }); }
      }
    }
    if (todo.length) renderDiagrams(todo, theme);
  }

  async function renderDiagrams(todo, theme) {
    try {
      await loadScript('vendor/mermaid.min.js');
    } catch (e) {
      todo.forEach(({ key }) => { diagramPending.delete(key); diagramCache.set(key, { error: 'the diagram library could not be loaded' }); });
      fillDiagrams();
      return;
    }
    if (mermaidTheme !== theme) {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, suppressErrorRendering: true, htmlLabels: false, flowchart: { htmlLabels: false }, fontFamily: getComputedStyle(document.body).fontFamily });
      mermaidTheme = theme;
    }
    for (const { key, src } of todo) {
      const id = 'inkwell-mmd-' + (++diagramSeq);
      try {
        const { svg } = await mermaid.render(id, src);
        const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true }, ADD_TAGS: ['foreignObject'] });
        diagramCache.set(key, { svg: clean });
      } catch (err) {
        diagramCache.set(key, { error: String((err && err.message) || err).split('\n')[0] });
        const stray = document.getElementById('d' + id);
        if (stray) stray.remove();
      }
      diagramPending.delete(key);
      if (diagramCache.size > 80) diagramCache.delete(diagramCache.keys().next().value);
    }
    fillDiagrams();
    syncMap = null;
  }

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    const delay = editor.value.length > 60000 ? 150 : 0;
    setTimeout(() => requestAnimationFrame(() => { renderQueued = false; render(); }), delay);
  }

  /* ---------- Outline ---------- */
  function previewHeadings() {
    return $$(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6', preview);
  }

  function buildOutline() {
    const heads = previewHeadings();
    if (!heads.length) {
      outlineEl.innerHTML = '<p class="empty-hint">Headings will appear here.</p>';
      return;
    }
    outlineEl.innerHTML = '';
    heads.forEach((h, i) => {
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.dataset.index = i;
      a.dataset.level = h.tagName[1];
      a.textContent = h.textContent.replace(/^#/, '').trim();
      a.title = a.textContent;
      outlineEl.appendChild(a);
    });
    updateActiveOutline();
  }

  function updateActiveOutline() {
    const links = $$('a', outlineEl);
    if (!links.length) return;
    let active = 0;
    if (app.dataset.view !== 'write') {
      const top = previewPane.scrollTop + 80;
      previewHeadings().forEach((h, i) => { if (h.offsetTop <= top) active = i; });
    } else {
      const map = getSyncMap();
      const top = editor.scrollTop + 80;
      map.editorHeads.forEach((y, i) => { if (y <= top) active = i; });
    }
    links.forEach((a, i) => a.classList.toggle('active', i === active));
  }

  outlineEl.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    jumpToHeading(Number(a.dataset.index));
  });

  function jumpToHeading(i) {
    const view = app.dataset.view;
    const heads = previewHeadings();
    if (view !== 'write' && heads[i]) {
      lockSync('editor');
      previewPane.scrollTo({ top: heads[i].offsetTop - 24, behavior: 'smooth' });
    }
    if (view !== 'read') {
      const map = getSyncMap();
      if (map.editorHeads[i] !== undefined) {
        if (view === 'write') {
          editor.focus({ preventScroll: true });
          const pos = headingOffsets[i];
          editor.setSelectionRange(pos, pos);
        }
        lockSync('preview');
        editor.scrollTo({ top: map.editorHeads[i] - 24, behavior: 'smooth' });
      }
    }
  }

  /* ---------- Scroll sync (heading-anchored) ---------- */
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-99999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal', boxSizing: 'border-box' });
  document.body.appendChild(mirror);

  function measureEditorOffsets(offsets) {
    const cs = getComputedStyle(editor);
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'tabSize']) mirror.style[p] = cs[p];
    mirror.style.width = editor.clientWidth + 'px';
    const src = editor.value;
    const frag = document.createDocumentFragment();
    let last = 0;
    const marks = offsets.map((off) => {
      frag.appendChild(document.createTextNode(src.slice(last, off)));
      const span = document.createElement('span');
      frag.appendChild(span);
      last = off;
      return span;
    });
    mirror.replaceChildren(frag);
    const tops = marks.map((s) => s.offsetTop - parseFloat(cs.paddingTop));
    mirror.replaceChildren();
    return tops;
  }

  function getSyncMap() {
    if (syncMap) return syncMap;
    const editorHeads = app.dataset.view === 'read' ? [] : measureEditorOffsets(headingOffsets);
    const previewHeads = previewHeadings().map((h) => h.offsetTop - 24);
    const points = [{ e: 0, p: 0 }];
    const n = Math.min(editorHeads.length, previewHeads.length);
    for (let i = 0; i < n; i++) {
      const prev = points[points.length - 1];
      if (editorHeads[i] > prev.e && previewHeads[i] > prev.p) points.push({ e: editorHeads[i], p: previewHeads[i] });
    }
    const eMax = Math.max(1, editor.scrollHeight - editor.clientHeight);
    const pMax = Math.max(1, previewPane.scrollHeight - previewPane.clientHeight);
    while (points.length > 1 && (points[points.length - 1].e >= eMax || points[points.length - 1].p >= pMax)) points.pop();
    points.push({ e: eMax, p: pMax });
    syncMap = { points, editorHeads };
    return syncMap;
  }

  function interpolate(points, from, to, v) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (v <= b[from]) {
        const t = (v - a[from]) / Math.max(1, b[from] - a[from]);
        return a[to] + t * (b[to] - a[to]);
      }
    }
    return points[points.length - 1][to];
  }

  let lock = { pane: null, until: 0 };
  function lockSync(pane) { lock = { pane, until: performance.now() + 700 }; }
  const isLocked = (pane) => lock.pane === pane && performance.now() < lock.until;

  editor.addEventListener('scroll', () => {
    if (app.dataset.view === 'split' && !isLocked('editor')) {
      const target = interpolate(getSyncMap().points, 'e', 'p', editor.scrollTop);
      lock = { pane: 'preview', until: performance.now() + 60 };
      previewPane.scrollTop = target;
    }
    updateActiveOutline();
  }, { passive: true });

  previewPane.addEventListener('scroll', () => {
    if (app.dataset.view === 'split' && !isLocked('preview')) {
      const target = interpolate(getSyncMap().points, 'p', 'e', previewPane.scrollTop);
      lock = { pane: 'editor', until: performance.now() + 60 };
      editor.scrollTop = target;
    }
    updateActiveOutline();
  }, { passive: true });

  new ResizeObserver(() => { syncMap = null; }).observe(editor);
  new ResizeObserver(() => { syncMap = null; }).observe(preview);

  /* ---------- Stats ---------- */
  const countWords = (text) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  let docWords = 0;

  // Readable text only: skips diagram SVGs (with their CSS), hidden MathML and UI bits.
  function readableText() {
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('svg, style, .katex-mathml, .copy-code, .anchor, .code-lang, .diagram') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let text = '', node;
    while ((node = walker.nextNode())) text += node.data + ' ';
    return text;
  }

  function updateStats() {
    const text = readableText();
    docWords = countWords(text);
    const chars = text.replace(/\s/g, '').length;
    $('#st-words').title = `${docWords.toLocaleString()} words, ${chars.toLocaleString()} characters (without spaces), ${editor.value.split('\n').length.toLocaleString()} lines`;
    $('#st-read span').textContent = `${Math.max(1, Math.round(docWords / 230))} min read`;
    updateWordLabel();
  }

  function updateWordLabel() {
    const sel = editor.selectionStart !== editor.selectionEnd ? countWords(editor.value.slice(editor.selectionStart, editor.selectionEnd)) : 0;
    $('#st-words').textContent = sel
      ? `${sel.toLocaleString()} of ${docWords.toLocaleString()} words`
      : `${docWords.toLocaleString()} ${docWords === 1 ? 'word' : 'words'}`;
  }

  function updateCursor() {
    const pos = editor.selectionStart;
    const before = editor.value.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    const sel = Math.abs(editor.selectionEnd - editor.selectionStart);
    $('#st-pos').textContent = `Ln ${line}, Col ${col}` + (sel ? ` (${sel} selected)` : '');
    updateWordLabel();
  }

  /* ---------- Editing primitives ---------- */
  function replaceRange(start, end, text, selStart = start + text.length, selEnd = selStart) {
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = text === '' ? (start === end || document.execCommand('delete')) : document.execCommand('insertText', false, text);
    } catch (e) { ok = false; }
    if (!ok) {
      editor.setRangeText(text, start, end, 'end');
      editor.dispatchEvent(new Event('input'));
    }
    editor.setSelectionRange(selStart, selEnd);
  }

  function lineBounds(start, end) {
    const v = editor.value;
    const ls = v.lastIndexOf('\n', start - 1) + 1;
    let le = v.indexOf('\n', end > start && v[end - 1] === '\n' ? end - 1 : end);
    if (le === -1) le = v.length;
    return [ls, le];
  }

  function wrap(before, after = before, placeholder = 'text') {
    const { selectionStart: s, selectionEnd: e, value: v } = editor;
    const sel = v.slice(s, e);
    if (v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      replaceRange(s - before.length, e + after.length, sel, s - before.length, e - before.length);
      return;
    }
    if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
      const inner = sel.slice(before.length, sel.length - after.length);
      replaceRange(s, e, inner, s, s + inner.length);
      return;
    }
    const inner = sel || placeholder;
    replaceRange(s, e, before + inner + after, s + before.length, s + before.length + inner.length);
  }

  function prefixLines(makePrefix, matcher) {
    const [ls, le] = lineBounds(editor.selectionStart, editor.selectionEnd);
    const lines = editor.value.slice(ls, le).split('\n');
    const allHave = lines.every((l) => !l.trim() || matcher.test(l));
    let n = 0;
    const out = lines.map((l) => {
      if (!l.trim() && lines.length > 1) return l;
      if (allHave) return l.replace(matcher, '');
      const stripped = l.replace(/^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?|#{1,6}\s+)/, '$1');
      const indent = stripped.match(/^\s*/)[0];
      return indent + makePrefix(n++) + stripped.slice(indent.length);
    }).join('\n');
    replaceRange(ls, le, out, ls, ls + out.length);
  }

  function cycleHeading() {
    const [ls, le] = lineBounds(editor.selectionStart, editor.selectionStart);
    const line = editor.value.slice(ls, le);
    const m = line.match(/^(#{1,6})\s+/);
    const level = m ? m[1].length : 0;
    const body = m ? line.slice(m[0].length) : line;
    const next = level >= 3 ? body : '#'.repeat(level + 1) + ' ' + body;
    const caret = ls + next.length;
    replaceRange(ls, le, next, caret);
  }

  function insertBlock(text, selectFrom, selectTo) {
    const { selectionStart: s, selectionEnd: e, value: v } = editor;
    const pre = s === 0 || v.slice(Math.max(0, s - 2), s) === '\n\n' ? '' : (v[s - 1] === '\n' ? '\n' : '\n\n');
    const post = v.slice(e, e + 1) === '\n' || e === v.length ? '\n' : '\n\n';
    const start = s + pre.length;
    replaceRange(s, e, pre + text + post, start + (selectFrom ?? text.length), start + (selectTo ?? selectFrom ?? text.length));
  }

  const formats = {
    bold: () => wrap('**', '**', 'bold text'),
    italic: () => wrap('_', '_', 'italic text'),
    strike: () => wrap('~~', '~~', 'struck text'),
    heading: cycleHeading,
    code: () => {
      const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
      if (sel.includes('\n')) {
        const s = editor.selectionStart;
        replaceRange(s, editor.selectionEnd, '```\n' + sel + '\n```', s + 3);
      } else wrap('`', '`', 'code');
    },
    link: () => {
      const { selectionStart: s, selectionEnd: e, value: v } = editor;
      const sel = v.slice(s, e);
      if (/^https?:\/\/\S+$/.test(sel)) {
        replaceRange(s, e, `[link text](${sel})`, s + 1, s + 10);
      } else {
        const text = sel || 'link text';
        const out = `[${text}](https://)`;
        replaceRange(s, e, out, s + text.length + 3, s + out.length - 1);
      }
    },
    image: () => {
      const { selectionStart: s, selectionEnd: e, value: v } = editor;
      const alt = v.slice(s, e) || 'alt text';
      const out = `![${alt}](https://)`;
      replaceRange(s, e, out, s + alt.length + 4, s + out.length - 1);
    },
    quote: () => prefixLines(() => '> ', /^\s*>\s?/),
    ul: () => prefixLines(() => '- ', /^\s*[-*+]\s+(?!\[[ xX]\])/),
    ol: () => prefixLines((i) => `${i + 1}. `, /^\s*\d+[.)]\s+/),
    task: () => prefixLines(() => '- [ ] ', /^\s*[-*+]\s+\[[ xX]\]\s+/),
    table: () => insertTable(3, 2),
    hr: () => insertBlock('---'),
    mark: () => wrap('==', '==', 'highlighted text'),
    math: () => {
      const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
      if (sel.includes('\n') || !sel) insertBlock('$$\n' + (sel || 'E = mc^2') + '\n$$', 3, 3 + (sel || 'E = mc^2').length);
      else wrap('$', '$', 'x^2');
    },
    diagram: () => {
      const sample = 'flowchart LR\n  A[Write] --> B{Happy?}\n  B -- Yes --> C[Publish]\n  B -- No --> A';
      insertBlock('```mermaid\n' + sample + '\n```', 11, 11 + sample.length);
    },
    footnote: () => {
      const v = editor.value;
      let n = 1;
      while (v.includes(`[^${n}]`)) n++;
      const { selectionEnd: e } = editor;
      replaceRange(e, e, `[^${n}]`);
      const def = `[^${n}]: `;
      const tail = editor.value.replace(/\s+$/, '');
      const sep = /\n\[\^[^\]]+\]:[^\n]*$/.test(tail) ? '\n' : '\n\n';
      const at = tail.length;
      replaceRange(at, editor.value.length, sep + def + 'Footnote text.\n', at + sep.length + def.length, at + sep.length + def.length + 'Footnote text.'.length);
    },
    callout: () => {
      const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
      const body = (sel || 'Something worth noticing.').split('\n').map((l) => '> ' + l).join('\n');
      insertBlock('> [!NOTE]\n' + body, 4, 8);
    },
    toc: () => insertBlock('[TOC]'),
    date: () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      replaceRange(editor.selectionStart, editor.selectionEnd, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    },
  };

  function insertTable(cols, rows) {
    const head = '| ' + Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(' | ') + ' |';
    const sep = '| ' + Array.from({ length: cols }, () => '--------').join(' | ') + ' |';
    const row = '| ' + Array.from({ length: cols }, () => '        ').join(' | ') + ' |';
    insertBlock([head, sep, ...Array.from({ length: rows }, () => row)].join('\n'), 2, 10);
  }

  /* ---------- Tables: format and Tab between cells ---------- */
  const isTableLine = (l) => /\|/.test(l) && l.trim() !== '';
  const isSepRow = (l) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && l.includes('-');

  function splitRow(line) {
    let t = line.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
    const cells = [];
    let cur = '', code = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === '\\' && t[i + 1] === '|') { cur += '\\|'; i++; continue; }
      if (c === '`') code = !code;
      if (c === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/gu;
  const textWidth = (s) => [...s].length + (s.match(WIDE) || []).length;

  // Returns the table around the caret: its line range in the source and its cells.
  function tableAt(pos) {
    const v = editor.value;
    const lines = v.split('\n');
    let offset = 0, li = 0;
    while (li < lines.length - 1 && offset + lines[li].length < pos) { offset += lines[li].length + 1; li++; }
    if (!isTableLine(lines[li])) return null;
    let a = li, b = li;
    while (a > 0 && isTableLine(lines[a - 1])) a--;
    while (b < lines.length - 1 && isTableLine(lines[b + 1])) b++;
    if (b - a < 1 || !isSepRow(lines[a + 1])) return null;
    let start = 0;
    for (let i = 0; i < a; i++) start += lines[i].length + 1;
    const block = lines.slice(a, b + 1);
    const end = start + block.join('\n').length;
    const row = li - a;
    const rel = pos - offset;
    const col = Math.max(0, (lines[li].slice(0, rel).match(/(?<!\\)\|/g) || []).length - (lines[li].trim().startsWith('|') ? 1 : 0));
    return { start, end, block, row, col };
  }

  function buildTable(block) {
    const rows = block.map(splitRow);
    const aligns = rows[1].map((c) => (c.startsWith(':') && c.endsWith(':') ? 'c' : c.endsWith(':') ? 'r' : c.startsWith(':') ? 'l' : ''));
    const body = [rows[0], ...rows.slice(2)];
    const cols = Math.max(...body.map((r) => r.length), aligns.length);
    const widths = Array.from({ length: cols }, (_, i) => Math.max(3, ...body.map((r) => textWidth(r[i] || ''))));
    const pad = (s, w, a) => {
      const gap = w - textWidth(s);
      if (a === 'r') return ' '.repeat(gap) + s;
      if (a === 'c') return ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2));
      return s + ' '.repeat(gap);
    };
    const line = (r) => '| ' + widths.map((w, i) => pad(r[i] || '', w, aligns[i])).join(' | ') + ' |';
    const sep = '| ' + widths.map((w, i) => {
      const a = aligns[i];
      if (a === 'c') return ':' + '-'.repeat(w - 2) + ':';
      if (a === 'r') return '-'.repeat(w - 1) + ':';
      if (a === 'l') return ':' + '-'.repeat(w - 1);
      return '-'.repeat(w);
    }).join(' | ') + ' |';
    return { lines: [line(body[0]), sep, ...body.slice(1).map(line)], widths, cols };
  }

  // Start offset (relative to the table) of a cell's content in formatted table lines.
  function cellOffset(lines, widths, row, col) {
    let off = 0;
    for (let i = 0; i < row; i++) off += lines[i].length + 1;
    off += 2;
    for (let i = 0; i < col; i++) off += widths[i] + 3;
    return off;
  }

  function formatTable(move = 0) {
    const t = tableAt(editor.selectionStart);
    if (!t) { if (!move) toast('Place the cursor in a table first'); return false; }
    let { lines, widths, cols } = buildTable(t.block);
    // Logical rows skip the separator line: 0 is the header, 1.. are body rows.
    let r = t.row <= 1 ? 0 : t.row - 1;
    let col = t.row === 1 ? 0 : Math.min(t.col, cols - 1);
    if (move > 0) {
      col++;
      if (col >= cols) { col = 0; r++; }
      if (r >= lines.length - 1) lines = [...lines, '| ' + widths.map((w) => ' '.repeat(w)).join(' | ') + ' |'];
    } else if (move < 0) {
      col--;
      if (col < 0) {
        if (r === 0) col = 0;
        else { r--; col = cols - 1; }
      }
    }
    const row = r === 0 ? 0 : r + 1;
    const text = lines.join('\n');
    const at = t.start + cellOffset(lines, widths, row, col);
    const cell = splitRow(lines[row])[col] || '';
    replaceRange(t.start, t.end, text, at, at + cell.length);
    return true;
  }

  /* ---------- Line operations ---------- */
  function moveLines(dir) {
    const { selectionStart: s, selectionEnd: en, value: v } = editor;
    const [ls, le] = lineBounds(s, en);
    const block = v.slice(ls, le);
    if (dir < 0) {
      if (ls === 0) return;
      const pls = v.lastIndexOf('\n', ls - 2) + 1;
      const prev = v.slice(pls, ls - 1);
      const shift = prev.length + 1;
      replaceRange(pls, le, block + '\n' + prev, s - shift, en - shift);
    } else {
      if (le >= v.length) return;
      let nle = v.indexOf('\n', le + 1);
      if (nle === -1) nle = v.length;
      const next = v.slice(le + 1, nle);
      const shift = next.length + 1;
      replaceRange(ls, nle, next + '\n' + block, s + shift, en + shift);
    }
  }

  function duplicateLines(dir) {
    const { selectionStart: s, selectionEnd: en, value: v } = editor;
    const [ls, le] = lineBounds(s, en);
    const block = v.slice(ls, le);
    if (dir > 0) replaceRange(le, le, '\n' + block, s + block.length + 1, en + block.length + 1);
    else replaceRange(ls, ls, block + '\n', s, en);
  }

  /* ---------- Format bar, insert menu, table picker ---------- */
  $('.format-bar').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  $('.format-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.pop) { togglePopover(btn.dataset.pop, btn); return; }
    if (btn.dataset.fmt) formats[btn.dataset.fmt]();
  });

  let openPop = null;
  function togglePopover(id, anchor) {
    const pop = $('#' + id);
    const wasOpen = openPop === pop;
    closePopover();
    if (wasOpen) return;
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 12) + 'px';
    pop.style.top = r.bottom + 6 + 'px';
    openPop = pop;
    if (id === 'table-picker') paintTablePicker(0, 0);
  }
  function closePopover() {
    if (openPop) openPop.hidden = true;
    openPop = null;
  }
  document.addEventListener('mousedown', (e) => {
    if (openPop && !openPop.contains(e.target) && !e.target.closest('[data-pop]')) closePopover();
  });

  $('#insert-menu').addEventListener('mousedown', (e) => e.preventDefault());
  $('#insert-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fmt]');
    if (!b) return;
    closePopover();
    formats[b.dataset.fmt]();
  });

  const tableGrid = $('#table-grid');
  for (let r = 1; r <= 6; r++) {
    for (let c = 1; c <= 8; c++) {
      const cell = document.createElement('button');
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.setAttribute('aria-label', `${c} by ${r} table`);
      tableGrid.appendChild(cell);
    }
  }
  function paintTablePicker(c, r) {
    for (const cell of tableGrid.children) cell.classList.toggle('on', Number(cell.dataset.c) <= c && Number(cell.dataset.r) <= r);
    $('#table-size').textContent = c && r ? `${c} columns × ${r} rows` : 'Pick a size';
  }
  tableGrid.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('button');
    if (cell) paintTablePicker(Number(cell.dataset.c), Number(cell.dataset.r));
  });
  tableGrid.addEventListener('mousedown', (e) => e.preventDefault());
  tableGrid.addEventListener('click', (e) => {
    const cell = e.target.closest('button');
    if (!cell) return;
    closePopover();
    insertTable(Number(cell.dataset.c), Number(cell.dataset.r));
  });

  /* ---------- Editor behaviour ---------- */
  editor.addEventListener('input', () => {
    scheduleRender();
    persistDraft();
    updateMeta();
    updateCursor();
    scheduleAutosave();
    typewriterScroll();
  });
  for (const ev of ['keyup', 'click', 'select']) editor.addEventListener(ev, updateCursor);
  editor.addEventListener('keyup', (e) => { if (/^(Arrow|Page|Home|End)/.test(e.key)) typewriterScroll(); });

  // Typewriter scrolling keeps the line you're writing in the middle of the editor.
  function caretTop(pos) {
    const cs = getComputedStyle(editor);
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'tabSize']) mirror.style[p] = cs[p];
    mirror.style.width = editor.clientWidth + 'px';
    const span = document.createElement('span');
    span.textContent = '​';
    mirror.replaceChildren(document.createTextNode(editor.value.slice(0, pos)), span);
    const top = span.offsetTop;
    mirror.replaceChildren();
    return top;
  }
  function typewriterScroll() {
    if (!settings.typewriter || app.dataset.view === 'read' || editor.selectionStart !== editor.selectionEnd) return;
    const lh = parseFloat(getComputedStyle(editor).lineHeight) || 24;
    editor.scrollTop = caretTop(editor.selectionStart) - editor.clientHeight / 2 + lh / 2;
  }

  const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', '`': '`' };
  const WRAPS = { ...PAIRS, '*': '*', '_': '_', '~': '~' };
  const CLOSERS = new Set(Object.values(PAIRS));

  function autoPair(e) {
    const { selectionStart: s, selectionEnd: en, value: v } = editor;
    const ch = e.key;
    if (s !== en) {
      if (!WRAPS[ch]) return false;
      const sel = v.slice(s, en);
      replaceRange(s, en, ch + sel + WRAPS[ch], s + 1, en + 1);
      return true;
    }
    const next = v[s] || '';
    const prev = v[s - 1] || '';
    if (CLOSERS.has(ch) && next === ch) { editor.setSelectionRange(s + 1, s + 1); return true; }
    if (!PAIRS[ch]) return false;
    if (next && !/[\s)\]}.,;:!?]/.test(next)) return false;
    if ((ch === '"' || ch === '`') && /[\p{L}\p{N}]/u.test(prev)) return false;
    if (ch === '`' && prev === '`') return false;
    replaceRange(s, s, ch + PAIRS[ch], s + 1);
    return true;
  }

  editor.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      const map = { b: 'bold', i: 'italic', k: 'link', e: 'code', h: 'heading' };
      if (!e.shiftKey && map[k]) { e.preventDefault(); formats[map[k]](); return; }
      if (e.shiftKey && k === 'x') { e.preventDefault(); formats.strike(); return; }
      if (e.shiftKey && k === 'h') { e.preventDefault(); formats.mark(); return; }
      if (e.shiftKey && k === 'm') { e.preventDefault(); formats.math(); return; }
      if (e.shiftKey && k === 'v') { e.preventDefault(); pastePlain(); return; }
    }

    if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      if (e.shiftKey) duplicateLines(dir); else moveLines(dir);
      return;
    }

    if (settings.autoPair && !mod && !e.altKey && e.key.length === 1 && autoPair(e)) { e.preventDefault(); return; }

    if (e.key === 'Backspace' && settings.autoPair && !mod && editor.selectionStart === editor.selectionEnd) {
      const s = editor.selectionStart, v = editor.value;
      if (s > 0 && PAIRS[v[s - 1]] && PAIRS[v[s - 1]] === v[s]) { e.preventDefault(); replaceRange(s - 1, s + 1, ''); return; }
    }

    if (e.key === 'Tab' && !mod && !e.altKey && tableAt(editor.selectionStart) && !editor.value.slice(editor.selectionStart, editor.selectionEnd).includes('\n')) {
      e.preventDefault();
      formatTable(e.shiftKey ? -1 : 1);
      return;
    }

    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = editor;
      const [ls, le] = lineBounds(s, en);
      const multi = editor.value.slice(s, en).includes('\n');
      const onListLine = /^\s*(?:[-*+]|\d+[.)])\s/.test(editor.value.slice(ls, le));
      if (e.shiftKey || multi || onListLine) {
        const lines = editor.value.slice(ls, le).split('\n');
        const out = lines.map((l) => e.shiftKey ? l.replace(/^( {1,2}|\t)/, '') : '  ' + l).join('\n');
        const delta = out.split('\n')[0].length - lines[0].length;
        if (multi) replaceRange(ls, le, out, ls, ls + out.length);
        else replaceRange(ls, le, out, Math.max(ls, s + delta));
      } else {
        replaceRange(s, en, '  ');
      }
      return;
    }

    if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey && editor.selectionStart === editor.selectionEnd) {
      const pos = editor.selectionStart;
      const v = editor.value;
      const ls = v.lastIndexOf('\n', pos - 1) + 1;
      const line = v.slice(ls, pos);
      const m = line.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|(\d+)([.)])\s+|>\s?)/);
      if (!m) return;
      e.preventDefault();
      if (line.trim() === m[0].trim()) {
        replaceRange(ls, pos, '');
        return;
      }
      let marker = m[2];
      if (m[3]) marker = `${Number(m[3]) + 1}${m[4]} `;
      else if (/\[[ xX]\]/.test(marker)) marker = marker.replace(/\[[ xX]\]/, '[ ]');
      replaceRange(pos, pos, '\n' + m[1] + marker);
    }
  });

  editor.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const images = [...cd.files].filter((f) => f.type.startsWith('image/'));
    if (images.length) { e.preventDefault(); insertImages(images); return; }

    const text = cd.getData('text/plain');
    const { selectionStart: s, selectionEnd: en, value: v } = editor;
    if (text && s !== en && /^https?:\/\/\S+$/.test(text.trim()) && !v.slice(s, en).includes('\n')) {
      e.preventDefault();
      replaceRange(s, en, `[${v.slice(s, en)}](${text.trim()})`);
      return;
    }

    const html = cd.getData('text/html');
    if (settings.smartPaste && html) {
      const md = htmlToMarkdown(html);
      if (md) { e.preventDefault(); replaceRange(s, en, md); }
    }
  });

  async function pastePlain() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) replaceRange(editor.selectionStart, editor.selectionEnd, text.replace(/\r\n?/g, '\n'));
    } catch (e) {
      toast('Could not read the clipboard');
    }
  }

  // Rich text from web pages, Word or Google Docs becomes Markdown. Content that is only styled
  // text (code editors, terminals, plain selections) is pasted as is.
  const SEMANTIC = 'h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,pre,a[href],strong,b,em,i,img,code,hr,del,s';
  let turndown = null;
  function htmlToMarkdown(html) {
    if (!window.TurndownService) return null;
    const doc = DOMPurify.sanitize(html, { RETURN_DOM: true, FORBID_TAGS: ['style', 'meta', 'title'] });
    for (const b of doc.querySelectorAll('b[id^="docs-internal-guid"]')) b.replaceWith(...b.childNodes);
    if (!doc.querySelector(SEMANTIC)) return null;
    if (!turndown) {
      turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_', strongDelimiter: '**', hr: '---' });
      if (window.turndownPluginGfm) turndown.use(turndownPluginGfm.gfm);
      // List items with a single space after the marker ("- item"), like Inkwell's own lists.
      turndown.addRule('listItem', {
        filter: 'li',
        replacement(content, node, options) {
          const parent = node.parentNode;
          let prefix = options.bulletListMarker + ' ';
          if (parent.nodeName === 'OL') {
            const start = Number(parent.getAttribute('start')) || 1;
            prefix = (start + Array.prototype.indexOf.call(parent.children, node)) + '. ';
          }
          const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n(?!$)/g, '\n' + ' '.repeat(prefix.length));
          return prefix + body + (node.nextSibling && !/\n$/.test(body) ? '\n' : '');
        },
      });
    }
    try {
      return turndown.turndown(doc).replace(/\n{3,}/g, '\n\n').trim();
    } catch (e) {
      return null;
    }
  }

  // Pasted or dropped images are saved into an "assets" folder next to the document.
  async function insertImages(files) {
    if (!native) { toast('Pasting images works in the desktop app'); return; }
    if (!state.handle) {
      toast('Save the document first, so images can be stored next to it');
      await saveAs();
      if (!state.handle) return;
    }
    const links = [];
    for (const f of files) {
      try {
        const rel = await native.saveAsset(f.name || 'image.png', new Uint8Array(await f.arrayBuffer()));
        const alt = (f.name || 'image').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        links.push(`![${alt}](${rel.split('/').map(encodeURIComponent).join('/')})`);
      } catch (err) {
        toast('Could not save image: ' + err.message);
      }
    }
    if (links.length) {
      replaceRange(editor.selectionStart, editor.selectionEnd, links.join('\n'));
      toast(links.length === 1 ? 'Image saved to assets' : `${links.length} images saved to assets`);
    }
  }

  /* ---------- Preview interactions ---------- */
  preview.addEventListener('click', (e) => {
    const box = e.target.closest('input[type="checkbox"]');
    if (box) { toggleTask($$('input[type="checkbox"]', preview).indexOf(box), box.checked); return; }

    const img = e.target.closest('img');
    if (img && !img.closest('a')) { openLightbox(img); return; }

    const copy = e.target.closest('.copy-code');
    if (copy) {
      const code = copy.parentElement.querySelector('code');
      navigator.clipboard.writeText(code.textContent).then(() => toast('Code copied'), () => toast('Copy failed'));
      return;
    }

    const a = e.target.closest('a[href^="#"]');
    if (a) {
      e.preventDefault();
      const target = preview.querySelector(`[id="${CSS.escape(decodeURIComponent(a.getAttribute('href').slice(1)))}"]`);
      if (target) previewPane.scrollTo({ top: target.offsetTop - 24, behavior: 'smooth' });
    }
  });

  function toggleTask(index, checked) {
    const v = editor.value;
    const re = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;
    let inFence = false, count = 0, offset = 0;
    for (const line of v.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      else if (!inFence) {
        const m = line.match(re);
        if (m) {
          if (count === index) {
            const at = offset + m[1].length;
            const keep = [editor.selectionStart, editor.selectionEnd];
            const top = editor.scrollTop;
            const pTop = previewPane.scrollTop;
            editor.setRangeText(checked ? 'x' : ' ', at, at + 1, 'preserve');
            editor.setSelectionRange(...keep);
            editor.scrollTop = top;
            editor.dispatchEvent(new Event('input'));
            requestAnimationFrame(() => { previewPane.scrollTop = pTop; });
            return;
          }
          count++;
        }
      }
      offset += line.length + 1;
    }
  }

  /* ---------- Files ---------- */
  const normalize = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const baseName = (p) => p.split(/[\\/]/).pop();

  async function confirmDiscard() {
    if (!state.dirty) return true;
    if (!native && !state.handle) return true; // browser drafts are autosaved
    return confirm(`Discard unsaved changes to ${docName.value}?`);
  }

  async function ensurePermission(handle, mode = 'read') {
    if (!handle.queryPermission) return true;
    if ((await handle.queryPermission({ mode })) === 'granted') return true;
    return (await handle.requestPermission({ mode })) === 'granted';
  }

  // Desktop: open a file by absolute path into this window.
  async function openPath(p) {
    try {
      const f = await native.readFile(p);
      setDocument({ content: normalize(f.content), name: f.name, handle: { path: f.path, name: f.name } });
      addRecent({ name: f.name, path: f.path });
    } catch (err) {
      toast(`Could not open ${baseName(p)}`);
    }
  }

  // Browser: open a File System Access handle.
  async function openHandle(handle) {
    if (!(await ensurePermission(handle, 'read'))) { toast('Permission denied'); return; }
    const file = await handle.getFile();
    setDocument({ content: normalize(await file.text()), name: file.name, handle });
    addRecent({ name: file.name, handle });
    toast(`Opened ${file.name}`);
  }

  async function openFile() {
    if (native) {
      if (!(await confirmDiscard())) return;
      const [first, ...rest] = await native.openDialog();
      if (first) await openPath(first);
      rest.forEach((p) => native.newWindow(p));
      return;
    }
    if (!(await confirmDiscard())) return;
    if (!hasFsAccess) { $('#file-input').click(); return; }
    try {
      const [handle] = await window.showOpenFilePicker({ types: MD_TYPES, id: 'inkwell' });
      await openHandle(handle);
    } catch (err) {
      if (err.name !== 'AbortError') toast('Could not open file');
    }
  }

  $('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setDocument({ content: normalize(await file.text()), name: file.name });
    addRecent({ name: file.name, content: editor.value });
    e.target.value = '';
  });

  async function writeHandle(handle) {
    const w = await handle.createWritable();
    await w.write(editor.value);
    await w.close();
  }

  async function save({ quiet = false } = {}) {
    if (!state.handle) return quiet ? undefined : saveAs();
    try {
      const content = editor.value;
      if (native) {
        await native.writeFile(state.handle.path, content);
      } else {
        if (quiet && state.handle.queryPermission && (await state.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') return;
        if (!(await ensurePermission(state.handle, 'readwrite'))) { toast('Permission denied'); return; }
        await writeHandle(state.handle);
      }
      state.savedContent = content;
      persistDraft();
      updateMeta();
      if (!quiet) toast(`Saved ${state.handle.name}`);
      refreshFiles();
    } catch (err) {
      toast('Save failed: ' + err.message);
    }
  }

  let autosaveTimer;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    if (!settings.autosave || !state.handle) return;
    autosaveTimer = setTimeout(() => { if (state.dirty) save({ quiet: true }); }, 1200);
  }
  window.addEventListener('blur', () => { if (settings.autosave && state.handle && state.dirty) save({ quiet: true }); });

  function suggestedName() {
    const name = docName.value.trim() || 'Untitled.md';
    return /\.(md|markdown|mdown|mkd|mkdn|txt)$/i.test(name) ? name : name + '.md';
  }

  async function saveAs() {
    const name = suggestedName();
    try {
      if (native) {
        const p = await native.saveDialog(name);
        if (!p) return;
        await native.writeFile(p, editor.value);
        state.handle = { path: p, name: baseName(p) };
      } else if ('showSaveFilePicker' in window) {
        const handle = await window.showSaveFilePicker({ suggestedName: name, types: MD_TYPES, id: 'inkwell' });
        await writeHandle(handle);
        state.handle = handle;
        idb.set('current', handle);
      } else {
        download(name, editor.value, 'text/markdown');
        markSaved();
        return;
      }
      docName.value = state.handle.name;
      addRecent(native ? { name: state.handle.name, path: state.handle.path } : { name: state.handle.name, handle: state.handle });
      markSaved();
      toast(`Saved ${state.handle.name}`);
    } catch (err) {
      if (err.name !== 'AbortError') toast('Save failed: ' + err.message);
    }
  }

  function markSaved() {
    state.savedContent = editor.value;
    persistDraft();
    updateMeta();
    refreshFiles();
  }

  async function newDoc() {
    if (!(await confirmDiscard())) return;
    setDocument({ content: '', name: 'Untitled.md' });
    if (app.dataset.view === 'read') setView('split');
    editor.focus();
  }

  async function exportPdf() {
    try {
      const out = await native.exportPdf(suggestedName().replace(/\.[^.]+$/, '') + '.pdf');
      if (out) toast(`Exported ${baseName(out)}`);
    } catch (err) {
      toast('PDF export failed: ' + err.message);
    }
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  docName.addEventListener('input', () => { persistDraft(); updateMeta(); });
  docName.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); editor.focus(); } });
  docName.addEventListener('blur', () => { if (!docName.value.trim()) docName.value = 'Untitled.md'; updateMeta(); });

  if (native) {
    native.onSaveAndClose(async () => {
      await save();
      if (!state.dirty) native.closeWindow();
    });
    native.onFileChanged(({ content }) => {
      const text = normalize(content);
      if (text === editor.value) return;
      if (state.dirty) { toast('File changed on disk - your unsaved edits are kept'); return; }
      const top = editor.scrollTop, pTop = previewPane.scrollTop;
      const sel = [editor.selectionStart, editor.selectionEnd];
      editor.value = text;
      state.savedContent = text;
      editor.setSelectionRange(...sel);
      render();
      updateMeta();
      editor.scrollTop = top;
      previewPane.scrollTop = pTop;
      toast('Reloaded - file changed on disk');
    });
  }

  /* ---------- Recent files ---------- */
  async function getRecent() { return (await idb.get(native ? 'recent-native' : 'recent')) || []; }
  const setRecent = (list) => idb.set(native ? 'recent-native' : 'recent', list);

  async function sameEntry(a, b) {
    if (a.path || b.path) return !!a.path && !!b.path && a.path.toLowerCase() === b.path.toLowerCase();
    if (a.handle && b.handle) { try { return await a.handle.isSameEntry(b.handle); } catch (e) { return false; } }
    return !a.handle && !b.handle && a.name === b.name;
  }

  async function addRecent(entry) {
    const kept = [];
    for (const r of await getRecent()) if (!(await sameEntry(entry, r))) kept.push(r);
    kept.unshift({ ...entry, at: Date.now() });
    await setRecent(kept.slice(0, 12));
    renderRecent();
  }

  async function renderRecent() {
    const list = await getRecent();
    recentEl.innerHTML = '';
    if (!list.length) {
      recentEl.innerHTML = '<li><p class="empty-hint">Files you open show up here.</p></li>';
      return;
    }
    list.forEach((r, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<button class="recent-open"><svg><use href="#i-file"/></svg><span></span></button><button class="recent-remove" title="Remove from list" aria-label="Remove from list"><svg><use href="#i-x"/></svg></button>';
      li.querySelector('span').textContent = r.name;
      li.querySelector('.recent-open').title = `${r.path || r.name}\nOpened ${new Date(r.at).toLocaleString()}`;
      li.querySelector('.recent-open').addEventListener('click', async () => {
        if (state.handle && (await sameEntry(r, native ? { path: state.handle.path } : { handle: state.handle }))) return;
        if (!(await confirmDiscard())) return;
        try {
          if (r.path) await openPath(r.path);
          else if (r.handle) await openHandle(r.handle);
          else { setDocument({ content: r.content || '', name: r.name }); addRecent(r); }
        } catch (err) {
          toast('That file is no longer available');
        }
      });
      li.querySelector('.recent-remove').addEventListener('click', async () => {
        const cur = await getRecent();
        cur.splice(i, 1);
        await setRecent(cur);
        renderRecent();
      });
      recentEl.appendChild(li);
    });
  }

  /* ---------- Files (folder tree, desktop only) ---------- */
  const filesEl = $('#files');
  const tree = { root: null, pinned: ls.get('folder', null), expanded: new Set(ls.get('expanded', [])) };
  const pathKey = (p) => (p || '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
  const isInside = (p, dir) => pathKey(p).startsWith(pathKey(dir) + '/');
  const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '');

  function treeRoot() {
    const doc = state.handle && state.handle.path;
    if (tree.pinned && (!doc || isInside(doc, tree.pinned))) return tree.pinned;
    return doc ? dirOf(doc) : tree.pinned;
  }

  let filesTimer;
  function refreshFiles() {
    if (!native || !filesEl) return;
    clearTimeout(filesTimer);
    filesTimer = setTimeout(renderFiles, 30);
  }

  async function renderFiles() {
    const root = treeRoot();
    tree.root = root;
    $('#files-name').textContent = root ? baseName(root) || root : 'Files';
    $('#files-name').title = root || '';
    if (!root) {
      filesEl.innerHTML = '<p class="empty-hint">Save the document or open a folder to see its files.</p>';
      return;
    }
    const list = await listDir(root);
    const frag = document.createDocumentFragment();
    await appendEntries(frag, list, 0);
    filesEl.replaceChildren(frag);
    if (!list.length) filesEl.innerHTML = '<p class="empty-hint">No Markdown files in this folder.</p>';
  }

  async function listDir(dir) {
    try { return await native.listDir(dir); } catch (e) { return []; }
  }

  async function appendEntries(parent, entries, depth) {
    const current = state.handle && state.handle.path;
    for (const entry of entries) {
      const btn = document.createElement('button');
      btn.className = 'file-item' + (entry.dir ? ' is-dir' : '') + (!entry.dir && pathKey(entry.path) === pathKey(current) ? ' current' : '');
      btn.style.setProperty('--depth', depth);
      btn.title = entry.path;
      btn.dataset.path = entry.path;
      const open = entry.dir && tree.expanded.has(pathKey(entry.path));
      btn.innerHTML = entry.dir
        ? `<svg class="chev${open ? ' open' : ''}"><use href="#i-chevron"/></svg><svg><use href="#i-folder"/></svg><span></span>`
        : '<svg><use href="#i-file"/></svg><span></span>';
      btn.querySelector('span').textContent = entry.dir ? entry.name : entry.name.replace(/\.(md|markdown|mdown|mkd|mkdn)$/i, '');
      if (entry.dir) btn.dataset.dir = '1';
      parent.appendChild(btn);
      if (open) await appendEntries(parent, await listDir(entry.path), depth + 1);
    }
  }

  if (filesEl) {
    filesEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('.file-item');
      if (!btn) return;
      const p = btn.dataset.path;
      if (btn.dataset.dir) {
        const k = pathKey(p);
        if (tree.expanded.has(k)) tree.expanded.delete(k); else tree.expanded.add(k);
        ls.set('expanded', [...tree.expanded].slice(-200));
        renderFiles();
        return;
      }
      if (e.ctrlKey || e.metaKey) { native.newWindow(p); return; }
      if (state.handle && pathKey(state.handle.path) === pathKey(p)) return;
      if (!(await confirmDiscard())) return;
      await openPath(p);
    });
    filesEl.addEventListener('auxclick', (e) => {
      const btn = e.target.closest('.file-item:not(.is-dir)');
      if (btn && e.button === 1) native.newWindow(btn.dataset.path);
    });
    window.addEventListener('focus', refreshFiles);
  }

  async function openFolder() {
    const dir = await native.openFolderDialog();
    if (!dir) return;
    tree.pinned = dir;
    ls.set('folder', dir);
    toggleSidebar(true);
    renderFiles();
  }

  /* ---------- Image lightbox ---------- */
  const lightbox = $('#lightbox');
  function openLightbox(img) {
    const big = $('#lightbox-img');
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    $('#lightbox-caption').textContent = img.alt || '';
    lightbox.hidden = false;
  }
  lightbox.addEventListener('click', () => { lightbox.hidden = true; });

  /* ---------- Drag & drop ---------- */
  const overlay = $('#drop-overlay');
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const onlyImages = (list) => list.length > 0 && [...list].every((it) => (it.type || '').startsWith('image/'));
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    $('#drop-text').textContent = onlyImages(e.dataTransfer.items) && app.dataset.view !== 'read'
      ? 'Drop images to insert them'
      : 'Drop a Markdown file to open it';
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; overlay.hidden = true; } });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (onlyImages(files) && app.dataset.view !== 'read') { insertImages(files); return; }

    if (native) {
      const paths = files.map((f) => native.pathForFile(f)).filter(Boolean);
      const [first, ...rest] = paths;
      rest.forEach((p) => native.newWindow(p));
      if (first && (await confirmDiscard())) await openPath(first);
      return;
    }

    const item = [...e.dataTransfer.items].find((it) => it.kind === 'file');
    const handlePromise = item && item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null;
    if (!(await confirmDiscard())) return;
    const handle = handlePromise ? await handlePromise.catch(() => null) : null;
    if (handle && handle.kind === 'file') return openHandle(handle);
    setDocument({ content: normalize(await files[0].text()), name: files[0].name });
    addRecent({ name: files[0].name, content: editor.value });
  });

  /* ---------- Export ---------- */
  const EXPORT_CSS = `:root{color-scheme:light dark;--bg:#fffdf9;--text:#1f1c17;--muted:#857c6e;--border:#e3dccf;--accent:#3346d3;--code:#f3eee5;--soft:rgba(51,70,211,.08)}
@media (prefers-color-scheme:dark){:root{--bg:#121318;--text:#e9e5dc;--muted:#8a8578;--border:#2a2e39;--accent:#8f9dff;--code:#1c1e26;--soft:rgba(143,157,255,.12)}}
body{margin:0;background:var(--bg);color:var(--text);font:19px/1.7 Newsreader,Georgia,serif}
main{max-width:720px;margin:0 auto;padding:64px 24px 96px}
h1,h2,h3,h4{line-height:1.2;letter-spacing:-.015em;margin:1.8em 0 .6em;font-weight:600}h1{font-size:2.3em;font-weight:500;margin-top:0}h2{font-size:1.6em;font-weight:500;border-bottom:1px solid var(--border);padding-bottom:.25em}
a{color:var(--accent);text-underline-offset:3px}.anchor{display:none}
blockquote{margin:0 0 1.1em;padding:.1em 1.1em;border-left:3px solid var(--accent);background:var(--soft);font-style:italic;border-radius:0 8px 8px 0}
code{font:.8em "JetBrains Mono",Consolas,monospace;background:var(--code);border:1px solid var(--border);border-radius:5px;padding:.12em .38em}
pre{background:var(--code);border:1px solid var(--border);border-radius:10px;padding:16px 18px;overflow-x:auto}pre code{border:0;padding:0;background:none;font-size:.72em}.code-lang,.copy-code{display:none}
table{border-collapse:collapse;font:.8em/1.5 system-ui,sans-serif}th,td{border:1px solid var(--border);padding:8px 12px;text-align:left}
img{max-width:100%;border-radius:10px}hr{border:0;border-top:1px solid var(--border);margin:2.4em 0}li::marker{color:var(--muted)}
.hljs-keyword,.hljs-literal{color:#a3268c}.hljs-string{color:#1f7a4d}.hljs-number{color:#b45309}.hljs-comment{color:#9a9182;font-style:italic}.hljs-title{color:#2f47c9}.hljs-attr,.hljs-property{color:#0e7490}
mark{background:#fbe7a1;color:inherit;padding:0 2px;border-radius:3px}.math-block{overflow-x:auto;margin:0 0 1.1em}.diagram{text-align:center;margin:0 0 1.1em}.diagram svg{max-width:100%;height:auto}
.callout{--c:#3346d3;border:1px solid color-mix(in srgb,var(--c) 30%,transparent);border-left:4px solid var(--c);background:color-mix(in srgb,var(--c) 7%,transparent);border-radius:8px;padding:.6em 1em;margin:0 0 1.1em}.callout-title{font:600 .8em system-ui,sans-serif;color:var(--c);margin:0 0 .3em;text-transform:uppercase;letter-spacing:.05em}.callout-body>:last-child{margin-bottom:0}
.callout[data-callout=tip]{--c:#15803d}.callout[data-callout=important]{--c:#7c3aed}.callout[data-callout=warning]{--c:#b45309}.callout[data-callout=caution]{--c:#c2410c}.callout[data-callout=quote]{--c:#857c6e}
.footnotes{border-top:1px solid var(--border);margin-top:3em;padding-top:1em;font-size:.85em}.fn-back{text-decoration:none}.frontmatter{border:1px solid var(--border);border-radius:8px;padding:.6em 1em;margin-bottom:2em;font:.75em/1.6 system-ui,sans-serif}.frontmatter dl{display:grid;grid-template-columns:auto 1fr;gap:2px 16px;margin:0}.frontmatter dt{color:var(--muted)}.frontmatter dd{margin:0}.fm-chip{display:inline-block;border:1px solid var(--border);border-radius:99px;padding:0 8px;margin:0 4px 2px 0}
.toc ul{list-style:none;padding-left:0}.toc li[data-level="2"]{padding-left:1em}.toc li[data-level="3"]{padding-left:2em}.toc li[data-level="4"]{padding-left:3em}`;

  function exportHtml() {
    const title = docName.value.replace(/\.[^.]+$/, '');
    const body = preview.cloneNode(true);
    body.querySelectorAll('.copy-code').forEach((n) => n.remove());
    body.querySelectorAll('input[type="checkbox"]').forEach((n) => n.setAttribute('disabled', ''));
    const katexCss = body.querySelector('.katex') ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${window.katex ? katex.version : '0.19.0'}/dist/katex.min.css">\n` : '';
    const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n${katexCss}<style>${EXPORT_CSS}</style>\n</head>\n<body>\n<main>\n${body.innerHTML}\n</main>\n</body>\n</html>\n`;
    download(title + '.html', html, 'text/html');
    toast('Exported HTML');
  }

  async function copyHtml() {
    const clone = preview.cloneNode(true);
    clone.querySelectorAll('.copy-code, .anchor, .code-lang').forEach((n) => n.remove());
    const html = clone.innerHTML;
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([editor.value], { type: 'text/plain' }),
      })]);
    } catch (e) {
      await navigator.clipboard.writeText(html);
    }
    toast('Copied as rich text');
  }

  /* ---------- Views, sidebar, resizer, zen ---------- */
  function setView(view) {
    app.dataset.view = view;
    ls.set('view', view);
    $$('.view-switch button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    moveIndicator($('.view-switch'));
    syncMap = null;
    requestAnimationFrame(() => {
      if (view === 'split') previewPane.scrollTop = interpolate(getSyncMap().points, 'e', 'p', editor.scrollTop);
      if (view !== 'read' && !find.open) editor.focus({ preventScroll: true });
      updateActiveOutline();
      if (find.open) refreshFind(true);
    });
  }
  $$('.view-switch button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  function toggleSidebar(force) {
    const hide = force !== undefined ? !force : !app.classList.contains('no-sidebar');
    app.classList.toggle('no-sidebar', hide);
    ls.set('sidebar', !hide);
    setTimeout(() => { syncMap = null; }, 320);
  }
  $('#btn-sidebar').addEventListener('click', () => toggleSidebar());

  function toggleZen(force) {
    const on = force !== undefined ? force : !app.classList.contains('zen');
    app.classList.toggle('zen', on);
    if (on) { toast('Focus mode - press Esc to exit'); if (app.dataset.view !== 'read') editor.focus(); }
    syncMap = null;
  }

  const resizer = $('#resizer');
  resizer.addEventListener('pointerdown', (e) => {
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    const rect = workspace.getBoundingClientRect();
    const move = (ev) => {
      const pct = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100));
      workspace.style.setProperty('--split', pct + '%');
    };
    const up = () => {
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', up);
      ls.set('split', workspace.style.getPropertyValue('--split'));
      syncMap = null;
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
  });
  resizer.addEventListener('dblclick', () => { workspace.style.setProperty('--split', '50%'); ls.set('split', '50%'); syncMap = null; });
  resizer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cur = parseFloat(workspace.style.getPropertyValue('--split')) || 50;
    const next = Math.min(80, Math.max(20, cur + (e.key === 'ArrowLeft' ? -2 : 2)));
    workspace.style.setProperty('--split', next + '%');
    ls.set('split', next + '%');
    syncMap = null;
  });

  /* ---------- Theme ---------- */
  function setTheme(choice, animate = true) {
    const root = document.documentElement;
    if (animate) {
      root.classList.add('theme-anim');
      setTimeout(() => root.classList.remove('theme-anim'), 400);
    }
    if (choice === 'system') delete root.dataset.theme;
    else root.dataset.theme = choice;
    try { localStorage.setItem('inkwell.theme', choice); } catch (e) { /* storage unavailable */ }
    if (native) native.setTheme(choice);
    $$('.theme-switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice)));
    moveIndicator($('.theme-switch'));
    if (diagramSources.length) fillDiagrams();
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (diagramSources.length) fillDiagrams(); });
  $$('.theme-switch button').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeChoice)));
  const currentTheme = () => { try { return localStorage.getItem('inkwell.theme') || 'system'; } catch (e) { return 'system'; } };

  function moveIndicator(group) {
    const active = group.querySelector('[aria-selected="true"], [aria-checked="true"]');
    const ind = group.querySelector('.seg-indicator');
    if (!active || !ind) return;
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
  }
  const refreshIndicators = () => $$('.segmented').forEach(moveIndicator);
  window.addEventListener('resize', () => { refreshIndicators(); syncMap = null; });

  /* ---------- Menu ---------- */
  const moreMenu = $('#more-menu');
  const closeMenu = () => { moreMenu.hidden = true; };
  $('#btn-more').addEventListener('click', (e) => { e.stopPropagation(); moreMenu.hidden = !moreMenu.hidden; });
  document.addEventListener('click', (e) => { if (!moreMenu.hidden && !moreMenu.contains(e.target)) closeMenu(); });
  moreMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    closeMenu();
    commandById[b.dataset.cmd].run();
  });

  $('#btn-new').addEventListener('click', newDoc);
  $('#btn-open').addEventListener('click', openFile);
  $('#btn-save').addEventListener('click', save);

  /* ---------- Command palette ---------- */
  const commands = [
    { id: 'new', label: 'New document', icon: 'plus', kbd: 'Ctrl Alt N', run: newDoc },
    { id: 'open', label: 'Open file…', icon: 'open', kbd: 'Ctrl O', run: openFile },
    { id: 'save', label: 'Save', icon: 'save', kbd: 'Ctrl S', run: save },
    { id: 'saveAs', label: 'Save as…', icon: 'save', kbd: 'Ctrl Shift S', run: saveAs },
    { id: 'write', label: 'View: Write', icon: 'pen', kbd: 'Ctrl 1', run: () => setView('write') },
    { id: 'split', label: 'View: Split', icon: 'split', kbd: 'Ctrl 2', run: () => setView('split') },
    { id: 'read', label: 'View: Read', icon: 'book', kbd: 'Ctrl 3', run: () => setView('read') },
    { id: 'themeLight', label: 'Theme: Light', icon: 'sun', run: () => setTheme('light') },
    { id: 'themeDark', label: 'Theme: Dark', icon: 'moon', run: () => setTheme('dark') },
    { id: 'themeSystem', label: 'Theme: System', icon: 'monitor', run: () => setTheme('system') },
    { id: 'sidebar', label: 'Toggle sidebar', icon: 'sidebar', kbd: 'Ctrl Shift B', run: () => toggleSidebar() },
    { id: 'zen', label: 'Toggle focus mode', icon: 'focus', kbd: 'Ctrl .', run: () => toggleZen() },
    { id: 'exportHtml', label: 'Export as HTML', icon: 'download', run: exportHtml },
    { id: 'copyHtml', label: 'Copy as rich text / HTML', icon: 'copy', run: copyHtml },
    { id: 'print', label: 'Print', icon: 'printer', kbd: 'Ctrl P', run: () => window.print() },
    ...(native ? [
      { id: 'exportPdf', label: 'Export as PDF', icon: 'download', run: exportPdf },
      { id: 'newWindow', label: 'New window', icon: 'plus', kbd: 'Ctrl N', run: () => native.newWindow() },
      { id: 'showInFolder', label: isMac ? 'Show file in Finder' : 'Show file in Explorer', icon: 'open', run: () => (state.handle ? native.showInFolder(state.handle.path) : toast('Save the document first')) },
    ] : []),
    { id: 'palette', label: 'Command palette', icon: 'command', kbd: 'Ctrl Shift P', run: () => openPalette() },
    { id: 'find', label: 'Find', icon: 'search', kbd: 'Ctrl F', run: () => openFind(false) },
    { id: 'replace', label: 'Find and replace', icon: 'replace', kbd: 'Ctrl Alt F', run: () => openFind(true) },
    { id: 'settings', label: 'Settings', icon: 'settings', kbd: 'Ctrl ,', run: () => openSettings() },
    { id: 'formatTable', label: 'Format table', icon: 'table', run: () => formatTable(0) },
    { id: 'typewriter', label: 'Toggle typewriter scrolling', icon: 'focus', run: () => { setSetting('typewriter', !settings.typewriter); toast(settings.typewriter ? 'Typewriter scrolling on' : 'Typewriter scrolling off'); typewriterScroll(); } },
    { id: 'autosave', label: 'Toggle autosave', icon: 'save', run: () => { setSetting('autosave', !settings.autosave); toast(settings.autosave ? 'Autosave on' : 'Autosave off'); scheduleAutosave(); } },
    { id: 'pastePlain', label: 'Paste as plain text', icon: 'copy', kbd: 'Ctrl Shift V', run: pastePlain },
    { id: 'insertTable', label: 'Insert table', icon: 'table', run: formats.table },
    { id: 'insertTask', label: 'Insert task list', icon: 'check', run: formats.task },
    { id: 'insertMath', label: 'Insert math', icon: 'sigma', kbd: 'Ctrl Shift M', run: formats.math },
    { id: 'insertDiagram', label: 'Insert diagram (Mermaid)', icon: 'diagram', run: formats.diagram },
    { id: 'insertCallout', label: 'Insert callout', icon: 'callout', run: formats.callout },
    { id: 'insertFootnote', label: 'Insert footnote', icon: 'footnote', run: formats.footnote },
    { id: 'insertToc', label: 'Insert table of contents', icon: 'list', run: formats.toc },
    { id: 'insertDate', label: 'Insert today\'s date', icon: 'calendar', run: formats.date },
    { id: 'highlight', label: 'Highlight', icon: 'highlight', kbd: 'Ctrl Shift H', run: formats.mark },
    { id: 'moveLineUp', label: 'Move line up', icon: 'up', kbd: 'Alt ↑', run: () => moveLines(-1) },
    { id: 'moveLineDown', label: 'Move line down', icon: 'down', kbd: 'Alt ↓', run: () => moveLines(1) },
    { id: 'duplicateLine', label: 'Duplicate line', icon: 'copy', kbd: 'Shift Alt ↓', run: () => duplicateLines(1) },
    ...(native ? [
      { id: 'openFolder', label: 'Open folder…', icon: 'folder', run: () => openFolder() },
      ...(isMac ? [] : [
        { id: 'zoomIn', label: 'Zoom in', icon: 'plus', kbd: 'Ctrl =', run: () => zoom(1) },
        { id: 'zoomOut', label: 'Zoom out', icon: 'minus', kbd: 'Ctrl -', run: () => zoom(-1) },
        { id: 'zoomReset', label: 'Reset zoom', icon: 'monitor', kbd: 'Ctrl 0', run: () => zoom(0) },
      ]),
    ] : []),
    { id: 'welcome', label: 'Show welcome guide', icon: 'book', run: async () => { if (await confirmDiscard()) setDocument({ content: welcomeText(), name: 'Welcome.md' }); } },
  ];
  const commandById = Object.fromEntries(commands.map((c) => [c.id, c]));

  const palette = $('#palette');
  const pInput = $('#palette-input');
  const pList = $('#palette-list');
  let pItems = [], pActive = 0, pReturnFocus = null;

  function fuzzyScore(query, text) {
    if (!query) return 1;
    const q = query.toLowerCase(), t = text.toLowerCase();
    if (t.includes(q)) return 100 - t.indexOf(q);
    let ti = 0, score = 0;
    for (const ch of q) {
      const found = t.indexOf(ch, ti);
      if (found === -1) return 0;
      score += found === ti ? 3 : 1;
      ti = found + 1;
    }
    return score;
  }

  function renderPalette() {
    const q = pInput.value.trim();
    pItems = commands.filter((c) => c.id !== 'palette')
      .map((c) => ({ c, s: fuzzyScore(q, c.label) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
    pActive = Math.min(pActive, Math.max(0, pItems.length - 1));
    pList.innerHTML = '';
    if (!pItems.length) { pList.innerHTML = '<li class="no-results">No matching commands</li>'; return; }
    pItems.forEach((c, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.className = i === pActive ? 'active' : '';
      li.innerHTML = `<svg><use href="#i-${c.icon}"/></svg><span></span>${c.kbd ? `<kbd>${keyLabel(c.kbd)}</kbd>` : ''}`;
      li.querySelector('span').textContent = c.label;
      li.addEventListener('mousemove', () => { if (pActive !== i) { pActive = i; highlightPalette(); } });
      li.addEventListener('click', () => runPalette(i));
      pList.appendChild(li);
    });
  }
  function highlightPalette() {
    $$('li', pList).forEach((li, i) => li.classList.toggle('active', i === pActive));
    const el = pList.children[pActive];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
  function openPalette() {
    pReturnFocus = document.activeElement;
    palette.hidden = false;
    pInput.value = '';
    pActive = 0;
    renderPalette();
    pInput.focus();
  }
  function closePalette() {
    palette.hidden = true;
    if (pReturnFocus && pReturnFocus.focus) pReturnFocus.focus({ preventScroll: true });
  }
  function runPalette(i) {
    const c = pItems[i];
    closePalette();
    if (c) c.run();
  }
  pInput.addEventListener('input', () => { pActive = 0; renderPalette(); });
  pInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); pActive = (pActive + 1) % Math.max(1, pItems.length); highlightPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pActive = (pActive - 1 + pItems.length) % Math.max(1, pItems.length); highlightPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalette(pActive); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  palette.addEventListener('mousedown', (e) => { if (e.target === palette) closePalette(); });

  /* ---------- About ---------- */
  const SHORTCUTS = [
    ['Files', [
      ['Open', 'Ctrl O'], ['Save', 'Ctrl S'], ['Save as', 'Ctrl Shift S'],
      ...(native ? [['New window', 'Ctrl N'], ['Close window', 'Ctrl W']] : []),
      ['New document', 'Ctrl Alt N'], ['Print', 'Ctrl P'],
    ]],
    ['View', [
      ['Write / Split / Read', 'Ctrl 1 2 3'], ['Focus mode', 'Ctrl .'],
      ['Toggle sidebar', 'Ctrl Shift B'], ['Command palette', 'Ctrl Shift P'],
      ['Settings', 'Ctrl ,'], ['About & shortcuts', 'F1'],
      ...(native && !isMac ? [['Zoom in / out / reset', 'Ctrl = - 0']] : []),
    ]],
    ['Find', [
      ['Find', 'Ctrl F'], ['Find and replace', 'Ctrl Alt F'], ['Next / previous match', 'Enter / Shift Enter'],
    ]],
    ['Formatting', [
      ['Bold', 'Ctrl B'], ['Italic', 'Ctrl I'], ['Strikethrough', 'Ctrl Shift X'], ['Highlight', 'Ctrl Shift H'],
      ['Link', 'Ctrl K'], ['Inline code', 'Ctrl E'], ['Math', 'Ctrl Shift M'], ['Cycle heading', isMac ? '\u2303 H' : 'Ctrl H'],
      ['Indent / outdent list', 'Tab / Shift Tab'],
    ]],
    ['Editing', [
      ['Next / previous table cell', 'Tab / Shift Tab'], ['Move line up / down', 'Alt \u2191 \u2193'],
      ['Duplicate line', 'Shift Alt \u2193'], ['Paste as plain text', 'Ctrl Shift V'],
    ]],
  ];

  const about = $('#about');
  let aboutReturnFocus = null;
  let aboutFilled = false;

  async function fillAbout() {
    if (aboutFilled) return;
    aboutFilled = true;
    const info = native ? await native.getAppInfo() : null;
    $('#about-version').textContent = info ? `Version ${info.version}` : 'Web edition';
    $('#about-year').textContent = String(Math.max(2026, new Date().getFullYear()));
    const facts = info
      ? [['Version', info.version], ['Electron', info.electron], ['Chromium', info.chrome], ['Node.js', info.node], ['Platform', info.platform]]
      : [['Edition', 'Web'], ['Browser', navigator.userAgentData ? navigator.userAgentData.brands.map((b) => `${b.brand} ${b.version}`).filter((s) => !/Not/.test(s)).join(', ') : 'Web browser']];
    const dl = $('#about-facts');
    for (const [k, v] of facts) {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      dl.append(dt, dd);
    }
    const list = $('#shortcut-list');
    for (const [group, rows] of SHORTCUTS) {
      const g = document.createElement('dt');
      g.className = 'group';
      g.textContent = group;
      list.appendChild(g);
      for (const [label, keys] of rows) {
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = label;
        keyLabel(keys).split(' ').forEach((k) => {
          const kbd = document.createElement('kbd');
          kbd.textContent = k;
          dd.appendChild(kbd);
        });
        list.append(dt, dd);
      }
    }
  }

  function setAboutTab(tab) {
    $$('.about-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $$('.about-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    moveIndicator($('.about-tabs'));
  }

  async function openAbout(tab = 'info') {
    closeMenu();
    if (!palette.hidden) closePalette();
    aboutReturnFocus = document.activeElement;
    await fillAbout();
    about.hidden = false;
    setAboutTab(tab);
    $('#about-dialog').focus();
  }

  function closeAbout() {
    about.hidden = true;
    if (aboutReturnFocus && aboutReturnFocus.focus) aboutReturnFocus.focus({ preventScroll: true });
  }

  $('#btn-about').addEventListener('click', () => openAbout());
  $('#about-close').addEventListener('click', closeAbout);
  about.addEventListener('mousedown', (e) => { if (e.target === about) closeAbout(); });
  $$('.about-tabs button').forEach((b) => b.addEventListener('click', () => setAboutTab(b.dataset.tab)));
  about.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAbout(); return; }
    if (e.key !== 'Tab') return;
    const focusable = $$('button, a[href]', about).filter((el) => el.offsetParent !== null);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  commands.push(
    { id: 'about', label: 'About Inkwell', icon: 'help', kbd: 'F1', run: () => openAbout() },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', run: () => openAbout('keys') },
  );
  commandById.about = commands[commands.length - 2];
  commandById.shortcuts = commands[commands.length - 1];

  /* ---------- Updates ---------- */
  const updateCard = $('#update-card');
  const updateRow = $('#update-row');
  let updateState = { status: 'idle' };
  let dismissedFor = null;

  function describeUpdate(s) {
    switch (s.status) {
      case 'checking': return { row: 'Checking for updates…', action: null };
      case 'none': return { row: `You're up to date (${s.current})`, action: 'Check now' };
      case 'downloading': return { row: `Downloading Inkwell ${s.version}… ${s.percent || 0}%`, action: null };
      case 'ready': return { row: `Inkwell ${s.version} is ready to install`, action: 'Restart to update' };
      case 'manual': return { row: s.message || `Inkwell ${s.version} is available`, action: 'Download' };
      case 'error': return { row: s.message || 'Couldn\'t check for updates', action: 'Try again' };
      case 'unsupported': return { row: s.message || 'Automatic updates are off', action: null };
      default: return { row: 'Automatic updates are on', action: 'Check now' };
    }
  }

  function renderUpdate(s) {
    updateState = s;
    const { row, action } = describeUpdate(s);
    updateRow.dataset.status = s.status;
    $('#update-text').textContent = row;
    const btn = $('#update-action');
    btn.hidden = !action;
    if (action) btn.textContent = action;

    // The floating card appears for downloads and finished updates, unless dismissed for this version.
    const show = ['downloading', 'ready', 'manual'].includes(s.status) && dismissedFor !== `${s.status}:${s.version}`;
    updateCard.hidden = !show;
    if (!show) return;
    $('#update-card-title').textContent = s.status === 'downloading' ? `Downloading Inkwell ${s.version}` : `Inkwell ${s.version} is available`;
    $('#update-card-text').textContent = s.status === 'downloading'
      ? 'You can keep working. Inkwell will let you know when it\'s ready.'
      : s.status === 'ready' ? 'Restart to finish updating. Your files stay as they are.' : (s.message || 'Download it from GitHub.');
    const bar = $('#update-progress');
    bar.hidden = s.status !== 'downloading';
    bar.firstElementChild.style.width = `${s.percent || 0}%`;
    const primary = $('#update-card-primary');
    primary.hidden = s.status === 'downloading';
    primary.textContent = s.status === 'ready' ? 'Restart' : 'Download';
  }

  async function installUpdate() {
    // Save first, so the restart never asks about unsaved changes mid-update.
    if (updateState.status === 'ready' && state.dirty && state.handle) await save();
    native.installUpdate();
  }

  function updateAction() {
    if (updateState.status === 'ready' || updateState.status === 'manual') installUpdate();
    else native.checkForUpdates();
  }

  if (native && native.onUpdateState) {
    native.onUpdateState(renderUpdate);
    native.getUpdateState().then(renderUpdate);
    $('#update-action').addEventListener('click', updateAction);
    $('#update-card-primary').addEventListener('click', installUpdate);
    $('#update-card-close').addEventListener('click', () => {
      dismissedFor = `${updateState.status}:${updateState.version}`;
      updateCard.hidden = true;
    });
    commands.push({ id: 'checkUpdates', label: 'Check for updates', icon: 'download', run: () => { native.checkForUpdates(); openAbout(); } });
    commandById.checkUpdates = commands[commands.length - 1];
  }

  /* ---------- Find & replace ---------- */
  const findbar = $('#findbar');
  const fbFind = $('#fb-find');
  const fbReplace = $('#fb-replace');
  const editorMarks = $('#editor-marks');
  const find = { open: false, re: null, matches: [], index: -1, ranges: [], opts: { case: false, word: false, regex: false, ...ls.get('findOpts', {}) } };
  const hasHighlights = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';

  function buildFindRegex() {
    const q = fbFind.value;
    if (!q) return null;
    let src = find.opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (find.opts.word) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    try { return new RegExp(src, 'gmu' + (find.opts.case ? '' : 'i')); } catch (e) {
      try { return new RegExp(src, 'gm' + (find.opts.case ? '' : 'i')); } catch (e2) { return 'invalid'; }
    }
  }

  function collect(re, text, limit = 10000) {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) && out.length < limit) {
      if (m[0] === '') { re.lastIndex++; continue; }
      out.push([m.index, m.index + m[0].length]);
    }
    return out;
  }

  const findInPreview = () => app.dataset.view === 'read';

  // Recomputes matches. With `jump`, selects the first match at or after the cursor.
  function refreshFind(jump) {
    const re = buildFindRegex();
    find.re = re instanceof RegExp ? re : null;
    findbar.classList.toggle('invalid', re === 'invalid');
    find.matches = find.re ? collect(find.re, editor.value) : [];
    paintPreviewMatches();
    if (jump) {
      if (findInPreview()) find.index = find.ranges.length ? 0 : -1;
      else {
        const from = Math.min(editor.selectionStart, editor.selectionEnd);
        const i = find.matches.findIndex(([s]) => s >= from);
        find.index = find.matches.length ? (i < 0 ? 0 : i) : -1;
      }
      showCurrent();
    } else {
      const n = findInPreview() ? find.ranges.length : find.matches.length;
      if (find.index >= n) find.index = n - 1;
      paintEditorMarks();
      paintCurrentPreview(false);
      updateFindCount();
    }
  }

  function updateFindCount() {
    const n = findInPreview() ? find.ranges.length : find.matches.length;
    $('#fb-count').textContent = !fbFind.value ? '' : n ? `${find.index + 1} of ${n >= 10000 ? '10000+' : n}` : 'No results';
  }

  function step(dir) {
    const n = findInPreview() ? find.ranges.length : find.matches.length;
    if (!n) return;
    find.index = ((find.index < 0 ? (dir > 0 ? -1 : 0) : find.index) + dir + n) % n;
    showCurrent();
  }

  function showCurrent() {
    updateFindCount();
    if (findInPreview()) { paintCurrentPreview(true); return; }
    const m = find.matches[find.index];
    if (m) {
      editor.setSelectionRange(m[0], m[1]);
      const top = caretTop(m[0]);
      if (top < editor.scrollTop + 40 || top > editor.scrollTop + editor.clientHeight - 80) {
        lockSync('editor');
        editor.scrollTop = top - editor.clientHeight / 3;
        if (app.dataset.view === 'split') previewPane.scrollTop = interpolate(getSyncMap().points, 'e', 'p', editor.scrollTop);
      }
    }
    paintEditorMarks();
    paintCurrentPreview(false);
  }

  // Matches in the editor are drawn on a layer behind the (transparent) textarea.
  function paintEditorMarks() {
    if (!find.open || !find.matches.length || app.dataset.view === 'read') { editorMarks.hidden = true; return; }
    const cs = getComputedStyle(editor);
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom', 'tabSize']) editorMarks.style[p] = cs[p];
    Object.assign(editorMarks.style, { top: editor.offsetTop + 'px', left: editor.offsetLeft + 'px', width: editor.clientWidth + 'px', height: editor.clientHeight + 'px' });
    const v = editor.value;
    const frag = document.createDocumentFragment();
    let last = 0;
    find.matches.forEach(([s, e], i) => {
      frag.appendChild(document.createTextNode(v.slice(last, s)));
      const mk = document.createElement('mark');
      if (i === find.index) mk.className = 'current';
      mk.textContent = v.slice(s, e);
      frag.appendChild(mk);
      last = e;
    });
    frag.appendChild(document.createTextNode(v.slice(last) + '​'));
    editorMarks.replaceChildren(frag);
    editorMarks.hidden = false;
    editorMarks.scrollTop = editor.scrollTop;
  }
  editor.addEventListener('scroll', () => { if (!editorMarks.hidden) editorMarks.scrollTop = editor.scrollTop; }, { passive: true });
  new ResizeObserver(() => { if (find.open) paintEditorMarks(); }).observe(editor);

  // Matches in the preview use the CSS Custom Highlight API, so the DOM stays untouched.
  function paintPreviewMatches() {
    find.ranges = [];
    if (!hasHighlights) return;
    CSS.highlights.delete('find');
    CSS.highlights.delete('find-current');
    if (!find.open || !find.re) return;
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('.copy-code, .anchor, .katex-mathml, .code-lang, svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let node;
    while ((node = walker.nextNode()) && find.ranges.length < 10000) {
      for (const [s, e] of collect(find.re, node.data, 10000 - find.ranges.length)) {
        const r = new Range();
        r.setStart(node, s);
        r.setEnd(node, e);
        find.ranges.push(r);
      }
    }
    if (find.ranges.length) CSS.highlights.set('find', new Highlight(...find.ranges));
  }

  function paintCurrentPreview(scroll) {
    if (!hasHighlights) return;
    CSS.highlights.delete('find-current');
    if (!findInPreview()) return;
    const r = find.ranges[find.index];
    if (!r) return;
    CSS.highlights.set('find-current', new Highlight(r));
    if (scroll) {
      const rect = r.getBoundingClientRect();
      const pane = previewPane.getBoundingClientRect();
      if (rect.top < pane.top + 40 || rect.bottom > pane.bottom - 40) {
        previewPane.scrollTop += rect.top - pane.top - previewPane.clientHeight / 3;
      }
    }
  }

  function openFind(withReplace) {
    closeMenu();
    if (!palette.hidden) closePalette();
    find.open = true;
    findbar.hidden = false;
    findbar.classList.toggle('with-replace', !!withReplace);
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (sel && !sel.includes('\n') && app.dataset.view !== 'read') fbFind.value = sel;
    else if (app.dataset.view === 'read') {
      const s = String(window.getSelection() || '');
      if (s && !s.includes('\n')) fbFind.value = s;
    }
    syncFindOptions();
    const target = withReplace && fbFind.value ? fbReplace : fbFind;
    target.focus();
    target.select();
    refreshFind(true);
  }

  function closeFind() {
    find.open = false;
    findbar.hidden = true;
    editorMarks.hidden = true;
    if (hasHighlights) { CSS.highlights.delete('find'); CSS.highlights.delete('find-current'); }
    if (app.dataset.view !== 'read') editor.focus({ preventScroll: true });
  }

  function syncFindOptions() {
    for (const b of $$('[data-opt]', findbar)) b.setAttribute('aria-pressed', String(!!find.opts[b.dataset.opt]));
  }

  function replacement(matchText) {
    const rep = fbReplace.value;
    if (!find.opts.regex) return rep;
    const single = new RegExp(find.re.source, find.re.flags.replace('g', ''));
    return matchText.replace(single, rep);
  }

  function replaceOne() {
    if (!find.re) return;
    if (findInPreview()) setView('split');
    let m = find.matches[find.index];
    const sel = [editor.selectionStart, editor.selectionEnd];
    if (!m || m[0] !== sel[0] || m[1] !== sel[1]) { refreshFind(true); m = find.matches[find.index]; if (!m) return; }
    const rep = replacement(editor.value.slice(m[0], m[1]));
    replaceRange(m[0], m[1], rep, m[0] + rep.length);
    fbReplace.focus();
    refreshFind(true);
  }

  function replaceAll() {
    if (!find.re || !find.matches.length) return;
    const n = find.matches.length;
    const v = editor.value;
    let out = '', last = 0;
    for (const [s, e] of find.matches) {
      out += v.slice(last, s) + replacement(v.slice(s, e));
      last = e;
    }
    out += v.slice(last);
    const top = editor.scrollTop;
    replaceRange(0, v.length, out, 0);
    editor.scrollTop = top;
    fbReplace.focus();
    refreshFind(false);
    toast(`Replaced ${n.toLocaleString()} ${n === 1 ? 'match' : 'matches'}`);
  }

  fbFind.addEventListener('input', () => refreshFind(true));
  fbFind.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  });
  fbReplace.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey || e.metaKey) replaceAll(); else replaceOne(); }
  });
  findbar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.altKey) { e.preventDefault(); e.stopPropagation(); fbFind.focus(); fbFind.select(); }
  });
  findbar.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-opt]');
    if (opt) {
      find.opts[opt.dataset.opt] = !find.opts[opt.dataset.opt];
      ls.set('findOpts', find.opts);
      syncFindOptions();
      refreshFind(true);
      return;
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'fb-next') step(1);
    else if (b.id === 'fb-prev') step(-1);
    else if (b.id === 'fb-close') closeFind();
    else if (b.id === 'fb-toggle') { findbar.classList.toggle('with-replace'); (findbar.classList.contains('with-replace') ? fbReplace : fbFind).focus(); }
    else if (b.id === 'fb-one') replaceOne();
    else if (b.id === 'fb-all') replaceAll();
  });

  /* ---------- Settings dialog ---------- */
  const settingsEl = $('#settings');
  let settingsReturnFocus = null;

  function renderSettingsForm() {
    for (const input of $$('[data-setting]', settingsEl)) {
      const key = input.dataset.setting;
      if (input.type === 'checkbox') input.checked = !!settings[key];
      else if (input.type === 'range') {
        input.value = settings[key];
        const out = input.parentElement.querySelector('output');
        if (out) out.textContent = settings[key] + ' px';
      }
    }
    for (const group of $$('[data-setting-group]', settingsEl)) {
      const key = group.dataset.settingGroup;
      for (const b of $$('button', group)) b.setAttribute('aria-checked', String(b.dataset.value === settings[key]));
      if (!settingsEl.hidden) moveIndicator(group);
    }
  }

  settingsEl.addEventListener('input', (e) => {
    const input = e.target.closest('[data-setting]');
    if (!input) return;
    setSetting(input.dataset.setting, input.type === 'checkbox' ? input.checked : Number(input.value));
    if (input.dataset.setting === 'autosave') scheduleAutosave();
  });
  settingsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-setting-group] button');
    if (b) { setSetting(b.closest('[data-setting-group]').dataset.settingGroup, b.dataset.value); return; }
    if (e.target.closest('[data-close]')) closeSettings();
    if (e.target.closest('#settings-reset')) {
      Object.assign(settings, SETTING_DEFAULTS);
      ls.set('settings', settings);
      applySettings();
      renderSettingsForm();
      toast('Settings restored');
    }
  });
  settingsEl.addEventListener('mousedown', (e) => { if (e.target === settingsEl) closeSettings(); });
  settingsEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSettings(); return; }
    if (e.key !== 'Tab') return;
    const focusable = $$('button, input', settingsEl).filter((el) => el.offsetParent !== null);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function openSettings() {
    closeMenu();
    if (!palette.hidden) closePalette();
    if (!about.hidden) closeAbout();
    settingsReturnFocus = document.activeElement;
    settingsEl.hidden = false;
    renderSettingsForm();
    $('#settings-dialog').focus();
  }
  function closeSettings() {
    settingsEl.hidden = true;
    if (settingsReturnFocus && settingsReturnFocus.focus) settingsReturnFocus.focus({ preventScroll: true });
  }
  $('#btn-settings').addEventListener('click', openSettings);

  /* ---------- Zoom (Windows; macOS uses the View menu) ---------- */
  function zoom(dir) {
    if (!native || !native.setZoom) return;
    const level = dir === 0 ? 0 : Math.max(-4, Math.min(5, ls.get('zoom', 0) + dir));
    ls.set('zoom', level);
    native.setZoom(level);
    syncMap = null;
    setTimeout(refreshIndicators, 50);
    toast(`Zoom ${Math.round(Math.pow(1.2, level) * 100)}%`);
  }

  /* ---------- Reading progress ---------- */
  const progress = $('#read-progress span');
  previewPane.addEventListener('scroll', () => {
    const max = previewPane.scrollHeight - previewPane.clientHeight;
    progress.style.transform = `scaleX(${max > 0 ? previewPane.scrollTop / max : 0})`;
  }, { passive: true });

  /* ---------- Sidebar sections ---------- */
  const collapsed = new Set(ls.get('collapsed', []));
  for (const sec of $$('.side-section[data-section]')) {
    sec.classList.toggle('collapsed', collapsed.has(sec.dataset.section));
    const head = sec.querySelector('.side-toggle');
    head.setAttribute('aria-expanded', String(!collapsed.has(sec.dataset.section)));
    head.addEventListener('click', () => {
      const id = sec.dataset.section;
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      sec.classList.toggle('collapsed', collapsed.has(id));
      head.setAttribute('aria-expanded', String(!collapsed.has(id)));
      ls.set('collapsed', [...collapsed]);
    });
  }
  const folderBtn = $('#btn-folder');
  if (folderBtn) folderBtn.addEventListener('click', (e) => { e.stopPropagation(); openFolder(); });

  /* ---------- Global shortcuts ---------- */
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'F1') { e.preventDefault(); about.hidden ? openAbout() : closeAbout(); return; }
    if (e.key === 'F3') { e.preventDefault(); if (find.open) step(e.shiftKey ? -1 : 1); else openFind(false); return; }
    if (e.key === 'Escape') {
      if (!lightbox.hidden) { lightbox.hidden = true; return; }
      if (openPop) { closePopover(); return; }
      if (!moreMenu.hidden) { closeMenu(); return; }
      if (find.open) { closeFind(); return; }
      if (app.classList.contains('zen')) { toggleZen(false); return; }
    }
    if (!mod) return;
    if (e.code === 'KeyF' && e.altKey && !e.shiftKey) { e.preventDefault(); openFind(true); return; }
    if (k === 'f' && !e.altKey && !e.shiftKey) { e.preventDefault(); openFind(false); return; }
    if (e.key === ',' && !e.altKey && !e.shiftKey) { e.preventDefault(); settingsEl.hidden ? openSettings() : closeSettings(); return; }
    if (native && !isMac && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
      e.preventDefault();
      zoom(e.key === '-' ? -1 : e.key === '0' ? 0 : 1);
      return;
    }
    if (k === 's' && e.shiftKey) { e.preventDefault(); saveAs(); }
    else if (k === 's') { e.preventDefault(); save(); }
    else if (k === 'o') { e.preventDefault(); openFile(); }
    else if (e.code === 'KeyN' && e.altKey) { e.preventDefault(); newDoc(); }
    else if (k === 'n' && native && !e.shiftKey) { e.preventDefault(); native.newWindow(); }
    else if (k === 'w' && native && !e.shiftKey) { e.preventDefault(); window.close(); }
    else if (k === 'p' && e.shiftKey) { e.preventDefault(); palette.hidden ? openPalette() : closePalette(); }
    else if (k === 'b' && e.shiftKey) { e.preventDefault(); toggleSidebar(); }
    else if (e.key === '.') { e.preventDefault(); toggleZen(); }
    else if (!e.shiftKey && !e.altKey && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); setView(['write', 'split', 'read'][Number(e.key) - 1]); }
  });

  /* ---------- Toasts ---------- */
  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); el.addEventListener('animationend', () => el.remove()); }, 2200);
  }

  /* ---------- Boot ---------- */
  async function boot() {
    if (isMac) {
      for (const el of $$('[title]')) el.title = keyLabel(el.title).replace(/\u2318\+H\b/, '\u2303+H');
      for (const el of $$('#more-menu kbd')) el.textContent = keyLabel(el.textContent);
      const finder = $('#more-menu [data-cmd="showInFolder"]');
      if (finder) finder.lastChild.textContent = 'Show in Finder';
    }
    if (native) native.onMenuCommand((id) => { if (commandById[id]) commandById[id].run(); });
    applySettings();
    if (native && !isMac && native.setZoom && ls.get('zoom', 0)) native.setZoom(ls.get('zoom', 0));
    setTheme(currentTheme(), false);
    const split = ls.get('split', null);
    if (split) workspace.style.setProperty('--split', split);
    const wide = window.innerWidth > 900;
    toggleSidebar(ls.get('sidebar', wide) && wide);

    const draft = native ? null : ls.get('draft', null);
    if (native) {
      const initial = await native.getInitialFile();
      if (initial && !initial.error) {
        setDocument({ content: normalize(initial.content), name: initial.name, handle: { path: initial.path, name: initial.name } });
        addRecent({ name: initial.name, path: initial.path });
      } else if (!ls.get('welcomed', false)) {
        ls.set('welcomed', true);
        setDocument({ content: welcomeText(), name: 'Welcome.md' });
      } else {
        setDocument({ content: '', name: 'Untitled.md' });
      }
      if (initial && initial.error) toast(`Could not open ${baseName(initial.path)}`);
    } else if (draft && typeof draft.content === 'string') {
      editor.value = draft.content;
      docName.value = draft.name || 'Untitled.md';
      state.savedContent = draft.savedContent ?? draft.content;
      const handle = await idb.get('current');
      if (handle && handle.name) state.handle = handle;
      render();
      updateMeta();
    } else {
      setDocument({ content: welcomeText(), name: 'Welcome.md' });
    }

    setView(ls.get('view', 'split'));
    updateCursor();
    renderRecent();
    document.fonts && document.fonts.ready.then(() => { refreshIndicators(); syncMap = null; });

    // Opened as an installed PWA with a file (file handler / launch queue).
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async (params) => {
        if (params.files && params.files[0]) await openHandle(params.files[0]);
      });
    }
  }

  boot();
})();

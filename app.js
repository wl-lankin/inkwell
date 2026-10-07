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
  const keyLabel = (s) => (isMac ? s.replace(/Ctrl/g, '⌘').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧') : s);
  const welcomeText = () => (isMac
    ? window.INKWELL_WELCOME.replace(/`Ctrl (?!H`)/g, '`Cmd ').replace(/Ctrl ([0-9OSNPB.])/g, 'Cmd $1').replace(/Explorer/g, 'Finder')
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
    document.title = (dirty ? '• ' : '') + docName.value + ' - Inkwell';
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

  marked.use({
    gfm: true,
    renderer: {
      heading(token) {
        const inner = this.parser.parseInline(token.tokens);
        const id = slugify(token.text);
        return `<h${token.depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${token.depth}>\n`;
      },
      code(token) {
        const lang = (token.lang || '').trim().split(/\s+/)[0].toLowerCase();
        const known = lang && hljs.getLanguage(lang);
        const body = known ? hljs.highlight(token.text, { language: lang, ignoreIllegals: true }).value : escapeHtml(token.text);
        const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
        return `<pre>${label}<code class="hljs${known ? ' language-' + lang : ''}">${body}</code></pre>\n`;
      },
    },
  });

  let headingOffsets = [];
  let syncMap = null;

  function render() {
    const src = editor.value;
    slugCounts.clear();
    const tokens = marked.lexer(src);

    // Locate top-level headings in the source so editor and preview can be aligned.
    headingOffsets = [];
    let cursor = 0;
    for (const t of tokens) {
      if (!t.raw) continue;
      const at = src.indexOf(t.raw, cursor);
      if (at === -1) continue;
      if (t.type === 'heading') headingOffsets.push(at);
      cursor = at + t.raw.length;
    }

    const html = marked.parser(tokens);
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

    syncMap = null;
    buildOutline();
    updateStats();
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
  function updateStats() {
    const text = preview.textContent || '';
    const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    $('#st-words').textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`;
    $('#st-read span').textContent = `${Math.max(1, Math.round(words / 230))} min read`;
  }

  function updateCursor() {
    const pos = editor.selectionStart;
    const before = editor.value.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    const sel = Math.abs(editor.selectionEnd - editor.selectionStart);
    $('#st-pos').textContent = `Ln ${line}, Col ${col}` + (sel ? ` (${sel} selected)` : '');
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
    table: () => insertBlock('| Column | Column |\n| ------ | ------ |\n| Cell   | Cell   |', 2, 8),
    hr: () => insertBlock('---'),
  };

  $('.format-bar').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  $('.format-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fmt]');
    if (btn) formats[btn.dataset.fmt]();
  });

  /* ---------- Editor behaviour ---------- */
  editor.addEventListener('input', () => {
    scheduleRender();
    persistDraft();
    updateMeta();
    updateCursor();
  });
  for (const ev of ['keyup', 'click', 'select']) editor.addEventListener(ev, updateCursor);

  editor.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      const map = { b: 'bold', i: 'italic', k: 'link', e: 'code', h: 'heading' };
      if (!e.shiftKey && map[k]) { e.preventDefault(); formats[map[k]](); return; }
      if (e.shiftKey && k === 'x') { e.preventDefault(); formats.strike(); return; }
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
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    const { selectionStart: s, selectionEnd: en, value: v } = editor;
    if (text && s !== en && /^https?:\/\/\S+$/.test(text.trim()) && !v.slice(s, en).includes('\n')) {
      e.preventDefault();
      replaceRange(s, en, `[${v.slice(s, en)}](${text.trim()})`);
    }
  });

  /* ---------- Preview interactions ---------- */
  preview.addEventListener('click', (e) => {
    const box = e.target.closest('input[type="checkbox"]');
    if (box) { toggleTask($$('input[type="checkbox"]', preview).indexOf(box), box.checked); return; }

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
  const normalize = (text) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
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

  async function save() {
    if (!state.handle) return saveAs();
    try {
      if (native) {
        await native.writeFile(state.handle.path, editor.value);
      } else {
        if (!(await ensurePermission(state.handle, 'readwrite'))) { toast('Permission denied'); return; }
        await writeHandle(state.handle);
      }
      markSaved();
      toast(`Saved ${state.handle.name}`);
    } catch (err) {
      toast('Save failed: ' + err.message);
    }
  }

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

  /* ---------- Drag & drop ---------- */
  const overlay = $('#drop-overlay');
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; overlay.hidden = false; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; overlay.hidden = true; } });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    const files = [...e.dataTransfer.files];
    if (!files.length) return;

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
.hljs-keyword,.hljs-literal{color:#a3268c}.hljs-string{color:#1f7a4d}.hljs-number{color:#b45309}.hljs-comment{color:#9a9182;font-style:italic}.hljs-title{color:#2f47c9}.hljs-attr,.hljs-property{color:#0e7490}`;

  function exportHtml() {
    const title = docName.value.replace(/\.[^.]+$/, '');
    const body = preview.cloneNode(true);
    body.querySelectorAll('.copy-code').forEach((n) => n.remove());
    body.querySelectorAll('input[type="checkbox"]').forEach((n) => n.setAttribute('disabled', ''));
    const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>${EXPORT_CSS}</style>\n</head>\n<body>\n<main>\n${body.innerHTML}\n</main>\n</body>\n</html>\n`;
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
      if (view !== 'read') editor.focus({ preventScroll: true });
      updateActiveOutline();
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
  }
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
    { id: 'insertTable', label: 'Insert table', icon: 'table', run: formats.table },
    { id: 'insertTask', label: 'Insert task list', icon: 'check', run: formats.task },
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
      ['Toggle sidebar', 'Ctrl Shift B'], ['Command palette', 'Ctrl Shift P'], ['About & shortcuts', 'F1'],
    ]],
    ['Formatting', [
      ['Bold', 'Ctrl B'], ['Italic', 'Ctrl I'], ['Strikethrough', 'Ctrl Shift X'],
      ['Link', 'Ctrl K'], ['Inline code', 'Ctrl E'], ['Cycle heading', isMac ? '⌃ H' : 'Ctrl H'],
      ['Indent / outdent list', 'Tab / Shift Tab'],
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

  /* ---------- Global shortcuts ---------- */
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'F1') { e.preventDefault(); about.hidden ? openAbout() : closeAbout(); return; }
    if (e.key === 'Escape') {
      if (!moreMenu.hidden) { closeMenu(); return; }
      if (app.classList.contains('zen')) { toggleZen(false); return; }
    }
    if (!mod) return;
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
      for (const el of $('[title]')) el.title = keyLabel(el.title).replace(/⌘+H/, '⌃+H');
      for (const el of $('#more-menu kbd')) el.textContent = keyLabel(el.textContent);
      const finder = $('#more-menu [data-cmd="showInFolder"]');
      if (finder) finder.lastChild.textContent = 'Show in Finder';
    }
    if (native) native.onMenuCommand((id) => { if (commandById[id]) commandById[id].run(); });
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

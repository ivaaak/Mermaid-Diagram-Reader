// Shared helpers for both pages: localStorage store, theme, Mermaid rendering, small UI utilities.
(function () {
  const STORE_KEY = 'mdr.diagrams.v1';
  const THEME_KEY = 'mdr.theme';

  // ---------- Theme ----------
  function currentTheme() {
    return document.documentElement.dataset.theme;
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    initMermaid();
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* storage unavailable */ }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage unavailable */ }
    applyTheme(next);
    document.dispatchEvent(new CustomEvent('mdr:theme', { detail: next }));
  }

  // ---------- Store ----------
  const Store = {
    all() {
      try {
        const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    },
    // Throws if the browser refuses the write (quota exceeded, storage disabled).
    _save(list) {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
    },
    get(id) {
      return this.all().find((d) => d.id === id) || null;
    },
    addMany(items) {
      const now = Date.now();
      const created = items.map((item, i) => ({
        id: newId(),
        name: item.name || 'Untitled diagram',
        code: item.code,
        source: item.source || null,
        createdAt: now + i,
        updatedAt: now + i,
      }));
      this._save(this.all().concat(created));
      return created;
    },
    update(id, patch) {
      const list = this.all();
      const item = list.find((d) => d.id === id);
      if (!item) return null;
      Object.assign(item, patch, { updatedAt: Date.now() });
      this._save(list);
      return item;
    },
    remove(id) {
      this._save(this.all().filter((d) => d.id !== id));
    },
    bytesUsed() {
      let raw = '';
      try { raw = localStorage.getItem(STORE_KEY) || ''; } catch (e) { /* storage unavailable */ }
      return new Blob([raw]).size;
    },
  };

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ---------- Mermaid ----------
  let renderSeq = 0;

  function initMermaid() {
    if (!window.mermaid) return;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: currentTheme() === 'dark' ? 'redux-dark-color' : 'redux-color',
      // Mermaid's default (200px) re-wraps lines the author already broke by hand.
      flowchart: { wrappingWidth: 400 },
    });
  }

  // The redux themes use the Recursive font. Mermaid sizes boxes from measured text, so wait for the
  // font (briefly) before the first render or labels would be measured in the fallback font.
  const fontReady = Promise.race([
    document.fonts.load('16px "Recursive Variable"').catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  // Resolves to { svg } or { error }; never rejects.
  async function render(code) {
    if (!window.mermaid) {
      return { error: 'The Mermaid library could not be loaded. Check your internet connection and reload.' };
    }
    if (!code || !code.trim()) return { error: 'This diagram is empty.' };
    await fontReady;
    const id = 'mdr-render-' + ++renderSeq;
    try {
      const { svg } = await mermaid.render(id, normalize(code));
      return { svg };
    } catch (e) {
      // Mermaid leaves its scratch elements behind when rendering fails.
      for (const leftover of [id, 'd' + id]) {
        const el = document.getElementById(leftover);
        if (el) el.remove();
      }
      return { error: (e && e.message) || String(e) };
    }
  }

  // Flowchart labels often use a literal backslash-n for line breaks, which current Mermaid prints as text.
  function normalize(code) {
    return detectType(code) === 'Flowchart' ? code.replace(/\\n/g, '<br/>') : code;
  }

  const TYPES = [
    [/^(graph|flowchart)/i, 'Flowchart'],
    [/^sequenceDiagram/i, 'Sequence'],
    [/^classDiagram/i, 'Class'],
    [/^stateDiagram/i, 'State'],
    [/^erDiagram/i, 'ER'],
    [/^gantt/i, 'Gantt'],
    [/^pie/i, 'Pie'],
    [/^journey/i, 'Journey'],
    [/^gitGraph/i, 'Git graph'],
    [/^mindmap/i, 'Mindmap'],
    [/^timeline/i, 'Timeline'],
    [/^quadrantChart/i, 'Quadrant'],
    [/^requirementDiagram/i, 'Requirement'],
    [/^C4/i, 'C4'],
    [/^sankey/i, 'Sankey'],
    [/^xychart/i, 'XY chart'],
    [/^block/i, 'Block'],
    [/^architecture/i, 'Architecture'],
    [/^kanban/i, 'Kanban'],
    [/^packet/i, 'Packet'],
  ];

  function detectType(code) {
    const body = String(code || '').replace(/^\s*---[\s\S]*?---/, '');
    const first = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%'));
    if (!first) return 'Unknown';
    const match = TYPES.find(([re]) => re.test(first));
    return match ? match[1] : 'Diagram';
  }

  // ---------- Formatting ----------
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function timeAgo(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago';
    return new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  // ---------- UI ----------
  let toastTimer = null;

  function toast(message, kind) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function download(filename, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFilename(name) {
    return (name || 'diagram').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'diagram';
  }

  // First click arms the button, second click within 3 s runs the action.
  function confirmClick(button, action) {
    const label = button.textContent;
    let timer = null;
    button.addEventListener('click', () => {
      if (button.classList.contains('armed')) {
        clearTimeout(timer);
        action();
        return;
      }
      button.classList.add('armed');
      button.textContent = 'Confirm?';
      timer = setTimeout(() => {
        button.classList.remove('armed');
        button.textContent = label;
      }, 3000);
    });
  }

  initTheme();
  initMermaid();

  window.MDR = {
    Store, render, detectType, toggleTheme,
    formatBytes, formatDate, timeAgo,
    toast, download, safeFilename, confirmClick,
  };
})();

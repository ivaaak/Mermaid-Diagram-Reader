// Dashboard: overview of saved diagrams with previews, upload, and quick create.
(function () {
  const { Store, render, detectType, toggleTheme, formatBytes, timeAgo, toast, confirmClick } = window.MDR;

  const $ = (id) => document.getElementById(id);
  const grid = $('grid');
  const search = $('search');
  const sort = $('sort');
  const fileInput = $('fileInput');
  const newDialog = $('newDialog');

  const SAMPLES = [
    {
      name: 'Order checkout flow',
      code: [
        'flowchart TD',
        '  A[Cart] --> B{Signed in?}',
        '  B -- Yes --> C[Shipping details]',
        '  B -- No --> D[Sign in or guest] --> C',
        '  C --> E[Payment]',
        '  E --> F{Payment OK?}',
        '  F -- Yes --> G[Order confirmed]',
        '  F -- No --> E',
      ].join('\n'),
    },
    {
      name: 'Login sequence',
      code: [
        'sequenceDiagram',
        '  actor User',
        '  participant App',
        '  participant API',
        '  participant DB',
        '  User->>App: Enter credentials',
        '  App->>API: POST /login',
        '  API->>DB: Find user',
        '  DB-->>API: User record',
        '  API-->>App: Session token',
        '  App-->>User: Show dashboard',
      ].join('\n'),
    },
    {
      name: 'Blog data model',
      code: [
        'erDiagram',
        '  AUTHOR ||--o{ POST : writes',
        '  POST ||--o{ COMMENT : has',
        '  POST }o--o{ TAG : tagged',
        '  AUTHOR {',
        '    int id',
        '    string name',
        '  }',
        '  POST {',
        '    int id',
        '    string title',
        '    date published',
        '  }',
      ].join('\n'),
    },
  ];

  // Lazily render previews as cards scroll into view.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      renderPreview(entry.target);
    }
  }, { rootMargin: '200px' });

  async function renderPreview(el) {
    const diagram = Store.get(el.dataset.id);
    if (!diagram) return;
    const result = await render(diagram.code);
    if (result.error) {
      el.classList.add('failed');
      el.textContent = 'Preview unavailable — syntax error';
      return;
    }
    el.innerHTML = result.svg;
  }

  function visibleDiagrams() {
    const q = search.value.trim().toLowerCase();
    const list = Store.all().filter((d) => !q || d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q));
    const by = sort.value;
    if (by === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (by === 'created') list.sort((a, b) => b.createdAt - a.createdAt);
    else list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }

  function card(diagram) {
    const href = 'viewer.html?id=' + encodeURIComponent(diagram.id);
    const el = document.createElement('article');
    el.className = 'card';

    const preview = document.createElement('a');
    preview.className = 'preview';
    preview.href = href;
    preview.dataset.id = diagram.id;
    preview.setAttribute('aria-label', 'Open ' + diagram.name);
    observer.observe(preview);

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const title = document.createElement('a');
    title.className = 'card-title';
    title.href = href;
    title.textContent = diagram.name;
    title.title = diagram.name;

    const info = document.createElement('div');
    info.className = 'card-info';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = detectType(diagram.code);
    const when = document.createElement('span');
    when.className = 'muted';
    when.textContent = 'Updated ' + timeAgo(diagram.updatedAt);
    const del = document.createElement('button');
    del.className = 'btn ghost small danger';
    del.type = 'button';
    del.textContent = 'Delete';
    confirmClick(del, () => {
      Store.remove(diagram.id);
      refresh();
      toast('Deleted "' + diagram.name + '"');
    });
    info.append(badge, when, del);

    meta.append(title, info);
    el.append(preview, meta);
    return el;
  }

  function refresh() {
    const total = Store.all().length;
    const list = visibleDiagrams();

    $('stats').textContent = total
      ? total + (total === 1 ? ' diagram' : ' diagrams') + ' · ' + formatBytes(Store.bytesUsed()) + ' stored in this browser'
      : 'Stored locally in this browser';
    $('filters').hidden = total === 0;
    $('empty').hidden = total !== 0;
    $('noMatches').hidden = total === 0 || list.length > 0;

    observer.disconnect();
    grid.replaceChildren(...list.map(card));
  }

  function save(items) {
    if (!items.length) return;
    try {
      Store.addMany(items);
    } catch (e) {
      toast('Could not save — browser storage is full or unavailable.', 'error');
      return;
    }
    refresh();
    toast(items.length === 1 ? 'Added "' + items[0].name + '"' : 'Added ' + items.length + ' diagrams');
  }

  // A Markdown file can hold several ```mermaid blocks; any other file is one diagram.
  function diagramsFromFile(filename, text) {
    const base = filename.replace(/\.[^.]+$/, '');
    const blocks = [];
    const fence = /```+\s*mermaid[^\n]*\n([\s\S]*?)```/gi;
    let m;
    while ((m = fence.exec(text))) {
      if (m[1].trim()) blocks.push(m[1].trim());
    }
    if (!blocks.length) {
      const code = text.trim();
      return code ? [{ name: base, code, source: filename }] : [];
    }
    return blocks.map((code, i) => ({
      name: blocks.length > 1 ? base + ' (' + (i + 1) + ')' : base,
      code,
      source: filename,
    }));
  }

  async function importFiles(files) {
    const items = [];
    for (const file of files) {
      try {
        items.push(...diagramsFromFile(file.name, await file.text()));
      } catch (e) {
        toast('Could not read ' + file.name, 'error');
      }
    }
    if (!items.length) {
      toast('No Mermaid content found in the selected files.', 'error');
      return;
    }
    save(items);
  }

  // ---------- Events ----------
  $('themeToggle').addEventListener('click', toggleTheme);
  document.addEventListener('mdr:theme', refresh);

  $('uploadBtn').addEventListener('click', () => fileInput.click());
  $('dropzone').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    importFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  search.addEventListener('input', refresh);
  sort.addEventListener('change', refresh);

  $('samplesBtn').addEventListener('click', () => save(SAMPLES));

  $('newBtn').addEventListener('click', () => {
    $('newForm').reset();
    newDialog.showModal();
  });
  $('newCancel').addEventListener('click', () => newDialog.close());
  $('newForm').addEventListener('submit', () => {
    const code = $('newCode').value.trim();
    if (!code) return;
    save([{ name: $('newName').value.trim() || 'Untitled diagram', code, source: null }]);
  });

  // Whole-page drag and drop.
  const overlay = $('dragOverlay');
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) overlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    importFiles(Array.from(e.dataTransfer.files));
  });

  // Pick up changes made in another tab.
  window.addEventListener('storage', refresh);

  refresh();
})();

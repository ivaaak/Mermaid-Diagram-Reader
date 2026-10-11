// Viewer: diagram details, source editing, and a pan/zoom reader view.
(function () {
  const {
    Store, render, detectType, toggleTheme, formatBytes, formatDate,
    toast, download, safeFilename, confirmClick,
  } = window.MDR;

  const $ = (id) => document.getElementById(id);
  const id = new URLSearchParams(location.search).get('id');
  let diagram = id ? Store.get(id) : null;

  $('themeToggle').addEventListener('click', toggleTheme);

  if (!diagram) {
    $('viewer').hidden = true;
    $('name').hidden = true;
    $('typeBadge').hidden = true;
    $('notFound').hidden = false;
    return;
  }

  const stage = $('stage');
  const canvas = $('canvas');
  const codeEl = $('code');
  const nameEl = $('name');
  const errorEl = $('renderError');

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 8;
  const view = { x: 0, y: 0, scale: 1 };
  let natural = null; // intrinsic size of the rendered SVG
  let autoFit = true; // stays true until the user pans or zooms by hand
  let lastSvg = '';
  let renderToken = 0;

  // ---------- Details ----------
  function showDetails() {
    const type = detectType(codeEl.value);
    document.title = diagram.name + ' — Mermaid Reader';
    $('typeBadge').textContent = type;
    $('dType').textContent = type;
    $('dLines').textContent = codeEl.value.split('\n').length;
    $('dSize').textContent = formatBytes(new Blob([codeEl.value]).size);
    $('dSource').textContent = diagram.source || 'Pasted';
    $('dCreated').textContent = formatDate(diagram.createdAt);
    $('dUpdated').textContent = formatDate(diagram.updatedAt);
  }

  function isDirty() {
    return codeEl.value !== diagram.code;
  }

  function showDirty() {
    const dirty = isDirty();
    $('dirty').hidden = !dirty;
    $('saveBtn').disabled = !dirty;
    $('revertBtn').disabled = !dirty;
  }

  // ---------- Reader (pan / zoom) ----------
  function applyView() {
    const svg = canvas.querySelector('svg');
    if (svg && natural) {
      // Resize the SVG itself rather than CSS-scaling it, so it stays sharp at any zoom.
      svg.setAttribute('width', natural.w * view.scale);
      svg.setAttribute('height', natural.h * view.scale);
    }
    canvas.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px)';
    $('zoomLabel').textContent = Math.round(view.scale * 100) + '%';
  }

  function fit() {
    if (!natural) return;
    const pad = 56;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const scale = Math.min((w - pad) / natural.w, (h - pad) / natural.h, 2);
    view.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
    view.x = (w - natural.w * view.scale) / 2;
    view.y = (h - natural.h * view.scale) / 2;
    autoFit = true;
    applyView();
  }

  function zoomAt(cx, cy, factor) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale * factor));
    const k = next / view.scale;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.scale = next;
    autoFit = false;
    applyView();
  }

  function zoomCenter(factor) {
    zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, factor);
  }

  async function draw(refit) {
    const token = ++renderToken;
    const result = await render(codeEl.value);
    if (token !== renderToken) return; // a newer edit superseded this render

    if (result.error) {
      errorEl.textContent = result.error;
      errorEl.hidden = false;
      return; // keep the last good render on screen
    }
    errorEl.hidden = true;
    lastSvg = result.svg;
    canvas.innerHTML = result.svg;

    const svg = canvas.querySelector('svg');
    const box = svg.viewBox.baseVal;
    natural = box && box.width ? { w: box.width, h: box.height } : { w: svg.getBBox().width, h: svg.getBBox().height };
    svg.style.maxWidth = 'none';
    if (refit || autoFit) fit();
    else applyView();
  }

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  // One pointer pans; two pointers pinch-zoom (and pan with the midpoint).
  const pointers = new Map();
  let gesture = null;

  function startGesture() {
    const pts = Array.from(pointers.values());
    if (pts.length === 1) {
      gesture = { px: pts[0].x, py: pts[0].y };
    } else if (pts.length >= 2) {
      gesture = {
        px: (pts[0].x + pts[1].x) / 2,
        py: (pts[0].y + pts[1].y) / 2,
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      };
    } else {
      gesture = null;
    }
    stage.classList.toggle('dragging', !!gesture);
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.stage-tools, .render-error')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    startGesture();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const prev = gesture;
    startGesture();
    view.x += gesture.px - prev.px;
    view.y += gesture.py - prev.py;
    autoFit = false;
    if (gesture.dist && prev.dist) {
      const rect = stage.getBoundingClientRect();
      zoomAt(gesture.px - rect.left, gesture.py - rect.top, gesture.dist / prev.dist);
    } else {
      applyView();
    }
  });
  const endPointer = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    startGesture();
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  new ResizeObserver(() => {
    if (autoFit) fit();
  }).observe(stage);

  $('zoomIn').addEventListener('click', () => zoomCenter(1.25));
  $('zoomOut').addEventListener('click', () => zoomCenter(0.8));
  $('fitBtn').addEventListener('click', fit);

  function setReader(on) {
    document.body.classList.toggle('reader', on);
    document.body.classList.remove('show-details');
    $('readerLabel').textContent = on ? 'Exit reader' : 'Reader';
    fit();
  }
  $('readerBtn').addEventListener('click', () => setReader(!document.body.classList.contains('reader')));

  // On narrow screens the details panel opens over the diagram instead of sitting beside it.
  $('detailsBtn').addEventListener('click', () => document.body.classList.add('show-details'));
  $('closeDetails').addEventListener('click', () => document.body.classList.remove('show-details'));

  // ---------- Editing ----------
  let debounce = null;
  codeEl.addEventListener('input', () => {
    showDirty();
    showDetails();
    clearTimeout(debounce);
    debounce = setTimeout(() => draw(false), 350);
  });

  function persist(patch, message) {
    try {
      diagram = Store.update(diagram.id, patch) || diagram;
    } catch (e) {
      toast('Could not save — browser storage is full or unavailable.', 'error');
      return false;
    }
    showDetails();
    showDirty();
    if (message) toast(message);
    return true;
  }

  function saveCode() {
    if (isDirty()) persist({ code: codeEl.value }, 'Saved');
  }

  $('saveBtn').addEventListener('click', saveCode);
  $('revertBtn').addEventListener('click', () => {
    codeEl.value = diagram.code;
    showDirty();
    showDetails();
    draw(false);
  });

  nameEl.addEventListener('change', () => {
    const name = nameEl.value.trim() || 'Untitled diagram';
    nameEl.value = name;
    if (name !== diagram.name) persist({ name }, 'Renamed');
  });
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameEl.blur();
  });

  $('copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeEl.value);
      toast('Source copied');
    } catch (e) {
      codeEl.select();
      toast('Press Ctrl+C to copy', 'error');
    }
  });

  $('downloadMmd').addEventListener('click', () => {
    download(safeFilename(diagram.name) + '.mmd', codeEl.value, 'text/plain');
  });
  $('downloadSvg').addEventListener('click', () => {
    if (!lastSvg) return toast('Nothing to export — the diagram has not rendered.', 'error');
    download(safeFilename(diagram.name) + '.svg', lastSvg, 'image/svg+xml');
  });

  let deleted = false;
  confirmClick($('deleteBtn'), () => {
    Store.remove(diagram.id);
    deleted = true;
    location.href = 'index.html';
  });

  // ---------- Global ----------
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveCode();
      return;
    }
    const typing = e.target.matches('input, textarea, select');
    if (e.key === 'Escape' && document.body.classList.contains('reader')) return setReader(false);
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-') zoomCenter(0.8);
    else if (e.key === '0') fit();
    else if (e.key.toLowerCase() === 'f') setReader(!document.body.classList.contains('reader'));
  });

  window.addEventListener('beforeunload', (e) => {
    if (!deleted && isDirty()) e.preventDefault();
  });
  document.addEventListener('mdr:theme', () => draw(false));

  nameEl.value = diagram.name;
  codeEl.value = diagram.code;
  showDetails();
  showDirty();
  draw(true);
})();

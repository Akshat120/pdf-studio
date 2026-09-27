/* PDF Studio — a browser UI for common PDF operations, built on pdf-lib.
 * pdf-lib (window.PDFLib) does all the PDF editing; pdf.js (window.pdfjsLib)
 * is only used to draw page previews. Nothing is uploaded anywhere. */
(() => {
  'use strict';

  // ------------------------------------------------------------------ helpers

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2), v);
      } else if (k === 'class') node.className = v;
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c != null && c !== false) {
        node.append(c instanceof Node ? c : String(c));
      }
    }
    return node;
  }

  if (!window.PDFLib) {
    const fatal = $('#fatal');
    fatal.hidden = false;
    fatal.textContent =
      'PDF Studio could not load its PDF engine (vendor/pdf-lib.min.js). ' +
      'Please check that the file exists and reload the page.';
    $$('main button, main input').forEach((n) => (n.disabled = true));
    return;
  }

  const {
    PDFDocument,
    StandardFonts,
    rgb,
    degrees,
    PDFTextField,
    PDFCheckBox,
    PDFDropdown,
    PDFOptionList,
    PDFRadioGroup,
  } = PDFLib;

  const iconBtn = (label, title, onclick, disabled = false) =>
    el(
      'button',
      {
        class: 'icon',
        type: 'button',
        title,
        'aria-label': title,
        disabled,
        onclick,
      },
      label,
    );

  function toast(message, type = 'info') {
    const box = $('#toasts');
    while (box.children.length >= 4) box.firstChild.remove();
    const t = el(
      'div',
      {
        class: `toast ${type}`,
        role: type === 'error' ? 'alert' : 'status',
        title: 'Click to dismiss',
      },
      message,
    );
    t.addEventListener('click', () => t.remove());
    box.append(t);
    setTimeout(() => t.remove(), type === 'error' ? 7000 : 3500);
  }

  const readFile = async (file) => new Uint8Array(await file.arrayBuffer());
  const baseName = (name) => name.replace(/\.[^.]+$/, '');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const norm360 = (a) => ((a % 360) + 360) % 360;
  const clampNum = (value, min, max, fallback) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return rgb(
      ((n >> 16) & 255) / 255,
      ((n >> 8) & 255) / 255,
      (n & 255) / 255,
    );
  }

  /** "1-3, 5, 8-" -> zero-based page indices, in the order given. */
  function parseRanges(str, count) {
    const out = [];
    for (const part of str
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const m = part.match(/^(\d+)\s*(-\s*(\d+)?)?$/);
      if (!m) throw new Error(`"${part}" is not a valid page range`);
      const a = +m[1];
      const b = m[3] ? +m[3] : m[2] ? count : a;
      if (a < 1 || b < 1 || a > count || b > count) {
        throw new Error(`Page range "${part}" is outside 1–${count}`);
      }
      const step = a <= b ? 1 : -1;
      for (let i = a; i !== b + step; i += step) out.push(i - 1);
    }
    if (!out.length) throw new Error('Enter at least one page number');
    return out;
  }

  async function loadPdf(bytes, options = {}) {
    try {
      return await PDFDocument.load(bytes, {
        updateMetadata: false,
        ...options,
      });
    } catch (e) {
      if (/encrypted/i.test(e.message)) {
        throw new Error(
          'This PDF is password-protected. PDF Studio cannot open encrypted PDFs.',
        );
      }
      throw new Error(`Could not read this PDF (${e.message})`);
    }
  }

  const isPng = (b) =>
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isJpg = (b) => b[0] === 0xff && b[1] === 0xd8;

  // ISO-BMFF "ftyp" brands used by HEIC/HEIF photos (e.g. from iPhones). AVIF
  // shares the format; browsers decode AVIF themselves, so it's only sent to the
  // HEIC decoder if the browser can't.
  const HEIF_BRANDS = [
    'heic',
    'heix',
    'hevc',
    'hevx',
    'heim',
    'heis',
    'hevm',
    'hevs',
    'mif1',
    'msf1',
    'avif',
  ];
  const isHeif = (b) =>
    b.length > 12 &&
    String.fromCharCode(...b.subarray(4, 8)) === 'ftyp' &&
    HEIF_BRANDS.includes(String.fromCharCode(...b.subarray(8, 12)));

  // Only Safari can decode HEIC natively, so other browsers get heic-to
  // (libheif compiled to WebAssembly, ~3 MB). It's loaded the first time a
  // HEIC image is added, pinned with a Subresource Integrity hash.
  const HEIC_TO_URL =
    'https://cdn.jsdelivr.net/npm/heic-to@1.5.2/dist/iife/heic-to.js';
  const HEIC_TO_SRI =
    'sha384-cVm8gaWQ5+URpoh6ACKXpm8TuyoHkfIDDBkxvDoUdIZ18w8nV5en0lVQvWMwO/6S';
  let heicDecoder = null;

  function loadHeicDecoder() {
    if (!heicDecoder) {
      toast('Loading the HEIC decoder (first time only)…');
      heicDecoder = new Promise((resolve, reject) => {
        const script = el('script', {
          src: HEIC_TO_URL,
          integrity: HEIC_TO_SRI,
          crossorigin: 'anonymous',
          referrerpolicy: 'no-referrer',
        });
        script.onload = () =>
          window.HeicTo
            ? resolve(window.HeicTo)
            : reject(new Error('HEIC decoder failed to start'));
        script.onerror = () => {
          heicDecoder = null; // allow a retry, e.g. after reconnecting
          reject(
            new Error(
              'Could not load the HEIC decoder. Check your internet connection and try again.',
            ),
          );
        };
        document.head.append(script);
      });
    }
    return heicDecoder;
  }

  /** Returns PNG or JPG bytes for `file`. HEIC/HEIF and AVIF photos become JPEGs;
   *  other formats (WebP, GIF, …) become PNGs so transparency is kept.
   *  `from` names the original format when the image was converted. */
  async function normalizeImage(file) {
    const bytes = await readFile(file);
    if (isPng(bytes)) return { bytes, type: 'png' };
    if (isJpg(bytes)) return { bytes, type: 'jpg' };
    const heif = isHeif(bytes);
    const from = heif
      ? /\.avif$/i.test(file.name)
        ? 'AVIF'
        : 'HEIC'
      : (file.type.split('/')[1] || 'image').toUpperCase();
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) {
      if (!heif) throw new Error(`${file.name} is not a supported image`);
      const heicTo = await loadHeicDecoder();
      try {
        const jpeg = await heicTo({
          blob: file,
          type: 'image/jpeg',
          quality: 0.92,
        });
        return {
          bytes: new Uint8Array(await jpeg.arrayBuffer()),
          type: 'jpg',
          from,
        };
      } catch (e) {
        console.error(e);
        throw new Error(`${file.name} could not be decoded as a HEIC image`);
      }
    }
    const type = heif ? 'jpg' : 'png';
    const canvas = el('canvas', { width: bitmap.width, height: bitmap.height });
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const blob = await new Promise((r) =>
      canvas.toBlob(r, type === 'jpg' ? 'image/jpeg' : 'image/png', 0.92),
    );
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type, from };
  }

  /** An object URL showing a normalized image (works even for HEIC in Chrome). */
  const imageUrl = (img) =>
    URL.createObjectURL(
      new Blob([img.bytes], {
        type: img.type === 'png' ? 'image/png' : 'image/jpeg',
      }),
    );

  const embedImage = (doc, img) =>
    img.type === 'png' ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes);

  function download(bytes, name) {
    name =
      name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'document';
    if (!/\.pdf$/i.test(name)) name += '.pdf';
    const url = URL.createObjectURL(
      new Blob([bytes], { type: 'application/pdf' }),
    );
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return name;
  }

  /** Runs an async action while showing a busy state on its button; errors become toasts. */
  async function run(button, action) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    document.body.classList.add('busy');
    try {
      await action();
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), 'error');
    } finally {
      button.disabled = false;
      button.textContent = label;
      document.body.classList.remove('busy');
    }
  }

  function setupDrop(zone, onFiles) {
    const input = $('input[type=file]', zone);
    zone.tabIndex = 0;
    zone.setAttribute('role', 'button');
    zone.setAttribute(
      'aria-label',
      zone.textContent.replace(/\s+/g, ' ').trim(),
    );
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    const accepts = (file) =>
      !input.accept ||
      input.accept.split(',').some((a) => {
        a = a.trim();
        if (a.startsWith('.')) return file.name.toLowerCase().endsWith(a);
        if (a.endsWith('/*')) return file.type.startsWith(a.slice(0, -1));
        return file.type === a;
      });
    const handle = (files) => {
      const ok = files.filter(accepts);
      if (!ok.length) {
        toast('That file type is not supported here', 'error');
        return;
      }
      $('#result').hidden = true;
      zone.classList.add('loading');
      Promise.resolve(onFiles(input.multiple ? ok : [ok[0]]))
        .catch((e) => {
          console.error(e);
          toast(e.message || String(e), 'error');
        })
        .finally(() => zone.classList.remove('loading'));
    };
    input.addEventListener('change', () => {
      if (input.files.length) handle([...input.files]);
      input.value = '';
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      handle([...e.dataTransfer.files]);
    });
  }

  // Stop the browser from opening a file dropped outside a drop zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  /** Lets a grid card be dragged onto another card to reorder. `state.dragFrom`
   *  holds the index being dragged; `move(from, to)` performs the reorder. */
  function makeReorderable(card, index, state, move) {
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      state.dragFrom = index;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index)); // Firefox needs data to start a drag
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      state.dragFrom = -1;
      card.classList.remove('dragging');
    });
    card.addEventListener('dragover', (e) => {
      if (state.dragFrom < 0) return; // not one of our cards (e.g. a file from the desktop)
      e.preventDefault();
      e.stopPropagation();
      card.classList.add('dragover');
    });
    card.addEventListener('dragleave', () => card.classList.remove('dragover'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('dragover');
      const from = state.dragFrom;
      state.dragFrom = -1;
      if (from >= 0 && from !== index) move(from, index);
    });
  }

  // ------------------------------------------------------- previews (pdf.js)

  const pdfjs = window.pdfjsLib;
  const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
  if (pdfjs) {
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}build/pdf.worker.min.js`;
  } else {
    toast(
      'Page previews are unavailable (are you offline?). Most tools still work, ' +
        'but "Add text & images" needs previews.',
      'error',
    );
  }

  function openForView(bytes) {
    // pdf.js takes ownership of the buffer it is given, so pass a copy.
    // isEvalSupported: false guards against malicious fonts (CVE-2024-4367).
    return pdfjs.getDocument({
      data: bytes.slice(),
      cMapUrl: `${PDFJS_CDN}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_CDN}standard_fonts/`,
      isEvalSupported: false,
    }).promise;
  }

  /** Renders a page into `canvas`, sized by `width` or by the longer side (`fit`).
   *  Returns the CSS-pixel viewport, used to map clicks to PDF coordinates. */
  /** Renders a page into `canvas`. Size it by `width`, by the longer side
   *  (`fit`), or to fit inside a `box` of [width, height]. `rotate` adds extra
   *  clockwise rotation on top of the page's own. Returns the CSS-pixel
   *  viewport, used to map clicks to PDF coordinates. */
  async function renderPage(
    pdf,
    pageNumber,
    canvas,
    { width, fit, box, rotate = 0, maxDpr = Infinity },
  ) {
    const page = await pdf.getPage(pageNumber);
    const rotation = norm360(page.rotate + rotate);
    const base = page.getViewport({ scale: 1, rotation });
    const scale = width
      ? width / base.width
      : box
      ? Math.min(box[0] / base.width, box[1] / base.height)
      : fit / Math.max(base.width, base.height);
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const hi = page.getViewport({ scale: scale * dpr, rotation });
    canvas.width = Math.round(hi.width);
    canvas.height = Math.round(hi.height);
    canvas.style.width = `${Math.round(hi.width / dpr)}px`;
    canvas.style.height = `${Math.round(hi.height / dpr)}px`;
    // 'print' intent draws form-field values onto the canvas and doesn't wait on
    // requestAnimationFrame, so previews keep rendering in background tabs.
    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: hi,
      intent: 'print',
      annotationMode: pdfjs.AnnotationMode.ENABLE,
    }).promise;
    return page.getViewport({ scale, rotation });
  }

  // Longest side of page thumbnails in the Merge and Organize grids (CSS px).
  // Their sharpness is capped at 1.5x so a long PDF doesn't use too much memory.
  const GRID_THUMB = 230;
  const GRID_THUMB_OPTS = { fit: GRID_THUMB, maxDpr: 1.5 };

  async function renderThumbs(
    bytes,
    container,
    { max = 12, fit = 300, onOpenTitle = () => '' } = {},
  ) {
    container.innerHTML = '';
    if (!pdfjs) {
      container.append(
        el(
          'p',
          { class: 'muted' },
          'Previews are unavailable offline, but your file is ready.',
        ),
      );
      return;
    }
    const pdf = await openForView(bytes);
    const n = Math.min(pdf.numPages, max);
    for (let i = 1; i <= n; i++) {
      const canvas = el('canvas');
      container.append(
        el(
          'figure',
          {},
          el(
            'button',
            {
              type: 'button',
              class: 'thumb-open',
              title: 'View full size',
              'aria-label': `View page ${i} full size`,
              onclick: () =>
                openViewer(bytes, { start: i - 1, title: onOpenTitle() }),
            },
            canvas,
          ),
          el('figcaption', {}, `Page ${i}`),
        ),
      );
      await renderPage(pdf, i, canvas, { fit });
    }
    if (pdf.numPages > max) {
      container.append(
        el(
          'p',
          { class: 'muted more' },
          `+ ${plural(pdf.numPages - max, 'more page')}`,
        ),
      );
    }
    pdf.destroy();
  }

  // ------------------------------------------------------------ result panel

  const result = { bytes: null, url: null };
  // Set when the user has edits that exist only in memory (see beforeunload).
  let unsaved = false;

  async function showResult(bytes, filename) {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    result.bytes = bytes;
    if (result.url) URL.revokeObjectURL(result.url);
    result.url = URL.createObjectURL(
      new Blob([bytes], { type: 'application/pdf' }),
    );
    $('#result-name').value = filename;
    $('#result-meta').textContent = `${plural(
      doc.getPageCount(),
      'page',
    )} · ${formatBytes(bytes.length)}`;
    const section = $('#result');
    section.hidden = false;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    section.focus({ preventScroll: true });
    await renderThumbs(bytes, $('#result-thumbs'), {
      onOpenTitle: () => $('#result-name').value,
    });
  }

  $('#result-download').addEventListener('click', () => {
    const saved = download(result.bytes, $('#result-name').value);
    unsaved = false;
    toast(`Saved ${saved}`, 'ok');
  });
  $('#result-open').addEventListener('click', () =>
    window.open(result.url, '_blank'),
  );
  $('#result-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#result-download').click();
  });

  window.addEventListener('beforeunload', (e) => {
    if (!unsaved) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ------------------------------------------------------ full-size viewer

  // A lightbox that shows one page at a time as large as the window allows.
  // `pages` lists which pages to step through, as { index, rot } (0-based page
  // index plus extra rotation); it defaults to every page of the document.
  // It can also show images instead: `viewer.images` then holds
  // { url, name, width, height } items and `pdf` is null.
  const viewer = {
    pdf: null,
    images: null,
    pages: [],
    at: 0,
    token: 0,
    returnFocus: null,
  };

  /** Opens the viewer on a list of images, starting at `start`. */
  function openImageViewer(images, start = 0) {
    closeViewer({ restoreFocus: false });
    viewer.returnFocus = document.activeElement;
    viewer.images = images;
    viewer.pages = images;
    viewer.at = Math.min(start, images.length - 1);
    $('#viewer').hidden = false;
    document.body.classList.add('lb-open');
    $('#viewer-close').focus();
    drawViewer();
  }

  async function openViewer(bytes, { pages, start = 0, title = '' } = {}) {
    if (!pdfjs) {
      toast(
        'The page viewer needs previews, which could not load (offline?)',
        'error',
      );
      return;
    }
    closeViewer({ restoreFocus: false });
    viewer.returnFocus = document.activeElement;
    const token = ++viewer.token;
    const pdf = await openForView(bytes);
    if (token !== viewer.token) return pdf.destroy();
    viewer.pdf = pdf;
    viewer.images = null;
    viewer.pages =
      pages ||
      Array.from({ length: pdf.numPages }, (_, index) => ({ index, rot: 0 }));
    viewer.at = Math.min(start, viewer.pages.length - 1);
    $('#viewer-title').textContent = title;
    $('#viewer-title').title = title;
    $('#viewer').hidden = false;
    document.body.classList.add('lb-open');
    $('#viewer-close').focus();
    await drawViewer();
  }

  async function drawViewer() {
    const token = ++viewer.token;
    const { pages, at } = viewer;
    $('#viewer-count').textContent = `${viewer.images ? 'Image' : 'Page'} ${
      at + 1
    } of ${pages.length}`;
    $('#viewer-prev').disabled = at === 0;
    $('#viewer-next').disabled = at >= pages.length - 1;
    $('#viewer-nav').hidden = pages.length < 2;
    // Leave room for the frame's padding and the caption bar.
    const box = [
      Math.min(innerWidth * 0.94, 1600) - 24,
      innerHeight * 0.94 - 76,
    ];
    if (viewer.images) {
      const im = viewer.images[at];
      // Fit the window, but don't blow small images up past 2x (they'd just blur).
      const k = Math.min(box[0] / im.width, box[1] / im.height, 2);
      const title = `${im.name} · ${im.width} × ${im.height}`;
      $('#viewer-title').textContent = title;
      $('#viewer-title').title = title;
      $('#viewer-stage').replaceChildren(
        el('img', {
          src: im.url,
          alt: im.name,
          style: `width:${Math.round(im.width * k)}px;height:${Math.round(
            im.height * k,
          )}px`,
        }),
      );
      return;
    }
    const canvas = el('canvas', {
      role: 'img',
      'aria-label': `Page ${at + 1}`,
    });
    try {
      await renderPage(viewer.pdf, pages[at].index + 1, canvas, {
        box,
        rotate: pages[at].rot,
      });
    } catch (e) {
      if (token === viewer.token) console.error(e);
      return;
    }
    if (token !== viewer.token) return; // closed or moved on meanwhile
    $('#viewer-stage').replaceChildren(canvas);
  }

  function stepViewer(delta) {
    const to = viewer.at + delta;
    if (to < 0 || to >= viewer.pages.length) return;
    viewer.at = to;
    drawViewer();
  }

  function closeViewer({ restoreFocus = true } = {}) {
    if ($('#viewer').hidden) return;
    viewer.token++;
    viewer.pdf?.destroy();
    viewer.pdf = null;
    viewer.images = null;
    $('#viewer').hidden = true;
    $('#viewer-stage').replaceChildren();
    document.body.classList.remove('lb-open');
    if (restoreFocus) viewer.returnFocus?.focus?.();
  }

  $('#viewer-close').addEventListener('click', () => closeViewer());
  $('#viewer-prev').addEventListener('click', () => stepViewer(-1));
  $('#viewer-next').addEventListener('click', () => stepViewer(1));
  // Clicking the dark backdrop (outside the white frame) closes the viewer.
  $('#viewer').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeViewer();
  });
  document.addEventListener('keydown', (e) => {
    if ($('#viewer').hidden) return;
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft') stepViewer(-1);
    else if (e.key === 'ArrowRight') stepViewer(1);
    else if (e.key === 'Tab') {
      // Keep keyboard focus inside the dialog.
      const focusable = $$('#viewer button:not([disabled])');
      const i = focusable.indexOf(document.activeElement);
      const next = e.shiftKey ? i - 1 : i + 1;
      e.preventDefault();
      focusable[(next + focusable.length) % focusable.length]?.focus();
      return;
    } else return;
    e.preventDefault();
  });
  let viewerResizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(viewerResizeTimer);
    viewerResizeTimer = setTimeout(
      () => !$('#viewer').hidden && drawViewer(),
      200,
    );
  });

  // -------------------------------------------------------------- navigation

  function showTool(id) {
    if (!$(`#tool-${id}`)) id = 'merge';
    $$('#nav button').forEach((b) => {
      const active = b.dataset.tool === id;
      b.classList.toggle('active', active);
      if (active) {
        b.setAttribute('aria-current', 'page');
        b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else b.removeAttribute('aria-current');
    });
    $$('.tool').forEach((s) => (s.hidden = s.id !== `tool-${id}`));
    $('#result').hidden = true;
    history.replaceState(null, '', `#${id}`);
    document.dispatchEvent(new CustomEvent('toolchange', { detail: id }));
  }
  $$('#nav button').forEach((b) =>
    b.addEventListener('click', () => showTool(b.dataset.tool)),
  );
  showTool(location.hash.slice(1));
  window.addEventListener('hashchange', () => showTool(location.hash.slice(1)));

  // ------------------------------------------------------------------- merge

  const merge = { files: [], dragFrom: -1, focus: -1 };

  setupDrop($('#merge-drop'), async (files) => {
    const added = [];
    for (const file of files) {
      try {
        const bytes = await readFile(file);
        const doc = await loadPdf(bytes);
        const item = {
          name: file.name,
          bytes,
          pages: doc.getPageCount(),
          thumbPending: !!pdfjs,
        };
        merge.files.push(item);
        added.push(item);
      } catch (e) {
        toast(`${file.name}: ${e.message}`, 'error');
      }
    }
    drawMerge();
    // Draw first-page thumbnails in the background so the files show up right away.
    for (const item of added) {
      if (!pdfjs) break;
      try {
        item.thumbUrl = await renderFirstPageUrl(item.bytes);
      } catch (e) {
        console.error(e);
      }
      item.thumbPending = false;
      if (!merge.files.includes(item)) {
        if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl); // removed meanwhile
      } else drawMerge();
    }
  });

  /** Renders page 1 of a PDF to a small PNG and returns an object URL for it. */
  async function renderFirstPageUrl(bytes) {
    const pdf = await openForView(bytes);
    try {
      const canvas = el('canvas');
      await renderPage(pdf, 1, canvas, GRID_THUMB_OPTS);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      return URL.createObjectURL(blob);
    } finally {
      pdf.destroy();
    }
  }

  function moveFile(from, to) {
    if (to < 0 || to >= merge.files.length || from === to) return;
    merge.files.splice(to, 0, merge.files.splice(from, 1)[0]);
    merge.focus = to;
    drawMerge();
  }

  function removeFile(i) {
    const [gone] = merge.files.splice(i, 1);
    if (gone.thumbUrl) URL.revokeObjectURL(gone.thumbUrl);
    merge.focus = Math.min(i, merge.files.length - 1);
    drawMerge();
  }

  function drawMerge() {
    const { files } = merge;
    const grid = $('#merge-grid');
    // Keep keyboard focus on the same card when the grid is rebuilt
    // (e.g. when a thumbnail finishes rendering).
    const hadFocus = $$('.pframe', grid).indexOf(document.activeElement);
    const focusIndex = merge.focus >= 0 ? merge.focus : hadFocus;
    merge.focus = -1;
    grid.innerHTML = '';
    files.forEach((f, i) => {
      const thumb = f.thumbUrl
        ? el('img', { src: f.thumbUrl, alt: '' })
        : el(
            'span',
            { class: f.thumbPending ? 'thumb-pending' : 'thumb-none' },
            f.thumbPending ? '' : 'PDF',
          );
      const frame = el(
        'div',
        {
          class: 'pframe',
          role: 'button',
          tabindex: '0',
          'aria-label': `${f.name}, ${plural(f.pages, 'page')}, position ${
            i + 1
          } of ${files.length}`,
          title: `${f.name} — click to view, drag to change the order`,
          onclick: () => openViewer(f.bytes, { title: f.name }),
        },
        thumb,
      );
      frame.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openViewer(f.bytes, { title: f.name });
        } else if (
          e.shiftKey &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        ) {
          e.preventDefault();
          moveFile(i, i + (e.key === 'ArrowLeft' ? -1 : 1));
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          removeFile(i);
        }
      });
      const card = el(
        'div',
        { class: `pcard file-card${f.pages > 1 ? ' multi' : ''}` },
        frame,
        el('div', { class: 'fcap', title: f.name }, f.name),
        el('div', { class: 'fmeta muted small' }, plural(f.pages, 'page')),
        el(
          'div',
          { class: 'pbar' },
          el('span', { class: 'num' }, i + 1),
          iconBtn('⤢', `View ${f.name} full size`, () =>
            openViewer(f.bytes, { title: f.name }),
          ),
          iconBtn(
            '←',
            `Move ${f.name} earlier`,
            () => moveFile(i, i - 1),
            i === 0,
          ),
          iconBtn(
            '→',
            `Move ${f.name} later`,
            () => moveFile(i, i + 1),
            i === files.length - 1,
          ),
          iconBtn('✕', `Remove ${f.name}`, () => removeFile(i)),
        ),
      );
      makeReorderable(card, i, merge, moveFile);
      grid.append(card);
    });
    grid.hidden = !files.length;
    $('#merge-hint').hidden = files.length < 2;
    const total = files.reduce((sum, f) => sum + f.pages, 0);
    $('#merge-summary').textContent = !files.length
      ? 'Add two or more PDFs to get started.'
      : files.length === 1
      ? 'Add at least one more PDF to merge.'
      : `${plural(files.length, 'file')} · ${plural(total, 'page')} total`;
    $('#merge-run').disabled = files.length < 2;
    $('#merge-clear').hidden = !files.length;
    if (focusIndex >= 0) $$('.pframe', grid)[focusIndex]?.focus();
  }

  $('#merge-clear').addEventListener('click', () => {
    merge.files.forEach((f) => f.thumbUrl && URL.revokeObjectURL(f.thumbUrl));
    merge.files = [];
    drawMerge();
  });

  $('#merge-run').addEventListener('click', (e) =>
    run(e.currentTarget, async () => {
      const out = await PDFDocument.create();
      for (const file of merge.files) {
        const src = await loadPdf(file.bytes);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      await showResult(await out.save(), 'merged.pdf');
    }),
  );

  // ---------------------------------------------------------------- organize

  const org = {
    bytes: null,
    name: '',
    pages: [],
    thumbs: [],
    dragFrom: -1,
    focus: -1,
    token: 0,
  };

  setupDrop($('#org-drop'), async ([file]) => {
    const bytes = await readFile(file);
    const doc = await loadPdf(bytes);
    Object.assign(org, { bytes, name: file.name, focus: -1 });
    const token = ++org.token;
    // Correctly shaped placeholders until pdf.js has drawn each page.
    org.thumbs = doc.getPages().map((p, i) => {
      const { width, height } = p.getSize();
      const rotated = p.getRotation().angle % 180 !== 0;
      const [w, h] = rotated ? [height, width] : [width, height];
      const k = GRID_THUMB / Math.max(w, h);
      return el('canvas', {
        class: 'pending',
        role: 'img',
        'aria-label': `Page ${i + 1}`,
        style: `width:${Math.round(w * k)}px;height:${Math.round(h * k)}px`,
      });
    });
    resetOrg();
    $('#org-work').hidden = false;
    // Render thumbnails in the background so the drop zone is free again right away.
    if (pdfjs) {
      (async () => {
        const pdf = await openForView(bytes);
        for (let i = 0; i < pdf.numPages && token === org.token; i++) {
          await renderPage(pdf, i + 1, org.thumbs[i], GRID_THUMB_OPTS);
          org.thumbs[i].classList.remove('pending');
        }
        pdf.destroy();
      })().catch((e) => console.error(e));
    }
  });

  function resetOrg() {
    org.pages = org.thumbs.map((_, i) => ({ src: i, rot: 0, sel: false }));
    drawOrg();
  }

  function movePage(from, to) {
    if (to < 0 || to >= org.pages.length || from === to) return;
    org.pages.splice(to, 0, org.pages.splice(from, 1)[0]);
    org.focus = to;
    drawOrg();
  }

  function drawOrg() {
    const grid = $('#org-grid');
    grid.innerHTML = '';
    org.pages.forEach((p, i) => {
      const canvas = org.thumbs[p.src];
      canvas.style.transform = `rotate(${p.rot}deg)`;
      const toggle = () => {
        p.sel = !p.sel;
        org.focus = i;
        drawOrg();
      };
      const frame = el(
        'div',
        {
          class: 'pframe',
          role: 'button',
          tabindex: '0',
          'aria-pressed': String(p.sel),
          'aria-label': `Page ${i + 1}${p.sel ? ', selected' : ''}`,
          title: 'Click to select',
          onclick: toggle,
        },
        canvas,
      );
      frame.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        } else if (
          e.shiftKey &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        ) {
          e.preventDefault();
          movePage(i, i + (e.key === 'ArrowLeft' ? -1 : 1));
        }
      });
      const card = el(
        'div',
        { class: `pcard${p.sel ? ' selected' : ''}` },
        frame,
        el(
          'div',
          { class: 'pbar' },
          el(
            'span',
            { class: 'num' },
            i + 1,
            p.src !== i
              ? el('span', { class: 'muted small' }, ` (was ${p.src + 1})`)
              : '',
          ),
          iconBtn('⤢', `View page ${i + 1} full size`, () =>
            openViewer(org.bytes, {
              pages: org.pages.map((pg) => ({ index: pg.src, rot: pg.rot })),
              start: i,
              title: org.name,
            }),
          ),
          iconBtn(
            '↺',
            `Rotate page ${i + 1} left`,
            () => ((p.rot -= 90), drawOrg()),
          ),
          iconBtn(
            '↻',
            `Rotate page ${i + 1} right`,
            () => ((p.rot += 90), drawOrg()),
          ),
          iconBtn(
            '✕',
            `Delete page ${i + 1}`,
            () => (org.pages.splice(i, 1), drawOrg()),
          ),
        ),
      );
      makeReorderable(card, i, org, movePage);
      grid.append(card);
    });
    if (!org.pages.length) {
      grid.append(
        el(
          'p',
          { class: 'muted empty' },
          'All pages deleted. Press Reset to start over.',
        ),
      );
    }
    const selected = org.pages.filter((p) => p.sel).length;
    $('#org-info').textContent = `${org.name} · ${plural(
      org.pages.length,
      'page',
    )}${selected ? ` · ${selected} selected` : ''}`;
    $('#org-info').title = org.name;
    $('#org-save').disabled = !org.pages.length;
    $('#org-extract-sel').disabled = !selected;
    $('#org-del-sel').disabled = !selected;
    $('#org-rot-sel').title = selected
      ? 'Rotate selected pages'
      : 'Rotate all pages';
    if (org.focus >= 0) $$('.pframe', grid)[org.focus]?.focus();
  }

  async function exportPages(list, suffix) {
    if (!list.length) throw new Error('No pages to export');
    const src = await loadPdf(org.bytes);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      src,
      list.map((p) => p.src),
    );
    copied.forEach((page, k) => {
      if (norm360(list[k].rot)) {
        page.setRotation(
          degrees(norm360(page.getRotation().angle + list[k].rot)),
        );
      }
      out.addPage(page);
    });
    await showResult(await out.save(), `${baseName(org.name)}-${suffix}.pdf`);
  }

  $('#org-sel-all').addEventListener('click', () => {
    org.pages.forEach((p) => (p.sel = true));
    drawOrg();
  });
  $('#org-sel-none').addEventListener('click', () => {
    org.pages.forEach((p) => (p.sel = false));
    drawOrg();
  });
  $('#org-rot-sel').addEventListener('click', () => {
    const sel = org.pages.filter((p) => p.sel);
    (sel.length ? sel : org.pages).forEach((p) => (p.rot += 90));
    drawOrg();
  });
  $('#org-del-sel').addEventListener('click', () => {
    org.pages = org.pages.filter((p) => !p.sel);
    org.focus = -1;
    drawOrg();
  });
  $('#org-reset').addEventListener('click', () => {
    org.focus = -1;
    resetOrg();
  });
  $('#org-save').addEventListener('click', (e) =>
    run(e.currentTarget, () => exportPages(org.pages, 'organized')),
  );
  $('#org-extract-sel').addEventListener('click', (e) =>
    run(e.currentTarget, () =>
      exportPages(
        org.pages.filter((p) => p.sel),
        'extract',
      ),
    ),
  );
  $('#org-extract-range').addEventListener('click', (e) =>
    run(e.currentTarget, async () => {
      const idx = parseRanges($('#org-range').value, org.pages.length);
      await exportPages(
        idx.map((i) => org.pages[i]),
        'extract',
      );
    }),
  );
  $('#org-range').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#org-extract-range').click();
  });

  // --------------------------------------------------- edit: text and images

  const edit = {
    bytes: null,
    name: '',
    page: 0,
    count: 0,
    point: null,
    viewport: null,
    history: [],
    mode: 'text',
    image: null,
    token: 0,
    width: 0,
    zoom: 1, // 1 = page fills the column width
  };
  const stage = $('#edit-stage');
  const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

  /** Width available for the page inside the scrollable editor area. */
  function editFitWidth() {
    const box = $('#edit-scroll');
    const cs = getComputedStyle(box);
    return Math.floor(
      box.clientWidth -
        parseFloat(cs.paddingLeft) -
        parseFloat(cs.paddingRight) -
        2, // 2 = stage border
    );
  }

  function setZoom(zoom) {
    const scroller = $('#edit-scroll');
    // Keep roughly the same spot in view while zooming.
    const ratio = zoom / edit.zoom;
    const x =
      (scroller.scrollLeft + scroller.clientWidth / 2) * ratio -
      scroller.clientWidth / 2;
    const y =
      (scroller.scrollTop + scroller.clientHeight / 2) * ratio -
      scroller.clientHeight / 2;
    edit.zoom = zoom;
    renderEdit().then(() => scroller.scrollTo(Math.max(0, x), Math.max(0, y)));
  }
  $('#edit-zoom-in').addEventListener('click', () => {
    const next = ZOOM_LEVELS.find((z) => z > edit.zoom);
    if (next) setZoom(next);
  });
  $('#edit-zoom-out').addEventListener('click', () => {
    const prev = [...ZOOM_LEVELS].reverse().find((z) => z < edit.zoom);
    if (prev) setZoom(prev);
  });
  $('#edit-zoom-fit').addEventListener('click', () => setZoom(1));

  setupDrop($('#edit-drop'), async ([file]) => {
    const bytes = await readFile(file);
    const doc = await loadPdf(bytes);
    Object.assign(edit, {
      bytes,
      name: file.name,
      page: 0,
      count: doc.getPageCount(),
      point: null,
      history: [],
    });
    unsaved = false;
    const select = $('#edit-page');
    select.innerHTML = '';
    for (let i = 0; i < edit.count; i++) {
      select.append(el('option', { value: i }, i + 1));
    }
    $('#edit-count').textContent = `of ${edit.count}`;
    $('#edit-work').hidden = false;
    stage.tabIndex = 0;
    await renderEdit();
  });

  async function renderEdit() {
    const token = ++edit.token;
    $('#edit-page').value = edit.page;
    $('#edit-prev').disabled = edit.page === 0;
    $('#edit-next').disabled = edit.page >= edit.count - 1;
    $('#edit-undo').disabled = !edit.history.length;
    if (!pdfjs) {
      toast(
        'Placing content needs page previews, which could not load (offline?)',
        'error',
      );
      return;
    }
    const fitWidth = editFitWidth();
    if (fitWidth <= 0) return; // tool is hidden; it re-renders when shown
    const width = Math.round(fitWidth * edit.zoom);
    $('#edit-zoom-label').textContent =
      edit.zoom === 1 ? 'Fit width' : `${Math.round(edit.zoom * 100)}%`;
    $('#edit-zoom-out').disabled = edit.zoom <= ZOOM_LEVELS[0];
    $('#edit-zoom-in').disabled =
      edit.zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    const pdf = await openForView(edit.bytes);
    const canvas = el('canvas');
    const viewport = await renderPage(pdf, edit.page + 1, canvas, { width });
    pdf.destroy();
    if (token !== edit.token) return; // a newer render started meanwhile
    $('canvas', stage)?.remove();
    stage.prepend(canvas);
    edit.viewport = viewport;
    edit.width = fitWidth;
    drawMarker();
  }

  function drawMarker() {
    const marker = $('#edit-marker');
    const ready = edit.point && edit.viewport;
    marker.hidden = !ready;
    $('#edit-add').disabled = !ready;
    $('#edit-pos').textContent = ready
      ? `x ${edit.point.x.toFixed(0)}, y ${edit.point.y.toFixed(0)} pt`
      : 'click on the page';
    if (!ready) return;
    const [left, top] = edit.viewport.convertToViewportPoint(
      edit.point.x,
      edit.point.y,
    );
    marker.style.left = `${left}px`;
    marker.style.top = `${top}px`;

    const scale = edit.viewport.scale;
    const ghost = $('#edit-ghost');
    const imgbox = $('#edit-imgbox');
    ghost.hidden = edit.mode !== 'text';
    imgbox.hidden = edit.mode !== 'image' || !edit.image;
    if (edit.mode === 'text') {
      const px = clampNum($('#edit-size').value, 4, 300, 24) * scale;
      const font = $('#edit-font').value;
      ghost.textContent = $('#edit-text').value;
      ghost.style.fontSize = `${px}px`;
      ghost.style.top = `${-px * 0.9}px`;
      ghost.style.color = $('#edit-color').value;
      ghost.style.fontWeight = /Bold/.test(font) ? '700' : '400';
      ghost.style.fontFamily = font.startsWith('Times')
        ? 'Times, serif'
        : font.startsWith('Courier')
        ? 'Courier, monospace'
        : 'Helvetica, Arial, sans-serif';
    } else if (edit.image) {
      const w = clampNum($('#edit-img-width').value, 5, 5000, 150);
      imgbox.style.width = `${w * scale}px`;
      imgbox.style.height = `${
        w * (edit.image.height / edit.image.width) * scale
      }px`;
    }
  }

  stage.addEventListener('click', (e) => {
    const canvas = $('canvas', stage);
    if (!canvas || !edit.viewport) return;
    const rect = canvas.getBoundingClientRect();
    const [x, y] = edit.viewport.convertToPdfPoint(
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    edit.point = { x, y };
    drawMarker();
  });

  // Keyboard placement: arrows move the marker (Shift = faster), Enter adds.
  stage.addEventListener('keydown', (e) => {
    const canvas = $('canvas', stage);
    if (!canvas || !edit.viewport) return;
    const step = e.shiftKey ? 20 : 4;
    const moves = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const w = parseFloat(canvas.style.width);
      const h = parseFloat(canvas.style.height);
      let [vx, vy] = edit.point
        ? edit.viewport.convertToViewportPoint(edit.point.x, edit.point.y)
        : [w / 2, h / 2];
      vx = Math.min(w, Math.max(0, vx + moves[e.key][0]));
      vy = Math.min(h, Math.max(0, vy + moves[e.key][1]));
      const [x, y] = edit.viewport.convertToPdfPoint(vx, vy);
      edit.point = { x, y };
      drawMarker();
    } else if (e.key === 'Enter' && edit.point) {
      e.preventDefault();
      $('#edit-add').click();
    }
  });

  const goToPage = (n) => {
    edit.page = n;
    edit.point = null;
    renderEdit();
  };
  $('#edit-page').addEventListener('change', (e) => goToPage(+e.target.value));
  $('#edit-prev').addEventListener('click', () => goToPage(edit.page - 1));
  $('#edit-next').addEventListener('click', () => goToPage(edit.page + 1));

  $$('#tool-edit .tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      edit.mode = b.dataset.mode;
      $$('#tool-edit .tabs button').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      $('#edit-text-opts').hidden = edit.mode !== 'text';
      $('#edit-image-opts').hidden = edit.mode !== 'image';
      drawMarker();
    }),
  );
  [
    '#edit-text',
    '#edit-size',
    '#edit-color',
    '#edit-font',
    '#edit-img-width',
  ].forEach((s) => $(s).addEventListener('input', drawMarker));

  $('#edit-image').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const img = await normalizeImage(file);
      const bitmap = await createImageBitmap(new Blob([img.bytes]));
      if (edit.image) URL.revokeObjectURL(edit.image.url);
      edit.image = {
        ...img,
        name: file.name,
        width: bitmap.width,
        height: bitmap.height,
        url: imageUrl(img),
      };
      bitmap.close();
      const preview = $('#edit-image-preview');
      preview.replaceChildren(el('img', { src: edit.image.url, alt: '' }));
      preview.hidden = false;
      drawMarker();
    } catch (err) {
      if (edit.image) URL.revokeObjectURL(edit.image.url);
      edit.image = null;
      $('#edit-image-preview').hidden = true;
      e.target.value = '';
      toast(err.message, 'error');
    }
  });

  $('#edit-image-preview').addEventListener('click', () => {
    if (edit.image) openImageViewer([edit.image]);
  });

  $('#edit-add').addEventListener(
    'click',
    (e) =>
      run(e.currentTarget, async () => {
        if (!edit.point)
          throw new Error('Click on the page to choose a position first');
        const doc = await loadPdf(edit.bytes);
        const page = doc.getPage(edit.page);
        const angle = page.getRotation().angle; // keep content upright on rotated pages
        const { x, y } = edit.point;
        if (edit.mode === 'text') {
          const text = $('#edit-text').value;
          if (!text.trim()) throw new Error('Type some text first');
          const size = clampNum($('#edit-size').value, 4, 300, 24);
          const font = await doc.embedFont(
            StandardFonts[$('#edit-font').value],
          );
          try {
            page.drawText(text, {
              x,
              y,
              size,
              font,
              color: hexToRgb($('#edit-color').value),
              lineHeight: size * 1.2,
              rotate: degrees(angle),
            });
          } catch (err) {
            throw new Error(
              `Can't draw that text with a standard font: ${err.message}`,
            );
          }
        } else {
          if (!edit.image) throw new Error('Choose an image first');
          const img = await embedImage(doc, edit.image);
          const w = clampNum($('#edit-img-width').value, 5, 5000, 150);
          const h = (w * img.height) / img.width;
          const t = (angle * Math.PI) / 180;
          // The click marks the image's top-left corner; drawImage wants bottom-left.
          page.drawImage(img, {
            x: x + h * Math.sin(t),
            y: y - h * Math.cos(t),
            width: w,
            height: h,
            rotate: degrees(angle),
          });
        }
        edit.history.push(edit.bytes);
        edit.bytes = await doc.save();
        edit.point = null;
        unsaved = true;
        await renderEdit();
        toast(edit.mode === 'text' ? 'Text added' : 'Image added', 'ok');
      }).then(drawMarker), // run() re-enables the button; re-apply "needs a position"
  );

  async function undoEdit() {
    if (!edit.history.length) return;
    edit.bytes = edit.history.pop();
    unsaved = edit.history.length > 0;
    await renderEdit();
    toast('Undone');
  }
  $('#edit-undo').addEventListener('click', undoEdit);
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(
      document.activeElement.tagName,
    );
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !typing) {
      if (!$('#tool-edit').hidden && edit.history.length) {
        e.preventDefault();
        undoEdit();
      }
    }
  });
  $('#edit-done').addEventListener('click', (e) =>
    run(e.currentTarget, () =>
      showResult(edit.bytes, `${baseName(edit.name)}-edited.pdf`),
    ),
  );

  // Keep the edit preview sized to its column.
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!edit.bytes || $('#tool-edit').hidden) return;
      const width = editFitWidth();
      if (width > 0 && width !== edit.width) renderEdit();
    }, 200);
  });
  // The window may have been resized while another tool was showing.
  document.addEventListener('toolchange', (e) => {
    if (e.detail !== 'edit' || !edit.bytes) return;
    if (editFitWidth() !== edit.width) renderEdit();
  });

  // --------------------------------------------------------------- watermark

  const wm = { bytes: null, name: '' };

  setupDrop($('#wm-drop'), async ([file]) => {
    const bytes = await readFile(file);
    const doc = await loadPdf(bytes);
    Object.assign(wm, { bytes, name: file.name });
    const chip = $('#wm-file');
    chip.hidden = false;
    chip.textContent = `${file.name} · ${plural(doc.getPageCount(), 'page')}`;
    $('#wm-hint').textContent = 'Adjust the settings, then apply.';
    $('#wm-run').disabled = false;
  });

  $('#wm-opacity').addEventListener('input', (e) => {
    $('#wm-opacity-val').textContent = `${e.target.value}%`;
  });

  $('#wm-run').addEventListener('click', (e) =>
    run(e.currentTarget, async () => {
      const text = $('#wm-text').value.trim();
      if (!text) throw new Error('Enter watermark text');
      const doc = await loadPdf(wm.bytes);
      const font = await doc.embedFont(StandardFonts[$('#wm-font').value]);
      const size = clampNum($('#wm-size').value, 6, 400, 64);
      const angle = clampNum($('#wm-angle').value, -360, 360, 0);
      const opacity = clampNum($('#wm-opacity').value, 5, 100, 25) / 100;
      const color = hexToRgb($('#wm-color').value);
      const pages = doc.getPages();
      const range = $('#wm-pages').value.trim();
      const indices = range
        ? parseRanges(range, pages.length)
        : pages.map((_, i) => i);

      let textWidth;
      try {
        textWidth = font.widthOfTextAtSize(text, size);
      } catch (err) {
        throw new Error(
          `Can't draw that text with a standard font: ${err.message}`,
        );
      }
      const textHeight = font.heightAtSize(size, { descender: false });
      const t = (angle * Math.PI) / 180;

      for (const i of new Set(indices)) {
        const page = pages[i];
        const box = page.getMediaBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // Offset the start point so the rotated text is centred on the page.
        page.drawText(text, {
          x:
            cx - (textWidth / 2) * Math.cos(t) + (textHeight / 2) * Math.sin(t),
          y:
            cy - (textWidth / 2) * Math.sin(t) - (textHeight / 2) * Math.cos(t),
          size,
          font,
          color,
          opacity,
          rotate: degrees(angle),
        });
      }
      await showResult(
        await doc.save(),
        `${baseName(wm.name)}-watermarked.pdf`,
      );
    }),
  );

  // -------------------------------------------------------------------- form

  const formState = { bytes: null, name: '', controls: [] };

  setupDrop($('#form-drop'), async ([file]) => {
    const bytes = await readFile(file);
    const doc = await loadPdf(bytes);
    Object.assign(formState, { bytes, name: file.name, controls: [] });
    const box = $('#form-fields');
    box.innerHTML = '';
    $('#form-work').hidden = false;
    $('#form-filter').value = '';
    for (const field of doc.getForm().getFields()) {
      const control = buildControl(field);
      if (!control) continue;
      formState.controls.push(control);
      box.append(control.node);
    }
    const count = formState.controls.length;
    $('#form-info').textContent = count
      ? `${file.name} · ${plural(count, 'fillable field')}`
      : `${file.name} has no fillable form fields.`;
    $('#form-run').disabled = !count;
    box.hidden = !count;
    $('#form-filter').hidden = count < 8;
  });

  function buildControl(field) {
    const name = field.getName();
    const readOnly = field.isReadOnly();
    const safe = (fn, fallback) => {
      try {
        return fn();
      } catch (_) {
        return fallback;
      }
    };
    const wrap = (type, input) =>
      el(
        'label',
        { 'data-name': name.toLowerCase() },
        el('span', {}, name, el('span', { class: 'ftype' }, type)),
        input,
      );

    if (field instanceof PDFTextField) {
      const input = field.isMultiline()
        ? el('textarea', { rows: 2 })
        : el('input');
      input.value = safe(() => field.getText(), '') || '';
      input.disabled = readOnly;
      const max = field.getMaxLength();
      if (max) input.maxLength = max;
      return { name, node: wrap('text', input) };
    }
    if (field instanceof PDFCheckBox) {
      const input = el('input', { type: 'checkbox' });
      input.checked = field.isChecked();
      input.disabled = readOnly;
      const node = el(
        'label',
        { class: 'checkrow', 'data-name': name.toLowerCase() },
        input,
        el('span', {}, name, el('span', { class: 'ftype' }, 'checkbox')),
      );
      return { name, node };
    }
    if (field instanceof PDFDropdown || field instanceof PDFRadioGroup) {
      const isRadio = field instanceof PDFRadioGroup;
      const select = el('select', {}, el('option', { value: '' }, '— none —'));
      field
        .getOptions()
        .forEach((o) => select.append(el('option', { value: o }, o)));
      const current = safe(
        () => (isRadio ? field.getSelected() : field.getSelected()[0]),
        '',
      );
      select.value = current || '';
      select.disabled = readOnly;
      return { name, node: wrap(isRadio ? 'radio' : 'dropdown', select) };
    }
    if (field instanceof PDFOptionList) {
      const options = field.getOptions();
      const select = el('select', {
        multiple: true,
        size: Math.min(5, Math.max(2, options.length)),
      });
      const selected = new Set(safe(() => field.getSelected(), []));
      options.forEach((o) =>
        select.append(el('option', { value: o, selected: selected.has(o) }, o)),
      );
      select.disabled = readOnly;
      return { name, node: wrap('list', select) };
    }
    return null; // buttons and signatures can't be filled here
  }

  $('#form-filter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    formState.controls.forEach((c) => {
      c.node.hidden = q && !c.node.dataset.name.includes(q);
    });
  });

  $('#form-run').addEventListener('click', (e) =>
    run(e.currentTarget, async () => {
      const doc = await loadPdf(formState.bytes);
      const form = doc.getForm();
      // Controls hold only DOM inputs; write their values into this freshly loaded document.
      const problems = [];
      for (const c of formState.controls) {
        try {
          applyControl(form.getField(c.name), c.node);
        } catch (err) {
          problems.push(`${c.name}: ${err.message}`);
        }
      }
      if (problems.length) {
        throw new Error(`Some fields could not be filled — ${problems[0]}`);
      }
      if ($('#form-flatten').checked) form.flatten();
      await showResult(
        await doc.save(),
        `${baseName(formState.name)}-filled.pdf`,
      );
    }),
  );

  /** Writes the value of a control's input into `field`. */
  function applyControl(field, node) {
    const input = $('input, textarea, select', node);
    if (field instanceof PDFTextField) field.setText(input.value || undefined);
    else if (field instanceof PDFCheckBox) {
      if (input.checked) field.check();
      else field.uncheck();
    } else if (field instanceof PDFDropdown || field instanceof PDFRadioGroup) {
      if (input.value) field.select(input.value);
      else field.clear();
    } else if (field instanceof PDFOptionList) {
      const values = [...input.selectedOptions].map((o) => o.value);
      if (values.length) field.select(values);
      else field.clear();
    }
  }

  // ---------------------------------------------------------- images to PDF

  const imgs = { items: [], dragFrom: -1, focus: -1 };
  // Portrait page sizes in PDF points (1/72 inch).
  const PAGE_SIZES = {
    A4: [595.28, 841.89],
    Letter: [612, 792],
    A3: [841.89, 1190.55],
    Legal: [612, 1008],
    Tabloid: [792, 1224],
  };

  setupDrop($('#img-drop'), async (files) => {
    for (const file of files) {
      try {
        const img = await normalizeImage(file);
        const bitmap = await createImageBitmap(new Blob([img.bytes]));
        imgs.items.push({
          ...img,
          name: file.name,
          width: bitmap.width,
          height: bitmap.height,
          thumbUrl: imageUrl(img),
        });
        bitmap.close();
      } catch (e) {
        toast(e.message, 'error');
      }
    }
    drawImgs();
  });

  function moveImage(from, to) {
    if (to < 0 || to >= imgs.items.length || from === to) return;
    imgs.items.splice(to, 0, imgs.items.splice(from, 1)[0]);
    imgs.focus = to;
    drawImgs();
  }

  function removeImage(i) {
    const [gone] = imgs.items.splice(i, 1);
    URL.revokeObjectURL(gone.thumbUrl);
    imgs.focus = Math.min(i, imgs.items.length - 1);
    drawImgs();
  }

  function viewImages(start) {
    openImageViewer(
      imgs.items.map((it) => ({
        url: it.thumbUrl,
        name: it.name,
        width: it.width,
        height: it.height,
      })),
      start,
    );
  }

  function drawImgs() {
    const { items } = imgs;
    const grid = $('#img-grid');
    // Keep keyboard focus on the same card when the grid is rebuilt.
    const hadFocus = $$('.pframe', grid).indexOf(document.activeElement);
    const focusIndex = imgs.focus >= 0 ? imgs.focus : hadFocus;
    imgs.focus = -1;
    grid.innerHTML = '';
    items.forEach((it, i) => {
      const format = it.from
        ? `${it.from} → ${it.type.toUpperCase()}`
        : it.type.toUpperCase();
      const frame = el(
        'div',
        {
          class: 'pframe',
          role: 'button',
          tabindex: '0',
          'aria-label': `${it.name}, ${it.width} by ${it.height}, position ${
            i + 1
          } of ${items.length}`,
          title: `${it.name} — click to view, drag to change the order`,
          onclick: () => viewImages(i),
        },
        el('img', { src: it.thumbUrl, alt: '' }),
      );
      frame.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          viewImages(i);
        } else if (
          e.shiftKey &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        ) {
          e.preventDefault();
          moveImage(i, i + (e.key === 'ArrowLeft' ? -1 : 1));
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          removeImage(i);
        }
      });
      const card = el(
        'div',
        { class: 'pcard file-card image-card' },
        frame,
        el('div', { class: 'fcap', title: it.name }, it.name),
        el(
          'div',
          { class: 'fmeta muted small' },
          `${it.width} × ${it.height} · ${format}`,
        ),
        el(
          'div',
          { class: 'pbar' },
          el('span', { class: 'num' }, i + 1),
          iconBtn('⤢', `View ${it.name} full size`, () => viewImages(i)),
          iconBtn(
            '←',
            `Move ${it.name} earlier`,
            () => moveImage(i, i - 1),
            i === 0,
          ),
          iconBtn(
            '→',
            `Move ${it.name} later`,
            () => moveImage(i, i + 1),
            i === items.length - 1,
          ),
          iconBtn('✕', `Remove ${it.name}`, () => removeImage(i)),
        ),
      );
      makeReorderable(card, i, imgs, moveImage);
      grid.append(card);
    });
    const n = items.length;
    grid.hidden = !n;
    $('#img-hint').hidden = n < 2;
    $('#img-run').disabled = !n;
    $('#img-clear').hidden = !n;
    $('#img-summary').textContent = n
      ? `${plural(n, 'image')} · ${plural(n, 'page')}`
      : 'Add one or more images to get started.';
    if (focusIndex >= 0) $$('.pframe', grid)[focusIndex]?.focus();
  }

  $('#img-clear').addEventListener('click', () => {
    imgs.items.forEach((i) => URL.revokeObjectURL(i.thumbUrl));
    imgs.items = [];
    drawImgs();
  });

  $('#img-run').addEventListener('click', (e) =>
    run(e.currentTarget, async () => {
      const out = await PDFDocument.create();
      const sizeKey = $('#img-size').value;
      const orient = $('#img-orient').value;
      const margin = clampNum($('#img-margin').value, 0, 1000, 0);
      for (const item of imgs.items) {
        const img = await embedImage(out, item);
        let w;
        let h;
        if (sizeKey === 'fit') {
          [w, h] = [img.width + 2 * margin, img.height + 2 * margin];
        } else {
          [w, h] = PAGE_SIZES[sizeKey];
          const landscape =
            orient === 'landscape' ||
            (orient === 'auto' && img.width > img.height);
          if (landscape) [w, h] = [h, w];
        }
        if (w - 2 * margin < 10 || h - 2 * margin < 10) {
          throw new Error('The margin is too large for this page size');
        }
        const page = out.addPage([w, h]);
        const fit = img.scaleToFit(w - 2 * margin, h - 2 * margin);
        page.drawImage(img, {
          x: (w - fit.width) / 2,
          y: (h - fit.height) / 2,
          width: fit.width,
          height: fit.height,
        });
      }
      await showResult(await out.save(), 'images.pdf');
    }),
  );

  // ---------------------------------------------------------------- metadata

  const meta = { bytes: null, name: '' };
  const META_FIELDS = [
    'Title',
    'Author',
    'Subject',
    'Keywords',
    'Creator',
    'Producer',
  ];

  setupDrop($('#meta-drop'), async ([file]) => {
    const bytes = await readFile(file);
    const doc = await loadPdf(bytes);
    Object.assign(meta, { bytes, name: file.name });

    const pages = doc.getPages();
    const sizes = [
      ...new Set(
        pages.map((p) => {
          const { width, height } = p.getSize();
          const mm = (pt) => Math.round(pt * 0.3528);
          return `${Math.round(width)} × ${Math.round(height)} pt (${mm(
            width,
          )} × ${mm(height)} mm)`;
        }),
      ),
    ];
    const fmtDate = (d) => (d ? d.toLocaleString() : '—');
    let fieldCount = 0;
    try {
      fieldCount = doc.getForm().getFields().length;
    } catch (_) {
      // Some malformed forms can't be read; the count is informational only.
    }
    const facts = [
      ['File', file.name],
      ['File size', formatBytes(bytes.length)],
      ['Pages', pages.length],
      [
        'Page size',
        sizes.length > 3 ? `${sizes.length} different sizes` : sizes.join(', '),
      ],
      ['Form fields', fieldCount],
      ['Created', fmtDate(doc.getCreationDate())],
      ['Modified', fmtDate(doc.getModificationDate())],
    ];
    const dl = $('#meta-facts');
    dl.innerHTML = '';
    facts.forEach(([k, v]) =>
      dl.append(el('div', {}, el('dt', {}, k), el('dd', {}, v))),
    );
    META_FIELDS.forEach((f) => {
      $(`#meta-${f.toLowerCase()}`).value = doc[`get${f}`]() || '';
    });
    $('#meta-work').hidden = false;
  });

  $('#meta-run').addEventListener('click', (e) =>
    run(e.currentTarget, async () => {
      const doc = await loadPdf(meta.bytes);
      const v = (f) => $(`#meta-${f}`).value.trim();
      doc.setTitle(v('title'));
      doc.setAuthor(v('author'));
      doc.setSubject(v('subject'));
      doc.setKeywords(
        v('keywords')
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      );
      doc.setCreator(v('creator'));
      doc.setProducer(v('producer'));
      doc.setModificationDate(new Date());
      await showResult(await doc.save(), meta.name);
    }),
  );
})();

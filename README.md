# PDF Studio

A free, browser-based toolkit for everyday PDF tasks. Everything runs locally
in your browser — files are never uploaded anywhere, and there's no sign-up.

**▶ Live app: <https://pdf.akshatdhiman.in/>**

## Features

| Tool                  | What it does                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Merge & organize**  | Combine PDFs and arrange their pages in one grid: reorder (drag or Shift + ←/→), rotate, delete, extract by selection or range   |
| **Crop pages**        | Trim margins or keep part of a page: drag a crop box per page, or use the same crop on every page                                |
| **Compress PDF**      | Shrink PDFs: lossless clean-up, re-save large photos at Recommended / Strong levels, or aim for a target such as 50% smaller     |
| **Images to PDF**     | Turn JPG / PNG / HEIC / WebP / GIF images into a PDF; drag image cards to order the pages                                        |
| **Resize photo**      | Exact size in px / mm / cm / in, or passport, visa & social presets; drag-to-crop with face guide, max file size (KB), print DPI |
| **HEIC to JPG**       | Convert iPhone HEIC / HEIF photos to JPG or PNG at full size; download each one or all as a .zip                                 |
| **Remove password**   | Unlock a password-protected PDF (with its password) or strip printing/copying/editing restrictions                               |
| **Lock PDF**          | Add a password to open (AES-256) and/or block printing, copying, editing or form filling                                         |
| **Redact PDF**        | Black out areas for good: drag boxes or find text on every page; marked pages are flattened so hidden text is removed            |
| **Add text & images** | Click (or use the arrow keys) to place text, an image or a ready-made stamp (tick, cross, box, arrow…), with zoom and undo       |
| **Watermark**         | Stamp centered, rotated, semi-transparent text on all or some pages                                                              |
| **Fill a form**       | Fill text fields, checkboxes, radio groups, dropdowns and list boxes; optionally flatten                                         |
| **Compress images**   | Shrink HEIC/HEIF, JPEG, PNG, WebP, AVIF, GIF and BMP images; save as JPEG, WebP or PNG, resize, compare, download as .zip        |
| **Title & info**      | Change the title shown in tabs and title bars (kept in sync with XMP), optionally as the file name; edit other properties        |

Page ranges accept forms like `1-3, 5, 8-` (`8-` means "page 8 to the end").

Rotation is available throughout: per page in _Merge & organize_, _Crop
pages_, _Redact PDF_ and _Add text & images_ (↺ / ↻ next to the page number);
per image in _Images to PDF_, _Compress images_ and _Resize photo_; and for
every page at once on any finished PDF, from the result panel.

With several PDFs in _Merge & organize_, **Stack** on a file's chip collapses
its pages into one card, so the whole file can be moved, rotated or removed in
one go; **Unstack** spreads the pages out again.

Click any preview — an image in Images to PDF, the ⤢ button on a page in Merge
& organize, or a page in the result panel — to open it full size in a viewer
(← / → to step through, Esc to close).

## Running locally

The app is plain HTML, CSS and JavaScript with no build step. Serve the
repository folder with any static web server, for example:

```bash
npx http-server -c-1 -o
```

or

```bash
python3 -m http.server 8080
```

and open http://localhost:8080.

## Deploying

Every push to `main` runs the
[Deploy to GitHub Pages](.github/workflows/deploy.yml) workflow, which
publishes the repository to <https://pdf.akshatdhiman.in/>. You can
also start it by hand from the **Actions** tab.

To host it elsewhere, copy the files to any static host (Netlify, S3, an nginx
folder, …):

```
index.html
styles.css
app.js
icons/
vendor/
└── pdf-lib.min.js
```

## How it works

- [**pdf-lib**](https://pdf-lib.js.org) does all PDF reading and writing. Its
  official v1.17.1 UMD build is bundled in `vendor/pdf-lib.min.js`, so the core
  tools work offline.
- [**pdf.js**](https://mozilla.github.io/pdf.js/) 3.11.174 draws the page
  previews. It's loaded from jsDelivr with a Subresource Integrity hash and runs
  with `isEvalSupported: false` (the mitigation for CVE-2024-4367). If it can't
  load — for example offline — every tool except _Add text & images_ still
  works, just without previews.
- [**heic-to**](https://github.com/hoppergee/heic-to) 1.5.2 (libheif compiled to
  WebAssembly) decodes HEIC/HEIF photos, such as those from iPhones, in browsers
  that can't do it natively (everything except Safari). It's ~3 MB, so it's only
  loaded from jsDelivr — pinned with an SRI hash — the first time a HEIC image is
  added. Photos are converted to high-quality JPEGs before being placed in the PDF.
- [**qpdf**](https://github.com/qpdf/qpdf) 12.2.0, compiled to WebAssembly
  ([`@neslinesli93/qpdf-wasm`](https://github.com/neslinesli93/qpdf-wasm)),
  decrypts PDFs for _Remove password_ (AES-256, AES-128 and RC4) and encrypts
  them with AES-256 for _Lock PDF_. It's bundled
  in `vendor/qpdf/` (~1.3 MB) and only loaded when that tool is used, so
  passwords and files never leave the device.

### Updating pdf-lib

Download the new release's UMD build over the bundled copy, then test each
tool:

```bash
curl -L -o vendor/pdf-lib.min.js https://cdn.jsdelivr.net/npm/pdf-lib@<version>/dist/pdf-lib.min.js
```

## Code guide

Notes for anyone (person or AI assistant) changing the code. This repository,
`Akshat120/pdf-studio`, is what <https://pdf.akshatdhiman.in/> serves. The
older copy under `apps/studio` in `Akshat120/pdf-lib` is not deployed, so
don't edit it.

### Files

| File                 | Contents                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`         | The whole UI: a header, the `#nav` sidebar (one `data-tool="…"` button per tool), one `<section id="tool-…">` per tool, the shared `#result` panel and the full-size viewer |
| `app.js`             | All the logic, in one IIFE (no modules, no framework, no build)                                                                                                             |
| `styles.css`         | Light theme first, then the dark theme as `:where([data-theme='dark']) …` overrides near the end                                                                            |
| `vendor/`            | pdf-lib (loaded on every page) and qpdf wasm (loaded on demand)                                                                                                             |
| `.github/workflows/` | The Pages deploy; it swaps `?v=dev` in `index.html` for the commit hash so caches don't mix old and new files                                                               |

### How `app.js` is laid out

The file is split into sections by `// ---- name` banner comments, in this
order: helpers, theme, previews (pdf.js), result panel, full-size viewer,
navigation, then one section per tool. Each tool keeps its state in one small
object:

| Tool              | Section banner          | State object | Section id         |
| ----------------- | ----------------------- | ------------ | ------------------ |
| Merge & organize  | `merge & organize`      | `org`        | `tool-merge`       |
| Add text & images | `edit: text and images` | `edit`       | `tool-edit`        |
| Watermark         | `watermark`             | `wm`         | `tool-watermark`   |
| Fill a form       | `form`                  | `formState`  | `tool-form`        |
| Images to PDF     | `images to PDF`         | `imgs`       | `tool-images`      |
| Remove password   | `remove password`       | `unlock`     | `tool-unlock`      |
| Lock PDF          | `lock`                  | `lock`       | `tool-lock`        |
| Redact PDF        | `redact`                | `rd`         | `tool-redact`      |
| Crop pages        | `crop`                  | `cr`         | `tool-crop`        |
| Compress PDF      | `compress`              | `cmp`        | `tool-compress`    |
| Compress images   | `compress images`       | `ic`         | `tool-imgcompress` |
| HEIC to JPG       | `HEIC to JPG`           | `hc`         | `tool-heic`        |
| Resize photo      | `resize photo`          | `rs`         | `tool-resize`      |
| Title & info      | `metadata`              | `meta`       | `tool-meta`        |

Shared helpers that most tools use:

- `$` / `$$` — `querySelector` / `querySelectorAll` (the latter as an array).
- `el(tag, attrs, ...children)` — builds DOM nodes; `on…` attributes become
  event listeners.
- `setupDrop(zone, onFiles)` — makes a drop zone with its file input work by
  drag, click and keyboard.
- `run(button, action)` — shows "Working…" on a button while `action` runs
  and turns any thrown error into a toast. Throw `Error`s with a message the
  user can act on.
- `loadPdf(bytes)` — `PDFDocument.load` with friendly errors (e.g. for
  encrypted files).
- `rotatePdf(bytes, by, only)` — turns all or some pages by setting `/Rotate`.
- `renderPage` / `renderThumbs` — pdf.js previews. pdf.js may fail to load, so
  check `pdfjs` before relying on it.
- `showResult(bytes, filename, note, { password, quiet })` — every PDF tool
  ends here: it shows the result panel with preview, rename, download and
  rotate buttons.
- `normalizeImage(file)` — turns any added image into JPEG or PNG bytes that
  pdf-lib can embed (decoding HEIC and applying EXIF orientation).
- `parseRanges("1-3, 5, 8-", count)` — page ranges to 0-based indexes.
- `makeZip(files)` / `downloadBlob` / `download` — saving output.

`showTool(id)` switches tools: it shows `#tool-<id>`, updates the URL hash
(`#merge`, `#crop`, …) and fires a `toolchange` event that tools listen to for
setup and clean-up.

### Adding a tool

1. Add a nav button `<button type="button" data-tool="xyz">` to `#nav` in
   `index.html`, in the position it should appear.
2. Add `<section class="tool card" id="tool-xyz" aria-labelledby="h-xyz" hidden>`
   with a drop zone and controls, following an existing section.
3. Add a `// ---- xyz` section to `app.js` with a state object, `setupDrop`
   for input and `run` + `showResult` (or `download`) for output.
4. Add a row to the feature table above.

### Things that have bitten us

- **EXIF orientation.** Phone JPEGs often store the pixels sideways plus an
  EXIF Orientation tag. Browsers obey the tag; pdf-lib, pdf.js and PDF viewers
  ignore it. So images are made upright before they go into a PDF
  (`readJpegOrientation` in `normalizeImage`), and Compress PDF strips EXIF
  before decoding a PDF's JPEGs (`jpegWithoutExif`). Chrome applies the tag
  even with `createImageBitmap(…, { imageOrientation: 'none' })`, and with
  resize options it then squeezes the turned image into the requested size,
  so don't rely on that option.
- **Canvas size.** Browsers refuse canvases above roughly 16.7 million pixels;
  scale down to `MAX_PIXELS` before drawing big photos.
- **Autofill popups.** Password managers and Brave's email aliases attach to
  fields that look like a sign-up form. `noAutofill` marks every non-password
  field, and the password fields sit in their own `<form id="unlock-form">` /
  `<form id="lock-form">` (via `form="…"`) so the rest of the page has no
  password in it. Keep new password fields inside those forms.
- **Dark theme.** Dark rules are wrapped in `:where([data-theme='dark'])` so
  they have the same specificity as the light rules they replace. When adding
  a light-theme rule with colours, add its dark twin in that block.
- **Rotation.** Pages are turned with the `/Rotate` attribute (`rotatePdf`,
  `page.setRotation`). Tools that work in screen coordinates (crop, redact,
  edit) have to turn their boxes with the page.
- **Saving.** Pass `{ updateFieldAppearances: false }` when re-saving a PDF
  you didn't mean to restyle, or pdf-lib redraws every form field.

### Testing

There are no automated tests. Serve the folder locally (see _Running
locally_), try the tool you changed with a few real files (a phone photo, a
scanned PDF, a PDF with forms, a locked PDF), and check it at phone width and
in the dark theme. Command-line tools such as `pdfinfo`, `pdfimages` and
`pdftoppm` (poppler) help to check the output files.

## Accessibility

- Everything works with the keyboard: drop zones open the file picker with
  Enter/Space; in _Merge & organize_, Space selects a page and Shift + ←/→ moves
  it; in _Add text & images_, the arrow keys position content (Shift for bigger
  steps), Enter adds it and Ctrl/⌘ + Z undoes.
- Status messages are announced to screen readers, and there's a "Skip to
  content" link.
- The browser warns before you leave the page with unsaved edits.

## Known limitations

These come from pdf-lib:

- Other tools can't open password-protected PDFs directly — unlock them
  first with _Remove password_ (you need the password if one is required to
  open the file).
- Text uses the 14 standard PDF fonts, which only support Latin characters.
- Merging PDFs whose form fields share names can link those fields together.
- Compression can't touch specialised image encodings (JBIG2, CCITT, JPEG 2000),
  CMYK or indexed-colour images, so some scanned PDFs shrink less than with
  desktop tools. Text-only PDFs are usually compact already.
- Redacted pages become images, so their remaining text can't be selected or
  searched, and the output drops bookmarks, form fields and document info.
  Scanned pages have no text for _Find text_ — mark them by hand.
- Cropping hides what is outside the crop area rather than deleting it, so the
  hidden content is still in the file. Use _Redact PDF_ to remove content.
- No text extraction or conversion to images.

## Browser support

Current versions of Chrome, Edge, Firefox and Safari. The retro, circa-2011
look is purely cosmetic — the code is modern JavaScript.

There is a light and a dark theme. The page follows your system setting until
you use the ☾ / ☀ button in the header; after that it remembers your choice in
this browser.

## Contributing

Format changes with the included Prettier config before committing:

```bash
npx prettier --write "*.{html,css,js,md}"
```

## License

[MIT](LICENSE.md) © Akshat Dhiman.

PDF Studio bundles [pdf-lib](https://github.com/Hopding/pdf-lib) by Andrew
Dillon, also MIT-licensed — see [`vendor/pdf-lib.LICENSE.md`](vendor/pdf-lib.LICENSE.md).

HEIC support is provided by [heic-to](https://github.com/hoppergee/heic-to)
(LGPL-3.0), which the page loads unmodified from jsDelivr as a separate file.

_Remove password_ and _Lock PDF_ use [qpdf](https://github.com/qpdf/qpdf) (Apache-2.0) via
[`@neslinesli93/qpdf-wasm`](https://github.com/neslinesli93/qpdf-wasm) (ISC),
bundled unmodified in `vendor/qpdf/` with qpdf's license and notice files.

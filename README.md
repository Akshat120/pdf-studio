# PDF Studio

A free, browser-based toolkit for everyday PDF tasks. Everything runs locally
in your browser — files are never uploaded anywhere, and there's no sign-up.

**▶ Live app: <https://pdf.akshatdhiman.in/>**

## Features

| Tool                  | What it does                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------- |
| **Merge PDFs**        | Combine several PDFs into one; drag first-page cards (or Shift + ←/→) to set the order        |
| **Organize pages**    | Reorder (drag or Shift + ←/→), rotate, delete, or extract pages by selection or range         |
| **Add text & images** | Click (or use the arrow keys) to place text or an image on any page, with undo                |
| **Watermark**         | Stamp centered, rotated, semi-transparent text on all or some pages                           |
| **Fill a form**       | Fill text fields, checkboxes, radio groups, dropdowns and list boxes; optionally flatten      |
| **Images to PDF**     | Turn JPG / PNG / WebP / GIF images into a PDF, with page size, orientation and margins        |
| **Info & metadata**   | Inspect page count, sizes and dates; edit title, author, subject, keywords, creator, producer |

Page ranges accept forms like `1-3, 5, 8-` (`8-` means "page 8 to the end").

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

### Updating pdf-lib

Download the new release's UMD build over the bundled copy, then test each
tool:

```bash
curl -L -o vendor/pdf-lib.min.js https://cdn.jsdelivr.net/npm/pdf-lib@<version>/dist/pdf-lib.min.js
```

## Accessibility

- Everything works with the keyboard: drop zones open the file picker with
  Enter/Space; in _Organize pages_, Space selects a page and Shift + ←/→ moves
  it; in _Add text & images_, the arrow keys position content (Shift for bigger
  steps), Enter adds it and Ctrl/⌘ + Z undoes.
- Status messages are announced to screen readers, and there's a "Skip to
  content" link.
- The browser warns before you leave the page with unsaved edits.

## Known limitations

These come from pdf-lib:

- Password-protected (encrypted) PDFs can't be opened — the app shows a clear
  error.
- Text uses the 14 standard PDF fonts, which only support Latin characters.
- Merging PDFs whose form fields share names can link those fields together.
- No text extraction, compression, or conversion to images.

## Browser support

Current versions of Chrome, Edge, Firefox and Safari. The retro, circa-2011
look is purely cosmetic — the code is modern JavaScript.

## Contributing

Format changes with the included Prettier config before committing:

```bash
npx prettier --write "*.{html,css,js,md}"
```

## License

[MIT](LICENSE.md) © Akshat Dhiman.

PDF Studio bundles [pdf-lib](https://github.com/Hopding/pdf-lib) by Andrew
Dillon, also MIT-licensed — see [`vendor/pdf-lib.LICENSE.md`](vendor/pdf-lib.LICENSE.md).

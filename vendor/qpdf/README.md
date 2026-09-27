# qpdf (WebAssembly)

Used by the **Remove password** tool to decrypt PDFs in the browser. Loaded
only when that tool is used.

- `qpdf.js`, `qpdf.wasm` — from [`@neslinesli93/qpdf-wasm`](https://github.com/neslinesli93/qpdf-wasm)
  0.3.0 (ISC), which compiles [qpdf](https://github.com/qpdf/qpdf) **12.2.0**
  to WebAssembly. Files are unmodified.
- `LICENSE.txt`, `NOTICE.md` — qpdf's license (Apache-2.0) and notice file.

SHA-256:

```
c0e8fe62e0c3385dd8cb5d6b613f74d87a4138a3a3343e2add45a067a14d0884  qpdf.js
abd933f4ccace4f732999381b21aec8b7e3726f18a5b167fafd57f88dd440876  qpdf.wasm
```

To update: download `dist/qpdf.js` and `dist/qpdf.wasm` of a newer
`@neslinesli93/qpdf-wasm` from npm/jsDelivr, replace these files, and update
the versions and checksums above.

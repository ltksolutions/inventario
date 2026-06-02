# Protocol renderer assets

This directory contains binary assets bundled with the API for deterministic
offline PDF rendering of loan protocols (ADR-0022).

## Files

| File                          | Purpose                                                                   | License                                                  |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `DejaVuSans.ttf`              | Embedded font for PDF rendering — full Latin-ext + SK diacritics          | LicenseRef-DejaVu (see `LICENSES/LicenseRef-DejaVu.txt`) |
| `inventario-logo-default.png` | Default Inventario logo for PDF header (fallback when tenant has no logo) | CC-BY-4.0                                                |

## Adding the binary files

### DejaVuSans.ttf

Download from the official DejaVu Fonts release:

```
curl -L https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2 \
  | tar -xjf - --strip-components=2 dejavu-fonts-ttf-2.37/ttf/DejaVuSans.ttf \
  -C apps/api/src/modules/protocols/assets/
```

### inventario-logo-default.png

Rasterize from the SVG brand asset. Requirements:

- Dimensions: 240×60 px (4:1 aspect ratio)
- White background or transparent
- Format: PNG (pdf-lib cannot embed SVG)

Place the file in this directory as `inventario-logo-default.png`.

## Why bundled in the repo?

Deterministic rendering (ADR-0022 invariant #1) requires that font and logo
bytes are **identical on every deployment** — using an npm package for the
font or fetching it at runtime would introduce version drift. Bundling them as
repo assets guarantees byte-for-byte identical output, which is required for
`pdfSha256` stability.

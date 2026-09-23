# Annealer

Render an Apple Icon Composer bundle (`.icon`) and its companion web
favicons in plain Node.js — no Xcode, no `actool`, no macOS runner.

Annealer is a from-scratch reimplementation of Icon Composer's rendering
(squircle masking, gradient compensation, Display P3 color handling, and
iOS 26 "liquid glass" specular effects), reverse-engineered empirically
against Icon Composer's actual output. It ships as an npm package, a CLI,
and a GitHub Action.

## Supported icon shape

Annealer currently supports exactly one Icon Composer shape:

- A single `fill['automatic-gradient']` or `fill['flat-color']` value (no
  multi-stop gradient fills — unrecognized fills are rejected with an error
  rather than rendered incorrectly).
- Exactly one layer group, with `glass: true` on its layer (no
  `glass: false` rendering path).
- A glyph SVG containing any combination of paths and groups.

Icons outside this shape will render incorrectly rather than fail loudly.
See the [issue tracker](https://github.com/istic/annealer/issues) for
tracked gaps, and feel free to open a PR to extend support.

The web-icon filenames (`bloom-standard.svg`, `bloom-standard.png`,
`bloom-on-white.png`) are currently hardcoded from Annealer's origin
project and not yet configurable — also tracked in the issue tracker.

## Usage

### As a GitHub Action

```yaml
- uses: istic/annealer@v1
  with:
    icon-path: resources/branding/my-app.icon
    glyph: resources/branding/glyph.svg
    background-color: '#6A2AAC'
    output-dir: resources/icons
```

### As a CLI

```sh
npx @istic-co/annealer \
  --icon-path resources/branding/my-app.icon \
  --glyph resources/branding/glyph.svg \
  --background-color '#6A2AAC' \
  --output-dir resources/icons
```

### As an npm package

```js
import { generateAppleTouchIcon, generateWebIcons } from '@istic-co/annealer';

const config = {
  iconPath: 'resources/branding/my-app.icon',
  glyph: 'resources/branding/glyph.svg',
  backgroundColor: '#6A2AAC',
};

await generateAppleTouchIcon(config, 'resources/icons');
await generateWebIcons(config, 'resources/icons');
```

## Development

```sh
npm install
npm test
```

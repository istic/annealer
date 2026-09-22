/* global Buffer */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { packIco } from './pack-ico.js';

const DEFAULT_OUTPUT_DIR = 'resources/icons';
const CANVAS_SIZE = 1200;
const FAVICON_SIZES = [16, 32, 48, 64, 128, 256, 512];
const WHITE = '#FFFFFF';

function extractGlyphMarkup(svgMarkup) {
    const match = svgMarkup.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/i);

    if (!match) {
        throw new Error('extractGlyphMarkup: unable to parse glyph SVG');
    }

    return match[1].trim();
}

function buildCanvasSvg(glyphMarkup, backgroundColor) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="${backgroundColor}"/>
  ${glyphMarkup}
</svg>`;
}

async function writeOutput(outputDir, name, contents) {
    await fs.writeFile(path.join(outputDir, name), contents);
}

async function renderPng(svgBuffer, size) {
    return sharp(svgBuffer).resize(size, size).png().toBuffer();
}

export async function generateWebIcons(config, outputDir = DEFAULT_OUTPUT_DIR) {
    const glyphSource = await fs.readFile(config.glyph, 'utf-8');
    const glyphMarkup = extractGlyphMarkup(glyphSource);

    const standardSvg = buildCanvasSvg(glyphMarkup, config.backgroundColor);
    const onWhiteSvg = buildCanvasSvg(glyphMarkup, WHITE);
    const standardBuffer = Buffer.from(standardSvg);
    const onWhiteBuffer = Buffer.from(onWhiteSvg);

    await fs.mkdir(outputDir, { recursive: true });

    const faviconFrames = await Promise.all(FAVICON_SIZES.map((size) => renderPng(standardBuffer, size)));

    await Promise.all([
        writeOutput(outputDir, 'favicon.svg', standardSvg),
        writeOutput(outputDir, 'bloom-standard.svg', standardSvg),
        writeOutput(outputDir, 'favicon.ico', packIco(faviconFrames)),
        renderPng(standardBuffer, 96).then((png) => writeOutput(outputDir, 'favicon-96x96.png', png)),
        renderPng(standardBuffer, 1200).then((png) => writeOutput(outputDir, 'bloom-standard.png', png)),
        renderPng(onWhiteBuffer, 1200).then((png) => writeOutput(outputDir, 'bloom-on-white.png', png)),
        renderPng(standardBuffer, 192).then((png) => writeOutput(outputDir, 'web-app-manifest-192x192.png', png)),
        renderPng(standardBuffer, 512).then((png) => writeOutput(outputDir, 'web-app-manifest-512x512.png', png)),
    ]);
}

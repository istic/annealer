import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { generateWebIcons } from './generate-web-icons.js';

const FIXTURE_GLYPH = path.join(import.meta.dirname, 'test-fixtures', 'glyph.svg');
const CONFIG = { glyph: FIXTURE_GLYPH, backgroundColor: '#6A2AAC' };

let outputDir;

afterEach(async () => {
    if (outputDir) {
        await fs.rm(outputDir, { recursive: true, force: true });
        outputDir = undefined;
    }
});

async function freshOutputDir() {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-web-icons-'));

    return outputDir;
}

describe('generateWebIcons', () => {
    it('renders every PNG variant at its expected size', async () => {
        const dir = await freshOutputDir();

        await generateWebIcons(CONFIG, dir);

        const expectations = {
            'favicon-96x96.png': { width: 96, height: 96 },
            'icon-standard.png': { width: 1200, height: 1200 },
            'icon-on-white.png': { width: 1200, height: 1200 },
            'web-app-manifest-192x192.png': { width: 192, height: 192 },
            'web-app-manifest-512x512.png': { width: 512, height: 512 },
        };

        for (const [name, expected] of Object.entries(expectations)) {
            const { width, height } = await sharp(path.join(dir, name)).metadata();

            expect({ width, height }).toEqual(expected);
        }
    });

    it('writes the SVG variants', async () => {
        const dir = await freshOutputDir();

        await generateWebIcons(CONFIG, dir);

        const favicon = await fs.readFile(path.join(dir, 'favicon.svg'), 'utf-8');
        const standard = await fs.readFile(path.join(dir, 'icon-standard.svg'), 'utf-8');

        expect(favicon).toBe(standard);
        expect(favicon).toContain('fill="#6A2AAC"');
        expect(favicon).toContain('<circle');
    });

    it('renders favicon.ico with the full multi-resolution frame set', async () => {
        const dir = await freshOutputDir();

        await generateWebIcons(CONFIG, dir);

        const ico = await fs.readFile(path.join(dir, 'favicon.ico'));

        expect(ico.readUInt16LE(4)).toBe(7);
    });

    it('fills the standard variant with the configured background color', async () => {
        const dir = await freshOutputDir();

        await generateWebIcons(CONFIG, dir);

        const { data } = await sharp(path.join(dir, 'favicon-96x96.png'))
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Top-left corner sits outside the centered glyph, so it's pure background.
        expect([data[0], data[1], data[2]]).toEqual([0x6a, 0x2a, 0xac]);
    });

    it('fills the "on white" variant with a white background', async () => {
        const dir = await freshOutputDir();

        await generateWebIcons(CONFIG, dir);

        const { data } = await sharp(path.join(dir, 'icon-on-white.png'))
            .raw()
            .toBuffer({ resolveWithObject: true });

        expect([data[0], data[1], data[2]]).toEqual([0xff, 0xff, 0xff]);
    });

    it('draws a circular background with transparent corners when shape is "circle"', async () => {
        const dir = await freshOutputDir();

        await generateWebIcons({ ...CONFIG, shape: 'circle' }, dir);

        const favicon = await fs.readFile(path.join(dir, 'favicon.svg'), 'utf-8');
        const { data, info } = await sharp(path.join(dir, 'favicon-96x96.png'))
            .raw()
            .toBuffer({ resolveWithObject: true });
        const pixel = (x, y) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x + 1) * info.channels));

        expect(favicon).toContain('<circle cx="600" cy="600" r="600" fill="#6A2AAC"/>');
        expect(favicon).not.toContain('<rect');
        // Corner is outside the circle; the left edge midpoint is inside it.
        expect(pixel(0, 0)[3]).toBe(0);
        expect(pixel(2, 48).slice(0, 3)).toEqual([0x6a, 0x2a, 0xac]);
    });

    it('keeps the square background by default', async () => {
        const dir = await freshOutputDir();

        await generateWebIcons(CONFIG, dir);

        expect(await fs.readFile(path.join(dir, 'favicon.svg'), 'utf-8')).toContain('<rect');
    });

    it('rejects an unknown shape', async () => {
        const dir = await freshOutputDir();

        await expect(generateWebIcons({ ...CONFIG, shape: 'hexagon' }, dir)).rejects.toThrow(/shape must be one of/);
    });
});

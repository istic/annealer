import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compensateForAppleRender, hexToDisplayP3 } from './colors.js';
import { generateAppleTouchIcon } from './generate-apple-touch-icon.js';

const FIXTURE_ICON_DIR = path.join(import.meta.dirname, 'test-fixtures', 'sample.icon');
const CONFIG = { backgroundColor: '#6A2AAC' };

let outputDir;
let iconDir;

beforeEach(async () => {
    iconDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-icon-'));
    await fs.cp(FIXTURE_ICON_DIR, iconDir, { recursive: true });
});

afterEach(async () => {
    await fs.rm(iconDir, { recursive: true, force: true });

    if (outputDir) {
        await fs.rm(outputDir, { recursive: true, force: true });
        outputDir = undefined;
    }
});

describe('generateAppleTouchIcon', () => {
    it(
        'renders a 1024x1024 RGBA PNG',
        async () => {
            outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            const { width, height, channels } = await sharp(path.join(outputDir, 'apple-touch-icon.png')).metadata();

            expect({ width, height, channels }).toEqual({ width: 1024, height: 1024, channels: 4 });
        },
        20000,
    );

    it(
        "syncs icon.json's automatic-gradient to the compensated brand color",
        async () => {
            outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            const iconData = JSON.parse(await fs.readFile(path.join(iconDir, 'icon.json'), 'utf-8'));

            expect(iconData.fill['automatic-gradient']).toBe(hexToDisplayP3(compensateForAppleRender(CONFIG.backgroundColor)));
        },
        20000,
    );

    it(
        'syncs a flat-color fill without introducing an automatic-gradient key, and renders it flat',
        async () => {
            outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

            const jsonPath = path.join(iconDir, 'icon.json');
            const iconData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

            iconData.fill = { 'flat-color': iconData.fill['automatic-gradient'] };
            await fs.writeFile(jsonPath, JSON.stringify(iconData, null, 2), 'utf-8');

            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            const syncedIconData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

            expect(syncedIconData.fill).toEqual({
                'flat-color': hexToDisplayP3(compensateForAppleRender(CONFIG.backgroundColor)),
            });

            const { data, info } = await sharp(path.join(outputDir, 'apple-touch-icon.png'))
                .raw()
                .toBuffer({ resolveWithObject: true });
            const x = Math.floor(info.width / 2);
            const topIndex = (20 * info.width + x) * info.channels;
            const bottomIndex = ((info.height - 20) * info.width + x) * info.channels;

            expect([data[topIndex], data[topIndex + 1], data[topIndex + 2]]).toEqual([
                data[bottomIndex],
                data[bottomIndex + 1],
                data[bottomIndex + 2],
            ]);
        },
        20000,
    );

    it('rejects an unsupported (e.g. multi-stop) fill instead of rendering it incorrectly', async () => {
        outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

        const jsonPath = path.join(iconDir, 'icon.json');
        const iconData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

        iconData.fill = {
            'linear-gradient': ['display-p3:0.10000,0.10000,0.10000,1.00000', 'display-p3:0.90000,0.90000,0.90000,1.00000'],
        };
        await fs.writeFile(jsonPath, JSON.stringify(iconData, null, 2), 'utf-8');

        await expect(generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir)).rejects.toThrow(/unsupported icon\.json fill/);
    });

    it(
        'renders a glyph SVG with multiple paths instead of silently skipping it',
        async () => {
            outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

            const glyphPath = path.join(iconDir, 'Assets', 'glyph.svg');
            await fs.writeFile(
                glyphPath,
                `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">
  <path d="M600,200 A400,400 0 1,1 599,200 Z" fill="#FFFFFF"/>
  <path d="M400,400 L800,400 L800,800 L400,800 Z" fill="#000000"/>
</svg>`,
                'utf-8',
            );

            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            const { data, info } = await sharp(path.join(outputDir, 'apple-touch-icon.png'))
                .raw()
                .toBuffer({ resolveWithObject: true });
            const cx = Math.floor(info.width / 2);
            const cy = Math.floor(info.height / 2);
            const centerIndex = (cy * info.width + cx) * info.channels;

            const bgIconDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-icon-nobg-'));

            await fs.cp(iconDir, bgIconDir, { recursive: true });
            await fs.rm(path.join(bgIconDir, 'Assets', 'glyph.svg'));

            const bgOutputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-nobg-'));

            await generateAppleTouchIcon({ ...CONFIG, iconPath: bgIconDir }, bgOutputDir);

            const { data: bgData } = await sharp(path.join(bgOutputDir, 'apple-touch-icon.png'))
                .raw()
                .toBuffer({ resolveWithObject: true });

            expect([data[centerIndex], data[centerIndex + 1], data[centerIndex + 2]]).not.toEqual([
                bgData[centerIndex],
                bgData[centerIndex + 1],
                bgData[centerIndex + 2],
            ]);

            await fs.rm(bgIconDir, { recursive: true, force: true });
            await fs.rm(bgOutputDir, { recursive: true, force: true });
        },
        20000,
    );

    it(
        'renders a glyph SVG with a nested group instead of silently skipping it',
        async () => {
            outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

            const glyphPath = path.join(iconDir, 'Assets', 'glyph.svg');
            await fs.writeFile(
                glyphPath,
                `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">
  <g>
    <path d="M600,200 A400,400 0 1,1 599,200 Z" fill="#FFFFFF"/>
  </g>
</svg>`,
                'utf-8',
            );

            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            const { width, height, channels } = await sharp(path.join(outputDir, 'apple-touch-icon.png')).metadata();

            expect({ width, height, channels }).toEqual({ width: 1024, height: 1024, channels: 4 });
        },
        20000,
    );
});

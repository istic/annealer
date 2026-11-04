import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compensateForAppleRender, hexToDisplayP3 } from './colors.js';
import { generateAppleTouchIcon } from './generate-apple-touch-icon.js';

const FIXTURE_ICON_DIR = path.join(import.meta.dirname, 'test-fixtures', 'sample.icon');
const CONFIG = { backgroundColor: '#6A2AAC' };

// Mirrors glyphLayer()'s layerSize/layerOffset math for the fixture's
// layer.position.scale (0.77), to translate a point in the glyph's
// 0-1200 viewBox into a pixel coordinate on the final 1024x1024 canvas.
function glyphViewBoxToCanvas(viewBoxCoord) {
    const renderedScale = 0.77 ** 0.35;
    const layerSize = Math.round(1024 * renderedScale);
    const layerOffset = Math.round((1024 - layerSize) / 2);

    return Math.round(layerOffset + (viewBoxCoord / 1200) * layerSize);
}

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

    it('rejects a linear-gradient fill missing its orientation instead of rendering it incorrectly', async () => {
        outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

        const jsonPath = path.join(iconDir, 'icon.json');
        const iconData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

        iconData.fill = {
            'linear-gradient': ['display-p3:0.10000,0.10000,0.10000,1.00000', 'display-p3:0.90000,0.90000,0.90000,1.00000'],
        };
        await fs.writeFile(jsonPath, JSON.stringify(iconData, null, 2), 'utf-8');

        await expect(generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir)).rejects.toThrow(/unsupported icon\.json fill/);
    });

    it('rejects an unrecognized fill kind instead of rendering it incorrectly', async () => {
        outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

        const jsonPath = path.join(iconDir, 'icon.json');
        const iconData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

        iconData.fill = { 'radial-gradient': 'display-p3:0.10000,0.10000,0.10000,1.00000' };
        await fs.writeFile(jsonPath, JSON.stringify(iconData, null, 2), 'utf-8');

        await expect(generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir)).rejects.toThrow(/unsupported icon\.json fill/);
    });

    it.each([
        ['an out-of-gamut component', 'display-p3:2.00000,0.00000,0.00000,1.00000'],
        ['trailing garbage after a valid-looking prefix', 'display-p3:0.50000,0.50000,0.50000,1.00000 extra'],
        ['a missing alpha component', 'display-p3:0.50000,0.50000,0.50000'],
        // p3StringToAppleRgb() drops alpha and nothing here applies
        // stop-opacity, so a non-opaque stop must be rejected rather than
        // silently rendered fully opaque.
        ['a non-opaque alpha component', 'display-p3:0.50000,0.50000,0.50000,0.50000'],
    ])('rejects a linear-gradient stop with %s instead of rendering it incorrectly', async (_label, malformedColor) => {
        outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

        const jsonPath = path.join(iconDir, 'icon.json');
        const iconData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

        iconData.fill = {
            'linear-gradient': [malformedColor, 'display-p3:0.90000,0.90000,0.90000,1.00000'],
            orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 0.7 } },
        };
        await fs.writeFile(jsonPath, JSON.stringify(iconData, null, 2), 'utf-8');

        await expect(generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir)).rejects.toThrow(/unsupported icon\.json fill/);
    });

    it('rejects a linear-gradient orientation with a non-finite coordinate instead of rendering it incorrectly', async () => {
        outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

        const jsonPath = path.join(iconDir, 'icon.json');
        const iconData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

        iconData.fill = {
            'linear-gradient': ['display-p3:0.10000,0.10000,0.10000,1.00000', 'display-p3:0.90000,0.90000,0.90000,1.00000'],
            orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: '__INFINITY_SENTINEL__' } },
        };
        // JSON's `1e999` parses to Infinity (typeof still reports "number"),
        // so the literal is spliced in by hand rather than via
        // JSON.stringify, which would instead serialize Infinity as null.
        const json = JSON.stringify(iconData, null, 2).replace('"__INFINITY_SENTINEL__"', '1e999');

        await fs.writeFile(jsonPath, json, 'utf-8');
        expect(JSON.parse(json).fill.orientation.stop.y).toBe(Infinity);

        await expect(generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir)).rejects.toThrow(/unsupported icon\.json fill/);
    });

    it(
        "renders a linear-gradient fill along its stops and orientation, and doesn't sync icon.json",
        async () => {
            outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

            const jsonPath = path.join(iconDir, 'icon.json');
            const iconData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

            // Real Icon Composer output (from a linear-gradient-filled .icon bundle).
            iconData.fill = {
                'linear-gradient': ['display-p3:0.03879,0.75538,0.85828,1.00000', 'display-p3:0.15702,0.55681,0.61389,1.00000'],
                orientation: { start: { x: 0.5, y: 0 }, stop: { x: 0.5, y: 0.7 } },
            };
            const beforeJson = JSON.stringify(iconData, null, 2);
            await fs.writeFile(jsonPath, beforeJson, 'utf-8');
            // No glyph, so sampled pixels are pure background.
            await fs.rm(path.join(iconDir, 'Assets', 'glyph.svg'));

            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            expect(await fs.readFile(jsonPath, 'utf-8')).toBe(beforeJson);

            const { data, info } = await sharp(path.join(outputDir, 'apple-touch-icon.png'))
                .raw()
                .toBuffer({ resolveWithObject: true });
            const x = Math.floor(info.width / 2);
            const topIndex = (20 * info.width + x) * info.channels;
            // Past the 70%-height stop, where the gradient pads to its final color.
            const bottomIndex = (1000 * info.width + x) * info.channels;
            const closeTo = (actual, expected) => expected.every((value, i) => Math.abs(actual[i] - value) <= 20);

            expect(closeTo([data[topIndex], data[topIndex + 1], data[topIndex + 2]], [10, 193, 219])).toBe(true);
            expect(closeTo([data[bottomIndex], data[bottomIndex + 1], data[bottomIndex + 2]], [40, 142, 157])).toBe(true);
        },
        20000,
    );

    it(
        'spaces a linear-gradient with more than two stops evenly along its orientation',
        async () => {
            outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

            const jsonPath = path.join(iconDir, 'icon.json');
            const iconData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));

            iconData.fill = {
                'linear-gradient': [
                    'display-p3:1.00000,0.00000,0.00000,1.00000',
                    'display-p3:0.00000,1.00000,0.00000,1.00000',
                    'display-p3:0.00000,0.00000,1.00000,1.00000',
                ],
                orientation: { start: { x: 0, y: 0 }, stop: { x: 0, y: 1 } },
            };
            await fs.writeFile(jsonPath, JSON.stringify(iconData, null, 2), 'utf-8');
            await fs.rm(path.join(iconDir, 'Assets', 'glyph.svg'));

            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            const { data, info } = await sharp(path.join(outputDir, 'apple-touch-icon.png'))
                .raw()
                .toBuffer({ resolveWithObject: true });
            const x = Math.floor(info.width / 2);
            const midIndex = (Math.round(info.height / 2) * info.width + x) * info.channels;
            const closeTo = (actual, expected) => expected.every((value, i) => Math.abs(actual[i] - value) <= 20);

            // The middle stop should dominate at the gradient's midpoint.
            expect(closeTo([data[midIndex], data[midIndex + 1], data[midIndex + 2]], [0, 255, 0])).toBe(true);
        },
        20000,
    );

    it(
        'renders the second path of a multi-path glyph SVG instead of silently dropping it',
        async () => {
            outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

            const glyphPath = path.join(iconDir, 'Assets', 'glyph.svg');
            const firstPath = '<path d="M600,200 A400,400 0 1,1 599,200 Z" fill="#FFFFFF"/>';
            // Disjoint from the first path's circle (which spans viewBox x/y
            // 200-1000), so this only shows up if the second path is rendered.
            const secondPath = '<path d="M1050,1050 L1180,1050 L1180,1180 L1050,1180 Z" fill="#FFFFFF"/>';
            const x = glyphViewBoxToCanvas(1115);
            const y = glyphViewBoxToCanvas(1115);

            await fs.writeFile(glyphPath, `<svg viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">${firstPath}</svg>`, 'utf-8');
            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            const { data: onePathData, info } = await sharp(path.join(outputDir, 'apple-touch-icon.png'))
                .raw()
                .toBuffer({ resolveWithObject: true });
            const index = (y * info.width + x) * info.channels;

            await fs.writeFile(
                glyphPath,
                `<svg viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">${firstPath}${secondPath}</svg>`,
                'utf-8',
            );
            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            const { data: twoPathData } = await sharp(path.join(outputDir, 'apple-touch-icon.png'))
                .raw()
                .toBuffer({ resolveWithObject: true });

            expect([twoPathData[index], twoPathData[index + 1], twoPathData[index + 2]]).not.toEqual([
                onePathData[index],
                onePathData[index + 1],
                onePathData[index + 2],
            ]);
        },
        20000,
    );

    it(
        "applies a nested group's transform instead of ignoring the wrapping <g>",
        async () => {
            outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-apple-icon-'));

            const glyphPath = path.join(iconDir, 'Assets', 'glyph.svg');
            const circlePath = '<path d="M600,200 A400,400 0 1,1 599,200 Z" fill="#FFFFFF"/>';
            // Inside the untransformed circle (center 600,600 r400) but outside
            // it once the group shifts the circle 300 to the right.
            const x = glyphViewBoxToCanvas(300);
            const y = glyphViewBoxToCanvas(600);

            await fs.writeFile(glyphPath, `<svg viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">${circlePath}</svg>`, 'utf-8');
            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            const { data: untransformedData, info } = await sharp(path.join(outputDir, 'apple-touch-icon.png'))
                .raw()
                .toBuffer({ resolveWithObject: true });
            const index = (y * info.width + x) * info.channels;

            await fs.writeFile(
                glyphPath,
                `<svg viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg"><g transform="translate(300,0)">${circlePath}</g></svg>`,
                'utf-8',
            );
            await generateAppleTouchIcon({ ...CONFIG, iconPath: iconDir }, outputDir);

            const { data: transformedData } = await sharp(path.join(outputDir, 'apple-touch-icon.png'))
                .raw()
                .toBuffer({ resolveWithObject: true });

            expect([transformedData[index], transformedData[index + 1], transformedData[index + 2]]).not.toEqual([
                untransformedData[index],
                untransformedData[index + 1],
                untransformedData[index + 2],
            ]);
        },
        20000,
    );
});

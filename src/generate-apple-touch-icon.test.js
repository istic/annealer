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
});

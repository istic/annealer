import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI_PATH = path.join(import.meta.dirname, 'cli.js');
const FIXTURE_ICON_DIR = path.join(import.meta.dirname, '..', 'src', 'test-fixtures', 'sample.icon');
const FIXTURE_GLYPH = path.join(import.meta.dirname, '..', 'src', 'test-fixtures', 'glyph.svg');

let outputDir;

afterEach(async () => {
    if (outputDir) {
        await fs.rm(outputDir, { recursive: true, force: true });
        outputDir = undefined;
    }
});

describe('cli', () => {
    it(
        'generates both apple and web icons for target=all',
        async () => {
            outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-cli-'));

            await execFileAsync('node', [
                CLI_PATH,
                '--icon-path', FIXTURE_ICON_DIR,
                '--glyph', FIXTURE_GLYPH,
                '--background-color', '#6A2AAC',
                '--output-dir', outputDir,
                '--target', 'all',
            ]);

            const files = await fs.readdir(outputDir);

            expect(files).toContain('apple-touch-icon.png');
            expect(files).toContain('favicon.ico');
        },
        20000,
    );

    it('exits non-zero with a clear message when required flags are missing', async () => {
        outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'annealer-cli-'));

        await expect(
            execFileAsync('node', [CLI_PATH, '--output-dir', outputDir, '--target', 'apple']),
        ).rejects.toMatchObject({
            code: 1,
            stderr: expect.stringContaining('background-color is required'),
        });
    });
});

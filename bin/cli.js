#!/usr/bin/env node
/* global process */
import { parseArgs } from 'node:util';
import { generateAppleTouchIcon, generateWebIcons } from '../src/index.js';

const { values } = parseArgs({
    options: {
        'icon-path': { type: 'string', default: '' },
        glyph: { type: 'string', default: '' },
        'background-color': { type: 'string', default: '' },
        'output-dir': { type: 'string', default: 'resources/icons' },
        target: { type: 'string', default: 'all' },
    },
});

const VALID_TARGETS = ['apple', 'web', 'all'];

export async function main() {
    if (!VALID_TARGETS.includes(values.target)) {
        throw new Error(`--target must be one of ${VALID_TARGETS.join(', ')}, got "${values.target}"`);
    }

    if (!values['background-color']) {
        throw new Error('--background-color is required');
    }

    const config = {
        backgroundColor: values['background-color'],
        iconPath: values['icon-path'],
        glyph: values.glyph,
    };

    if (values.target === 'apple' || values.target === 'all') {
        if (!config.iconPath) {
            throw new Error('--icon-path is required for the apple target');
        }

        await generateAppleTouchIcon(config, values['output-dir']);
    }

    if (values.target === 'web' || values.target === 'all') {
        if (!config.glyph) {
            throw new Error('--glyph is required for the web target');
        }

        await generateWebIcons(config, values['output-dir']);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});

import { describe, expect, it } from 'vitest';
import { generateSquirclePath } from './squircle.js';

describe('generateSquirclePath', () => {
    it('starts at the rightmost point and closes the path', () => {
        const path = generateSquirclePath(1024, 5);

        expect(path.startsWith('M 1024,512 ')).toBe(true);
        expect(path.endsWith('Z')).toBe(true);
    });

    it('draws one line segment per degree of the sweep', () => {
        const path = generateSquirclePath(1024, 5);

        expect(path.split('L').length - 1).toBe(361);
    });
});

import { describe, expect, it } from 'vitest';
import { compensateForAppleRender, hexToDisplayP3, hexToRgb, p3StringToAppleRgb } from './colors.js';

describe('hexToRgb', () => {
    it('parses a hex string into RGB channel values', () => {
        expect(hexToRgb('#6A2AAC')).toEqual([106, 42, 172]);
    });
});

describe('hexToDisplayP3', () => {
    it('converts the brand purple to a Display P3 string', () => {
        expect(hexToDisplayP3('#6A2AAC')).toBe(
            'display-p3:0.12267,0.02717,0.37968,1.00000',
        );
    });

    it('converts black to zeroed P3 components', () => {
        expect(hexToDisplayP3('#000000')).toBe(
            'display-p3:0.00000,0.00000,0.00000,1.00000',
        );
    });
});

describe('compensateForAppleRender', () => {
    it('lightens the brand purple to counter Apple darkening', () => {
        expect(compensateForAppleRender('#6A2AAC')).toBe('#B060D8');
    });

    it('leaves black and white unaffected', () => {
        expect(compensateForAppleRender('#000000')).toBe('#000000');
        expect(compensateForAppleRender('#FFFFFF')).toBe('#FFFFFF');
    });
});

describe('p3StringToAppleRgb', () => {
    it('treats P3 components as sRGB matching Apple icon tool quirk', () => {
        // display-p3:0.37790,0.12750,0.64098 -> rgb(96, 33, 163) not rgb(176, 96, 216)
        expect(p3StringToAppleRgb('display-p3:0.37790,0.12750,0.64098,1.00000')).toEqual([96, 33, 163]);
    });
});

import { describe, expect, it } from 'vitest';
import { compensateForAppleRender, hexToAppleFill, hexToDisplayP3, hexToRgb, p3StringToAppleRgb } from './colors.js';

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

describe('hexToRgb short and alpha forms', () => {
    it.each([
        ['#1A5', [17, 170, 85]],
        ['#1A5F', [17, 170, 85]],
        ['#1A5C2AFF', [26, 92, 42]],
        ['#1A5C2A80', [26, 92, 42]],
        ['1a5', [17, 170, 85]],
    ])('parses %s ignoring alpha', (hex, expected) => {
        expect(hexToRgb(hex)).toEqual(expected);
    });
});

describe('hexToAppleFill', () => {
    it('accepts 3, 4 and 8 digit hex, always emitting an opaque fill', () => {
        expect(hexToAppleFill('#1A5')).toBe(hexToAppleFill('#11AA55'));
        expect(hexToAppleFill('#1A5C')).toBe(hexToAppleFill('#11AA55'));
        expect(hexToAppleFill('#1A5C2A80')).toBe(hexToAppleFill('#1A5C2A'));
        expect(hexToAppleFill('#1A5C2A80').endsWith(',1.00000')).toBe(true);
    });

    it('stores each channel as hex/255 so Apple\'s sRGB read-back reproduces the request', () => {
        expect(hexToAppleFill('#1A5C2A')).toBe('display-p3:0.10196,0.36078,0.16471,1.00000');
        expect(p3StringToAppleRgb(hexToAppleFill('#1A5C2A'))).toEqual([26, 92, 42]);
    });

    it.each(['#6A2AAC', '#1A5C2A', '#1a5c2a', '1A5C2A', '#1A5C2AFF', '#1a5c2a80', '#C2410C', '#000000', '#FFFFFF'])('round-trips %s exactly', (hex) => {
        expect(p3StringToAppleRgb(hexToAppleFill(hex))).toEqual(hexToRgb(hex));
    });

    it.each(['#GGGGGG', '', '#12345', '#1234567', '#1A5C2AFFF', undefined])('rejects %s rather than emitting NaN', (hex) => {
        expect(() => hexToAppleFill(hex)).toThrow('hexToAppleFill');
    });
});

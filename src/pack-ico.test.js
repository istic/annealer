import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { packIco, readPngDimensions } from './pack-ico.js';

async function solidPng(size) {
    return sharp({
        create: {
            width: size,
            height: size,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 1 },
        },
    })
        .png()
        .toBuffer();
}

describe('readPngDimensions', () => {
    it('reads width and height from a PNG buffer', async () => {
        const png = await solidPng(32);

        expect(readPngDimensions(png)).toEqual({ width: 32, height: 32 });
    });
});

describe('packIco', () => {
    it('builds an ICO container with one directory entry per frame', async () => {
        const sizes = [16, 256, 512];
        const frames = await Promise.all(sizes.map(solidPng));
        const ico = packIco(frames);

        expect(ico.readUInt16LE(0)).toBe(0); // reserved
        expect(ico.readUInt16LE(2)).toBe(1); // type: icon
        expect(ico.readUInt16LE(4)).toBe(sizes.length);

        let dataOffset = 6 + 16 * sizes.length;

        sizes.forEach((size, index) => {
            const entry = 6 + index * 16;
            const expectedDimensionByte = size >= 256 ? 0 : size;

            expect(ico.readUInt8(entry)).toBe(expectedDimensionByte);
            expect(ico.readUInt8(entry + 1)).toBe(expectedDimensionByte);
            expect(ico.readUInt16LE(entry + 4)).toBe(1); // color planes
            expect(ico.readUInt16LE(entry + 6)).toBe(32); // bits per pixel
            expect(ico.readUInt32LE(entry + 8)).toBe(frames[index].length);
            expect(ico.readUInt32LE(entry + 12)).toBe(dataOffset);

            const embedded = ico.subarray(dataOffset, dataOffset + frames[index].length);

            expect(readPngDimensions(embedded)).toEqual({ width: size, height: size });

            dataOffset += frames[index].length;
        });

        expect(ico.length).toBe(dataOffset);
    });
});

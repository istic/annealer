/* global Buffer */

const HEADER_SIZE = 6;
const DIRECTORY_ENTRY_SIZE = 16;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function readPngDimensions(png) {
    if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('readPngDimensions: buffer is not a PNG image');
    }

    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// Builds a multi-frame .ico container directly from PNG buffers — the format
// every modern browser and OS supports since Windows Vista. Frames at or above
// 256px store 0 in the (single-byte) directory width/height fields; readers
// fall back to the embedded PNG's own dimensions, which is exactly how
// ImageMagick encodes the existing favicon.ico's 512px frame.
export function packIco(pngBuffers) {
    const directorySize = DIRECTORY_ENTRY_SIZE * pngBuffers.length;
    const header = Buffer.alloc(HEADER_SIZE);

    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(pngBuffers.length, 4);

    const directory = Buffer.alloc(directorySize);
    let dataOffset = HEADER_SIZE + directorySize;

    pngBuffers.forEach((png, index) => {
        const { width, height } = readPngDimensions(png);
        const entry = index * DIRECTORY_ENTRY_SIZE;

        directory.writeUInt8(width >= 256 ? 0 : width, entry);
        directory.writeUInt8(height >= 256 ? 0 : height, entry + 1);
        directory.writeUInt8(0, entry + 2); // palette colors (none)
        directory.writeUInt8(0, entry + 3); // reserved
        directory.writeUInt16LE(1, entry + 4); // color planes
        directory.writeUInt16LE(32, entry + 6); // bits per pixel
        directory.writeUInt32LE(png.length, entry + 8);
        directory.writeUInt32LE(dataOffset, entry + 12);

        dataOffset += png.length;
    });

    return Buffer.concat([header, directory, ...pngBuffers]);
}

// D65 matrices, ported from regen-icons.sh's hex_to_display_p3 Python heredoc.
const SRGB_TO_XYZ = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.072175],
    [0.0193339, 0.119192, 0.9503041],
];

const XYZ_TO_P3 = [
    [2.4934969, -0.9313836, -0.4027108],
    [-0.829489, 1.762664, 0.0236247],
    [0.0358458, -0.0761724, 0.9568845],
];

// Empirical per-channel darkening observed in apple-touch-icon output vs the
// requested background color, ported from regen-icons.sh's DARKEN constant.
const APPLE_RENDER_DARKEN = [
    0.6022727272727273, 0.4375, 0.7962962962962963,
];

function multiply(matrix, vector) {
    return matrix.map((row) =>
        row.reduce((sum, value, index) => sum + value * vector[index], 0),
    );
}

function srgbToLinear(channel) {
    return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
}

export function hexToRgb(hex) {
    const raw = hex.replace('#', '');

    return [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16));
}

export function rgbToHex([r, g, b]) {
    return `#${[r, g, b]
        .map((channel) => channel.toString(16).padStart(2, '0').toUpperCase())
        .join('')}`;
}

export function hexToDisplayP3(hex) {
    const linear = hexToRgb(hex).map((channel) => srgbToLinear(channel / 255));
    const xyz = multiply(SRGB_TO_XYZ, linear);
    const p3 = multiply(XYZ_TO_P3, xyz).map((channel) => Math.min(1, Math.max(0, channel)));

    return `display-p3:${p3.map((channel) => channel.toFixed(5)).join(',')},1.00000`;
}

export function compensateForAppleRender(hex) {
    const compensated = hexToRgb(hex).map((channel, index) =>
        Math.min(255, Math.max(0, Math.round(channel / APPLE_RENDER_DARKEN[index]))),
    );

    return rgbToHex(compensated);
}

// Apple's icon tool stores gamma-encoded P3 components directly in the sRGB
// container without gamut conversion. This replicates that quirk so the
// background color used for icon rendering matches the old pipeline exactly.
export function p3StringToAppleRgb(p3Str) {
    const match = p3Str.match(/display-p3:([\d.]+),([\d.]+),([\d.]+)/);

    if (!match) {
        throw new Error(`p3StringToAppleRgb: cannot parse "${p3Str}"`);
    }

    return [match[1], match[2], match[3]].map((v) => Math.round(Number(v) * 255));
}

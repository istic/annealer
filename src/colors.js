import Color from 'color';

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

// Per-channel factors fitted empirically to one colour (#6A2AAC), ported from
// regen-icons.sh's DARKEN constant. Only the deprecated
// compensateForAppleRender uses them; they distort other colours.
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

// Parsed with the `color` package, so #RGB, #RGBA, #RRGGBB and #RRGGBBAA all
// work. Alpha is ignored: the Apple icon fill is always opaque. A bare hex
// string without the leading # is still accepted.
function parseColor(value) {
    if (typeof value !== 'string') {
        throw new Error(`Unable to parse colour from ${typeof value}`);
    }

    return Color(/^[0-9a-f]{3,8}$/i.test(value) ? `#${value}` : value);
}

export function hexToRgb(hex) {
    return parseColor(hex).rgb().array().slice(0, 3);
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

/**
 * Builds the icon.json fill for a requested sRGB hex. Annealer reads the
 * stored P3 components as plain sRGB channels (the Apple icon tool quirk in
 * p3StringToAppleRgb), so storing hex/255 per channel makes the background
 * rendered by this package match the request.
 * Unlike compensateForAppleRender, it carries no per-channel constants.
 */
export function hexToAppleFill(hex) {
    let rgb;

    try {
        rgb = hexToRgb(hex);
    } catch (error) {
        throw new Error(`hexToAppleFill: expected a hex colour like "#1A5C2A", got "${hex}"`, { cause: error });
    }

    const components = rgb.map((channel) => (channel / 255).toFixed(5));

    return `display-p3:${components.join(',')},1.00000`;
}

/**
 * @deprecated The per-channel factors were fitted to one colour (#6A2AAC) and
 * distort others; use hexToAppleFill. Kept for API compatibility.
 */
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

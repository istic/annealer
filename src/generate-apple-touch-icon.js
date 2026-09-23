/* global Buffer */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compensateForAppleRender, hexToDisplayP3, p3StringToAppleRgb } from './colors.js';
import { generateSquirclePath } from './squircle.js';
import { extractGlyphMarkup } from './svg.js';

const DEFAULT_OUTPUT_DIR = 'resources/icons';
const SIZE = 1024;

// Apple's "automatic-gradient" lightens the top of the icon by ~40 RGB units,
// reaching the base color at ~70% of the height and staying flat below that.
const GRADIENT_LIFT = 40;

function isOrientationPoint(point) {
    return typeof point?.x === 'number' && typeof point?.y === 'number';
}

// A "linear-gradient" fill is an explicit, designer-authored gradient: 2+
// Display P3 stop colors plus a fractional start/stop vector, e.g.
// { "linear-gradient": ["display-p3:...", "display-p3:..."],
//   "orientation": { "start": { "x": 0.5, "y": 0 }, "stop": { "x": 0.5, "y": 0.7 } } }
// (confirmed against real Icon Composer output). It's the same primitive
// "automatic-gradient" is built on — a single accent color auto-expanded
// into a 2-stop gradient stopping at 70% height — just exposed directly.
function isLinearGradientFill(fill) {
    return (
        Array.isArray(fill['linear-gradient']) &&
        fill['linear-gradient'].length >= 2 &&
        fill['linear-gradient'].every((color) => typeof color === 'string') &&
        isOrientationPoint(fill.orientation?.start) &&
        isOrientationPoint(fill.orientation?.stop)
    );
}

function detectFillKind(fill) {
    const keys = Object.keys(fill || {});

    if (keys.length === 1 && typeof fill[keys[0]] === 'string' && ['automatic-gradient', 'flat-color'].includes(keys[0])) {
        return keys[0];
    }

    if (keys.length === 2 && keys.includes('linear-gradient') && keys.includes('orientation') && isLinearGradientFill(fill)) {
        return 'linear-gradient';
    }

    throw new Error(
        `generateAppleTouchIcon: unsupported icon.json fill ${JSON.stringify(fill)} — supported fills are a single ` +
        '"automatic-gradient" or "flat-color" color, or a "linear-gradient" array of 2+ colors with a matching "orientation".',
    );
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);

        return true;
    } catch {
        return false;
    }
}

async function syncIconJsonFill(jsonPath, compensatedHex, write = true) {
    const iconData = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
    const fillKind = detectFillKind(iconData.fill);

    if (fillKind === 'linear-gradient') {
        // A linear-gradient's stops and orientation are authored directly in
        // icon.json — there's no single configured background color to
        // derive them from, so leave the bundle's own fill as-is.
        return { iconData, fillKind };
    }

    iconData.fill = { [fillKind]: hexToDisplayP3(compensatedHex) };

    if (write) {
        await fs.writeFile(jsonPath, `${JSON.stringify(iconData, null, 2)}\n`, 'utf-8');
    }

    return { iconData, fillKind };
}

function squircleMask() {
    return Buffer.from(`
        <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
            <path d="${generateSquirclePath(SIZE, 5)}" fill="white" />
        </svg>
    `);
}

function maskedSquircleLayer(contentSvg) {
    return sharp(Buffer.from(contentSvg)).composite([{ input: squircleMask(), blend: 'dest-in' }]).png().toBuffer();
}

function backgroundLayer(rgb, fillKind) {
    const [r, g, b] = rgb;
    const baseColor = `rgb(${r}, ${g}, ${b})`;
    const topColor = fillKind === 'automatic-gradient'
        ? `rgb(${Math.min(255, r + GRADIENT_LIFT)}, ${Math.min(255, g + GRADIENT_LIFT)}, ${Math.min(255, b + GRADIENT_LIFT)})`
        : baseColor;

    return maskedSquircleLayer(`
        <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
            <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:${topColor}" />
                <stop offset="70%" style="stop-color:${baseColor}" />
                <stop offset="100%" style="stop-color:${baseColor}" />
            </linearGradient>
            <rect width="${SIZE}" height="${SIZE}" fill="url(#grad)" />
        </svg>
    `);
}

// Stops are spaced evenly along the start->stop vector, matching SVG/CSS
// gradients' own default when no explicit per-stop offsets are given —
// icon.json's linear-gradient array carries colors only, no offsets.
function linearGradientBackgroundLayer(stops, orientation) {
    const stopMarkup = stops
        .map(([r, g, b], index) => {
            const offset = stops.length === 1 ? 0 : (index / (stops.length - 1)) * 100;

            return `<stop offset="${offset}%" style="stop-color:rgb(${r}, ${g}, ${b})" />`;
        })
        .join('');

    return maskedSquircleLayer(`
        <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
            <linearGradient
                id="grad"
                x1="${orientation.start.x * 100}%" y1="${orientation.start.y * 100}%"
                x2="${orientation.stop.x * 100}%" y2="${orientation.stop.y * 100}%"
            >
                ${stopMarkup}
            </linearGradient>
            <rect width="${SIZE}" height="${SIZE}" fill="url(#grad)" />
        </svg>
    `);
}

async function glyphLayer(iconDir, group, layer) {
    const imagePath = path.join(iconDir, 'Assets', layer['image-name']);

    if (!(await fileExists(imagePath))) {
        return null;
    }

    const originalSvg = await fs.readFile(imagePath, 'utf-8');
    const glyphMarkup = extractGlyphMarkup(originalSvg);

    const scale = layer.position?.scale || 1.0;
    // Apple's icon JSON expresses scale as a "coverage" fraction; its renderer
    // maps that to an effective layer size via a power curve — exponent ~0.35
    // empirically matches Xcode's output across the observable scale range.
    const renderedScale = scale ** 0.35;
    const layerSize = Math.round(SIZE * renderedScale);
    const layerOffset = Math.round((SIZE - layerSize) / 2);

    // Apple's translucency is a frosted-glass blend, not simple fill-opacity.
    // The interior petal pixels in the reference output match ~0.70 opacity for
    // translucency=0.5; specular highlights then push bright edges toward white.
    const translucency = group.translucency?.enabled ? (group.translucency.value ?? 0.5) : 1.0;
    const layerOpacity = Math.min(1.0, 0.4 + translucency * 0.55);

    const glassGlyphSvg = `
        <svg width="${layerSize}" height="${layerSize}" viewBox="0 0 1200 1200">
            <defs>
                <filter id="liquidGlass" x="-15%" y="-15%" width="130%" height="130%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="14" result="glowBlur" />
                    <feFlood flood-color="white" flood-opacity="0.3" result="glowFill" />
                    <feComposite in="glowFill" in2="glowBlur" operator="in" result="outerGlow" />
                    <feGaussianBlur in="SourceAlpha" stdDeviation="16" result="bump" />
                    <feSpecularLighting in="bump" surfaceScale="6" specularConstant="3" specularExponent="25" lighting-color="white" result="spec">
                        <fePointLight x="-300" y="-500" z="900" />
                    </feSpecularLighting>
                    <feComposite in="spec" in2="SourceAlpha" operator="in" result="specLight" />
                    <feMerge>
                        <feMergeNode in="outerGlow" />
                        <feMergeNode in="SourceGraphic" />
                        <feMergeNode in="specLight" />
                    </feMerge>
                </filter>
                <!-- mask-type="alpha" makes the mask follow the glyph shapes'
                     coverage regardless of how many paths/groups it's made of
                     or what fill colors they use, instead of the luminance-
                     based masking SVG uses by default. -->
                <mask id="glyphMask" maskUnits="userSpaceOnUse" x="0" y="0" width="1200" height="1200" mask-type="alpha">
                    ${glyphMarkup}
                </mask>
            </defs>
            <!-- The filter must wrap the already-masked shape rather than sit
                 on the rect itself: SVG filters run before masking, so a
                 filter on the rect would see the full 1200x1200 rectangle's
                 alpha instead of the glyph's, losing the glow/specular
                 falloff at the glyph's actual edges. -->
            <g filter="url(#liquidGlass)">
                <rect x="0" y="0" width="1200" height="1200" fill="white" fill-opacity="${layerOpacity}" mask="url(#glyphMask)" />
            </g>
        </svg>
    `;

    const input = await sharp(Buffer.from(glassGlyphSvg)).png().toBuffer();

    return { input, top: layerOffset, left: layerOffset };
}

// Apple's squircle has a ~20px bright specular highlight along all edges,
// clipped to the squircle boundary: feMorphology erode carves a border ring,
// then a Gaussian blur softens it inward.
async function edgeGlowLayer() {
    const svg = `
        <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
            <defs>
                <filter id="edgeGlow" x="0%" y="0%" width="100%" height="100%">
                    <feMorphology in="SourceAlpha" operator="erode" radius="16" result="eroded" />
                    <feComposite in="SourceAlpha" in2="eroded" operator="arithmetic" k2="1" k3="-1" result="ring" />
                    <feGaussianBlur in="ring" stdDeviation="7" result="soft" />
                    <feFlood flood-color="white" flood-opacity="0.6" result="white" />
                    <feComposite in="white" in2="soft" operator="in" result="glow" />
                    <feComposite in="glow" in2="SourceAlpha" operator="in" />
                </filter>
            </defs>
            <path d="${generateSquirclePath(SIZE, 5)}" fill="white" filter="url(#edgeGlow)" />
        </svg>
    `;

    return { input: await sharp(Buffer.from(svg)).png().toBuffer(), top: 0, left: 0 };
}

// Apple's top-left corner has a stronger, crisper highlight. surfaceScale=51
// compensates for librsvg normalising bump gradients by 255; the low z=80
// point light makes interior normals near-zero while the TL corner's outward
// normal aligns with the light, creating a highlight that fades at TR/BR.
async function cornerSpecularLayer() {
    const svg = `
        <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
            <defs>
                <filter id="cornerSpec" x="0%" y="0%" width="100%" height="100%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="bump" />
                    <feSpecularLighting in="bump" surfaceScale="51" specularConstant="0.65" specularExponent="8" lighting-color="white" result="spec">
                        <fePointLight x="-100" y="-100" z="80" />
                    </feSpecularLighting>
                    <feComposite in="spec" in2="SourceAlpha" operator="in" />
                </filter>
            </defs>
            <path d="${generateSquirclePath(SIZE, 5)}" fill="white" filter="url(#cornerSpec)" />
        </svg>
    `;

    return { input: await sharp(Buffer.from(svg)).png().toBuffer(), top: 0, left: 0 };
}

export async function generateAppleTouchIcon(config, outputDir = DEFAULT_OUTPUT_DIR, { syncJson = true } = {}) {
    const iconDir = config.iconPath;
    const jsonPath = path.join(iconDir, 'icon.json');
    const compensatedHex = compensateForAppleRender(config.backgroundColor);
    const { iconData, fillKind } = await syncIconJsonFill(jsonPath, compensatedHex, syncJson);
    // Replicate Apple's icon tool quirk: P3 components are stored in the sRGB
    // container without gamut conversion, so we read them back the same way.
    const background = fillKind === 'linear-gradient'
        ? await linearGradientBackgroundLayer(iconData.fill['linear-gradient'].map(p3StringToAppleRgb), iconData.fill.orientation)
        : await backgroundLayer(p3StringToAppleRgb(iconData.fill[fillKind]), fillKind);

    const composites = [{ input: background, top: 0, left: 0 }];

    for (const group of iconData.groups || []) {
        for (const layer of group.layers || []) {
            const composite = await glyphLayer(iconDir, group, layer);

            if (composite) {
                composites.push(composite);
            }
        }
    }

    composites.push(await edgeGlowLayer());
    composites.push(await cornerSpecularLayer());

    await fs.mkdir(outputDir, { recursive: true });
    await sharp({
        create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
        .composite(composites)
        .toFile(path.join(outputDir, 'apple-touch-icon.png'));
}

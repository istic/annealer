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

// Icon Composer also supports gradient fills with more than two stops, but
// their icon.json shape isn't publicly documented and we don't want to guess
// at it and render silently wrong output, so only these two kinds are
// recognized; anything else throws instead of mis-rendering.
const SUPPORTED_FILL_KINDS = ['automatic-gradient', 'flat-color'];

function detectFillKind(fill) {
    const keys = Object.keys(fill || {});

    if (keys.length !== 1 || !SUPPORTED_FILL_KINDS.includes(keys[0]) || typeof fill[keys[0]] !== 'string') {
        throw new Error(
            `generateAppleTouchIcon: unsupported icon.json fill ${JSON.stringify(fill)} — ` +
            `only a single ${SUPPORTED_FILL_KINDS.map((kind) => `"${kind}"`).join(' or ')} color is supported (no multi-stop gradients).`,
        );
    }

    return keys[0];
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

    iconData.fill = { [fillKind]: hexToDisplayP3(compensatedHex) };

    if (write) {
        await fs.writeFile(jsonPath, `${JSON.stringify(iconData, null, 2)}\n`, 'utf-8');
    }

    return { iconData, fillKind };
}

function backgroundLayer(rgb, fillKind) {
    const [r, g, b] = rgb;
    const baseColor = `rgb(${r}, ${g}, ${b})`;
    const topColor = fillKind === 'automatic-gradient'
        ? `rgb(${Math.min(255, r + GRADIENT_LIFT)}, ${Math.min(255, g + GRADIENT_LIFT)}, ${Math.min(255, b + GRADIENT_LIFT)})`
        : baseColor;

    const squircleMask = Buffer.from(`
        <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
            <path d="${generateSquirclePath(SIZE, 5)}" fill="white" />
        </svg>
    `);

    const gradient = Buffer.from(`
        <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
            <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:${topColor}" />
                <stop offset="70%" style="stop-color:${baseColor}" />
                <stop offset="100%" style="stop-color:${baseColor}" />
            </linearGradient>
            <rect width="${SIZE}" height="${SIZE}" fill="url(#grad)" />
        </svg>
    `);

    return sharp(gradient).composite([{ input: squircleMask, blend: 'dest-in' }]).png().toBuffer();
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
            <rect x="0" y="0" width="1200" height="1200" fill="white" fill-opacity="${layerOpacity}" mask="url(#glyphMask)" filter="url(#liquidGlass)" />
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
    const rgb = p3StringToAppleRgb(iconData.fill[fillKind]);

    const composites = [{ input: await backgroundLayer(rgb, fillKind), top: 0, left: 0 }];

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

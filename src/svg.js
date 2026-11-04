export function extractGlyphMarkup(svgMarkup) {
    const match = svgMarkup.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/i);

    if (!match) {
        throw new Error('extractGlyphMarkup: unable to parse glyph SVG');
    }

    return match[1].trim();
}

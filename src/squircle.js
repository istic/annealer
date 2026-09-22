// Quintic superellipse (n=5 by convention here) path generator matching
// Apple's squircle shape, traced in one-degree steps from the rightmost point.
export function generateSquirclePath(size, exponent) {
    const radius = size / 2;
    const center = size / 2;
    let path = `M ${radius + center},${center} `;

    for (let degrees = 0; degrees <= 360; degrees += 1) {
        const angle = (degrees * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const x = Math.abs(cos) ** (2 / exponent) * radius * Math.sign(cos) + center;
        const y = Math.abs(sin) ** (2 / exponent) * radius * Math.sign(sin) + center;

        path += `L ${x},${y} `;
    }

    return `${path}Z`;
}

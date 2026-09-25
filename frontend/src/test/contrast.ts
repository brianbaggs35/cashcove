/** WCAG 2 colour contrast, for tests that keep the palette readable. */

type Rgb = [number, number, number]

/** Reads #rgb or #rrggbb, the forms Vuetify's theme colours come in. */
function parse(hex: string): Rgb {
  const digits = hex.length === 4 ? hex.slice(1).replace(/./g, '$&$&') : hex.slice(1)
  return [0, 2, 4].map((start) => parseInt(digits.slice(start, start + 2), 16)) as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

/** How a colour looks laid over another at some opacity, like Vuetify's tonal tints. */
export function tint(color: string, over: string, opacity: number): string {
  const [top, bottom] = [parse(color), parse(over)]
  const mixed = top.map((value, index) =>
    Math.round(value * opacity + bottom[index]! * (1 - opacity)),
  )
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/** The contrast ratio between two colours like #0f716a, from 1 to 21. AA text needs 4.5. */
export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(parse(a)), luminance(parse(b))].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (lighter + 0.05) / (darker + 0.05)
}

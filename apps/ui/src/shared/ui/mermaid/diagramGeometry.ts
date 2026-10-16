/** Read only the opening SVG tag; parsing the entire diagram again delays the first click. */
export function diagramBounds(svg: string) {
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? ''
  const attribute = (name: string) =>
    root.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]
  const length = (name: string) => {
    const value = attribute(name)
    return value?.includes('%') ? undefined : Number.parseFloat(value ?? '')
  }
  const box = attribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const dimension = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
  return {
    x: 0,
    y: 0,
    width: dimension(box?.[2] ?? length('width'), 800),
    height: dimension(box?.[3] ?? length('height'), 600),
  }
}

/** Enough room for gestures and controls, with height following the picture's proportions. */
export function diagramWindowSize(bounds: { width: number; height: number }) {
  return {
    width: Math.min(1320, Math.max(560, bounds.width * 1.25 + 96)),
    height: Math.min(760, Math.max(280, bounds.height * 1.25 + 160)),
  }
}

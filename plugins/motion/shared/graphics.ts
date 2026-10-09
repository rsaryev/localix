import type { MotionDocument } from './schema'
import { ease } from './timing'

// Film colors are authored content; workbench chrome continues to use host tokens.
export const palettes = {
  ink: { background: '#111518', foreground: '#f4f3e9', accent: '#b7ecce', muted: '#a9b3b1' },
  paper: { background: '#f2efe6', foreground: '#202d2a', accent: '#287461', muted: '#626f67' },
  cobalt: { background: '#142db0', foreground: '#f8f4e9', accent: '#d6f080', muted: '#c3cbf0' },
  citrus: { background: '#e4f290', foreground: '#202d22', accent: '#4b6944', muted: '#5d6e50' },
  rose: { background: '#ead5cf', foreground: '#452a31', accent: '#a03e52', muted: '#7c5d62' },
  ember: { background: '#f45d35', foreground: '#22140f', accent: '#ffe7b8', muted: '#62311c' },
  electric: { background: '#201c38', foreground: '#f4eefa', accent: '#a49aff', muted: '#bbb1d6' },
  noir: { background: '#070809', foreground: '#f4f4f2', accent: '#aedbde', muted: '#a1a5a9' },
  graphite: { background: '#0d0d0f', foreground: '#f1efeb', accent: '#c6bba9', muted: '#aaa6a0' },
} satisfies Record<MotionDocument['palette'], Record<string, string>>
export type FilmPalette = (typeof palettes)[keyof typeof palettes]
export type Painter = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export function roundRect(
  ctx: Painter,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}
export function circle(ctx: Painter, x: number, y: number, radius: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}
export function fittedText(
  ctx: Painter,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  color: string,
  options: {
    weight?: number
    align?: CanvasTextAlign
    maxLines?: number
    lineHeight?: number
    family?: string
  } = {},
) {
  const {
    weight = 600,
    align = 'left',
    maxLines = 4,
    lineHeight = 1.05,
    family = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  } = options
  const split = (fontSize: number) => {
    ctx.font = `${weight} ${fontSize}px ${family}`
    const lines: string[] = []
    for (const paragraph of value.split('\n')) {
      let line = ''
      for (const word of paragraph.split(/\s+/u)) {
        const candidate = line ? `${line} ${word}` : word
        if (line && ctx.measureText(candidate).width > width) {
          lines.push(line)
          line = word
        } else line = candidate
      }
      lines.push(line)
    }
    return lines
  }
  let fontSize = size
  let lines = split(fontSize)
  for (
    let attempt = 0;
    attempt < 24 &&
    (lines.length > maxLines || lines.some((line) => ctx.measureText(line).width > width));
    attempt++
  ) {
    fontSize *= 0.92
    lines = split(fontSize)
  }
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'top'
  for (let index = 0; index < lines.length; index++)
    ctx.fillText(lines[index]!, x, y + index * fontSize * lineHeight)
  return lines.length * fontSize * lineHeight
}
export function reveal(time: number, delay = 0, duration = 0.8) {
  return ease((time - delay) / duration)
}
export function drawImageCover(
  ctx: Painter,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const source = image as { width: number; height: number }
  const scale = Math.max(width / source.width, height / source.height)
  const sw = width / scale
  const sh = height / scale
  ctx.drawImage(
    image,
    (source.width - sw) / 2,
    (source.height - sh) / 2,
    sw,
    sh,
    x,
    y,
    width,
    height,
  )
}

import { pluginFiles } from './runtime'

function safeName(title: string | undefined, fallback: string): string {
  const base = (title ?? fallback)
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base.length > 0 ? base : fallback
}

// `downloadTable` (whole-dataset export via the table service's export URL) moved to
// an extension-owned table surface; this file keeps only chart image exports.

/** Clone the chart's SVG with an explicit xmlns + computed text color baked in. */
function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  // currentColor on axes/labels resolves to the host theme's text color.
  const color = getComputedStyle(svg).color
  clone.setAttribute('color', color)
  return new XMLSerializer().serializeToString(clone)
}

/** Download the rendered chart SVG as a standalone .svg file. */
export function downloadChartSvg(svg: SVGSVGElement, title?: string): void {
  const blob = new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' })
  const filename = `${safeName(title, 'chart')}.svg`
  void pluginFiles.saveBlob(filename, blob)
}

/** Rasterize the rendered chart SVG to a PNG (2x) and download it. */
export async function downloadChartPng(svg: SVGSVGElement, title?: string): Promise<void> {
  const rect = svg.getBoundingClientRect()
  const w = Math.max(1, Math.round(rect.width))
  const h = Math.max(1, Math.round(rect.height))
  const scale = 2
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializeSvg(svg))}`

  const img = new Image()
  img.width = w
  img.height = h
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Could not draw the chart as an image.'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  ctx.scale(scale, scale)
  // Flatten onto the host surface color so transparent SVGs read on any viewer.
  ctx.fillStyle = getComputedStyle(svg).getPropertyValue('--surface') || '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not encode the chart as a PNG.')
  const filename = `${safeName(title, 'chart')}.png`
  await pluginFiles.saveBlob(filename, blob)
}

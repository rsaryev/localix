import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * A plugin app's Dock icon, drawn from the icon the plugin already shows on the rail.
 *
 * Every plugin app wears Localix's own icon (`apps/desktop-tauri/app-icon.png`): the same
 * near-black rounded square on the 1024 grid, the same faint top-to-bottom fall of light, and a
 * single light glyph in the middle. Only the glyph tells the apps apart, so they read as one
 * family beside Localix in the Dock.
 */
export interface IconRendition {
  size: number
  /** Base64 PNG, as the shell's `mini_app_install` takes it. */
  png: string
}

/** The pixel sizes the shell assembles into an `.icns` (`app_icon.rs`). */
export const ICON_SIZES = [128, 256, 512, 1024] as const

/** Measured from Localix's icon: a 896 tile with 64 points of margin. */
const GRID = 1024
const TILE = 896
const TILE_RADIUS = 196
const TILE_TOP = '#121215'
const TILE_BOTTOM = '#09090b'
const GLYPH_COLOR = '#e7e6e6'
/** Quieter than the Localix bird: the glyph fills two fifths of the grid, at a fine stroke. */
const GLYPH = 400
const GLYPH_STROKE = '1.5'

/** What the rail draws a plugin with: a component that takes only a class. */
export type IconComponent = ComponentType<{ className?: string }>

/** The glyph as standalone SVG markup an `<img>` can load: sized, light and self-contained. */
export function glyphSvg(Icon: IconComponent): string {
  const markup = renderToStaticMarkup(createElement(Icon))
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  if (svg.nodeName.toLowerCase() !== 'svg') {
    throw new Error('The plugin icon did not render an SVG')
  }
  return glyphMarkup(svg as unknown as SVGSVGElement)
}

/** Detached from the page, `currentColor` and CSS sizes resolve to nothing; state them. */
export function glyphMarkup(svg: SVGSVGElement): string {
  svg.removeAttribute('class')
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width', String(GLYPH))
  svg.setAttribute('height', String(GLYPH))
  svg.setAttribute('color', GLYPH_COLOR)
  if (svg.getAttribute('stroke-width')) svg.setAttribute('stroke-width', GLYPH_STROKE)
  return svg.outerHTML.replaceAll('currentColor', GLYPH_COLOR)
}

function loadImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The plugin icon could not be drawn'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

function drawTile(context: CanvasRenderingContext2D): void {
  const inset = (GRID - TILE) / 2
  const fall = context.createLinearGradient(0, inset, 0, inset + TILE)
  fall.addColorStop(0, TILE_TOP)
  fall.addColorStop(1, TILE_BOTTOM)
  context.fillStyle = fall
  context.beginPath()
  context.roundRect(inset, inset, TILE, TILE, TILE_RADIUS)
  context.fill()
}

/** Draw the icon once on the 1024 grid, then scale it down for each smaller rendition. */
export async function renderAppIcon(Icon: IconComponent): Promise<IconRendition[]> {
  const glyph = await loadImage(glyphSvg(Icon))
  const master = document.createElement('canvas')
  master.width = GRID
  master.height = GRID
  const context = master.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  drawTile(context)
  context.drawImage(glyph, (GRID - GLYPH) / 2, (GRID - GLYPH) / 2, GLYPH, GLYPH)
  return ICON_SIZES.map((size) => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const scaled = canvas.getContext('2d')
    if (!scaled) throw new Error('Canvas is unavailable')
    scaled.imageSmoothingQuality = 'high'
    scaled.drawImage(master, 0, 0, size, size)
    return { size, png: canvas.toDataURL('image/png').slice('data:image/png;base64,'.length) }
  })
}

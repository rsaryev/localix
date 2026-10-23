import { API_BASE_URL, apiFetch } from '@/shared/api/internal'

/**
 * A standalone app's Dock icon: the mini app's own icon, the file its `mini-app.json` names, as
 * the host serves it (`GET /rpc/mini-apps/:app/icon`). The same picture the store and the rail
 * show, so the app is recognisable wherever it appears. An app that names none gets no Mac app
 * rather than a blank one.
 */
export interface IconRendition {
  size: number
  /** Base64 PNG, as the shell's `mini_app_install` takes it. */
  png: string
}

/** The pixel sizes the shell assembles into an `.icns` (`app_icon.rs`). */
export const ICON_SIZES = [128, 256, 512, 1024] as const
const GRID = 1024

/** The app's icon file, from the host. */
export async function loadAppIcon(miniApp: string, title: string): Promise<Blob> {
  const response = await apiFetch(
    `${API_BASE_URL}/rpc/mini-apps/${encodeURIComponent(miniApp)}/icon`,
  )
  if (!response.ok)
    throw new Error(`${title} has no icon of its own: add an "icon" to its mini-app.json`)
  return response.blob()
}

function loadImage(blob: Blob): Promise<{ image: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The mini app icon could not be drawn'))
    }
    image.src = url
  })
}

/**
 * Draw the icon once on the 1024 grid, then scale it down for each smaller rendition. An SVG is
 * rasterised at full size, so every rendition is sharp; a raster icon is drawn to fill the grid.
 * Read through an object URL, so the canvas is never tainted by another origin.
 */
export async function renderAppIcon(miniApp: string, title: string): Promise<IconRendition[]> {
  const { image, release } = await loadImage(await loadAppIcon(miniApp, title))
  try {
    const master = document.createElement('canvas')
    master.width = GRID
    master.height = GRID
    const context = master.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, GRID, GRID)
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
  } finally {
    release()
  }
}

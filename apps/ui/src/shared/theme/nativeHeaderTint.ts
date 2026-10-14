export type NativeHeaderTint = [number, number, number, number]

/** Resolve the shared sidebar token to sRGB for AppKit, including its alpha. */
export function readNativeHeaderTint(): NativeHeaderTint | undefined {
  if (typeof document === 'undefined' || !document.documentElement) return undefined
  const sample = document.createElement('span')
  sample.hidden = true
  sample.style.backgroundColor = 'var(--sidebar)'
  document.documentElement.appendChild(sample)
  try {
    const color = getComputedStyle(sample).backgroundColor
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    const pixel = context.getImageData(0, 0, 1, 1).data
    return [pixel[0]! / 255, pixel[1]! / 255, pixel[2]! / 255, pixel[3]! / 255]
  } catch {
    return undefined
  } finally {
    sample.remove()
  }
}

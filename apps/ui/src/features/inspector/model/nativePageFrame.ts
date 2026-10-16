import type { PageFrame } from './nativePageLayer'

const clips = /^(hidden|clip|scroll|auto)$/

/** A native child view needs the visible DOM intersection: CSS cannot clip its layer. */
export function visibleNativePageFrame(host: HTMLElement): PageFrame | null {
  if (!host.isConnected) return null
  const rect = host.getBoundingClientRect()
  let left = Math.max(0, rect.left)
  let top = Math.max(0, rect.top)
  let right = Math.min(window.innerWidth, rect.right)
  let bottom = Math.min(window.innerHeight, rect.bottom)
  for (let element: HTMLElement | null = host; element; element = element.parentElement) {
    const style = getComputedStyle(element)
    if (
      element.hidden ||
      element.inert ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      Number.parseFloat(style.opacity) === 0 ||
      style.contentVisibility === 'hidden'
    )
      return null
    if (element === host) continue
    const clipX = clips.test(style.overflowX || style.overflow)
    const clipY = clips.test(style.overflowY || style.overflow)
    if (!clipX && !clipY) continue
    const parent = element.getBoundingClientRect()
    const scaleX = element.offsetWidth ? parent.width / element.offsetWidth : 1
    const scaleY = element.offsetHeight ? parent.height / element.offsetHeight : 1
    if (clipX) {
      const edge = parent.left + element.clientLeft * scaleX
      const size = element.offsetWidth ? element.clientWidth * scaleX : parent.width
      left = Math.max(left, edge)
      right = Math.min(right, edge + size)
    }
    if (clipY) {
      const edge = parent.top + element.clientTop * scaleY
      const size = element.offsetHeight ? element.clientHeight * scaleY : parent.height
      top = Math.max(top, edge)
      bottom = Math.min(bottom, edge + size)
    }
  }
  const width = right - left
  const height = bottom - top
  if (![left, top, width, height].every(Number.isFinite) || width < 1 || height < 1) return null
  return { x: left, y: top, width, height }
}

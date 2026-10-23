const nativeWindowImages = new WeakSet<DataTransfer>()

/** The native provisional window is the drag image; suppress the browser's second ghost. */
export function setNativeWindowDragImage(dt: DataTransfer): void {
  if (typeof document === 'undefined' || typeof dt.setDragImage !== 'function') return
  const image = document.createElement('canvas')
  image.width = image.height = 1
  image.style.cssText = 'position:fixed;left:-100px;top:-100px;pointer-events:none'
  image.setAttribute('aria-hidden', 'true')
  document.body.append(image)
  dt.setDragImage(image, 0, 0)
  nativeWindowImages.add(dt)
  setTimeout(() => image.remove(), 0)
}

/**
 * Compact custom drag ghost: a small themed pill with the item's label instead
 * of the browser default (a translucent snapshot of the WHOLE source element —
 * for wide rows/cards that ghost looks broken and obscures the drop target).
 *
 * Must be called synchronously inside a `dragstart` handler. The pill is
 * appended off-screen (the drag image must be in the document when
 * `setDragImage` is called) and removed on the next tick.
 */
export function setCompactDragImage(dt: DataTransfer, label: string): void {
  if (
    typeof document === 'undefined' ||
    typeof dt.setDragImage !== 'function' ||
    nativeWindowImages.has(dt)
  )
    return
  const el = document.createElement('div')
  const text = label.trim() || 'Item'
  el.textContent = text.length > 42 ? `${text.slice(0, 41)}…` : text
  // Inline styles (not classes) so the ghost renders identically wherever the
  // source lives; themed via the app-level CSS custom properties.
  el.style.cssText = [
    'position:fixed',
    'top:-100px',
    'left:-100px',
    'pointer-events:none',
    'max-width:16rem',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'white-space:nowrap',
    // 18px line box + 2×4px padding + 2×1px border = 28px, i.e. the
    // --chrome-control-md rung: the ghost is exactly one control tall, like the
    // chips and rows it is dragged from. Written as padding rather than a
    // var() height because the pill has to size itself from its own text.
    'padding:4px 10px',
    'border-radius:9999px',
    'font:500 12px/1.5 ui-sans-serif,system-ui,sans-serif',
    'background:var(--surface-raised,#fff)',
    'color:var(--text-soft,#444)',
    'border:1px solid var(--control-border,#ccc)',
    'box-shadow:0 4px 12px rgba(0,0,0,0.18)',
  ].join(';')
  document.body.appendChild(el)
  dt.setDragImage(el, 12, 14)
  setTimeout(() => el.remove(), 0)
}

/** Preserve a workbench tab's real geometry and grabbed point without a second interactive tab. */
export function setElementDragImage(
  dt: DataTransfer,
  source: Element,
  point: { clientX: number; clientY: number },
): void {
  if (
    typeof document === 'undefined' ||
    typeof dt.setDragImage !== 'function' ||
    nativeWindowImages.has(dt)
  )
    return
  if (!(source instanceof HTMLElement)) return
  const rect = source.getBoundingClientRect()
  if (!(rect.width > 0 && rect.height > 0)) return
  const ghost = source.cloneNode(true) as HTMLElement
  // No duplicate identity, focus stops, or geometry/drop registrations in this visual copy.
  for (const element of [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]) {
    element.removeAttribute('id')
    element.removeAttribute('draggable')
    element.removeAttribute('role')
    element.removeAttribute('tabindex')
    for (const attribute of element.getAttributeNames()) {
      if (attribute.startsWith('aria-') || attribute.startsWith('data-'))
        element.removeAttribute(attribute)
    }
  }
  ghost.inert = true
  ghost.setAttribute('aria-hidden', 'true')
  Object.assign(ghost.style, {
    position: 'fixed',
    top: `${-rect.height - 100}px`,
    left: `${-rect.width - 100}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    minWidth: `${rect.width}px`,
    maxWidth: `${rect.width}px`,
    margin: '0',
    pointerEvents: 'none',
    animation: 'none',
    transition: 'none',
    opacity: '1',
    font: getComputedStyle(source).font,
  })
  document.body.appendChild(ghost)
  const clamp = (value: number, size: number) =>
    Math.min(size, Math.max(0, Number.isFinite(value) ? value : size / 2))
  dt.setDragImage(
    ghost,
    clamp(point.clientX - rect.left, rect.width),
    clamp(point.clientY - rect.top, rect.height),
  )
  setTimeout(() => ghost.remove(), 0)
}

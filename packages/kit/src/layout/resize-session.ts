/** One resize lifecycle for sashes, sidebars, sections and table columns. */
export function startResizeSession(
  event: { type?: string; button: number; clientX: number; clientY: number; pointerId?: number },
  ports: {
    cursor: 'col-resize' | 'row-resize'
    onMove: (event: MouseEvent | PointerEvent) => void
    onEnd: () => void
    onCancel?: () => void
  },
): () => void {
  if (event.button !== 0) return () => {}
  const pointer = event.type?.startsWith('pointer') || event.pointerId !== undefined
  const shield = document.createElement('div')
  shield.style.cssText = `position:fixed;inset:0;z-index:2147483647;cursor:${ports.cursor};touch-action:none;`
  document.body.append(shield)
  const selection = document.body.style.userSelect
  document.body.style.userSelect = 'none'
  let done = false
  let frame: number | null = null
  let pending: MouseEvent | PointerEvent | null = null
  const flush = () => {
    frame = null
    if (!pending) return
    const next = pending
    pending = null
    ports.onMove(next)
  }
  const matches = (next: MouseEvent | PointerEvent) =>
    !pointer || (next as PointerEvent).pointerId === event.pointerId
  const move = (next: MouseEvent | PointerEvent) => {
    if (!matches(next)) return
    pending = next
    if (frame === null) frame = requestAnimationFrame(flush)
  }
  const finish = (cancelled = false) => {
    if (done) return
    done = true
    if (frame !== null) cancelAnimationFrame(frame)
    if (!cancelled) flush()
    pending = null
    shield.remove()
    document.body.style.userSelect = selection
    window.removeEventListener(pointer ? 'pointermove' : 'mousemove', move)
    window.removeEventListener(pointer ? 'pointerup' : 'mouseup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('blur', blur)
    shield.removeEventListener('mouseleave', blur)
    if (cancelled) (ports.onCancel ?? ports.onEnd)()
    else ports.onEnd()
  }
  const up = (next: MouseEvent | PointerEvent) => {
    if (matches(next)) finish()
  }
  const cancel = (next: PointerEvent) => {
    if (matches(next)) finish(true)
  }
  const blur = () => finish()
  window.addEventListener(pointer ? 'pointermove' : 'mousemove', move)
  window.addEventListener(pointer ? 'pointerup' : 'mouseup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('blur', blur)
  shield.addEventListener('mouseleave', blur)
  // Teardown on unmount must release the shield and every listener too.
  return () => finish(true)
}

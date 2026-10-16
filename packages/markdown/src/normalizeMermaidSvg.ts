/**
 * Mermaid may serialize a flowchart's viewBox before its last node transforms have reached the
 * browser's geometry cache. Measure the finished vector once, before caching or displaying it.
 * This is drawing work; opening the viewer never reparses or measures the diagram.
 */
export function normalizeMermaidSvg(vector: string): string {
  if (typeof document === 'undefined' || !vector.includes('class="root"')) return vector
  const holder = document.createElement('div')
  holder.setAttribute('aria-hidden', 'true')
  Object.assign(holder.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: '1000px',
    opacity: '0',
    pointerEvents: 'none',
  })
  // Only strict Mermaid output reaches here, never raw agent-authored SVG.
  holder.innerHTML = vector
  document.body.append(holder)
  try {
    const svg = holder.querySelector('svg')
    if (!svg || typeof svg.getBBox !== 'function') return vector
    const bounds = svg.getBBox()
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    )
      return vector
    const width = bounds.width + 16
    const height = bounds.height + 16
    svg.setAttribute('viewBox', `${bounds.x - 8} ${bounds.y - 8} ${width} ${height}`)
    svg.style.maxWidth = `${width}px`
    return svg.outerHTML
  } catch {
    return vector
  } finally {
    holder.remove()
  }
}

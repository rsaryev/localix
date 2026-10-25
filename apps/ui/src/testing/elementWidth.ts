/**
 * The test DOM lays nothing out, so a part that measures its own box reads zero. This gives every
 * element matching `only` (default: all) the width a test asks for and returns the undo.
 */
export function stubElementWidth(
  width: number,
  only: (element: HTMLElement) => boolean = () => true,
): () => void {
  const owner = [HTMLElement.prototype, Element.prototype].find((candidate) =>
    Object.getOwnPropertyDescriptor(candidate, 'getBoundingClientRect'),
  )!
  const original = Object.getOwnPropertyDescriptor(owner, 'getBoundingClientRect')!
  const measure = original.value as (this: HTMLElement) => DOMRect
  Object.defineProperty(owner, 'getBoundingClientRect', {
    ...original,
    value(this: HTMLElement) {
      const rect = measure.call(this)
      return only(this) ? ({ ...rect.toJSON(), width } as DOMRect) : rect
    },
  })
  return () => void Object.defineProperty(owner, 'getBoundingClientRect', original)
}

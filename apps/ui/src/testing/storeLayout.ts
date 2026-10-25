import { stubElementWidth } from './elementWidth'

/**
 * The Store measures its own pane, and its lists window themselves against its scroller; the
 * test DOM lays nothing out. This gives the pane the width a test asks for, the scroller 900px of
 * height and a windowed row 76px — what a browser would measure — and returns the undo.
 */
export function stubStoreLayout(width: number): () => void {
  const proto = HTMLElement.prototype
  const original = Object.getOwnPropertyDescriptors(proto)
  const restorePane = stubElementWidth(width, (el) => el.hasAttribute('data-layout'))
  const size = (get: (el: HTMLElement) => number | undefined) => ({
    configurable: true,
    get(this: HTMLElement) {
      return get(this) ?? 0
    },
  })
  const scroller = (value: number) =>
    size((el) => (el.hasAttribute('data-store-scroller') ? value : undefined))
  Object.defineProperties(proto, {
    offsetHeight: size((el) =>
      el.hasAttribute('data-store-scroller') ? 900 : el.hasAttribute('data-index') ? 76 : undefined,
    ),
    clientHeight: scroller(900),
    clientWidth: scroller(width),
  })
  return () => {
    restorePane()
    for (const key of ['offsetHeight', 'clientHeight', 'clientWidth'] as const)
      if (original[key]) Object.defineProperty(proto, key, original[key])
      else delete (proto as unknown as Record<string, unknown>)[key]
  }
}

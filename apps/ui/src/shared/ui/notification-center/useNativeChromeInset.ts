import { useLayoutEffect, useState, type RefObject } from 'react'

/** Native tabs paint above the webview, so collision detection must exclude their band. */
function nativeChromeInset() {
  if (typeof document === 'undefined') return 0
  const root = document.documentElement
  if (root.dataset.nativeTitlebar !== 'true') return 0
  const styles = getComputedStyle(root)
  const height = (token: string) =>
    Math.max(0, Number.parseFloat(styles.getPropertyValue(token)) || 0)
  return (
    height('--native-tabbar-height') +
    (root.dataset.fullscreen === 'true' ? 0 : height('--titlebar-height'))
  )
}

export function useNativeChromeInset(anchorRef: RefObject<HTMLButtonElement | null>) {
  const [geometry, setGeometry] = useState(() => ({ inset: nativeChromeInset(), sideOffset: 4 }))

  useLayoutEffect(() => {
    const update = () => {
      const inset = nativeChromeInset()
      const anchorBottom = anchorRef.current?.getBoundingClientRect().bottom ?? inset
      setGeometry({ inset, sideOffset: Math.max(4, inset - anchorBottom + 4) })
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-native-titlebar', 'data-fullscreen'],
    })
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [anchorRef])

  return geometry
}

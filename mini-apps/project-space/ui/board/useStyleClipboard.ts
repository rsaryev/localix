import { useMemo, useRef } from 'react'
import type { StyleClipboard } from './boardKeys'
import type { CopiedStyle } from './commands'

/**
 * The style ⌥⌘C copied, held for as long as the board is open — as the design tools keep it until
 * the page reloads. It is the person's tool, not the board's content: nothing is written.
 */
export function useStyleClipboard(): StyleClipboard {
  const copied = useRef<CopiedStyle | null>(null)
  return useMemo(
    () => ({
      copied: () => copied.current,
      copy: (style) => {
        copied.current = style
      },
    }),
    [],
  )
}

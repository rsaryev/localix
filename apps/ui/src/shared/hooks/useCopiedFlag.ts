import { useCallback, useEffect, useRef, useState } from 'react'
import { COPIED_FEEDBACK_MS } from '@/shared/lib/timings'

/**
 * The "Copied" tick for copy actions that are not plain text (images, custom payloads). The
 * caller performs the copy and calls `flash()` on success; the flag resets after `resetMs`,
 * a repeat flash restarts the timer, and unmount clears it. Plain text uses the SDK `useCopied`.
 */
export function useCopiedFlag(resetMs: number = COPIED_FEEDBACK_MS): {
  copied: boolean
  flash: () => void
} {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const flash = useCallback(() => {
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), resetMs)
  }, [resetMs])
  return { copied, flash }
}

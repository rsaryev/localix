import { useCallback, useEffect, useRef, useState } from 'react'

import { toast } from './notifications'
import { pluginClipboard } from './runtime'

export function useCopied(resetMs = 1500): {
  copied: boolean
  copy: (text: string) => Promise<void>
} {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const copy = useCallback(
    async (text: string) => {
      // A copy that cannot happen must SAY so. This used to return quietly on a
      // false and swallow a rejection, so every copy button in the app — code
      // blocks, tool IO, command cards, message actions — reacted to a refused
      // clipboard exactly as it reacts to a click that never registered: the icon
      // simply never became a checkmark. That is indistinguishable from a dead
      // control, and it is the same failure shape as a native call that logs its
      // error instead of returning it.
      try {
        if (!(await pluginClipboard.writeText(text))) {
          toast.error('Could not copy to the clipboard', {
            description: 'This window is not allowed to write to the clipboard.',
          })
          return
        }
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), resetMs)
      } catch (cause) {
        toast.error('Could not copy to the clipboard', {
          description: cause instanceof Error ? cause.message : undefined,
        })
      }
    },
    [resetMs],
  )

  return { copied, copy }
}

/**
 * Copy `text` and report only a copy that did NOT happen.
 *
 * Every toast is a durable Event Center row, so a "SQL copied" row per click filled the journal
 * with a fact the person had just caused and could already see. A success is therefore silent
 * here; a caller whose control has room for a confirmation shows it inline (the boolean result, or
 * `useCopied`'s tick). A failure still speaks, because a refused clipboard otherwise looks exactly
 * like a click that never registered.
 */
export async function copyText(text: string, label: string): Promise<boolean> {
  const failure = `Could not copy ${inSentence(label)}`
  try {
    if (await pluginClipboard.writeText(text)) return true
    toast.error(failure, {
      description: 'The clipboard is unavailable in this browser context.',
    })
    return false
  } catch (cause) {
    toast.error(failure, {
      description: cause instanceof Error ? cause.message : undefined,
    })
    return false
  }
}

/** "Object name" reads as "object name" mid-headline; an acronym ("SQL", "DDL") keeps its case. */
function inSentence(label: string): string {
  if (/^.\p{Lu}/u.test(label)) return label
  return label.charAt(0).toLowerCase() + label.slice(1)
}

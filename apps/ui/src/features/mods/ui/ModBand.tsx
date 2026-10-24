import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, Minus } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import type { ModAction, ModElement } from '@/shared/api/modsApi'
import { ModTree } from './ModTree'
import { hotkeysOf, pressHotkey } from './siteHotkeys'

/**
 * The band above the prompt box, as Claude Code draws its `AbovePrompt` site: the mods' tree, a
 * collapse mark at its right end, and its Buttons' hotkeys while the band holds the focus. A digit
 * hotkey also answers a digit typed alone into the empty prompt box, once the person pauses: the
 * digit goes, the Button is pressed. Collapsed, the band is one dim row and nothing presses in it.
 */

/** How long the box must hold the digit alone before it presses the band's Button. */
const DIGIT_PAUSE_MS = 600

const setFieldValue = (field: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

export interface ModBandProps {
  tree: Array<ModElement | string>
  act: (action: ModAction) => void
  /** Runs `run` once the person paused; injected by tests. */
  afterPause?: (run: () => void) => () => void
}

const pauseThen = (run: () => void) => {
  const timer = setTimeout(run, DIGIT_PAUSE_MS)
  return () => clearTimeout(timer)
}

export function ModBand({ tree, act, afterPause = pauseThen }: ModBandProps) {
  const [collapsed, setCollapsed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const hotkeys = useMemo(() => hotkeysOf(tree), [tree])
  const latest = useRef({ hotkeys, act, collapsed, afterPause })
  useLayoutEffect(() => {
    latest.current = { hotkeys, act, collapsed, afterPause }
  })

  // A digit alone in this composer's empty prompt box answers the band's Button on that digit.
  useEffect(() => {
    const shell = root.current?.closest('[data-agent-link-drop-target]')
    if (!shell) return
    let cancel: (() => void) | undefined
    const onInput = (event: Event) => {
      cancel?.()
      const field = event.target
      if (!(field instanceof HTMLTextAreaElement) || !shell.contains(field)) return
      const { hotkeys: keys, collapsed: folded, afterPause: wait } = latest.current
      const digit = field.value
      if (folded || !/^[0-9]$/.test(digit) || !keys.has(digit)) return
      cancel = wait(() => {
        if (field.value !== digit) return
        setFieldValue(field, '')
        latest.current.act({ kind: 'press', element: keys.get(digit)! })
      })
    }
    shell.addEventListener('input', onInput)
    return () => {
      cancel?.()
      shell.removeEventListener('input', onInput)
    }
  }, [])

  if (collapsed)
    return (
      <div ref={root} className="flex items-center gap-2 px-3 py-1 text-xs text-text-faint">
        <span className="truncate">Mods band collapsed</span>
        <IconButton
          className="ml-auto"
          size="sm"
          aria-label="Expand the band"
          onClick={() => setCollapsed(false)}
        >
          <ChevronUp />
        </IconButton>
      </div>
    )
  return (
    <div ref={root} className="flex items-start gap-2 px-3 py-1.5">
      <div
        role="region"
        aria-label="Mods band"
        // The band takes the keyboard on a click or Tab, and its Buttons' hotkeys with it.
        tabIndex={0}
        className="min-w-0 flex-1 text-sm focus-ring rounded-sm"
        onKeyDown={(event) => pressHotkey(event, hotkeys, act)}
      >
        <ModTree nodes={tree} act={act} />
      </div>
      <IconButton size="sm" aria-label="Collapse the band" onClick={() => setCollapsed(true)}>
        <Minus />
      </IconButton>
    </div>
  )
}

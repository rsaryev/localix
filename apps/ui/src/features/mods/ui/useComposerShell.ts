import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ModAction } from '@/shared/api/modsApi'
import { CMD, useKeybindingMatcher } from '@/shared/lib/keybindings'

/**
 * What the band above the prompt box hears from the composer it sits in (`ModBand.tsx`):
 *
 * - A digit typed alone into the empty prompt box presses the band's Button on that digit, once
 *   the person pauses: the digit goes, the Button is pressed.
 * - The previous and next page shortcuts (⌥[ and ⌥] by default) turn the band's pages.
 * - Each keystroke is activity, and text in the box is a draft: both hold the band's page still.
 */

/** How long the box must hold the digit alone before it presses the band's Button. */
const DIGIT_PAUSE_MS = 600

const pauseThen = (run: () => void) => {
  const timer = setTimeout(run, DIGIT_PAUSE_MS)
  return () => clearTimeout(timer)
}

const setFieldValue = (field: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

export interface ComposerShellOptions {
  /** The visible page's hotkeys, to the key of the Button each presses. */
  hotkeys: ReadonlyMap<string, string>
  act: (action: ModAction) => void
  /** Collapsed, nothing in the band presses. */
  collapsed: boolean
  /** Turn the band's pages by one, back or forward; absent with one page. */
  step?: (by: number) => void
  /** Runs `run` once the person paused; injected by tests. */
  afterPause?: (run: () => void) => () => void
}

const shellOf = (root: RefObject<HTMLElement | null>) =>
  root.current?.closest('[data-agent-link-drop-target]')

/** Each keystroke in the composer, and whether its box holds a draft. */
export function useComposerActivity(root: RefObject<HTMLElement | null>) {
  const [activity, setActivity] = useState(0)
  const [drafting, setDrafting] = useState(false)
  useEffect(() => {
    const shell = shellOf(root)
    if (!shell) return
    const onInput = (event: Event) => {
      const field = event.target
      if (field instanceof HTMLTextAreaElement) setDrafting(field.value !== '')
    }
    const onKeyDown = () => setActivity((count) => count + 1)
    shell.addEventListener('input', onInput)
    shell.addEventListener('keydown', onKeyDown)
    return () => {
      shell.removeEventListener('input', onInput)
      shell.removeEventListener('keydown', onKeyDown)
    }
  }, [root])
  return { activity, drafting }
}

/** The band's keys in its composer: a digit alone in the box, and the page shortcuts. */
export function useComposerShell(
  root: RefObject<HTMLElement | null>,
  options: ComposerShellOptions,
): void {
  const matches = useKeybindingMatcher()
  const latest = useRef({ ...options, matches, afterPause: options.afterPause ?? pauseThen })
  useLayoutEffect(() => {
    latest.current = { ...options, matches, afterPause: options.afterPause ?? pauseThen }
  })

  useEffect(() => {
    const shell = shellOf(root)
    if (!shell) return
    let cancel: (() => void) | undefined
    const onInput = (event: Event) => {
      cancel?.()
      const field = event.target
      if (!(field instanceof HTMLTextAreaElement) || !shell.contains(field)) return
      const { hotkeys: keys, collapsed, afterPause } = latest.current
      const digit = field.value
      if (collapsed || !/^[0-9]$/.test(digit) || !keys.has(digit)) return
      cancel = afterPause(() => {
        if (field.value !== digit) return
        setFieldValue(field, '')
        latest.current.act({ kind: 'press', element: keys.get(digit)! })
      })
    }
    const onKeyDown = (event: Event) => {
      const key = event as KeyboardEvent
      const { matches: hits, step, collapsed } = latest.current
      const by = hits(key, CMD.modBandPrevPage) ? -1 : hits(key, CMD.modBandNextPage) ? 1 : 0
      if (by === 0 || !step || collapsed) return
      key.preventDefault()
      step(by)
    }
    shell.addEventListener('input', onInput)
    shell.addEventListener('keydown', onKeyDown)
    return () => {
      cancel?.()
      shell.removeEventListener('input', onInput)
      shell.removeEventListener('keydown', onKeyDown)
    }
  }, [root])
}

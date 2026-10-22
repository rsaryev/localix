/**
 * What a mod may write to Localix's log, bounded: each line cut to a length, and at most so many
 * lines in a window of time. The host bounds a VM's reports and its module's `console` lines with
 * it; the clock is injected, so tests move it.
 */

export interface RateLimit {
  /** `pass`: write it; `first-drop`: the window is full, say so once; `drop`: say nothing. */
  take(): 'pass' | 'first-drop' | 'drop'
}

export function createRateLimit(options: {
  max: number
  windowMs: number
  now: () => number
}): RateLimit {
  let opened = -Infinity
  let used = 0
  return {
    take() {
      const now = options.now()
      if (now - opened >= options.windowMs) {
        opened = now
        used = 0
      }
      used += 1
      if (used <= options.max) return 'pass'
      return used === options.max + 1 ? 'first-drop' : 'drop'
    },
  }
}

/** `text` cut to `max` characters, saying how much was left out. */
export function truncated(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more)`
}

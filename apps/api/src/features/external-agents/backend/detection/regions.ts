/**
 * Extract the slice of a rendered screen a rule is allowed to look at.
 *
 * The screen we receive is the host's already-emulated `ScreenSnapshot.text` — plain text, ANSI
 * resolved — the live bottom-buffer screen snapshot that screen rules read.
 */

import type { RegionKind } from './manifest-types'

/**
 * Box-drawing rules used by these TUIs to separate the transcript from the prompt/approval area.
 * A rule scoped `after_last_horizontal_rule` is asking "only look at the current interaction",
 * which is what keeps an old approval prompt scrolled up the buffer from re-triggering `blocked`.
 */
const HORIZONTAL_RULE = /^[\s]*[─━═-]{6,}[\s]*$/

/**
 * Codex's composer line: a line that is exactly `›` or starts with `› `.
 *
 * Two of the codex rules apply after the last prompt marker, and they were once pointed at
 * `after_last_horizontal_rule` instead — a different anchor. That is not a
 * smaller region, it is a different one, and when a screen carries no box-drawing rule the
 * horizontal variant degrades to the WHOLE screen. `live_strong_blocker` is Codex's primary
 * "a human is needed" rule; evaluated over the whole buffer it can re-fire on an approval prompt
 * that scrolled away long ago, which is exactly what scoping a rule is meant to prevent, and a
 * false `blocked` settles a wait instantly.
 */
const CODEX_PROMPT_LINE = /^›(?: |$)/

export function extractRegion(screen: string, region: RegionKind): string {
  switch (region.kind) {
    case 'whole_recent':
      return screen
    case 'bottom_non_empty_lines': {
      const lines = screen.split('\n')
      const kept: string[] = []
      for (let i = lines.length - 1; i >= 0 && kept.length < region.count; i -= 1) {
        if (lines[i].trim()) kept.push(lines[i])
      }
      return kept.reverse().join('\n')
    }
    case 'after_last_horizontal_rule': {
      const lines = screen.split('\n')
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (HORIZONTAL_RULE.test(lines[i])) return lines.slice(i + 1).join('\n')
      }
      // No rule on screen means the whole screen IS the current interaction.
      return screen
    }
    case 'after_last_prompt_marker': {
      const lines = screen.split('\n')
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (CODEX_PROMPT_LINE.test(lines[i])) return lines.slice(i + 1).join('\n')
      }
      // With no marker present the whole content is returned: a screen with no composer yet has
      // nothing above the current interaction to exclude.
      return screen
    }
  }
}

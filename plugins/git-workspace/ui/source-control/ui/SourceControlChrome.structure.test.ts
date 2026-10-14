import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

/**
 * The source-control chrome is built from kit controls.
 *
 * The header's toolbar was a local `iconBtn` class string on raw `<button>`s — heights from
 * padding, off the control ladder, each re-wrapping a Tooltip that IconButton carries — and the
 * commit list drew its own empty and loading lines beside a sibling section that used the kit's.
 */
describe('source control chrome', () => {
  test('toolbar actions are kit IconButton / Button, not a local class string', () => {
    const header = read('SourceControlHeader.tsx')
    expect(header).not.toContain('const iconBtn')
    for (const label of ['Open full diff', 'More source control actions', 'Refresh']) {
      expect(header).toMatch(new RegExp(`<IconButton[^>]*aria-label="${label}"`, 's'))
    }
    expect(header).toContain('<WorkbenchToolbar')
    expect(header).toContain('<MenuEntries entries={menu}')
    expect(header).not.toContain('variant="outline"')
  })

  test('rebase and bisect band actions are the kit field Button, not raw veiled buttons', () => {
    // They stayed raw because `outline` has no resting fill; the kit's `field` variant is that
    // veil, so a hand-written `bg-foreground/[0.06]` copy is now a second opinion on it.
    const header = read('SourceControlHeader.tsx')
    const bands = read('SourceControlBanners.tsx')
    expect(header).not.toContain('<button')
    expect(bands).not.toContain('<button')
    expect(bands).not.toContain('bg-foreground/[0.06]')
    for (const label of ['Continue', 'Abort', 'Good', 'Bad', 'Reset — finish bisect']) {
      expect(bands).toMatch(
        new RegExp(`<Button[^>]*variant="field"[^>]*>[^<]*(<[^>]+>[^<]*)*${label}`, 's'),
      )
    }
  })

  test('the commit list shows its states through the kit hints', () => {
    const graph = read('CommitGraph.tsx')
    expect(graph).toContain('<LoadingHint')
    expect(graph).toContain('No commits yet.</EmptyHint>')
    expect(graph).not.toContain('<div className="px-3 py-2 text-2xs text-text-faint">No commits')
  })
})

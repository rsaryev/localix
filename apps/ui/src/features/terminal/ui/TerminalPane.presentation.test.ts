import { describe, expect, test } from 'bun:test'

const source = await Bun.file(import.meta.dir + '/TerminalPane.tsx').text()
const statusSource = await Bun.file(import.meta.dir + '/TerminalPaneStatus.tsx').text()

describe('TerminalPane disconnected presentation', () => {
  test('uses the shared state layer and keeps command failures readable', () => {
    expect(source).toContain('<TerminalConnectionState')
    expect(statusSource).toContain(
      '<PaneStateOverlay className="pointer-events-none z-(--z-controls)">',
    )
    expect(statusSource).toContain(
      '<PaneStateOverlay material="subtle" className="pointer-events-none z-(--z-controls)">',
    )
    for (const text of [source, statusSource]) {
      expect(text).not.toContain('PANE_STATE_OVERLAY')
      expect(text).not.toContain('TERMINAL_ENDED_OVERLAY')
      expect(text).not.toContain('@/features/inspector/ui/PreviewIntro')
    }
  })
})

describe('TerminalPane xterm host geometry', () => {
  // The fit addon sizes the grid from `getComputedStyle(host).height/width`, and Chrome
  // resolves those to the BORDER box. Padding on the host is therefore counted as usable
  // space: fit returns one row (and up to two columns) too many, the top padding shifts
  // the grid down as well, and the pane's overflow-hidden slices the bottom line off at
  // every single pane height. The padding has to live one level up.
  test('the host xterm mounts into carries no padding of its own', () => {
    const host = source.match(/<div ref=\{hostRef\}[^>]*className="([^"]*)"/)
    expect(host).not.toBeNull()
    const classes = host?.[1]?.split(/\s+/) ?? []
    expect(classes.filter((c) => /^-?p[xytrbles]?-/.test(c))).toEqual([])
  })
})

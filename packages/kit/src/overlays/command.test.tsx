import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SquareTerminal } from 'lucide-react'
import { Command, CommandInput } from './command'
import { kitTsxSources } from '../testing/jsx-contract'
import { commandDialogViolations } from '../testing/overlay-contracts'

describe('command input glyph', () => {
  test('allows command palettes to replace the search glyph with a terminal command mark', () => {
    const html = renderToStaticMarkup(
      <Command>
        <CommandInput icon={SquareTerminal} placeholder="Run a command…" />
      </Command>,
    )

    expect(html).toContain('lucide-square-terminal')
    expect(html).not.toContain('lucide-search')
    expect(html).toContain('Run a command')
  })

  /**
   * The kit half of the rule: the kit composes no palette of its own today, so this binds any it
   * grows. The palettes the product composes are checked (and must exist) in
   * `apps/ui/src/shared/ui/overlays.contract.test.ts`, because the kit never reads the host.
   */
  test('every dialog palette owns one command root, input, and scrolling list', async () => {
    expect(commandDialogViolations(await kitTsxSources()).violations).toEqual([])
  })

  test('the palette detector counts each region (positive control)', () => {
    const complete =
      '<CommandDialog><Command><CommandInput /><CommandList /></Command></CommandDialog>'
    const noList = '<CommandDialog><Command><CommandInput /></Command></CommandDialog>'
    const twoInputs =
      '<CommandDialog><Command><CommandInput /><CommandInput /><CommandList /></Command></CommandDialog>'

    expect(commandDialogViolations([{ path: 'a.tsx', source: complete }])).toEqual({
      checked: 1,
      violations: [],
    })
    expect(commandDialogViolations([{ path: 'b.tsx', source: noList }]).violations).toEqual([
      'b.tsx:1 must contain exactly one CommandList (found 0)',
    ])
    expect(commandDialogViolations([{ path: 'c.tsx', source: twoInputs }]).violations).toEqual([
      'c.tsx:1 must contain exactly one CommandInput (found 2)',
    ])
  })
})

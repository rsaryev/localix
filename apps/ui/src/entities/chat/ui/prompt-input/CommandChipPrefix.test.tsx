import { describe, expect, test } from 'bun:test'
import { Search } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComposerCommands } from './useComposerCommands'
import { CommandChipPrefix } from './CommandChipPrefix'

describe('CommandChipPrefix presentation', () => {
  test('uses one command glyph and flat argument metadata', () => {
    const slash = {
      detected: {
        command: {
          trigger: 'plugin',
          icon: <Search className="size-3" />,
        },
      },
      clearCommand: () => {},
    } as unknown as ComposerCommands['slash']
    const slashArgs = {
      chips: [
        {
          spec: { name: 'source' },
          option: { label: 'owner/review' },
        },
      ],
      clearArgFrom: () => {},
    } as unknown as ComposerCommands['slashArgs']

    const html = renderToStaticMarkup(<CommandChipPrefix slash={slash} slashArgs={slashArgs} />)

    expect(html).toContain('lucide-square-terminal')
    expect(html).not.toContain('lucide-search')
    expect(html).toContain('/plugin')
    expect(html).toContain('owner/review')
    expect(html).not.toContain('rounded-full')
    expect(html).not.toContain('bg-surface-raised')
    expect(html).not.toContain('border-control-border')
  })
})

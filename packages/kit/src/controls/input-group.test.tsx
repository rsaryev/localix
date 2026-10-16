import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Search, X } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './input-group'

describe('InputGroup workbench geometry', () => {
  test('keeps the field and inline actions on the shared physical scale', () => {
    const html = renderToStaticMarkup(
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput aria-label="Filter" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="xs" aria-label="Clear">
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    )

    expect(html).toContain('h-[var(--chrome-control-md)]')
    expect(html).toContain('h-[var(--chrome-control-xs)]')
    expect(html).toContain('aria-label="Filter"')
    expect(html).toContain('aria-label="Clear"')
  })
})

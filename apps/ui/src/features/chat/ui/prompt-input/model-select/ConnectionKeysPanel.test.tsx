import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConnectionKeyRow } from './ConnectionKeysPanel'

describe('ConnectionKeyRow presentation', () => {
  test('renders a saved key as a flat registry row', () => {
    const html = renderToStaticMarkup(
      <ConnectionKeyRow
        connectionId="connection-1"
        keyEntry={{
          id: 'key-1',
          label: 'Production',
          maskedKey: 'sk-••••1234',
          priority: 0,
          enabled: true,
        }}
        canRemove
        onRemoveKey={async () => {}}
        onUpdateKey={async () => {}}
      />,
    )

    expect(html).toContain('Production')
    expect(html).toContain('sm:opacity-0')
    expect(html).not.toContain('bg-surface-raised')
    expect(html).not.toContain('border-control-border')
    expect(html).not.toContain('rounded-lg')
  })
})

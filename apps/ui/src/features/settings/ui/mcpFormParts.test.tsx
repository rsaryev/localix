import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EnvEditor } from './mcpFormParts'

describe('MCP key/value editor', () => {
  test('names each key and value while sharing standard control geometry', () => {
    const html = renderToStaticMarkup(
      <EnvEditor label="Headers" entries={{ Authorization: 'Bearer token' }} onChange={() => {}} />,
    )

    expect(html).toContain('<fieldset')
    expect(html).toContain('<legend')
    expect(html).toContain('aria-label="Headers key 1"')
    expect(html).toContain('aria-label="Headers value 1"')
    expect(html).toContain('aria-label="Remove headers row"')
    expect(html).toContain('data-slot="input"')
    expect(html).toContain('h-[var(--chrome-control-xl)]')
    expect(html).toContain('data-slot="button"')
  })

  test('locks the whole editor through native fieldset semantics', () => {
    const html = renderToStaticMarkup(
      <EnvEditor label="Environment variables" entries={{}} onChange={() => {}} disabled />,
    )

    expect(html).toContain('<fieldset disabled=""')
  })
})

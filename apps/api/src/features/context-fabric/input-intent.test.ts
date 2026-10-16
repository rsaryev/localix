import { describe, expect, test } from 'bun:test'
import { buildInputIntentContext, renderInputIntentContext } from './input-intent'

describe('InputIntentContext', () => {
  test('keeps raw intent and adds bounded labels without expanding content', () => {
    const input = buildInputIntentContext('Review @resource:localix://resource/git/p/status', [
      { kind: 'text', name: 'schema.sql', text: 'SECRET', size: 6 },
    ])
    const rendered = renderInputIntentContext(input)
    expect(rendered).toContain('Review @resource:localix://resource/git/p/status')
    expect(rendered).toContain('schema.sql')
    expect(rendered).not.toContain('SECRET')
  })
})

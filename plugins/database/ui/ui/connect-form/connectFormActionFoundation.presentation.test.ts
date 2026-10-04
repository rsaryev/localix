import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('database connection action foundation', () => {
  test.each(['./ConnectionInput.tsx', './FormFooter.tsx'])(
    '%s delegates bounded actions to Button',
    (name) => {
      const source = read(name)

      expect(source).not.toContain('<button')
      expect(source).toContain('<Button')
    },
  )

  test('keeps the inline clear command text-shaped', () => {
    const source = read('./ConnectionInput.tsx')

    expect(source).toContain('<TextAction')
    expect(source).toContain('Clear')
  })

  test('announces asynchronous state and marks inline action icons as decorative', () => {
    const footer = read('./FormFooter.tsx')
    const fields = read('./ConnectionInput.tsx')

    expect(footer).toContain('aria-busy={f.testing || undefined}')
    expect(footer).toContain('aria-busy={f.busy || undefined}')
    expect(footer).toContain('aria-live="polite"')
    expect(fields).toContain('aria-live="polite"')
    expect(footer.match(/data-icon="inline-start" aria-hidden/g)).toHaveLength(7)
    expect(fields.match(/data-icon="inline-start" aria-hidden/g)).toHaveLength(3)
  })
})

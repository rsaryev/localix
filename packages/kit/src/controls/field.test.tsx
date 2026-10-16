import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Field } from './field'
import { Input } from './input'
import { Select } from './select'
import { Textarea } from './textarea'

describe('Field semantics', () => {
  test('owns label, help, error, required, invalid and disabled state for an input', () => {
    const html = renderToStaticMarkup(
      <Field
        label="Repository"
        description="Absolute path or owner/repo"
        error="Repository is required"
        required
        disabled
      >
        <Input size="xl" />
      </Field>,
    )

    expect(html).toContain('data-slot="field"')
    expect(html).toMatch(/<label[^>]+for="([^"]+)"/)
    expect(html).toMatch(/<input[^>]+\sid="([^"]+)"/)
    const labelFor = html.match(/<label[^>]+for="([^"]+)"/)?.[1]
    const inputId = html.match(/<input[^>]+\sid="([^"]+)"/)?.[1]
    expect(labelFor).toBe(inputId)
    expect(html).toContain('aria-describedby=')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-required="true"')
    expect(html).toContain('required=""')
    expect(html).toContain('disabled=""')
    expect(html).toContain('role="alert"')
  })

  test('passes the same identity and description contract to popup choices', () => {
    const html = renderToStaticMarkup(
      <Field label="Scope" description="Where this capability is available">
        <Select
          value="global"
          onValueChange={() => {}}
          options={[{ value: 'global', label: 'Global' }]}
        />
      </Field>,
    )

    const labelFor = html.match(/<label[^>]+for="([^"]+)"/)?.[1]
    const buttonId = html.match(/<button[^>]+\sid="([^"]+)"/)?.[1]
    expect(labelFor).toBe(buttonId)
    expect(html).toContain('aria-labelledby=')
    expect(html).toContain('aria-describedby=')
    expect(html).toContain('role="combobox"')
    expect(html).toContain('aria-autocomplete="none"')
  })

  test('keeps explicit accessible naming while still merging field help', () => {
    const html = renderToStaticMarkup(
      <Field label="Instructions" description="Markdown supported">
        <Textarea aria-label="Custom instructions" aria-describedby="external-help" />
      </Field>,
    )

    expect(html).toContain('aria-label="Custom instructions"')
    expect(html).not.toContain('aria-labelledby=')
    expect(html).toMatch(/aria-describedby="[^"]+ external-help"/)
  })

  test('supports a stable control identity without breaking label association', () => {
    const html = renderToStaticMarkup(
      <Field controlId="plugin-source" label="Source">
        <Input />
      </Field>,
    )

    expect(html).toContain('for="plugin-source"')
    expect(html).toContain('id="plugin-source"')
    expect(html).toContain('id="plugin-source-label"')
  })
})

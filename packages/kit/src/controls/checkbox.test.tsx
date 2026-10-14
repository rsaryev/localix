import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Checkbox } from './checkbox'
import { Field } from './field'

describe('Checkbox contract', () => {
  test('owns stable geometry and every shared visual state', () => {
    const html = renderToStaticMarkup(<Checkbox aria-label="Include generated files" />)

    expect(html).toContain('data-slot="checkbox"')
    expect(html).toContain('appearance-none')
    expect(html).toContain('size-4')
    expect(html).toContain('checked:bg-foreground')
    expect(html).toContain('indeterminate:before:scale-100')
    expect(html).toContain('focus-visible:ring-control-border-focus')
    expect(html).toContain('aria-invalid:border-destructive')
    expect(html).toContain('forced-colors:appearance-auto')
    expect(html).toContain('motion-reduce:transition-none')
  })

  test('inherits native identity, validation, help, and disabled state from Field', () => {
    const html = renderToStaticMarkup(
      <Field
        controlId="generated-files"
        label="Include generated files"
        description="Adds ignored build output"
        error="Confirm this choice"
        required
        disabled
      >
        <Checkbox />
      </Field>,
    )

    expect(html).toContain('for="generated-files"')
    expect(html).toContain('id="generated-files"')
    expect(html).toContain('aria-labelledby="generated-files-label"')
    expect(html).toContain('aria-describedby="generated-files-error generated-files-description"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-required="true"')
    expect(html).toContain('required=""')
    expect(html).toContain('disabled=""')
  })

  test('allows local density overrides without exposing the native type', () => {
    const html = renderToStaticMarkup(
      <Checkbox aria-label="Compact option" className="size-3 justify-self-center" />,
    )

    expect(html).toContain('type="checkbox"')
    expect(html).toContain('size-3')
    expect(html).not.toContain('size-4')
  })
})

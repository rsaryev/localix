import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Field } from './field'
import { Switch } from './switch'

describe('Switch contract', () => {
  test('owns stable geometry and every shared visual state', () => {
    const html = renderToStaticMarkup(
      <Switch checked onChange={() => {}} aria-label="Enable telemetry" />,
    )

    expect(html).toContain('data-slot="switch"')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('appearance-none')
    expect(html).toContain('h-5')
    expect(html).toContain('w-9')
    expect(html).toContain('checked:bg-foreground')
    expect(html).toContain('checked:after:translate-x-4')
    expect(html).toContain('focus-visible:ring-control-border-focus')
    expect(html).toContain('aria-invalid:border-destructive')
    expect(html).toContain('forced-colors:appearance-auto')
    expect(html).toContain('motion-reduce:after:transition-none')
  })

  test('inherits identity, validation, and disabled state from Field', () => {
    const html = renderToStaticMarkup(
      <Field
        controlId="background-sync"
        label="Background sync"
        description="Keeps the workspace current"
        error="Confirm this choice"
        required
        disabled
      >
        <Switch checked={false} onChange={() => {}} />
      </Field>,
    )

    expect(html).toContain('for="background-sync"')
    expect(html).toContain('id="background-sync"')
    expect(html).toContain('aria-labelledby="background-sync-label"')
    expect(html).toContain('aria-describedby="background-sync-error background-sync-description"')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('aria-required="true"')
    expect(html).toContain('required=""')
    expect(html).toContain('disabled=""')
  })

  test('offers a compact geometry without a second implementation', () => {
    const html = renderToStaticMarkup(
      <Switch checked={false} size="sm" onChange={() => {}} aria-label="Compact setting" />,
    )

    expect(html).toContain('data-size="sm"')
    expect(html).toContain('h-4')
    expect(html).toContain('w-7')
    expect(html).toContain('checked:after:translate-x-3')
    expect(html).not.toContain('w-9')
  })
})

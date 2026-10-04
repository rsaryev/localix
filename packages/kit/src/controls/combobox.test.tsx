import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Combobox, type ComboboxOption } from './combobox'

const options: ComboboxOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo', hint: 'current' },
]

describe('Combobox', () => {
  test('trigger renders the selected label as a search-dialog disclosure', () => {
    const html = renderToStaticMarkup(
      <Combobox value="b" onValueChange={() => {}} options={options} aria-label="Namespace" />,
    )
    expect(html).toContain('Bravo')
    expect(html).toContain('aria-label="Namespace"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('role="combobox"')
    expect(html).toContain('h-[var(--chrome-control-lg)]')
    expect(html).toContain('<svg') // chevron affordance
  })

  test('trigger shows the placeholder when unset', () => {
    const html = renderToStaticMarkup(
      <Combobox
        value=""
        onValueChange={() => {}}
        options={options}
        placeholder="Select namespace…"
      />,
    )
    expect(html).toContain('Select namespace…')
  })

  test('disabled trigger is disabled', () => {
    const html = renderToStaticMarkup(
      <Combobox
        value=""
        onValueChange={() => {}}
        options={[]}
        disabled
        placeholder="No namespaces"
      />,
    )
    expect(html).toContain('disabled')
    expect(html).toContain('No namespaces')
  })

  test('settings density shares the large control token and invalid-state recipe', () => {
    const html = renderToStaticMarkup(
      <Combobox
        value="b"
        onValueChange={() => {}}
        options={options}
        size="xl"
        aria-invalid="true"
      />,
    )
    expect(html).toContain('h-[var(--chrome-control-xl)]')
    expect(html).toContain('aria-invalid:border-destructive')
    expect(html).toContain('aria-invalid="true"')
  })
})

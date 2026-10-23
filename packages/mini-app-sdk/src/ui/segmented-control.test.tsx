import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Segmented, SegmentedRadioGroup } from './segmented-control'

describe('SegmentedRadioGroup contract', () => {
  test('renders one named native radio group with shared visual states', () => {
    const html = renderToStaticMarkup(
      <SegmentedRadioGroup
        name="order"
        value="standard"
        onValueChange={() => {}}
        aria-label="Table order"
        options={[
          { value: 'standard', label: 'Standard' },
          { value: 'signal', label: 'By signal' },
        ]}
      />,
    )

    expect(html).toContain('role="radiogroup"')
    expect(html.match(/type="radio"/g)).toHaveLength(2)
    expect(html.match(/name="order"/g)).toHaveLength(2)
    expect(html).toContain('checked="" value="standard"')
    expect(html).toContain('data-state="checked"')
    expect(html).toContain('peer-focus-visible:ring-control-border-focus')
    expect(html).toContain('forced-colors:not-sr-only')
    expect(html).toContain('forced-colors:bg-transparent')
    expect(html).not.toContain('forced-colors:hidden')
  })

  test('owns compact outlined geometry without consumer-owned radio styling', () => {
    const html = renderToStaticMarkup(
      <SegmentedRadioGroup
        size="sm"
        variant="outlined"
        value="auto"
        onValueChange={() => {}}
        aria-label="Strategy"
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'trend', label: 'Trend' },
        ]}
      />,
    )

    expect(html).toContain('data-size="sm"')
    // Track and item on the host control scale, not the raw h-6/h-5 pair this
    // used to assert — the physical size is unchanged (24/20px), but it is now
    // spelled with the same tokens the surrounding Buttons and Inputs use.
    expect(html).toContain('h-[var(--chrome-control-sm)]')
    expect(html).toContain('h-[var(--chrome-control-xs)]')
    expect(html).toContain('ring-inset')
    expect(html).toContain('ring-border/60')
    expect(html).toContain('bg-surface-active')
  })

  test('propagates disabled and required state to every native option', () => {
    const html = renderToStaticMarkup(
      <SegmentedRadioGroup
        disabled
        required
        value="one"
        onValueChange={() => {}}
        aria-label="Choice"
        options={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
      />,
    )

    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('aria-required="true"')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html.match(/required=""/g)).toHaveLength(2)
  })

  test('routes the compact typed-choice facade through the native radio contract', () => {
    const html = renderToStaticMarkup(
      <Segmented
        aria-label="Time range"
        value="week"
        onChange={() => {}}
        options={[
          { id: 'day', label: '24h' },
          { id: 'week', label: '7d' },
        ]}
      />,
    )

    expect(html.match(/type="radio"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Time range"')
    expect(html).not.toContain('aria-pressed')
  })
})

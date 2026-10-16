import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  PopoverAction,
  PopoverBody,
  PopoverDescription,
  PopoverFooter,
  PopoverHeader,
  PopoverTitle,
} from './popover'

describe('structured popover regions', () => {
  test('pins named header actions around one scroll-owning body', () => {
    const html = renderToStaticMarkup(
      <>
        <PopoverHeader
          actionsLabel="Context actions"
          actions={<button type="button">Clear</button>}
        >
          <PopoverTitle>Attached context</PopoverTitle>
          <PopoverDescription>Ordered for this message</PopoverDescription>
        </PopoverHeader>
        <PopoverBody>Items</PopoverBody>
        <PopoverFooter role="group" aria-label="Footer actions">
          <button type="button">Apply</button>
        </PopoverFooter>
      </>,
    )

    expect(html).toContain('<header')
    expect(html).toContain('data-slot="popover-header"')
    expect(html).toContain('border-b border-control-border/60')
    expect(html).toContain('flex-wrap')
    expect(html).toContain('basis-40')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Context actions"')
    expect(html).toContain('justify-end')
    expect(html).toContain('<h2 data-slot="popover-title"')
    expect(html).toContain('data-slot="popover-description"')
    expect(html).toContain('data-slot="popover-body"')
    expect(html).toContain('min-h-0 flex-1')
    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('overscroll-contain')
    expect(html).toContain('data-slot="popover-footer"')
    expect(html).toContain('shrink-0 border-t')
  })

  test('keeps lifecycle actions on one native-button geometry with an explicit danger tone', () => {
    const html = renderToStaticMarkup(
      <PopoverFooter role="group" aria-label="Lifecycle actions">
        <PopoverAction>Retry</PopoverAction>
        <PopoverAction tone="danger" aria-busy="true">
          Remove
        </PopoverAction>
      </PopoverFooter>,
    )

    expect(html.match(/data-slot="popover-action"/g)).toHaveLength(2)
    expect(html).toContain('<button')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-size="sm"')
    expect(html).toContain('aria-label="Lifecycle actions"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('text-status-error')
  })
})

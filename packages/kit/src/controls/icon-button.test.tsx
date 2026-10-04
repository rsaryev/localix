import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { X } from 'lucide-react'
import { IconButton } from './icon-button'
import { Button } from './button'

describe('IconButton', () => {
  // One name, one measure — each row is the SAME token `Button` gives that
  // name (`buttonVariants` size `sm` is also `--chrome-control-sm`). This table
  // used to sit one tier tighter (`sm`→xs, `md`→sm, `lg`→md), which is what
  // made `size="sm"` mean 24px on a Button and 20px on an IconButton.
  test.each([
    ['xs', '--chrome-control-xs'],
    ['sm', '--chrome-control-sm'],
    ['md', '--chrome-control-md'],
    ['lg', '--chrome-control-lg'],
    ['xl', '--chrome-control-xl'],
    ['touch', '--chrome-control-touch'],
  ] as const)('maps %s to a stable semantic control size', (size, token) => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="Dismiss" size={size}>
        <X />
      </IconButton>,
    )

    expect(html).toContain(`size-[var(${token})]`)
    expect(html).toContain('aria-label="Dismiss"')
    expect(html).toContain('type="button"')
    expect(html).toContain('aria-hidden="true"')
  })

  test('passes `recommended` through to Button, so an icon action can be the next step too', () => {
    const marked = renderToStaticMarkup(
      <IconButton aria-label="Retry" recommended>
        <X />
      </IconButton>,
    )
    expect(marked).toContain('lx-border-beam')
    expect(
      renderToStaticMarkup(
        <IconButton aria-label="Retry">
          <X />
        </IconButton>,
      ),
    ).not.toContain('lx-border-beam')
  })

  // The rule the ladder exists to keep: a size NAME is a physical measure, and
  // it is the same measure on the text button and the square one. Before this,
  // equal heights in a shared row needed UNEQUAL prop words, and most rows where a
  // Button and an IconButton are siblings ended up 4–8px apart because authors
  // guessed the offset wrong.
  // `default` is Button's name for the tier IconButton calls `md`.
  test.each([
    ['xs', 'xs'],
    ['sm', 'sm'],
    ['md', 'default'],
    ['lg', 'lg'],
    ['xl', 'xl'],
  ] as const)('renders %s at the same measure Button does', (iconSize, buttonSize) => {
    const measure = (html: string) => html.match(/--chrome-control-[a-z]+/)?.[0]

    const icon = measure(
      renderToStaticMarkup(
        <IconButton aria-label="Dismiss" size={iconSize}>
          <X />
        </IconButton>,
      ),
    )
    const text = measure(renderToStaticMarkup(<Button size={buttonSize}>Label</Button>))

    expect(icon).toBeDefined()
    expect(icon).toBe(text)
  })

  // A bare pair must line up too — the default is part of the contract, not an
  // exemption from it. IconButton defaulted to 24px against Button's 28px.
  test('defaults to the same measure a bare Button defaults to', () => {
    const measure = (html: string) => html.match(/--chrome-control-[a-z]+/)?.[0]

    expect(
      measure(
        renderToStaticMarkup(
          <IconButton aria-label="Dismiss">
            <X />
          </IconButton>,
        ),
      ),
    ).toBe(measure(renderToStaticMarkup(<Button>Label</Button>)))
  })

  test('adapts idle, open, and pressed feedback to sidebar chrome', () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="Search chats" surface="sidebar" aria-pressed="true">
        <X />
      </IconButton>,
    )

    expect(html).toContain('data-surface="sidebar"')
    expect(html).toContain('text-sidebar-foreground/60')
    expect(html).toContain('hover:bg-sidebar-accent')
    expect(html).toContain('aria-expanded:bg-sidebar-accent')
    expect(html).toContain('aria-pressed:bg-sidebar-accent')
    expect(html).toContain('aria-pressed="true"')
  })

  test('exposes content-surface pressed feedback for compact toggles', () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="Match case" aria-pressed="true">
        Aa
      </IconButton>,
    )

    expect(html).toContain('data-surface="content"')
    expect(html).toContain('aria-pressed:bg-surface-active')
    expect(html).toContain('aria-pressed:text-foreground')
    expect(html).toContain('aria-pressed="true"')
  })

  test('keeps destructive sidebar actions on the same control geometry', () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="Delete" surface="sidebar" tone="danger" size="lg">
        <X />
      </IconButton>,
    )

    // `lg` is 32px, the same measure Button's `lg` renders. It resolved to the
    // 28px `--chrome-control-md` while IconButton sat one tier below its labels.
    expect(html).toContain('size-[var(--chrome-control-lg)]')
    expect(html).toContain('text-destructive')
    expect(html).toContain('hover:bg-destructive/15')
  })

  test('provides one solid primary treatment on the same icon-action contract', () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="Send" emphasis="solid" size="xl">
        <X />
      </IconButton>,
    )

    expect(html).toContain('data-emphasis="solid"')
    expect(html).toContain('data-variant="mono"')
    // `xl` is 36px, the same measure Button's `xl` renders (was 32px).
    expect(html).toContain('size-[var(--chrome-control-xl)]')
    expect(html).toContain('bg-foreground')
    expect(html).toContain('text-background')
    expect(html).not.toContain('text-text-faint')
  })

  test('keeps a disabled action tooltip reachable without enabling the action', () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="Voice input" tooltip="Voice input unavailable" disabled>
        <X />
      </IconButton>,
    )

    expect(html).toContain('data-disabled-tooltip-anchor="true"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="Voice input"')
    expect(html).toContain('disabled=""')
  })

  test('does not add a focus wrapper around an enabled tooltip action', () => {
    const html = renderToStaticMarkup(
      <IconButton aria-label="Attach" tooltip="Attach file">
        <X />
      </IconButton>,
    )

    expect(html).not.toContain('data-disabled-tooltip-anchor')
    expect(html).not.toContain('tabindex="0"')
    expect(html).not.toContain('title=')
  })
})

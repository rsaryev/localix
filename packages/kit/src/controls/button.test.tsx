import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from './button'

describe('Button', () => {
  test('is safe inside a form unless the caller explicitly owns submission', () => {
    const action = renderToStaticMarkup(<Button>Refresh</Button>)
    const submit = renderToStaticMarkup(<Button type="submit">Save</Button>)

    expect(action).toContain('type="button"')
    expect(submit).toContain('type="submit"')
  })

  test('leaves element semantics to an asChild consumer', () => {
    const html = renderToStaticMarkup(
      <Button asChild variant="link">
        <a href="/settings">Settings</a>
      </Button>,
    )

    expect(html).toContain('<a href="/settings"')
    expect(html).not.toContain('type=')
    expect(html).toContain('data-slot="button"')
  })

  test('shares focus, disabled, and reduced-motion feedback across variants', () => {
    const html = renderToStaticMarkup(
      <Button variant="outline" disabled>
        Retry
      </Button>,
    )

    expect(html).toContain('data-variant="outline"')
    expect(html).toContain('focus-visible:ring-control-border-focus')
    expect(html).toContain('disabled:pointer-events-none')
    expect(html).toContain('motion-reduce:active:scale-100')
    expect(html).toContain('disabled=""')
  })

  test('a recommended button carries the travelling accent; others, disabled ones and asChild do not', () => {
    const beam = 'class="lx-border-beam"'
    const marked = renderToStaticMarkup(<Button recommended>Approve</Button>)
    expect(marked).toContain(beam)
    expect(marked).toContain('data-recommended="true"')
    expect(marked).toContain('data-variant="focus"')
    expect(marked).toContain('data-intensity="2"')
    // The beam's containing block, or it would paint around the nearest positioned ancestor.
    expect(marked).toMatch(/<button[^>]*class="[^"]*\brelative\b/)

    // Positive control for the absent cases: the same button without the flag has no beam.
    expect(renderToStaticMarkup(<Button>Approve</Button>)).not.toContain('lx-border-beam')
    expect(
      renderToStaticMarkup(
        <Button recommended disabled>
          Approve
        </Button>,
      ),
    ).not.toContain('lx-border-beam')
    const slotted = renderToStaticMarkup(
      <Button asChild recommended>
        <a href="/plan">Open</a>
      </Button>,
    )
    expect(slotted).toContain('<a href="/plan"')
    expect(slotted).not.toContain('lx-border-beam')
  })

  test('on a filled variant the beam is the fill kind; on a ground one it is not', () => {
    // The plan's Approve is `mono`: a ground beam's bright stop is the fill's own colour, so it
    // showed nothing there. The filled beam leads with the accent (`effects.css`).
    for (const variant of ['mono', 'default', 'destructive-solid'] as const)
      expect(
        renderToStaticMarkup(
          <Button variant={variant} recommended>
            Approve
          </Button>,
        ),
      ).toContain('data-surface="fill"')
    for (const variant of ['ghost', 'outline', 'field'] as const)
      expect(
        renderToStaticMarkup(
          <Button variant={variant} recommended>
            Approve
          </Button>,
        ),
      ).not.toContain('data-surface')
  })

  test('the accent is decorative: hidden from assistive tech, the name and role unchanged', () => {
    const plain = renderToStaticMarkup(<Button aria-label="Approve plan">Approve</Button>)
    const marked = renderToStaticMarkup(
      <Button aria-label="Approve plan" recommended>
        Approve
      </Button>,
    )
    expect(marked).toMatch(/<span aria-hidden="true"[^>]*class="lx-border-beam"/)
    // Strip the decorative span: what remains is the plain button plus its marker attributes.
    const withoutBeam = marked
      // The beam and its two empty ring layers.
      .replace(/<span aria-hidden="true"[^>]*>(?:<span[^>]*><\/span>)*<\/span>/, '')
      .replace(' data-recommended="true"', '')
      .replace(' relative', '')
    expect(withoutBeam).toBe(plain)
  })

  test('the field variant rests on the field veil, never the opaque secondary grey', () => {
    // On a tinted band (`bg-status-*/10`) an opaque fill reads as a black chip; the veil does not.
    const html = renderToStaticMarkup(<Button variant="field">Continue</Button>)
    expect(html).toContain('data-variant="field"')
    expect(html).toContain('bg-field-fill')
    expect(html).toContain('border-control-border')
    expect(html).not.toContain('bg-secondary')
  })
})

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownRendererImpl from './MarkdownRendererImpl'

const render = (markdown: string) =>
  renderToStaticMarkup(<MarkdownRendererImpl>{markdown}</MarkdownRendererImpl>)

const RECOVERY = [
  '> [!STEPS] Recovery after surgery',
  '> 1. **First 24 hours**',
  '>    *Day 1*',
  '>    Coming out of anaesthesia; keep her warm and still.',
  '> 2. **Activity returns**',
  '>    *Days 2–3*',
  '>    Appetite comes back; keep walks short.',
].join('\n')

describe('steps (`> [!STEPS]` over a list)', () => {
  test('the quote gives way to a timeline list, its marker gone and its title above', () => {
    const html = render(RECOVERY)
    expect(html).toContain('<ol class="lx-steps">')
    expect(html).not.toContain('<blockquote')
    expect(html).not.toContain('[!STEPS]')
    expect(html).toContain('<p class="lx-steps-title">Recovery after surgery</p>')
  })

  test('each step splits into a head — title and quiet "when" — and its own text', () => {
    const html = render(RECOVERY)
    expect(html).toContain(
      '<div class="lx-step-head"><span class="lx-step-title">First 24 hours</span><span class="lx-step-meta">Day 1</span></div>',
    )
    expect(html).toContain(
      '<div class="lx-step-body">Coming out of anaesthesia; keep her warm and still.</div>',
    )
  })

  test('the "when" may sit on the title line after a dash, and may be absent', () => {
    const html = render(
      ['> [!STEPS]', '> - **Install** — *5 min*', '>   Run the installer.', '> - **Verify**'].join(
        '\n',
      ),
    )
    expect(html).toContain('<ul class="lx-steps">')
    expect(html).toContain('<span class="lx-step-meta">5 min</span>')
    expect(html).toContain('<div class="lx-step-body">Run the installer.</div>')
    expect(html).toContain(
      '<div class="lx-step-head"><span class="lx-step-title">Verify</span></div>',
    )
    expect(html).not.toContain('lx-steps-title')
  })

  test('an ordinary bold-led list is NOT a timeline — only the marker makes one', () => {
    const html = render('1. **Pros:** fast\n2. **Cons:** costly')
    expect(html).not.toContain('lx-steps')
    expect(html).toContain('<strong>Pros:</strong>')
  })

  test('a marker with no list under it stays the quote it was written as', () => {
    const html = render('> [!STEPS]\n> Just a sentence.')
    expect(html).not.toContain('lx-steps')
    expect(html).toContain('<blockquote')
  })
})

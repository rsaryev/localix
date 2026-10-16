import { describe, expect, test } from 'bun:test'

import { buildPreviewCommentsMessage, type VfComment } from './payload'
import type { VfCapture } from '../protocol/index'

function capture(over: Partial<VfCapture> = {}): VfCapture {
  return {
    selector: 'button.cta',
    summary: 'button "Sign up"',
    domPath: 'header.nav > button.cta',
    classes: 'cta',
    role: 'button',
    text: 'Sign up',
    componentPath: 'Sidebar › SignupCta',
    html: '<button aria-label="Sign up" class="cta">',
    computedStyle: 'background-color: #4c8bf5',
    rect: { x: 10, y: 20, width: 80, height: 32 },
    kind: 'element',
    ...over,
  }
}

describe('buildPreviewCommentsMessage', () => {
  test('renders clean Markdown — header, neutral lead, no XML wrapper, no instructions', () => {
    const items: VfComment[] = [{ capture: capture(), note: 'make this bigger' }]
    const msg = buildPreviewCommentsMessage(items, { url: 'http://localhost:9/index.html' })
    expect(msg).toContain('**Preview feedback** — `http://localhost:9/index.html`')
    expect(msg).toContain('left comments on these elements:')
    expect(msg).toContain('**1. button "Sign up"**')
    expect(msg).toContain('> make this bigger') // comment as a blockquote
    expect(msg).toContain('- component: `Sidebar › SignupCta`')
    expect(msg).toContain('- html: `<button aria-label="Sign up" class="cta">`')
    expect(msg).toContain('- selector: `button.cta`')
    // neutral framing + no special-casing markers
    expect(msg).not.toContain('Change ONLY')
    expect(msg).not.toContain('<preview-comments')
    // identity before the weak selector
    expect(msg.indexOf('component:')).toBeLessThan(msg.indexOf('selector:'))
  })

  test('prefers a resolved source location over the served-file fallback', () => {
    const withSource = capture({
      source: {
        file: 'src/Cta.tsx',
        line: 42,
        component: 'Cta',
        method: 'react-fiber',
        confidence: 'high',
      },
    })
    const msg = buildPreviewCommentsMessage([{ capture: withSource, note: 'tweak' }], {
      servedFile: 'index.html',
    })
    expect(msg).toContain('- source: `src/Cta.tsx:42 (<Cta>)` _[react-fiber/high]_')
    expect(msg).not.toContain('served file')
  })

  test('falls back to the served file when no source resolved', () => {
    const msg = buildPreviewCommentsMessage(
      [{ capture: capture({ source: undefined }), note: 'x' }],
      { servedFile: 'index.html' },
    )
    expect(msg).toContain('- source: `index.html` _(served file; not resolved to a line)_')
  })

  test('emits element position + size, in px', () => {
    const msg = buildPreviewCommentsMessage([{ capture: capture(), note: 'too small' }], {})
    expect(msg).toContain('- position: x:10, y:20 · 80×32px')
  })

  test('includes the viewport size when valid, omits it when zero', () => {
    const withVp = buildPreviewCommentsMessage([{ capture: capture(), note: 'x' }], {
      viewport: { width: 1200.4, height: 800 },
    })
    expect(withVp).toContain('viewport 1200×800')
    const noVp = buildPreviewCommentsMessage([{ capture: capture(), note: 'x' }], {
      viewport: { width: 0, height: 0 },
    })
    expect(noVp).not.toContain('viewport')
  })

  test('keeps multi-line notes as one blockquote (every line prefixed)', () => {
    const msg = buildPreviewCommentsMessage(
      [{ capture: capture(), note: 'line one\nline two' }],
      {},
    )
    expect(msg).toContain('> line one\n> line two')
  })

  test('labels non-element picks with their kind + member count + lists members', () => {
    const multi = capture({ kind: 'multi', members: ['a.one', 'a.two'] })
    const msg = buildPreviewCommentsMessage([{ capture: multi, note: 'align these' }], {})
    expect(msg).toContain('- kind: multi (2 elements)')
    expect(msg).toContain('- members: a.one | a.two')
  })

  test('redacts secrets and strips URL tokens in the rendered message (host re-clamp)', () => {
    const leaky = capture({
      html: '<a href="https://x.com/cb?access_token=ghp_AAAAAAAAAAAAAAAAAAAAAAAA">',
      text: 'token=abcdef123456',
    })
    const msg = buildPreviewCommentsMessage([{ capture: leaky, note: 'fix link' }], {})
    expect(msg).not.toContain('ghp_')
    expect(msg).not.toContain('access_token')
    expect(msg).not.toContain('abcdef123456')
    expect(msg).toContain('[redacted]')
  })

  test('strips query/hash from the context URL', () => {
    const msg = buildPreviewCommentsMessage([{ capture: capture(), note: 'x' }], {
      url: 'https://app.example.com/page?session=secretvalue#frag',
    })
    expect(msg).toContain('`https://app.example.com/page`')
    expect(msg).not.toContain('session=secretvalue')
  })
})

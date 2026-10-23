import { describe, expect, test } from 'bun:test'

import { readerExternalLink, readerLinkGesture, readerLinkTarget } from './link'

describe('reader link policy', () => {
  test('accepts only host-routable browser, mail, and telephone links', () => {
    expect(readerExternalLink(' https://example.com/reference ')).toEqual({
      kind: 'external',
      href: 'https://example.com/reference',
      newTab: true,
    })
    expect(readerExternalLink('mailto:reader@example.com')).toMatchObject({
      kind: 'external',
      newTab: false,
    })
    expect(readerExternalLink('tel:+35799123456')).toMatchObject({
      kind: 'external',
      newTab: false,
    })
    expect(readerExternalLink('javascript:alert(1)')).toBeNull()
    expect(readerExternalLink('file:///tmp/book')).toBeNull()
    expect(readerExternalLink('https:')).toBeNull()
    expect(readerExternalLink('tel:')).toBeNull()
  })

  test('resolves bounded internal destinations and ignores spoofed routing on external links', () => {
    expect(
      readerLinkTarget({ href: '#details', chapter: '4', fragment: 'chapter%20details' }, 2),
    ).toEqual({ kind: 'internal', chapter: 4, fragment: 'chapter%20details' })
    expect(readerLinkTarget({ href: '#local', chapter: 'invalid' }, 2)).toEqual({
      kind: 'internal',
      chapter: 2,
      fragment: 'local',
    })
    expect(readerLinkTarget({ href: '#local', chapter: '' }, 2)).toMatchObject({ chapter: 2 })
    expect(readerLinkTarget({ href: `#${'x'.repeat(257)}` }, 2)).toEqual({ kind: 'inert' })
    expect(readerLinkTarget({ href: '#line\nbreak' }, 2)).toEqual({ kind: 'inert' })
    expect(
      readerLinkTarget({ href: 'https://example.com', chapter: '99', fragment: 'spoofed' }, 2),
    ).toMatchObject({ kind: 'external', href: 'https://example.com' })
    expect(readerLinkTarget({ href: 'chapter.xhtml' }, 2)).toEqual({ kind: 'inert' })
  })

  test('does not repeat child-owned activation and distinguishes primary from middle click', () => {
    expect(readerLinkGesture({ defaultPrevented: true, button: 0 })).toBeNull()
    expect(readerLinkGesture({ defaultPrevented: true, button: 1 })).toBeNull()
    expect(readerLinkGesture({ defaultPrevented: false, button: 0 })).toBe('primary')
    expect(readerLinkGesture({ defaultPrevented: false, button: 1 })).toBe('auxiliary')
    expect(readerLinkGesture({ defaultPrevented: false, button: 2 })).toBeNull()
  })
})

import { describe, expect, test } from 'bun:test'
import { classifyMarkdownLink, markdownUrlTransform } from './markdownLink'

describe('classifyMarkdownLink', () => {
  test('preserves only the Store page of one agent for the registered UI resolver', () => {
    const href = 'localix://ui/work-item/store?kind=agent&id=native%3Aqa'
    expect(classifyMarkdownLink(href)).toEqual({ kind: 'agent-profile', href })
    expect(markdownUrlTransform(href, 'href')).toBe(href)
    // Anything but a lone agent id is not an agent link; the Store resolver judges it as the
    // ordinary view link it is.
    for (const other of [
      'localix://ui/work-item/store?kind=agent&id=a&id=b',
      'localix://ui/work-item/store?kind=agent&id=a&unknown=1',
      'localix://ui/work-item/store?kind=plugin&id=a',
      'localix://ui/work-item/store?kind=agent',
      'localix://ui/work-item/store?kind=agent&id=%00',
    ])
      expect(classifyMarkdownLink(other).kind, other).not.toBe('agent-profile')
    expect(markdownUrlTransform('localix://ui/action/command/agent.delete', 'href')).toBeUndefined()
  })
  test('routes canonical and provider-compatible local file links in-app', () => {
    const plan = '\u041f\u043b\u0430\u043d'
    expect(
      classifyMarkdownLink('localix://ui/work-item/file?path=%2FUsers%2Fme%2Freport.pdf&line=7'),
    ).toEqual({ kind: 'file', path: '/Users/me/report.pdf', line: 7 })
    expect(classifyMarkdownLink('sandbox:/Users/me/%D0%9F%D0%BB%D0%B0%D0%BD.pdf')).toEqual({
      kind: 'file',
      path: `/Users/me/${plan}.pdf`,
    })
    expect(classifyMarkdownLink('file:///C:/Users/me/My%20Report.pdf')).toEqual({
      kind: 'file',
      path: 'C:/Users/me/My Report.pdf',
    })
    expect(classifyMarkdownLink('docs/My%20Report.pdf#L4')).toEqual({
      kind: 'file',
      path: 'docs/My Report.pdf',
      line: 4,
    })
  })

  test('routes supported external protocols out of the webview', () => {
    expect(classifyMarkdownLink('https://example.com/report.pdf')).toEqual({
      kind: 'external',
      href: 'https://example.com/report.pdf',
      newTab: true,
    })
    expect(classifyMarkdownLink('mailto:hello@example.com')).toMatchObject({
      kind: 'external',
      newTab: false,
    })
    expect(classifyMarkdownLink('tel:+35799123456')).toMatchObject({
      kind: 'external',
      newTab: false,
    })
  })

  test('an agent links any read-only app view; action links stay inert', () => {
    for (const href of [
      'localix://resource/chess/game/LOCALIX-1',
      'localix://ui/work-item/terminal?session=LOCALIX-1',
      'localix://ui/settings/tools',
    ]) {
      expect(classifyMarkdownLink(href), href).toEqual({ kind: 'app-view', href })
      expect(markdownUrlTransform(href, 'href'), href).toBe(href)
    }
    expect(classifyMarkdownLink('localix://ui/action/command/plugins.enable')).toEqual({
      kind: 'inert',
    })
  })

  test('keeps unknown, unsafe, malformed, and hash-router links inert', () => {
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,bad',
      'irc://example.com',
      '#section',
      'localix://ui/work-item/file?path=%2Fa.ts&unknown=1',
      'sandbox://remote.example/report.pdf',
      'file://remote.example/report.pdf',
      'just-a-word',
    ]) {
      expect(classifyMarkdownLink(href), href).toEqual({ kind: 'inert' })
      expect(markdownUrlTransform(href, 'href'), href).toBeUndefined()
    }
  })
})

describe('markdownUrlTransform', () => {
  test('preserves explicit file/external routes and sanitizes non-link resources', () => {
    expect(markdownUrlTransform('localix://ui/work-item/file?path=src%2Fa.ts', 'href')).toBe(
      'localix://ui/work-item/file?path=src%2Fa.ts',
    )
    expect(markdownUrlTransform('tel:+35799123456', 'href')).toBe('tel:+35799123456')
    expect(markdownUrlTransform('https://example.com', 'href')).toBe('https://example.com')
    expect(markdownUrlTransform('javascript:alert(1)', 'src')).toBeUndefined()
    expect(markdownUrlTransform('/images/chart.png', 'src')).toBe('/images/chart.png')
  })
})

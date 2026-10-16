import { describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'

import { rewriteMobiDocumentLinks } from './mobi'

function documentFor(html: string): Document {
  return parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document
}

describe('MOBI/KF8 link rewriting', () => {
  test('a rejected destination does not block the next link', async () => {
    const source = documentFor(
      '<a href="filepos:bad" data-reader-chapter="99">Broken</a><a href="filepos:good">Next</a>',
    )
    const target = documentFor('<p id="destination">Destination</p>')
    const calls: string[] = []
    await rewriteMobiDocumentLinks(
      [
        { sourceIndex: 0, document: source },
        { sourceIndex: 4, document: target },
      ],
      {
        isExternal: () => false,
        async resolveHref(href) {
          calls.push(href)
          if (href === 'filepos:bad') throw new Error('Unresolvable position')
          return { index: 4, anchor: (document) => document.querySelector('p') }
        },
      },
    )
    expect(calls).toEqual(['filepos:bad', 'filepos:good'])
    const [broken, next] = Array.from(source.querySelectorAll('a'))
    expect(broken?.hasAttribute('href')).toBe(false)
    expect(broken?.hasAttribute('data-reader-chapter')).toBe(false)
    expect(next?.getAttribute('href')).toBe('#destination')
    expect(next?.getAttribute('data-reader-chapter')).toBe('1')
  })

  test('maps file positions to Reader chapter fragments and keeps safe external links', async () => {
    const first = documentFor(
      '<a filepos="120">Next chapter</a><a href="https://example.com/source" data-reader-chapter="99">Source</a><a href="tel:+35799123456">Call</a>',
    )
    const second = documentFor('<p id="filepos120">Destination</p>')

    await rewriteMobiDocumentLinks(
      [
        { sourceIndex: 0, document: first },
        { sourceIndex: 4, document: second },
      ],
      {
        isExternal: (href) => /^(?!filepos)\w+:/iu.test(href),
        resolveHref: (href) => ({
          index: 4,
          anchor: (document) => document.getElementById(`filepos${href.replace('filepos:', '')}`),
        }),
      },
    )

    const internal = first.querySelector<HTMLAnchorElement>('a[filepos]')!
    expect(internal.getAttribute('href')).toBe('#filepos120')
    expect(internal.dataset.readerChapter).toBe('1')
    expect(internal.dataset.readerFragment).toBe('filepos120')
    expect(first.querySelectorAll('a')[1]?.getAttribute('href')).toBe('https://example.com/source')
    expect(first.querySelectorAll('a')[1]?.hasAttribute('data-reader-chapter')).toBe(false)
    expect(first.querySelectorAll('a')[2]?.getAttribute('href')).toBe('tel:+35799123456')
  })

  test('creates stable Reader fragments for KF8 selectors and strips unresolved destinations', async () => {
    const first = documentFor(
      '<a href="kindle:pos:fid:0001:off:0002">Resolved</a><a href="kindle:pos:fid:ffff:off:ffff">Missing</a>',
    )
    const second = documentFor('<p class="target">Destination without an id</p>')

    await rewriteMobiDocumentLinks(
      [
        { sourceIndex: 2, document: first },
        { sourceIndex: 8, document: second },
      ],
      {
        isExternal: () => false,
        resolveHref: (href) =>
          href.includes('0001')
            ? { index: 8, anchor: (document) => document.querySelector('.target') }
            : undefined,
      },
    )

    const [resolved, missing] = Array.from(first.querySelectorAll<HTMLAnchorElement>('a'))
    const fragment = second.querySelector<HTMLElement>('.target')?.id
    expect(fragment).toBe('reader-mobi-2-1')
    expect(resolved?.getAttribute('href')).toBe(`#${fragment}`)
    expect(resolved?.dataset.readerChapter).toBe('1')
    expect(missing?.hasAttribute('href')).toBe(false)
  })

  test('does not expose unsupported external schemes to the rendered document', async () => {
    const document = documentFor('<a href="ftp://example.com/file">Unsupported</a>')
    await rewriteMobiDocumentLinks([{ sourceIndex: 0, document }], {
      isExternal: () => true,
    })
    expect(document.querySelector('a')?.hasAttribute('href')).toBe(false)
  })

  test('replaces target ids that the shared sanitizer would discard', async () => {
    const source = documentFor('<a href="filepos:44">Target</a>')
    const target = documentFor('<p id="bad&#10;id">Destination</p>')
    await rewriteMobiDocumentLinks(
      [
        { sourceIndex: 0, document: source },
        { sourceIndex: 1, document: target },
      ],
      {
        isExternal: () => false,
        resolveHref: () => ({ index: 1, anchor: (document) => document.querySelector('p') }),
      },
    )
    expect(target.querySelector('p')?.id).toBe('reader-mobi-2-1')
    expect(source.querySelector('a')?.getAttribute('href')).toBe('#reader-mobi-2-1')
  })
})

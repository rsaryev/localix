import { expect, test } from 'bun:test'
import { spaceTypes } from '../types'
import { asWebUrl, contentFromText, webLinksInText } from './text'

test('web addresses can be pasted as link cards, including www addresses', () => {
  expect(contentFromText('https://example.com/guide?q=1#part', spaceTypes)).toEqual({
    type: 'link',
    props: { url: 'https://example.com/guide?q=1#part' },
  })
  expect(contentFromText('www.example.com/guide', spaceTypes)).toEqual({
    type: 'link',
    props: { url: 'https://www.example.com/guide' },
  })
  for (const value of ['javascript:alert(1)', 'file:///private/data', 'not a URL', 'https://']) {
    expect(asWebUrl(value)).toBeNull()
    expect(contentFromText(value, spaceTypes).type).toBe('note')
  }
})

test('note links preserve prose, query strings and balanced parentheses', () => {
  const text = 'Read (https://example.com/wiki/A_(B)).\nThen WWW.example.com?q=1&lang=ru!'
  const links = webLinksInText(text)
  expect(links.map((link) => link.url)).toEqual([
    'https://example.com/wiki/A_(B)',
    'https://www.example.com/?q=1&lang=ru',
  ])
  for (const link of links) expect(text.slice(link.start, link.end)).toBe(link.text)
  expect(text.slice(links[0]!.end, links[1]!.start)).toBe(').\nThen ')
  expect(webLinksInText('Plain text, javascript:alert(1), file:///tmp and https://')).toEqual([])
})

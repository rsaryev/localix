import { expect, test } from 'bun:test'
import { truncateHead, truncateTail } from './truncate'

test('keeps complete Unicode characters when only a partial trailing line fits', () => {
  expect(truncateTail('prefix😀', { maxBytes: 4 })).toMatchObject({
    content: '😀',
    outputBytes: 4,
    outputLines: 1,
    lastLinePartial: true,
    truncatedBy: 'bytes',
  })
  expect(truncateTail('prefix😀', { maxBytes: 3 })).toMatchObject({
    content: '',
    outputBytes: 0,
    lastLinePartial: true,
  })
  expect(truncateHead('😀', { maxBytes: 3 })).toMatchObject({
    content: '',
    outputBytes: 0,
    firstLineExceedsLimit: true,
  })
})

test('replaces unpaired surrogates only in partial-line suffixes', () => {
  expect(truncateTail('xx\ud800z', { maxBytes: 4 })).toMatchObject({
    content: '�z',
    outputBytes: 4,
    lastLinePartial: true,
  })
  for (const truncate of [truncateHead, truncateTail]) {
    expect(truncate('a\ud800', { maxBytes: 4 })).toMatchObject({
      content: 'a\ud800',
      truncated: false,
    })
    expect(truncate('a\udc00', { maxBytes: 4 })).toMatchObject({
      content: 'a\udc00',
      truncated: false,
    })
  }
})

import { expect, test } from 'bun:test'

import { researchInputSchema } from './research'
import { prepareResearchArguments } from './research-input'

const parse = (raw: unknown) => researchInputSchema.parse(prepareResearchArguments(raw))

test('WebSearch’s query, allowed_domains and blocked_domains are this tool’s', () => {
  expect(
    parse({ query: 'bun test timeout', allowed_domains: ['bun.sh'], blocked_domains: ['x.io'] }),
  ).toMatchObject({
    question: 'bun test timeout',
    include_domains: ['bun.sh'],
    exclude_domains: ['x.io'],
  })
})

test('WebFetch’s url and prompt read that page for that question', () => {
  expect(parse({ url: 'https://example.com/a', prompt: 'What is the price?' })).toMatchObject({
    question: 'What is the price?',
    urls: ['https://example.com/a'],
  })
  // No prompt: the page itself is the question.
  expect(parse({ url: 'https://example.com/a' })).toMatchObject({
    question: 'https://example.com/a',
    urls: ['https://example.com/a'],
  })
})

test('a url joins urls once, first; the native fields stay', () => {
  expect(
    parse({ question: 'q', url: 'https://a.test', urls: ['https://b.test', 'https://a.test'] }),
  ).toMatchObject({ question: 'q', urls: ['https://a.test', 'https://b.test'] })
})

test('two spellings of one thing that disagree are refused, never guessed', () => {
  expect(() => prepareResearchArguments({ question: 'a', query: 'b' })).toThrow(/query/)
  expect(() =>
    prepareResearchArguments({ question: 'a', prompt: 'b', url: 'https://x.test' }),
  ).toThrow(/prompt/)
  expect(() =>
    prepareResearchArguments({
      question: 'a',
      allowed_domains: ['x.io'],
      include_domains: ['y.io'],
    }),
  ).toThrow(/allowed_domains/)
})

test('a native call passes through untouched', () => {
  const raw = { question: 'q', queries: ['a'], urls: ['https://a.test'] }
  expect(prepareResearchArguments(raw)).toBe(raw)
})

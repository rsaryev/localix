import { describe, expect, test } from 'bun:test'

import { extractJsonBlock, jsonCandidates } from './extract-json-block'

describe('extractJsonBlock', () => {
  test('reads a labelled fence surrounded by prose', () => {
    const text = 'Here is where I got to.\n```json\n{"status":"complete"}\n```\nHope that helps.'
    expect(extractJsonBlock(text)?.value).toEqual({ status: 'complete' })
    expect(extractJsonBlock(text)?.source).toBe('fence')
  })

  test('an unlabelled fence is not a refusal', () => {
    expect(extractJsonBlock('```\n{"status":"blocked"}\n```')?.value).toEqual({ status: 'blocked' })
  })

  test('a bare object in prose is the fallback', () => {
    const found = extractJsonBlock('I think the answer is {"status":"working"} for now.')
    expect(found?.value).toEqual({ status: 'working' })
    expect(found?.source).toBe('bare')
  })

  test('a revised reply hands back the LAST block, not the first', () => {
    const text =
      '```json\n{"status":"working"}\n```\nActually:\n```json\n{"status":"complete"}\n```'
    expect(extractJsonBlock(text)?.value).toEqual({ status: 'complete' })
  })

  test('prose that mentions braces does not steal the object', () => {
    // Scanning back from the final `}` and counting depth is what makes this work; taking
    // the first `{` in the message would start inside the sentence.
    const text = 'An empty object is written { like this }. My answer:\n{"status":"complete"}'
    expect(extractJsonBlock(text)?.value).toEqual({ status: 'complete' })
  })

  test('nested objects come back whole', () => {
    const text =
      '```json\n{"status":"blocked","blocker":{"code":"needs-key","message":"no token"}}\n```'
    expect(extractJsonBlock(text)?.value).toEqual({
      status: 'blocked',
      blocker: { code: 'needs-key', message: 'no token' },
    })
  })

  test('`accept` lets a caller skip a block that parses but does not answer', () => {
    // The example from the prompt is earlier; the real answer is later. Without `accept` a
    // caller that needs `status` would still be right here — with it, it is right when the
    // model echoes the example LAST.
    const text = [
      'Answer in this form:',
      '```json',
      '{"example":true}',
      '```',
      '```json',
      '{"status":"complete","summary":"done"}',
      '```',
      'And an echo of the template: {"example":true}',
    ].join('\n')
    const found = extractJsonBlock(text, (value) => typeof value.status === 'string')
    expect(found?.value.status).toBe('complete')
  })

  test('nothing to find reports nothing — never a guess', () => {
    expect(extractJsonBlock('I could not finish, sorry.')).toBeUndefined()
    expect(extractJsonBlock('')).toBeUndefined()
  })

  test('malformed JSON is skipped, and an earlier valid block still wins', () => {
    const text = '```json\n{"status":"complete"}\n```\n```json\n{"status": oops}\n```'
    expect(extractJsonBlock(text)?.value).toEqual({ status: 'complete' })
  })

  test('an array or a scalar is not an object and is refused', () => {
    expect(extractJsonBlock('```json\n[1,2,3]\n```')).toBeUndefined()
    expect(extractJsonBlock('```json\n"just a string"\n```')).toBeUndefined()
    expect(extractJsonBlock('```json\nnull\n```')).toBeUndefined()
  })

  test('the raw text that parsed is reported, for a diagnostic that can quote it', () => {
    expect(extractJsonBlock('```json\n{"a":1}\n```')?.raw).toBe('{"a":1}')
  })
})

describe('jsonCandidates', () => {
  test('yields fences last-first, then the bare fallback', () => {
    const text = '```json\n{"n":1}\n```\n```json\n{"n":2}\n```\ntail {"n":3}'
    const sources = [...jsonCandidates(text)].map((c) => c.source)
    expect(sources).toEqual(['fence', 'fence', 'bare'])
    expect([...jsonCandidates(text)][0]?.raw.trim()).toBe('{"n":2}')
  })

  test('yields nothing when the text holds no closing brace', () => {
    expect([...jsonCandidates('no json here')]).toEqual([])
  })
})

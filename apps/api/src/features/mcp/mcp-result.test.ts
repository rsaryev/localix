import { afterEach, describe, expect, test } from 'bun:test'

import {
  capMcpErrorMessage,
  mapCallResult,
  MCP_RESULT_MAX_ANNOTATION_CHARS,
  resolveMcpResultMaxChars,
  MCP_RESULT_DEFAULT_MAX_CHARS,
} from './mcp-result'
import { readMaxResultChars } from './mcp-tools'

describe('resolveMcpResultMaxChars', () => {
  const prev = process.env.MAX_MCP_OUTPUT_TOKENS
  afterEach(() => {
    if (prev === undefined) delete process.env.MAX_MCP_OUTPUT_TOKENS
    else process.env.MAX_MCP_OUTPUT_TOKENS = prev
  })

  test('a per-tool annotation wins over everything', () => {
    process.env.MAX_MCP_OUTPUT_TOKENS = '1000'
    expect(resolveMcpResultMaxChars(5000)).toBe(5000)
  })

  test('MAX_MCP_OUTPUT_TOKENS is a token budget → chars ≈ ×4', () => {
    process.env.MAX_MCP_OUTPUT_TOKENS = '2000'
    expect(resolveMcpResultMaxChars()).toBe(8000)
  })

  test('falls back to the built-in default when unset', () => {
    delete process.env.MAX_MCP_OUTPUT_TOKENS
    expect(resolveMcpResultMaxChars()).toBe(MCP_RESULT_DEFAULT_MAX_CHARS)
  })
})

describe('mapCallResult honors an explicit maxChars', () => {
  test('a small cap truncates text and marks it', () => {
    const r = mapCallResult([{ type: 'text', text: 'x'.repeat(500) }], false, 100)
    expect(r.content.length).toBeLessThan(200)
    expect(r.content).toContain('truncated at 100 chars')
  })

  test('normalizes embedded resources and resource links into first-class provenance', () => {
    const result = mapCallResult(
      [
        {
          type: 'resource',
          resource: {
            uri: 'docs://guide/current',
            title: 'Current guide',
            text: 'The exact guide content.',
            mimeType: 'text/markdown',
          },
        },
        {
          type: 'resource_link',
          uri: 'https://example.com/related',
          name: 'Related source',
          description: 'Found but not loaded.',
        },
      ],
      false,
      1_000,
      { provider: 'MCP · docs' },
    )

    expect(result.content).toContain('The exact guide content.')
    expect(result.sources).toEqual([
      expect.objectContaining({
        kind: 'resource',
        title: 'Current guide',
        uri: 'docs://guide/current',
        role: 'consulted',
        status: 'available',
        provider: 'MCP · docs',
      }),
      expect.objectContaining({
        title: 'Related source',
        uri: 'https://example.com/related',
        role: 'discovered',
        status: 'available',
      }),
    ])
  })

  test('does not call an embedded resource consulted when its text missed the shared budget', () => {
    const result = mapCallResult(
      [
        { type: 'text', text: 'budget' },
        {
          type: 'resource',
          resource: { uri: 'docs://late', text: 'unread because the budget is exhausted' },
        },
      ],
      false,
      6,
    )

    expect(result.sources?.[0]).toMatchObject({
      uri: 'docs://late',
      role: 'discovered',
      status: 'available',
    })
  })

  test('degrades malformed multimodal parts without throwing across the MCP boundary', () => {
    const result = mapCallResult(
      [
        null,
        { type: 'image', data: 42, mimeType: false },
        { type: 'resource', resource: { uri: 42, text: 'untrusted resource text' } },
      ] as never,
      false,
      1_000,
    )

    expect(result.content).toContain('[unknown]')
    expect(result.content).toContain('[image]')
    expect(result.content).toContain('untrusted resource text')
    expect(result.sources).toBeUndefined()
  })

  test('bounds malformed/unknown part counts through the cumulative text budget', () => {
    const result = mapCallResult(Array.from({ length: 10_000 }, () => null) as never, false, 100)

    expect(result.content).toContain('MCP result truncated')
    expect(result.content.length).toBeLessThan(200)
    expect(() => mapCallResult({ not: 'an array' } as never, false, 100)).not.toThrow()
  })
})

describe('capMcpErrorMessage', () => {
  test('preserves small errors and bounds oversized errors by UTF-8 bytes', () => {
    expect(capMcpErrorMessage('connection closed', 100)).toBe('connection closed')

    const capped = capMcpErrorMessage('\ud83d\udea8'.repeat(1_000), 100)
    expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(100)
    expect(capped).toContain('MCP error truncated')
    // Never split a surrogate pair while taking the prefix.
    expect(capped).not.toContain('\ufffd')
  })

  test('honors tiny and zero third-party limits', () => {
    expect(Buffer.byteLength(capMcpErrorMessage('too large', 4), 'utf8')).toBe(4)
    expect(capMcpErrorMessage('too large', 0)).toBe('')
  })
})

describe('readMaxResultChars', () => {
  // The annotation arrives in the SERVER's tool definition, so an unclamped one let the party
  // being capped remove its own cap. 100_000_000 bought a 100 MB text result: the wire pruner
  // would bound it later, but the persisted tool item and the UI stream carried it whole.
  test('clamps an annotation that tries to raise the cap past the host ceiling', () => {
    expect(resolveMcpResultMaxChars(100_000_000)).toBe(MCP_RESULT_MAX_ANNOTATION_CHARS)
    expect(resolveMcpResultMaxChars(Number.MAX_SAFE_INTEGER)).toBe(MCP_RESULT_MAX_ANNOTATION_CHARS)
  })

  test('lets an annotation LOWER the cap without restriction', () => {
    // A server that knows its output is small is welcome to say so; only raising is bounded.
    expect(resolveMcpResultMaxChars(500)).toBe(500)
    expect(resolveMcpResultMaxChars(MCP_RESULT_DEFAULT_MAX_CHARS)).toBe(
      MCP_RESULT_DEFAULT_MAX_CHARS,
    )
  })

  test("a tool may raise its text to Claude Code's 500,000-character ceiling, not past it", () => {
    expect(resolveMcpResultMaxChars(400_000)).toBe(400_000)
    expect(resolveMcpResultMaxChars(600_000)).toBe(500_000)
  })

  test('admits a genuinely larger request up to the ceiling', () => {
    const asked = MCP_RESULT_DEFAULT_MAX_CHARS * 2
    expect(resolveMcpResultMaxChars(asked)).toBe(asked)
  })

  test('reads anthropic/maxResultSizeChars at the top level', () => {
    expect(readMaxResultChars({ name: 't', 'anthropic/maxResultSizeChars': 12000 })).toBe(12000)
  })
  test('reads it from the annotations object', () => {
    expect(
      readMaxResultChars({ name: 't', annotations: { 'anthropic/maxResultSizeChars': 8000 } }),
    ).toBe(8000)
  })
  test('undefined when absent or non-positive', () => {
    expect(readMaxResultChars({ name: 't' })).toBeUndefined()
    expect(readMaxResultChars({ name: 't', 'anthropic/maxResultSizeChars': 0 })).toBeUndefined()
    expect(readMaxResultChars(null)).toBeUndefined()
  })
})

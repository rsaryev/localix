import { describe, expect, test } from 'bun:test'

import { replacementContent } from './tool-output-replacement'

/**
 * The text the model sees in place of a tool's output once the kit accepted a PostToolUse hook's
 * replacement (hooks.md, "PostToolUse decision control"): the kit picks `updatedToolOutput` or an
 * MCP tool's `updatedMCPToolOutput` and drops a built-in tool's value of the wrong shape; Localix
 * reads the accepted value in its tool's shape.
 */
describe('a replacement the kit accepted', () => {
  test('a string is the text itself, an empty one included', () => {
    expect(replacementContent('Bash', 'redacted')).toBe('redacted')
    expect(replacementContent('Bash', '')).toBe('')
  })

  test('a built-in tool’s record is read in its own shape', () => {
    expect(replacementContent('Bash', { stdout: 'out', stderr: 'err' })).toBe('out\nerr')
    expect(replacementContent('Read', { file: { content: 'text' } })).toBe('text')
    expect(replacementContent('Search', { filenames: ['a', 'b'] })).toBe('a\nb')
    expect(replacementContent('Research', { results: ['x', { y: 1 }, 'z'] })).toBe('x\nz')
  })

  test('an MCP tool’s content blocks are their text, anything else its JSON', () => {
    expect(replacementContent('mcp_s_t', [{ type: 'text', text: 'one' }])).toBe('one')
    expect(replacementContent('mcp_s_t', { content: [{ type: 'text', text: 'two' }] })).toBe('two')
    expect(replacementContent('mcp_s_t', { n: 1 })).toBe('{"n":1}')
  })

  test('nothing replaced is undefined', () => {
    expect(replacementContent('Bash', undefined)).toBeUndefined()
    expect(replacementContent('Edit', { filePath: 'a' })).toBeUndefined()
  })
})

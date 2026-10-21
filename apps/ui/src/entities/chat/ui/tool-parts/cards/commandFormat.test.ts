import { describe, expect, test } from 'bun:test'

import { extractCommentLabel, formatCommand } from './commandFormat'

describe('extractCommentLabel', () => {
  test('reads a # comment on the first non-empty line', () => {
    expect(extractCommentLabel('# build the app\nnpm run build')).toBe('build the app')
    expect(extractCommentLabel('\n\n   # spaced  \nx')).toBe('spaced')
  })
  test('null when the first non-empty line is not a comment', () => {
    expect(extractCommentLabel('npm install')).toBeNull()
    expect(extractCommentLabel('echo hi\n# not first')).toBeNull()
  })
  test('an empty comment (# with nothing after) → null', () => {
    expect(extractCommentLabel('#   ')).toBeNull()
  })
})

describe('formatCommand', () => {
  test('prefers the comment label', () => {
    expect(formatCommand('# deploy to prod\nterraform apply')).toBe('deploy to prod')
  })
  test('short single-line command passes through unchanged', () => {
    expect(formatCommand('ls -la')).toBe('ls -la')
  })
  test('more than 2 lines → first 2 joined + ellipsis', () => {
    expect(formatCommand('a\nb\nc\nd')).toBe('a\nb…')
  })
  test('over the char limit → sliced + ellipsis', () => {
    const long = 'x'.repeat(200)
    const out = formatCommand(long)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBe(161) // 160 chars + the ellipsis
  })
  test('a label longer than the char limit is itself truncated', () => {
    const out = formatCommand('# ' + 'y'.repeat(200))
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBe(161)
  })
})

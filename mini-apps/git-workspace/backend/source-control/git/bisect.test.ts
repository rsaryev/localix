import { describe, expect, test } from 'bun:test'
import { parseBisectOutput } from './bisect'

describe('parseBisectOutput (pure)', () => {
  test('parses the progress line (plural)', () => {
    const r = parseBisectOutput(
      'Bisecting: 3 revisions left to test after this (roughly 2 steps)\n[abc123] c4',
    )
    expect(r.revisionsLeft).toBe(3)
    expect(r.stepsLeft).toBe(2)
    expect(r.firstBadSha).toBeUndefined()
  })

  test('parses the singular progress line (1 revision / 1 step)', () => {
    const r = parseBisectOutput(
      'Bisecting: 1 revision left to test after this (roughly 1 step)\n[def] c6',
    )
    expect(r.revisionsLeft).toBe(1)
    expect(r.stepsLeft).toBe(1)
  })

  test('parses the 0-remaining progress line', () => {
    const r = parseBisectOutput(
      'Bisecting: 0 revisions left to test after this (roughly 0 steps)\n[x] c5',
    )
    expect(r.revisionsLeft).toBe(0)
    expect(r.stepsLeft).toBe(0)
  })

  test('parses the terminal first-bad-commit verdict', () => {
    const sha = '6404b511ecb45b806d0018b7266108d5aa097298'
    const r = parseBisectOutput(
      `${sha} is the first bad commit\ncommit ${sha}\nAuthor: t <t@t.co>\n`,
    )
    expect(r.firstBadSha).toBe(sha)
    expect(r.revisionsLeft).toBeUndefined()
  })

  test('returns empty for unrecognized output', () => {
    expect(parseBisectOutput('some other git chatter')).toEqual({})
  })
})

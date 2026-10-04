import { describe, expect, test } from 'bun:test'
import { parseMergeConflicts, resolveMergeConflict } from './mergeConflicts'

const yaml = `service:
<<<<<<< HEAD
  serviceVersion: 0.2.20
=======
  serviceVersion: 0.2.21
>>>>>>> release
`

describe('parseMergeConflicts', () => {
  test('parses a two-way conflict and labels both sides', () => {
    const [region] = parseMergeConflicts(yaml)
    expect(region).toMatchObject({
      startLine: 2,
      endLine: 6,
      currentLabel: 'HEAD',
      incomingLabel: 'release',
    })
  })

  test('parses diff3 base content', () => {
    const text = `<<<<<<< ours
a
||||||| base
b
=======
c
>>>>>>> theirs
`
    const [region] = parseMergeConflicts(text)
    expect(region.baseLabel).toBe('base')
    expect(text.slice(region.base!.startOffset, region.base!.endOffset)).toBe('b\n')
  })

  test('ignores malformed blocks and finds a later complete block', () => {
    const text = `<<<<<<< broken
no separator
${yaml}`
    expect(parseMergeConflicts(text)).toHaveLength(1)
  })

  test('parses multiple independent blocks in document order', () => {
    const text = `${yaml}\n${yaml.replace('0.2.20', '0.3.0')}`
    const regions = parseMergeConflicts(text)
    expect(regions).toHaveLength(2)
    expect(regions[0].startOffset).toBeLessThan(regions[1].startOffset)
  })
})

describe('resolveMergeConflict', () => {
  test('keeps current, incoming, or both versions', () => {
    const [region] = parseMergeConflicts(yaml)
    expect(resolveMergeConflict(yaml, region, 'current')).toBe(
      `service:
  serviceVersion: 0.2.20
`,
    )
    expect(resolveMergeConflict(yaml, region, 'incoming')).toContain('0.2.21')
    expect(resolveMergeConflict(yaml, region, 'both')).toContain(
      '  serviceVersion: 0.2.20\n  serviceVersion: 0.2.21\n',
    )
  })

  test('preserves CRLF line endings', () => {
    const text = yaml.replaceAll('\n', '\r\n')
    const [region] = parseMergeConflicts(text)
    const resolved = resolveMergeConflict(text, region, 'incoming')
    expect(resolved).toBe('service:\r\n  serviceVersion: 0.2.21\r\n')
  })
})

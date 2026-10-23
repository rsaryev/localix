import { describe, expect, test } from 'bun:test'
import { parseUnifiedHunks } from './hunks'

describe('parseUnifiedHunks', () => {
  test('splits the file header from hunks and keeps body prefixes', () => {
    const diff = [
      'diff --git a/f.txt b/f.txt',
      'index f62562a..89026df 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -2 +2 @@ line1',
      '-line2',
      '+CHANGED2',
      '@@ -4,0 +5 @@ line4',
      '+ADDEDX',
      '@@ -7 +7,0 @@ line6',
      '-line7',
      '',
    ].join('\n')
    const { fileHeader, hunks } = parseUnifiedHunks(diff)
    expect(fileHeader).toBe(
      'diff --git a/f.txt b/f.txt\nindex f62562a..89026df 100644\n--- a/f.txt\n+++ b/f.txt',
    )
    expect(hunks).toHaveLength(3)
    expect(hunks[0]).toMatchObject({
      header: '@@ -2 +2 @@ line1',
      newStart: 2,
      newCount: 1,
      body: ['-line2', '+CHANGED2'],
    })
    expect(hunks[1]).toMatchObject({
      header: '@@ -4,0 +5 @@ line4',
      newStart: 5,
      newCount: 1,
      body: ['+ADDEDX'],
    })
    // A pure deletion carries newCount 0.
    expect(hunks[2]).toMatchObject({
      header: '@@ -7 +7,0 @@ line6',
      newStart: 7,
      newCount: 0,
      body: ['-line7'],
    })
  })

  test('empty diff yields no hunks', () => {
    expect(parseUnifiedHunks('').hunks).toHaveLength(0)
  })
})

// --- Real-git integration (temp repo) ----------------------------------------

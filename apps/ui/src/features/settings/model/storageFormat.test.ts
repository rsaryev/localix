import { describe, expect, test } from 'bun:test'

import { formatBytes, pruneSummary, retentionValue, usageLines } from './storageFormat'

describe('formatBytes', () => {
  test('scales and rounds', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(123 * 1024 * 1024)).toBe('123 MB')
    expect(formatBytes(4.2 * 1024 ** 3)).toBe('4.2 GB')
  })
})

describe('usageLines', () => {
  const usage = {
    fileBytes: 0,
    walBytes: 0,
    freeBytes: 0,
    messageBytes: 100,
    toolOutputBytes: 300,
    toolOutputRawBytes: 600,
    searchIndexBytes: 0,
  }
  test('largest first and without empty lines', () => {
    expect(usageLines(usage).map((line) => line.key)).toEqual(['outputs', 'messages'])
  })
})

describe('pruneSummary', () => {
  test('says what a count would do and what a removal did', () => {
    expect(pruneSummary({ sessions: 0, bytes: 0, dryRun: true })).toBe(
      'No conversations are that old.',
    )
    expect(pruneSummary({ sessions: 1, bytes: 2048, dryRun: true })).toBe(
      '1 conversation, about 2.0 KB of history, would be removed.',
    )
    expect(pruneSummary({ sessions: 3, bytes: 1048576, dryRun: false })).toBe(
      'Removed 3 conversations, about 1.0 MB of history.',
    )
  })
})

test('retentionValue maps absent to off', () => {
  expect(retentionValue(undefined)).toBe('off')
  expect(retentionValue(90)).toBe('90')
})

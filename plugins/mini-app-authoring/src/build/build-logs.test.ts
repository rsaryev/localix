import { describe, expect, test } from 'bun:test'

import { formatBuildLogs } from './build-logs'

describe('build logs', () => {
  // "Could not resolve: zod" without the importing file sent the agent searching for it.
  test('a bundler error names its file, line and column relative to the mini app', () => {
    const logs = [
      {
        message: 'Could not resolve: "left-pad"',
        position: { file: '/p/ui/A.tsx', line: 3, column: 18 },
      },
      { message: 'no position here', position: null },
    ]
    expect(formatBuildLogs(logs, '/p')).toBe(
      'ui/A.tsx:3:18 Could not resolve: "left-pad"\nno position here',
    )
  })
})

import { describe, expect, test } from 'bun:test'
import { instructionFilesForHooks } from './cc-hooks-build-helpers'

describe('InstructionsLoaded', () => {
  test('reports every instruction file but an AGENTS.md read directly', () => {
    const files = [
      { path: '/repo/AGENTS.md' },
      { path: '/repo/CLAUDE.md' },
      { path: '/repo/pkg/AGENTS.md' },
      { path: '/home/me/.localix/context.md' },
    ]
    expect(instructionFilesForHooks(files).map((file) => file.path)).toEqual([
      '/repo/CLAUDE.md',
      '/home/me/.localix/context.md',
    ])
    expect(instructionFilesForHooks(undefined)).toEqual([])
  })
})
